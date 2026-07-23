import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test, vi } from "vitest";

import { buildServerProgram } from "@/adapters/server/production/compiler";
import { compileSystem } from "@/compiler/source";
import { createMemoryEventStore } from "@/features/entity.testing";
import { createWorkflow, type WorkflowJournalEvent, type WorkflowModel } from "@/features/workflow";
import { createWorkflowFixture, createWorkflowTestClock } from "@/features/workflow.testing";

type Approval = WorkflowModel<{
  Name: "approval";
  Input: Readonly<{ requestId: string }>;
  Result: Readonly<{ receipt: string; approved: boolean }>;
  State: { phase: "pending" | "charged" | "completed"; approved: boolean };
  Dependencies: {
    payments: {
      charge(input: { requestId: string }): Promise<{ receipt: string }>;
      refund(input: { receipt: string }): Promise<void>;
    };
  };
  Signals: {
    approve(input: { by: string }): void;
  };
  Queries: {
    status(input: {}): Readonly<{ phase: string; approved: boolean }>;
  };
}>;

function approvalWorkflow(
  operation: "charge" | "refund" = "charge",
  beforeEffect: "pending" | "charged" = "pending",
  approvedBySignal = true,
) {
  return createWorkflow<Approval>({
    name: "approval",
    state: () => ({ phase: "pending", approved: false }),
    retry: { attempts: 3, delay: ({ attempt }) => attempt * 10 },
    async run({ dependencies, state, sleep }, { requestId }) {
      state.phase = beforeEffect;
      const payment =
        operation === "charge"
          ? await dependencies.payments.charge({ requestId })
          : (await dependencies.payments.refund({ receipt: requestId }),
            {
              receipt: requestId,
            });
      state.phase = "charged";
      await sleep({ milliseconds: 1000 });
      state.phase = "completed";
      return { receipt: payment.receipt, approved: state.approved };
    },
    signals: {
      approve({ state }) {
        state.approved = approvedBySignal;
      },
    },
    queries: {
      status: ({ state }) => ({ phase: state.phase, approved: state.approved }),
    },
  });
}

describe("semantic workflow Feature", () => {
  test("lowers a specialized factory through the production semantic compiler", async () => {
    const parent = resolve(process.cwd(), ".data");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(resolve(parent, "workflow-compiler-"));
    try {
      const entry = resolve(directory, "system.ts");
      await writeFile(entry, workflowSystemSource());
      const ir = compileSystem(entry);
      const contributions = ir.programs.flatMap(({ contributions }) => contributions);
      expect(
        contributions
          .filter(({ implementation }) => implementation.kind !== "portable")
          .map(({ id, implementation }) => ({ id, implementation })),
      ).toEqual([]);
      expect(contributions).toHaveLength(1);
      const program = ir.programs[0];
      if (!program) throw new Error("Workflow compiler fixture has no server Program.");
      const build = await buildServerProgram({
        system: ir.system.name,
        cache: resolve(parent, "workflow-production-cache"),
        directory,
        output: resolve(directory, "workflow-server"),
        program,
      });
      await expect(access(build.executable)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 120_000);

  test("runs durable dependencies, signals, queries, timers, and typed results", async () => {
    const charge = vi.fn(async () => ({ receipt: "receipt-1" }));
    const refund = vi.fn(async () => undefined);
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: { payments: { charge, refund } },
    });
    await fixture.api.start({ id: "one", input: { requestId: "request-1" } });
    await vi.waitFor(async () => {
      expect(await fixture.api.queries.status({ id: "one", input: {} })).toEqual({
        phase: "charged",
        approved: false,
      });
    });
    await fixture.api.signals.approve({ id: "one", input: { by: "alice" } });
    expect(await fixture.api.queries.status({ id: "one", input: {} })).toEqual({
      phase: "charged",
      approved: true,
    });
    fixture.clock.advance({ milliseconds: 1000 });
    await expect(fixture.api.result({ id: "one" })).resolves.toEqual({
      receipt: "receipt-1",
      approved: true,
    });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(refund).not.toHaveBeenCalled();
  });

  test("replays completed effects exactly once across a worker restart", async () => {
    const charge = vi.fn(async () => ({ receipt: "receipt-2" }));
    const refund = vi.fn(async () => undefined);
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: { payments: { charge, refund } },
    });
    await fixture.api.start({ id: "restart", input: { requestId: "request-2" } });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    await fixture.restart();
    await fixture.api.start({ id: "restart", input: { requestId: "request-2" } });
    await vi.waitFor(async () => {
      expect((await fixture.api.get({ id: "restart" })).state.phase).toBe("charged");
    });
    expect(charge).toHaveBeenCalledTimes(1);
    fixture.clock.advance({ milliseconds: 1000 });
    await expect(fixture.api.result({ id: "restart" })).resolves.toMatchObject({
      receipt: "receipt-2",
    });
  });

  test("retries transient Dependency failures and journals only the durable result", async () => {
    let attempts = 0;
    const charge = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return { receipt: "receipt-3" };
    });
    const clock = createWorkflowTestClock();
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      clock,
      dependencies: { payments: { charge, refund: async () => undefined } },
    });
    const result = fixture.api.result({ id: "retry" });
    await fixture.api.start({ id: "retry", input: { requestId: "request-3" } });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    clock.advance({ milliseconds: 10 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(2));
    clock.advance({ milliseconds: 20 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(3));
    clock.advance({ milliseconds: 1000 });
    await expect(result).resolves.toMatchObject({ receipt: "receipt-3" });
    const history = await fixture.events.read({ stream: "workflow:approval:retry" });
    expect(history.filter(({ event }) => event.type === "workflow.effect.completed")).toHaveLength(
      1,
    );
  });

  test("makes concurrent starts idempotent and rejects conflicting input", async () => {
    const charge = vi.fn(async () => ({ receipt: "receipt-4" }));
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: {
        payments: { charge, refund: async () => undefined },
      },
    });
    await Promise.all([
      fixture.api.start({ id: "same", input: { requestId: "request-4" } }),
      fixture.api.start({ id: "same", input: { requestId: "request-4" } }),
    ]);
    await expect(
      fixture.api.start({ id: "same", input: { requestId: "different" } }),
    ).rejects.toThrow("different input");
    const history = await fixture.events.read({ stream: "workflow:approval:same" });
    expect(history.filter(({ event }) => event.type === "workflow.started")).toHaveLength(1);
  });

  test("allows only one active writer for one identity across server replicas", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    const clock = createWorkflowTestClock();
    const charge = vi.fn(async () => ({ receipt: "replicated-receipt" }));
    const dependencies = {
      payments: { charge, refund: async () => undefined },
    };
    await using first = await createWorkflowFixture(approvalWorkflow(), {
      events,
      clock,
      dependencies,
    });
    await using second = await createWorkflowFixture(approvalWorkflow(), {
      events,
      clock,
      dependencies,
    });

    await Promise.all([
      first.api.start({ id: "replicated", input: { requestId: "request-replicated" } }),
      second.api.start({ id: "replicated", input: { requestId: "request-replicated" } }),
    ]);
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    clock.advance({ milliseconds: 1000 });
    await expect(second.api.result({ id: "replicated" })).resolves.toEqual({
      receipt: "replicated-receipt",
      approved: false,
    });
    const history = await events.read({ stream: "workflow:approval:replicated" });
    expect(history.filter(({ event }) => event.type === "workflow.worker.claimed")).toHaveLength(1);
  });

  test("renews ownership while a durable Dependency is still running", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    const clock = createWorkflowTestClock();
    let finish!: (value: { receipt: string }) => void;
    const charge = vi.fn(
      () =>
        new Promise<{ receipt: string }>((resolve) => {
          finish = resolve;
        }),
    );
    const dependencies = {
      payments: { charge, refund: async () => undefined },
    };
    await using first = await createWorkflowFixture(approvalWorkflow(), {
      events,
      clock,
      dependencies,
    });
    await using second = await createWorkflowFixture(approvalWorkflow(), {
      events,
      clock,
      dependencies,
    });

    await first.api.start({ id: "long", input: { requestId: "request-long" } });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    clock.advance({ milliseconds: 10_000 });
    await vi.waitFor(async () => {
      const history = await events.read({ stream: "workflow:approval:long" });
      expect(history.filter(({ event }) => event.type === "workflow.worker.claimed")).toHaveLength(
        2,
      );
    });
    await second.api.start({ id: "long", input: { requestId: "request-long" } });
    expect(charge).toHaveBeenCalledTimes(1);

    finish({ receipt: "long-receipt" });
    await vi.waitFor(async () => {
      expect((await first.api.get({ id: "long" })).state.phase).toBe("charged");
    });
    clock.advance({ milliseconds: 1000 });
    await expect(second.api.result({ id: "long" })).resolves.toMatchObject({
      receipt: "long-receipt",
    });
  });

  test("fails replay with a precise diagnostic when durable effect order changes", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    const clock = createWorkflowTestClock();
    const dependencies = {
      payments: {
        charge: vi.fn(async () => ({ receipt: "receipt-5" })),
        refund: vi.fn(async () => undefined),
      },
    };
    {
      await using original = await createWorkflowFixture(approvalWorkflow("charge"), {
        events,
        clock,
        dependencies,
      });
      await original.api.start({ id: "history", input: { requestId: "request-5" } });
      await vi.waitFor(() => expect(dependencies.payments.charge).toHaveBeenCalledTimes(1));
    }
    await using changed = await createWorkflowFixture(approvalWorkflow("refund"), {
      events,
      clock,
      dependencies,
    });
    await changed.api.start({ id: "history", input: { requestId: "request-5" } });
    await expect(changed.api.result({ id: "history" })).rejects.toMatchObject({
      failure: expect.objectContaining({
        message: expect.stringContaining("changed durable effect 1"),
      }),
    });
  });

  test("fails replay when state before a durable boundary changes", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    const clock = createWorkflowTestClock();
    const dependencies = {
      payments: {
        charge: vi.fn(async () => ({ receipt: "receipt-state" })),
        refund: vi.fn(async () => undefined),
      },
    };
    {
      await using original = await createWorkflowFixture(approvalWorkflow(), {
        events,
        clock,
        dependencies,
      });
      await original.api.start({ id: "state-history", input: { requestId: "request-state" } });
      await vi.waitFor(() => expect(dependencies.payments.charge).toHaveBeenCalledTimes(1));
    }
    await using changed = await createWorkflowFixture(approvalWorkflow("charge", "charged"), {
      events,
      clock,
      dependencies,
    });
    await changed.api.start({ id: "state-history", input: { requestId: "request-state" } });
    await expect(changed.api.result({ id: "state-history" })).rejects.toMatchObject({
      failure: expect.objectContaining({
        message: expect.stringContaining("changed state before durable boundary 1"),
      }),
    });
  });

  test("fails replay when a historical signal transition changes", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    const clock = createWorkflowTestClock();
    const dependencies = {
      payments: {
        charge: vi.fn(async () => ({ receipt: "receipt-signal" })),
        refund: vi.fn(async () => undefined),
      },
    };
    {
      await using original = await createWorkflowFixture(approvalWorkflow(), {
        events,
        clock,
        dependencies,
      });
      await original.api.start({ id: "signal-history", input: { requestId: "request-signal" } });
      await vi.waitFor(() => expect(dependencies.payments.charge).toHaveBeenCalledTimes(1));
      await original.api.signals.approve({
        id: "signal-history",
        input: { by: "alice" },
      });
      await vi.waitFor(async () => {
        expect(
          await original.api.queries.status({ id: "signal-history", input: {} }),
        ).toMatchObject({ approved: true });
      });
    }
    await using changed = await createWorkflowFixture(
      approvalWorkflow("charge", "pending", false),
      { events, clock, dependencies },
    );
    await changed.api.start({ id: "signal-history", input: { requestId: "request-signal" } });
    await expect(changed.api.result({ id: "signal-history" })).rejects.toMatchObject({
      failure: expect.objectContaining({
        message: expect.stringContaining('changed state after signal "approve"'),
      }),
    });
  });

  test("persists cancellation and does not complete after the timer wakes", async () => {
    const charge = vi.fn(async () => ({ receipt: "receipt-6" }));
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: {
        payments: { charge, refund: async () => undefined },
      },
    });
    await fixture.api.start({ id: "cancel", input: { requestId: "request-6" } });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    await fixture.api.cancel({ id: "cancel", reason: "no longer needed" });
    expect((await fixture.api.get({ id: "cancel" })).status).toBe("cancelled");
    fixture.clock.advance({ milliseconds: 1000 });
    await expect(fixture.api.result({ id: "cancel" })).rejects.toMatchObject({
      failure: { name: "WorkflowCancelled" },
    });
  });
});

function workflowSystemSource(): string {
  return `
import { createSystem, createWorkflow, type WorkflowModel } from "@/index";

type Reminder = WorkflowModel<{
  Name: "reminder";
  Input: { message: string };
  Result: { delivered: boolean };
  State: { phase: "pending" | "delivered" };
  Dependencies: {};
  Signals: {};
  Queries: {
    status(input: {}): { phase: "pending" | "delivered" };
  };
}>;

const reminder = createWorkflow<Reminder>({
  name: "reminder",
  state: () => ({ phase: "pending" }),
  async run({ state, sleep }, input) {
    await sleep({ milliseconds: 1 });
    state.phase = "delivered";
    return { delivered: input.message.length > 0 };
  },
  signals: {},
  queries: {
    status: ({ state }) => ({ phase: state.phase }),
  },
});

export default createSystem({ features: { reminder: reminder.server } });
`;
}
