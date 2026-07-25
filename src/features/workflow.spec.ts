import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { connect } from "@tursodatabase/database";
import fc from "fast-check";
import { describe, expect, test, vi } from "vitest";

import { createDevelopmentWorkflowRuntime } from "@/adapters/server/development/workflow";
import { buildServerProgram } from "@/adapters/server/production/compiler";
import { defineServerProductionDependency } from "@/adapters/server/production/dependencies";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import type {
  DeferredDependencyInvocation,
  DependencyInvocation,
  DependencyProviderInvocation,
} from "@/core/dependency";
import { createMemoryEventStore } from "@/features/entity.testing";
import {
  WORKFLOW_DEFINITION_VERSION,
  createWorkflow,
  type WorkflowActivityRetry,
  type WorkflowActivityTimeout,
  type WorkflowJournalEvent,
  type WorkflowModel,
} from "@/features/workflow";
import {
  createWorkflowFixture as createRawWorkflowFixture,
  createWorkflowTestClock,
} from "@/features/workflow.testing";
import { executeLinkedProgramIR, executeProgramIR } from "@/runtime/interpreter";
import { conformExternalDependencies } from "@/runtime/process";

const approvalName = "approval";
type Approval = WorkflowModel<{
  Name: typeof approvalName;
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
  Failures: {
    declined: { code: number };
  };
}>;

type Counter = WorkflowModel<{
  Name: "counter";
  Input: {};
  Result: { count: number };
  State: { count: number };
  Dependencies: {};
  Signals: {
    add(input: { amount: number }): void;
  };
  Queries: {
    count(input: {}): number;
  };
}>;

const counter = createWorkflow<Counter>({
  state: ({ input: _input }) => ({ count: 0 }),
  async execute({ state, sleep }) {
    await sleep({ duration: 1_000 });
    return { count: state.count };
  },
  signals: {
    add({ state, input }) {
      state.count += input.amount;
    },
  },
  queries: {
    count: ({ state }) => state.count,
  },
});

type Alarm = WorkflowModel<{
  Name: "alarm";
  Input: { deadline: number };
  Result: { fired: true };
  State: { phase: "waiting" | "fired" };
  Dependencies: {};
  Signals: {};
  Queries: {
    status(input: {}): "waiting" | "fired";
  };
}>;

function alarmWorkflow(deadlineOffset = 0) {
  return createWorkflow<Alarm>({
    state: ({ input: _input }) => ({ phase: "waiting" }),
    async execute({ input, state, sleep }) {
      await sleep({ deadline: input.deadline + deadlineOffset });
      state.phase = "fired";
      return { fired: true };
    },
    signals: {},
    queries: {
      status: ({ state }) => state.phase,
    },
  });
}

type Gate = WorkflowModel<{
  Name: "gate";
  Input: { timeout: number };
  Result: { opened: boolean };
  State: { open: boolean };
  Dependencies: {};
  Signals: {
    open(input: {}): void;
  };
  Queries: {
    open(input: {}): boolean;
  };
}>;

const gate = createWorkflow<Gate>({
  state: ({ input: _input }) => ({ open: false }),
  async execute({ input, state, wait }) {
    const opened = await wait({
      condition: () => state.open,
      timeout: input.timeout,
    });
    return { opened };
  },
  signals: {
    open({ state }) {
      state.open = true;
    },
  },
  queries: {
    open: ({ state }) => state.open,
  },
});

type Reschedulable = WorkflowModel<{
  Name: "reschedulable";
  Input: { deadline: number };
  Result: { deadline: number; firedAt: number };
  State: { deadline: number };
  Dependencies: {};
  Signals: {
    reschedule(input: { deadline: number }): void;
  };
  Queries: {
    deadline(input: {}): number;
  };
}>;

const reschedulable = createWorkflow<Reschedulable>({
  state: ({ input }) => ({ deadline: input.deadline }),
  async execute({ state, time, wait }) {
    while (true) {
      const deadline = state.deadline;
      const changed = await wait({
        condition: () => state.deadline !== deadline,
        timeout: deadline - time.now(),
      });
      if (!changed) return { deadline, firedAt: time.now() };
    }
  },
  signals: {
    reschedule({ state, input }) {
      state.deadline = input.deadline;
    },
  },
  queries: {
    deadline: ({ state }) => state.deadline,
  },
});

type CancellationWorkflow = WorkflowModel<{
  Name: "cancellation";
  Input: { mode: "inherit" | "manual" | "shield" | "timeout" };
  Result: { outcome: string };
  State: { cancel: boolean; outcome: string };
  Dependencies: {};
  Signals: {
    cancel(input: {}): void;
  };
  Queries: {
    outcome(input: {}): string;
  };
}>;

const cancellationWorkflow = createWorkflow<CancellationWorkflow>({
  state: ({ input: _input }) => ({ cancel: false, outcome: "running" }),
  async execute({ input, state, cancellation, sleep, wait }) {
    if (input.mode === "manual") {
      const branch = cancellation.start({
        propagation: "inherit",
        execute: async ({ sleep: branchSleep }) => {
          await branchSleep({ duration: 1_000 });
          return "late";
        },
      });
      await wait({ condition: () => state.cancel });
      branch.cancel({ reason: "superseded" });
      try {
        await branch.result();
      } catch {
        state.outcome = "manually-cancelled";
      }
      return { outcome: state.outcome };
    }
    if (input.mode === "timeout") {
      const branch = cancellation.start({
        propagation: "inherit",
        timeout: 100,
        execute: async ({ sleep: branchSleep }) => {
          await branchSleep({ duration: 1_000 });
          return "late";
        },
      });
      try {
        await branch.result();
      } catch {
        state.outcome = "timed-out";
      }
      return { outcome: state.outcome };
    }
    if (input.mode === "shield") {
      const cleanup = cancellation.start({
        propagation: "shield",
        execute: async ({ sleep: branchSleep }) => {
          await branchSleep({ duration: 100 });
          state.outcome = "cleaned";
        },
      });
      try {
        await sleep({ duration: 1_000 });
      } catch {
        // A shielded branch remains available for explicit durable cleanup.
      }
      await cleanup.result();
      return { outcome: state.outcome };
    }
    const branch = cancellation.start({
      propagation: "inherit",
      execute: async ({ sleep: branchSleep }) => {
        await branchSleep({ duration: 1_000 });
        return "late";
      },
    });
    await branch.result();
    return { outcome: "completed" };
  },
  signals: {
    cancel({ state }) {
      state.cancel = true;
    },
  },
  queries: {
    outcome: ({ state }) => state.outcome,
  },
});

function approvalWorkflow(
  operation: "charge" | "refund" = "charge",
  beforeActivity: "pending" | "charged" = "pending",
  approvedBySignal = true,
  retry: WorkflowActivityRetry = { attempts: 3, delay: 10, factor: 2 },
  timeout: WorkflowActivityTimeout = { attempt: 30_000 },
) {
  return createWorkflow<Approval>({
    state: ({ input: _input }) => ({ phase: "pending", approved: false }),
    activities: {
      payments: {
        charge: { timeout, retry },
        refund: { timeout, retry },
      },
    },
    async execute({ input: { requestId }, dependencies, state, sleep }) {
      state.phase = beforeActivity;
      const payment =
        operation === "charge"
          ? await dependencies.payments.charge({ requestId })
          : (await dependencies.payments.refund({ receipt: requestId }),
            {
              receipt: requestId,
            });
      state.phase = "charged";
      await sleep({ duration: 1000 });
      state.phase = "completed";
      return { receipt: payment.receipt, approved: state.approved };
    },
    signals: {
      approve({ state, input: _input }) {
        state.approved = approvedBySignal;
      },
    },
    queries: {
      status: ({ state }) => ({ phase: state.phase, approved: state.approved }),
    },
  });
}

function createWorkflowFixture(
  workflow: ReturnType<typeof approvalWorkflow>,
  input: Omit<Parameters<typeof createRawWorkflowFixture<Approval>>[1], "name">,
) {
  return createRawWorkflowFixture(workflow, { ...input, name: approvalName });
}

describe("semantic workflow Feature", () => {
  test("keeps the Temporal parity ledger source-linked and evidence-based", async () => {
    const ledger = JSON.parse(
      await readFile(resolve(process.cwd(), "docs/workflow-parity.json"), "utf8"),
    ) as Readonly<{
      status: string;
      reference: Readonly<{
        repository: string;
        commit: string;
      }>;
      surface: Readonly<Record<string, string>>;
      intentionalDifferences: readonly Readonly<{
        temporal: string;
        kit: string;
        reason: string;
      }>[];
      domains: readonly Readonly<{
        id: string;
        status: string;
        source: string;
        acceptance: readonly string[];
        evidence: readonly string[];
      }>[];
    }>;
    const statuses = new Set(["implemented", "partial", "missing", "intentional-difference"]);
    const ids = new Set<string>();
    const requiredDomains = new Set([
      "definition",
      "start-lifecycle",
      "activities",
      "timers-conditions",
      "concurrency-cancellation",
      "signals",
      "queries",
      "updates",
      "children",
      "schedules",
      "continue-as-new",
      "versioning",
      "visibility",
      "namespaces-task-queues",
      "data-conversion",
      "operations",
      "testing-replay",
      "observability",
      "nexus",
      "workflow-streams",
      "horizontal-scaling",
      "native-production",
      "performance",
    ]);

    expect(["draft", "complete"]).toContain(ledger.status);
    expect(ledger.reference.repository).toBe("https://github.com/temporalio/sdk-typescript");
    expect(ledger.reference.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(ledger.surface).sort()).toEqual(
      ["activity-provider", "adapter", "definition", "dependency", "execution", "testing"].sort(),
    );
    for (const meaning of Object.values(ledger.surface)) {
      expect(meaning.length).toBeGreaterThan(20);
    }
    expect(ledger.intentionalDifferences.length).toBeGreaterThan(0);
    for (const difference of ledger.intentionalDifferences) {
      expect(difference.temporal.length).toBeGreaterThan(0);
      expect(difference.kit.length).toBeGreaterThan(0);
      expect(difference.reason.length).toBeGreaterThan(20);
    }

    for (const domain of ledger.domains) {
      expect(ids.has(domain.id), `duplicate parity domain ${domain.id}`).toBe(false);
      ids.add(domain.id);
      expect(statuses.has(domain.status), `invalid parity status for ${domain.id}`).toBe(true);
      expect(domain.source, `missing parity source for ${domain.id}`).toMatch(
        /^(?:https:\/\/|docs\/)/,
      );
      expect(
        domain.acceptance.length,
        `missing acceptance criteria for ${domain.id}`,
      ).toBeGreaterThan(0);
      if (domain.status === "implemented") {
        expect(
          domain.evidence.length,
          `missing implementation evidence for ${domain.id}`,
        ).toBeGreaterThan(0);
      }
    }
    expect(ids).toEqual(requiredDomains);
  });

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
      let runtimeInput: Record<string, unknown> | undefined;
      await executeProgramIR(ir, contributions[0]!.id, {
        clock: { now: () => 0 },
        events: createMemoryEventStore(),
        identifiers: { create: () => "worker" },
        timer: { sleep: async () => undefined },
        workflowRuntime: {
          async create(input) {
            runtimeInput = input as Record<string, unknown>;
            return {};
          },
        },
      });
      expect(runtimeInput?.definition).toMatchObject({
        version: 1,
        protocolVersion: 9,
        name: "reminder",
        schemas: {
          input: {
            kind: "record",
            fields: [
              {
                name: "message",
                optional: false,
                type: { kind: "primitive", name: "string" },
              },
            ],
          },
          state: {
            kind: "record",
            fields: [
              {
                name: "phase",
                optional: false,
                type: {
                  kind: "union",
                  variants: [
                    { kind: "literal", value: "delivered" },
                    { kind: "literal", value: "pending" },
                  ],
                },
              },
            ],
          },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  test(
    "runs one compiled protocol through JavaScript and generated Rust",
    { tags: ["native"], timeout: 240_000 },
    async () => {
      const parent = resolve(process.cwd(), ".data");
      await mkdir(parent, { recursive: true });
      const directory = await mkdtemp(resolve(parent, "workflow-conformance-"));
      const entry = resolve(directory, "system.ts");
      const executable = resolve(directory, "workflow-server");
      const databasePath = resolve(directory, "events.sqlite");
      try {
        await writeFile(entry, workflowConformanceSystemSource());
        const ir = compileSystem(entry);
        const program = ir.programs[0];
        if (!program) throw new Error("Workflow conformance fixture has no server Program.");
        expect(linkProgram(program).external.map(({ name }) => name)).toContain("recorder");
        const interleavingScenarios = fc
          .sample(
            fc.record({
              mode: fc.constantFrom<"manual" | "none" | "root">("manual", "none", "root"),
              cancelSlot: fc.integer({ min: 1, max: 3 }),
              inheritedSlot: fc.integer({ min: 1, max: 4 }),
              timeoutSlot: fc.integer({ min: 1, max: 4 }),
              shieldedSlot: fc.integer({ min: 1, max: 4 }),
            }),
            { numRuns: 12, seed: 20_260_724 },
          )
          .map((scenario, index) => {
            const cancelAfter = scenario.cancelSlot * 10;
            return {
              id: `interleaving-${index}`,
              mode: scenario.mode,
              cancelAfter,
              inheritedDuration:
                scenario.mode === "none"
                  ? scenario.inheritedSlot * 20
                  : cancelAfter + scenario.inheritedSlot * 20,
              inheritedTimeout:
                scenario.mode === "none"
                  ? scenario.timeoutSlot * 20 + 5
                  : cancelAfter + scenario.timeoutSlot * 20 + 5,
              shieldedDuration:
                scenario.mode === "none"
                  ? scenario.shieldedSlot * 20
                  : cancelAfter + scenario.shieldedSlot * 20,
            };
          });

        const javascriptEvents = createMemoryEventStore<Record<string, unknown>>();
        const javascriptRecords: Array<{ value: unknown }> = [];
        let identity = 0;
        const javascript = await executeLinkedProgramIR(linkProgram(program), {
          clock: { now: () => Date.now() },
          events: javascriptEvents,
          identifiers: { create: () => `javascript-${++identity}` },
          timer: {
            sleep: ({ until }: { until: number }) =>
              new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, until - Date.now()))),
          },
          recorder: {
            async read() {
              return { scenarios: interleavingScenarios };
            },
            async record({
              input,
            }: {
              input: { value: unknown };
              invocation: DependencyInvocation;
            }) {
              javascriptRecords.push(input);
            },
          },
          workflowRuntime: createDevelopmentWorkflowRuntime(),
        });
        await javascript[Symbol.asyncDispose]();
        const javascriptWorkflow = await javascriptEvents.read({
          stream: "workflow:reminder:conformance",
        });
        expect(
          javascriptWorkflow.filter(({ event }) => event.type === "workflow.activity.completed"),
        ).toHaveLength(2);
        expect(
          javascriptWorkflow.filter(({ event }) => event.type === "workflow.activity.scheduled"),
        ).toHaveLength(2);
        expect(
          javascriptWorkflow.filter(
            ({ event }) => event.type === "workflow.activity.attempt.started",
          ),
        ).toHaveLength(2);
        expect(
          javascriptWorkflow.filter(({ event }) => event.type === "workflow.condition.scheduled"),
        ).toHaveLength(2);
        expect(
          javascriptWorkflow.filter(({ event }) => event.type === "workflow.condition.completed"),
        ).toHaveLength(2);
        const javascriptAdjustable = await javascriptEvents.read({
          stream: "workflow:adjustable:conformance-adjustable",
        });
        expect(
          javascriptAdjustable
            .filter(({ event }) => event.type === "workflow.condition.completed")
            .map(({ event }) => Reflect.get(event, "outcome")),
        ).toEqual(["satisfied", "timed-out"]);
        expect(
          javascriptWorkflow.find(({ event }) => event.type === "workflow.activity.scheduled")
            ?.event,
        ).toMatchObject({
          id: "activity:reminder:conformance:1",
          dependency: "formatter",
          operation: "format",
        });
        expect(javascriptRecords[0]).toEqual({
          value: {
            kind: "activity",
            message: "portable:1:activity:reminder:conformance:1",
          },
        });
        const javascriptDeferred = await javascriptEvents.read({
          stream: "workflow:deferred:conformance-deferred",
        });
        expect(
          javascriptDeferred.filter(({ event }) => event.type === "workflow.activity.deferred"),
        ).toHaveLength(1);
        expect(
          javascriptDeferred.filter(({ event }) => event.type === "workflow.activity.completed"),
        ).toHaveLength(1);
        const javascriptDeferredFailure = await javascriptEvents.read({
          stream: "workflow:deferred:conformance-deferred-failure",
        });
        expect(
          javascriptDeferredFailure.filter(
            ({ event }) => event.type === "workflow.activity.heartbeat",
          ),
        ).toHaveLength(1);
        expect(
          javascriptDeferredFailure.filter(
            ({ event }) => event.type === "workflow.activity.attempt.failed",
          ),
        ).toHaveLength(1);
        expect(
          javascriptDeferredFailure.filter(
            ({ event }) => event.type === "workflow.activity.attempt.started",
          ),
        ).toHaveLength(2);
        const scopeIds = [
          "scope-manual",
          "scope-timeout",
          "scope-inherited",
          "scope-shielded",
        ] as const;
        const javascriptScopes = new Map(
          await Promise.all(
            scopeIds.map(
              async (id) =>
                [
                  id,
                  await javascriptEvents.read({
                    stream: `workflow:scopedCancellation:${id}`,
                  }),
                ] as const,
            ),
          ),
        );
        expect(
          javascriptScopes
            .get("scope-manual")!
            .filter(({ event }) => event.type === "workflow.timer.cancelled"),
        ).toHaveLength(1);
        expect(
          javascriptScopes
            .get("scope-timeout")!
            .filter(({ event }) => event.type === "workflow.timer.completed"),
        ).toHaveLength(1);
        expect(
          javascriptScopes
            .get("scope-timeout")!
            .filter(({ event }) => event.type === "workflow.timer.cancelled"),
        ).toHaveLength(1);
        expect(
          javascriptScopes
            .get("scope-inherited")!
            .filter(({ event }) => event.type === "workflow.cancellation.requested"),
        ).toHaveLength(1);
        expect(
          javascriptScopes
            .get("scope-inherited")!
            .filter(({ event }) => event.type === "workflow.cancelled"),
        ).toHaveLength(1);
        expect(
          javascriptScopes
            .get("scope-shielded")!
            .filter(({ event }) => event.type === "workflow.cancellation.requested"),
        ).toHaveLength(1);
        expect(
          javascriptScopes
            .get("scope-shielded")!
            .filter(({ event }) => event.type === "workflow.completed"),
        ).toHaveLength(1);
        const javascriptInterleavings = new Map(
          await Promise.all(
            interleavingScenarios.map(
              async ({ id }) =>
                [
                  id,
                  await javascriptEvents.read({
                    stream: `workflow:interleaving:${id}`,
                  }),
                ] as const,
            ),
          ),
        );
        for (const scenario of interleavingScenarios) {
          const history = javascriptInterleavings.get(scenario.id)!;
          expect(history.filter(({ event }) => event.type === "workflow.completed")).toHaveLength(
            1,
          );
          expect(
            history.filter(({ event }) => event.type === "workflow.timer.cancelled").length,
          ).toBeGreaterThanOrEqual(scenario.mode === "none" ? 0 : 1);
        }

        const build = await buildServerProgram({
          system: ir.system.name,
          directory,
          dependencies: [workflowRecorderDependency()],
          output: executable,
          program,
        });
        const recorderOutput = resolve(directory, "recorder.jsonl");
        const native = spawn(build.executable, {
          env: {
            ...process.env,
            KIT_DATABASE: databasePath,
            KIT_RECORDER_INPUT: JSON.stringify({
              scenarios: interleavingScenarios,
            }),
            KIT_RECORDER_OUTPUT: recorderOutput,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let diagnostics = "";
        native.stdout?.on("data", (value) => {
          diagnostics += String(value);
        });
        native.stderr?.on("data", (value) => {
          diagnostics += String(value);
        });
        try {
          await waitForNativeExecution(
            native,
            () => diagnostics,
            async () => {
              try {
                return (
                  (await readFile(recorderOutput, "utf8")).trim().split("\n").length ===
                  2 + interleavingScenarios.length
                );
              } catch {
                return false;
              }
            },
          );
        } finally {
          if (native.exitCode === null) {
            native.kill("SIGINT");
            await new Promise<void>((resolve) => native.once("exit", () => resolve()));
          }
        }

        const database = (await connect(databasePath)) as unknown as {
          all(
            sql: string,
            ...parameters: readonly unknown[]
          ): Promise<readonly Record<string, unknown>[]>;
          close(): Promise<void>;
        };
        try {
          const nativeWorkflow = await database.all(
            "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
            "workflow:reminder:conformance",
          );
          expect(
            normalizeConcurrentWorkflowHistory(
              nativeWorkflow.map(({ event }) => JSON.parse(String(event))),
            ),
          ).toEqual(
            normalizeConcurrentWorkflowHistory(javascriptWorkflow.map(({ event }) => event)),
          );
          const nativeAdjustable = await database.all(
            "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
            "workflow:adjustable:conformance-adjustable",
          );
          expect(
            normalizeConcurrentWorkflowHistory(
              nativeAdjustable.map(({ event }) => JSON.parse(String(event))),
            ),
          ).toEqual(
            normalizeConcurrentWorkflowHistory(javascriptAdjustable.map(({ event }) => event)),
          );
          const nativeFailure = await database.all(
            "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
            "workflow:failing:conformance-failure",
          );
          const javascriptFailure = await javascriptEvents.read({
            stream: "workflow:failing:conformance-failure",
          });
          expect(
            nativeFailure.map(({ revision, event }) => ({
              revision,
              event: normalizeWorkflowEvent(JSON.parse(String(event))),
            })),
          ).toEqual(
            javascriptFailure.map(({ revision, event }) => ({
              revision,
              event: normalizeWorkflowEvent(event),
            })),
          );
          expect(javascriptFailure.some(({ event }) => event.type === "workflow.failed")).toBe(
            true,
          );
          const javascriptCancelled = await javascriptEvents.read({
            stream: "workflow:cancellable:conformance-cancel",
          });
          const nativeCancelled = await database.all(
            "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
            "workflow:cancellable:conformance-cancel",
          );
          expect(
            nativeCancelled
              .map(({ revision, event }) => ({
                revision,
                event: JSON.parse(String(event)) as Record<string, unknown>,
              }))
              .filter(({ event }) => !String(event.type).startsWith("workflow.worker."))
              .map(({ event }) => normalizeWorkflowEvent(event)),
          ).toEqual(
            javascriptCancelled
              .filter(({ event }) => !String(event.type).startsWith("workflow.worker."))
              .map(({ event }) => normalizeWorkflowEvent(event)),
          );
          expect(
            javascriptCancelled.filter(({ event }) => event.type === "workflow.cancelled"),
          ).toHaveLength(1);
          expect(
            javascriptCancelled.filter(({ event }) => event.type === "workflow.completed"),
          ).toHaveLength(0);
          for (const id of scopeIds) {
            const nativeScope = await database.all(
              "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
              `workflow:scopedCancellation:${id}`,
            );
            expect(
              normalizeConcurrentWorkflowHistory(
                nativeScope.map(({ event }) => JSON.parse(String(event))),
              ),
            ).toEqual(
              normalizeConcurrentWorkflowHistory(
                javascriptScopes.get(id)!.map(({ event }) => event),
              ),
            );
          }
          for (const scenario of interleavingScenarios) {
            const nativeInterleaving = await database.all(
              "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
              `workflow:interleaving:${scenario.id}`,
            );
            expect(
              normalizeConcurrentWorkflowHistory(
                nativeInterleaving.map(({ event }) => JSON.parse(String(event))),
              ),
              `generated Rust history for ${scenario.id} (${scenario.mode})`,
            ).toEqual(
              normalizeConcurrentWorkflowHistory(
                javascriptInterleavings.get(scenario.id)!.map(({ event }) => event),
              ),
            );
          }
          const javascriptDeadline = await javascriptEvents.read({
            stream: "workflow:deadline:conformance-deadline",
          });
          const nativeDeadline = await database.all(
            "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
            "workflow:deadline:conformance-deadline",
          );
          const nativeDeadlineEvents = nativeDeadline.map(({ event }) =>
            JSON.parse(String(event)),
          ) as Record<string, unknown>[];
          expect(activityRetryDelays(nativeDeadlineEvents)).toEqual([1]);
          expect(activityRetryDelays(javascriptDeadline.map(({ event }) => event))).toEqual([1]);
          expect(
            nativeDeadline.map(({ revision }, index) => ({
              revision,
              event: normalizeWorkflowEvent(nativeDeadlineEvents[index]),
            })),
          ).toEqual(
            javascriptDeadline.map(({ revision, event }) => ({
              revision,
              event: normalizeWorkflowEvent(event),
            })),
          );
          expect(
            javascriptDeadline.filter(
              ({ event }) => event.type === "workflow.activity.attempt.started",
            ),
          ).toHaveLength(2);
          expect(
            javascriptDeadline
              .filter(({ event }) => event.type === "workflow.activity.attempt.failed")
              .map(({ event }) => (event as { error: { data: unknown } }).error.data),
          ).toEqual([{ timeout: "attempt" }, { timeout: "attempt" }]);
          expect(
            javascriptDeadline.filter(({ event }) => event.type === "workflow.failed"),
          ).toHaveLength(1);
          const nativeDeferred = await database.all(
            "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
            "workflow:deferred:conformance-deferred",
          );
          expect(
            nativeDeferred.map(({ revision, event }) => ({
              revision,
              event: normalizeWorkflowEvent(JSON.parse(String(event))),
            })),
          ).toEqual(
            javascriptDeferred.map(({ revision, event }) => ({
              revision,
              event: normalizeWorkflowEvent(event),
            })),
          );
          const nativeDeferredFailure = await database.all(
            "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
            "workflow:deferred:conformance-deferred-failure",
          );
          const nativeDeferredFailureEvents = nativeDeferredFailure.map(({ event }) =>
            JSON.parse(String(event)),
          ) as Record<string, unknown>[];
          expect(activityRetryDelays(nativeDeferredFailureEvents)).toEqual([1]);
          expect(activityRetryDelays(javascriptDeferredFailure.map(({ event }) => event))).toEqual([
            1,
          ]);
          expect(
            nativeDeferredFailure.map(({ revision }, index) => ({
              revision,
              event: normalizeWorkflowEvent(nativeDeferredFailureEvents[index]),
            })),
          ).toEqual(
            javascriptDeferredFailure.map(({ revision, event }) => ({
              revision,
              event: normalizeWorkflowEvent(event),
            })),
          );
          const nativeRecords = (await readFile(recorderOutput, "utf8"))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as { value: unknown });
          expect(nativeRecords).toEqual(javascriptRecords);
          expect(javascriptRecords).toHaveLength(2 + interleavingScenarios.length);
        } finally {
          await database.close();
        }
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  test(
    "resumes one compiled Workflow after JavaScript and native runtime restarts",
    { tags: ["native"], timeout: 240_000 },
    async () => {
      const parent = resolve(process.cwd(), ".data");
      await mkdir(parent, { recursive: true });
      const directory = await mkdtemp(resolve(parent, "workflow-restart-"));
      const entry = resolve(directory, "system.ts");
      const executable = resolve(directory, "workflow-server");
      const databasePath = resolve(directory, "events.sqlite");
      const stream = "workflow:restartable:restart";
      const cancellationStream = "workflow:restartCancellation:restart";
      try {
        await writeFile(entry, workflowRestartSystemSource());
        const ir = compileSystem(entry);
        const program = ir.programs[0];
        if (!program) throw new Error("Workflow restart fixture has no server Program.");

        const javascriptEvents = createMemoryEventStore<Record<string, unknown>>();
        const clock = createWorkflowTestClock();
        let identity = 0;
        const javascriptDependencies = {
          clock: { now: () => clock.now() },
          events: javascriptEvents,
          identifiers: { create: () => `javascript-restart-${++identity}` },
          timer: clock.timer,
          workflowRuntime: createDevelopmentWorkflowRuntime(),
        };
        const first = await executeLinkedProgramIR(linkProgram(program), javascriptDependencies);
        await vi.waitFor(async () => {
          expect(
            (await javascriptEvents.read({ stream })).some(
              ({ event }) => event.type === "workflow.timer.scheduled",
            ),
          ).toBe(true);
          const cancellationHistory = await javascriptEvents.read({
            stream: cancellationStream,
          });
          expect(
            cancellationHistory.some(
              ({ event }) => event.type === "workflow.cancellation.requested",
            ),
          ).toBe(true);
          expect(
            cancellationHistory.some(({ event }) => event.type === "workflow.timer.scheduled"),
          ).toBe(true);
        });
        await first[Symbol.asyncDispose]();
        expect(
          (await javascriptEvents.read({ stream })).some(
            ({ event }) => event.type === "workflow.timer.completed",
          ),
        ).toBe(false);
        expect(
          (await javascriptEvents.read({ stream: cancellationStream })).some(
            ({ event }) => event.type === "workflow.timer.completed",
          ),
        ).toBe(false);

        const second = await executeLinkedProgramIR(linkProgram(program), javascriptDependencies);
        clock.advance({ milliseconds: 3_000 });
        await vi.waitFor(async () => {
          expect(
            (await javascriptEvents.read({ stream })).some(
              ({ event }) => event.type === "workflow.completed",
            ),
          ).toBe(true);
        });
        await second[Symbol.asyncDispose]();
        const javascriptHistory = await javascriptEvents.read({ stream });
        const javascriptCancellationHistory = await javascriptEvents.read({
          stream: cancellationStream,
        });
        expect(
          javascriptCancellationHistory.filter(
            ({ event }) => event.type === "workflow.cancellation.requested",
          ),
        ).toHaveLength(1);
        expect(
          javascriptCancellationHistory.filter(({ event }) => event.type === "workflow.completed"),
        ).toHaveLength(1);
        expect(
          javascriptCancellationHistory.filter(({ event }) => event.type === "workflow.cancelled"),
        ).toHaveLength(0);

        const build = await buildServerProgram({
          system: ir.system.name,
          directory,
          output: executable,
          program,
        });
        await runNativeAfterReady(build.executable, databasePath, 500);
        const nativeBeforeRestart = await readNativeWorkflowHistory(databasePath, stream);
        const scheduled = nativeBeforeRestart.find(
          ({ event }) => event.type === "workflow.timer.scheduled",
        );
        expect(scheduled).toBeDefined();
        expect(
          nativeBeforeRestart.some(({ event }) => event.type === "workflow.timer.completed"),
        ).toBe(false);
        const nativeCancellationBeforeRestart = await readNativeWorkflowHistory(
          databasePath,
          cancellationStream,
        );
        const cancellationScheduled = nativeCancellationBeforeRestart.find(
          ({ event }) => event.type === "workflow.timer.scheduled",
        );
        expect(cancellationScheduled).toBeDefined();
        expect(
          nativeCancellationBeforeRestart.some(
            ({ event }) => event.type === "workflow.cancellation.requested",
          ),
        ).toBe(true);
        expect(
          nativeCancellationBeforeRestart.some(
            ({ event }) => event.type === "workflow.timer.completed",
          ),
        ).toBe(false);

        const deadline = Math.max(
          Number(scheduled?.event.deadline),
          Number(cancellationScheduled?.event.deadline),
        );
        expect(Number.isSafeInteger(deadline)).toBe(true);
        await runNativeAfterReady(
          build.executable,
          databasePath,
          Math.max(500, deadline - Date.now() + 500),
        );
        const nativeHistory = await readNativeWorkflowHistory(databasePath, stream);
        expect(
          nativeHistory.map(({ revision, event }) => ({
            revision,
            event: normalizeWorkflowEvent(event),
          })),
        ).toEqual(
          javascriptHistory.map(({ revision, event }) => ({
            revision,
            event: normalizeWorkflowEvent(event),
          })),
        );
        expect(
          nativeHistory.filter(({ event }) => event.type === "workflow.timer.scheduled"),
        ).toHaveLength(1);
        expect(
          nativeHistory.filter(({ event }) => event.type === "workflow.timer.completed"),
        ).toHaveLength(1);
        const nativeCancellationHistory = await readNativeWorkflowHistory(
          databasePath,
          cancellationStream,
        );
        expect(
          nativeCancellationHistory.map(({ revision, event }) => ({
            revision,
            event: normalizeWorkflowEvent(event),
          })),
        ).toEqual(
          javascriptCancellationHistory.map(({ revision, event }) => ({
            revision,
            event: normalizeWorkflowEvent(event),
          })),
        );
        expect(
          nativeCancellationHistory.filter(
            ({ event }) => event.type === "workflow.cancellation.requested",
          ),
        ).toHaveLength(1);
        expect(
          nativeCancellationHistory.filter(
            ({ event }) => event.type === "workflow.timer.scheduled",
          ),
        ).toHaveLength(1);
        expect(
          nativeCancellationHistory.filter(
            ({ event }) => event.type === "workflow.timer.completed",
          ),
        ).toHaveLength(1);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  test("runs durable dependencies, signals, queries, timers, and typed results", async () => {
    const charge = vi.fn(async () => ({ receipt: "receipt-1" }));
    const refund = vi.fn(async () => undefined);
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: { payments: { charge, refund } },
    });
    await fixture.api.start({ id: "one", input: { requestId: "request-1" } });
    await vi.waitFor(async () => {
      expect(
        await fixture.api.query.status({
          execution: { id: "one" },
          input: {},
          consistency: "current",
        }),
      ).toEqual({
        phase: "charged",
        approved: false,
      });
    });
    await fixture.api.signal.approve({ execution: { id: "one" }, input: { by: "alice" } });
    expect(
      await fixture.api.query.status({
        execution: { id: "one" },
        input: {},
        consistency: "current",
      }),
    ).toEqual({
      phase: "charged",
      approved: true,
    });
    fixture.clock.advance({ milliseconds: 1000 });
    await expect(fixture.api.result({ execution: { id: "one" }, follow: "run" })).resolves.toEqual({
      receipt: "receipt-1",
      approved: true,
    });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(refund).not.toHaveBeenCalled();
  });

  test("persists an absolute timer deadline and resumes it after restart", async () => {
    const clock = createWorkflowTestClock(100);
    await using fixture = await createRawWorkflowFixture(alarmWorkflow(), {
      name: "alarm",
      clock,
      dependencies: {},
    });

    await fixture.api.start({ id: "absolute", input: { deadline: 250 } });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({ stream: "workflow:alarm:absolute" });
      expect(history.find(({ event }) => event.type === "workflow.timer.scheduled")?.event).toEqual(
        {
          type: "workflow.timer.scheduled",
          sequence: 1,
          deadline: 250,
          at: 100,
        },
      );
    });

    await fixture.restart();
    clock.advance({ milliseconds: 149 });
    await expect(fixture.api.describe({ execution: { id: "absolute" } })).resolves.toMatchObject({
      status: "running",
      state: { phase: "waiting" },
    });
    clock.advance({ milliseconds: 1 });
    await expect(
      fixture.api.result({ execution: { id: "absolute" }, follow: "run" }),
    ).resolves.toEqual({ fired: true });

    const history = await fixture.events.read({ stream: "workflow:alarm:absolute" });
    expect(history.filter(({ event }) => event.type === "workflow.timer.scheduled")).toHaveLength(
      1,
    );
    expect(history.filter(({ event }) => event.type === "workflow.timer.completed")).toHaveLength(
      1,
    );
  });

  test("rejects an absolute timer changed during replay", async () => {
    const clock = createWorkflowTestClock(100);
    const events = createMemoryEventStore<WorkflowJournalEvent<Alarm>>();
    {
      await using fixture = await createRawWorkflowFixture(alarmWorkflow(), {
        name: "alarm",
        clock,
        events,
        dependencies: {},
      });
      await fixture.api.start({ id: "changed", input: { deadline: 250 } });
      await vi.waitFor(async () => {
        expect(
          (await events.read({ stream: "workflow:alarm:changed" })).some(
            ({ event }) => event.type === "workflow.timer.scheduled",
          ),
        ).toBe(true);
      });
    }

    await using changed = await createRawWorkflowFixture(alarmWorkflow(1), {
      name: "alarm",
      clock,
      events,
      dependencies: {},
    });
    await expect(
      changed.api.result({ execution: { id: "changed" }, follow: "run" }),
    ).rejects.toMatchObject({
      failure: expect.objectContaining({
        message: expect.stringContaining("changed timer 1"),
      }),
    });
  });

  test("resumes a durable condition after restart and satisfies it from a Signal", async () => {
    const clock = createWorkflowTestClock(100);
    await using fixture = await createRawWorkflowFixture(gate, {
      name: "gate",
      clock,
      dependencies: {},
    });

    await fixture.api.start({ id: "signal", input: { timeout: 100 } });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({ stream: "workflow:gate:signal" });
      expect(
        history.find(({ event }) => event.type === "workflow.condition.scheduled")?.event,
      ).toEqual({
        type: "workflow.condition.scheduled",
        sequence: 1,
        timeout: 100,
        deadline: 200,
        at: 100,
      });
    });
    await fixture.restart();
    await fixture.api.signal.open({ execution: { id: "signal" }, input: {} });
    await expect(
      fixture.api.result({ execution: { id: "signal" }, follow: "run" }),
    ).resolves.toEqual({ opened: true });

    const history = await fixture.events.read({ stream: "workflow:gate:signal" });
    expect(
      history.filter(({ event }) => event.type === "workflow.condition.scheduled"),
    ).toHaveLength(1);
    expect(
      history.filter(({ event }) => event.type === "workflow.condition.completed"),
    ).toHaveLength(1);
    expect(
      history.find(({ event }) => event.type === "workflow.condition.completed")?.event,
    ).toMatchObject({ outcome: "satisfied" });
  });

  test("returns false when a durable condition reaches its timeout", async () => {
    const clock = createWorkflowTestClock(100);
    await using fixture = await createRawWorkflowFixture(gate, {
      name: "gate",
      clock,
      dependencies: {},
    });

    const execution = await fixture.api.start({ id: "timeout", input: { timeout: 50 } });
    const result = fixture.api.result({ execution, follow: "run" });
    await vi.waitFor(async () => {
      expect(
        (await fixture.events.read({ stream: "workflow:gate:timeout" })).some(
          ({ event }) => event.type === "workflow.condition.scheduled",
        ),
      ).toBe(true);
    });
    clock.advance({ milliseconds: 49 });
    await expect(fixture.api.describe({ execution: { id: "timeout" } })).resolves.toMatchObject({
      status: "running",
    });
    clock.advance({ milliseconds: 1 });
    await expect(result).resolves.toEqual({ opened: false });

    const history = await fixture.events.read({ stream: "workflow:gate:timeout" });
    expect(
      history.find(({ event }) => event.type === "workflow.condition.completed")?.event,
    ).toMatchObject({ outcome: "timed-out" });
  });

  test("composes a replay-safe reschedulable timer from conditions and deterministic time", async () => {
    const clock = createWorkflowTestClock();
    await using fixture = await createRawWorkflowFixture(reschedulable, {
      name: "reschedulable",
      clock,
      dependencies: {},
    });

    await fixture.api.start({ id: "deadline", input: { deadline: 100 } });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:reschedulable:deadline",
      });
      expect(
        history.filter(({ event }) => event.type === "workflow.condition.scheduled"),
      ).toHaveLength(1);
    });

    clock.advance({ milliseconds: 50 });
    await fixture.api.signal.reschedule({
      execution: { id: "deadline" },
      input: { deadline: 200 },
    });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:reschedulable:deadline",
      });
      expect(
        history.filter(({ event }) => event.type === "workflow.condition.scheduled"),
      ).toHaveLength(2);
    });

    await fixture.restart();
    clock.advance({ milliseconds: 149 });
    await expect(fixture.api.describe({ execution: { id: "deadline" } })).resolves.toMatchObject({
      status: "running",
      state: { deadline: 200 },
    });
    clock.advance({ milliseconds: 1 });
    await expect(
      fixture.api.result({ execution: { id: "deadline" }, follow: "run" }),
    ).resolves.toEqual({
      deadline: 200,
      firedAt: 200,
    });

    const history = await fixture.events.read({
      stream: "workflow:reschedulable:deadline",
    });
    expect(
      history
        .filter(({ event }) => event.type === "workflow.condition.completed")
        .map(({ event }) => ("outcome" in event ? event.outcome : undefined)),
    ).toEqual(["satisfied", "timed-out"]);
  });

  test("rejects a condition that mutates workflow state", async () => {
    const impure = createWorkflow<Gate>({
      state: ({ input: _input }) => ({ open: false }),
      async execute({ state, wait }) {
        const opened = await wait({
          condition: () => {
            state.open = true;
            return false;
          },
        });
        return { opened };
      },
      signals: {
        open({ state }) {
          state.open = true;
        },
      },
      queries: {
        open: ({ state }) => state.open,
      },
    });
    await using fixture = await createRawWorkflowFixture(impure, {
      name: "gate",
      dependencies: {},
    });

    await fixture.api.start({ id: "impure", input: { timeout: 100 } });
    await expect(
      fixture.api.result({ execution: { id: "impure" }, follow: "run" }),
    ).rejects.toMatchObject({
      failure: expect.objectContaining({
        message: "Workflow condition must not mutate state.",
      }),
    });
  });

  test("replays completed Activities exactly once across a worker restart", async () => {
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
      expect((await fixture.api.describe({ execution: { id: "restart" } })).state.phase).toBe(
        "charged",
      );
    });
    expect(charge).toHaveBeenCalledTimes(1);
    fixture.clock.advance({ milliseconds: 1000 });
    await expect(
      fixture.api.result({ execution: { id: "restart" }, follow: "run" }),
    ).resolves.toMatchObject({
      receipt: "receipt-2",
    });
  });

  test("completes a deferred Activity idempotently after a worker restart", async () => {
    let deferred: DeferredDependencyInvocation<Readonly<{ receipt: string }>> | undefined;
    const charge = vi.fn(
      async ({
        invocation,
      }: {
        input: { requestId: string };
        invocation: DependencyProviderInvocation<never, never, Readonly<{ receipt: string }>>;
      }) => {
        deferred = invocation.defer({ id: `completion:${invocation.id}` });
        return deferred;
      },
    );
    const payments = conformExternalDependencies(
      [
        {
          name: "payments",
          binding: "envelope",
          operations: [
            {
              name: "charge",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "requestId",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
            },
          ],
        },
      ],
      { payments: { charge } },
    ).payments as Approval["Dependencies"]["payments"];
    await using fixture = await createWorkflowFixture(
      approvalWorkflow("charge", "pending", true, { attempts: 1 }, { attempt: 10 }),
      {
        dependencies: { payments },
      },
    );

    const execution = await fixture.api.start({
      id: "deferred",
      input: { requestId: "request-deferred" },
    });
    await vi.waitFor(() => expect(deferred).toBeDefined());
    expect(deferred?.execution).toEqual({
      workflow: "approval",
      id: execution.id,
      run: execution.run,
    });
    await expect(
      fixture.api.activities.complete({
        invocation: {
          ...deferred!,
          execution: {
            ...deferred!.execution,
            run: `${deferred!.execution.run}-stale`,
          },
        },
        result: { receipt: "stale" },
      }),
    ).rejects.toThrow(
      `has run ${JSON.stringify(execution.run)}, not ${JSON.stringify(`${execution.run}-stale`)}`,
    );
    await vi.waitFor(async () => {
      expect(
        (await fixture.events.read({ stream: "workflow:approval:deferred" })).filter(
          ({ event }) => event.type === "workflow.activity.deferred",
        ),
      ).toHaveLength(1);
    });

    await fixture.restart();
    const result = fixture.api.result({ execution: { id: "deferred" }, follow: "run" });
    await vi.waitFor(async () => {
      expect(
        (await fixture.events.read({ stream: "workflow:approval:deferred" })).some(
          ({ event }) => event.type === "workflow.worker.claimed",
        ),
      ).toBe(true);
    });
    await fixture.api.activities.complete({
      invocation: deferred!,
      result: { receipt: "receipt-deferred" },
    });
    await fixture.api.activities.complete({
      invocation: deferred!,
      result: { receipt: "receipt-deferred" },
    });
    await vi.waitFor(async () => {
      expect((await fixture.api.describe({ execution: { id: "deferred" } })).state.phase).toBe(
        "charged",
      );
    });
    fixture.clock.advance({ milliseconds: 1_000 });
    await expect(result).resolves.toEqual({ receipt: "receipt-deferred", approved: false });
    await expect(
      fixture.api.activities.complete({
        invocation: deferred!,
        result: { receipt: "conflict" },
      }),
    ).rejects.toThrow("completed with a different result");
    expect(charge).toHaveBeenCalledTimes(1);
    const history = await fixture.events.read({ stream: "workflow:approval:deferred" });
    expect(history.filter(({ event }) => event.type === "workflow.activity.deferred")).toHaveLength(
      1,
    );
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.completed"),
    ).toHaveLength(1);

    deferred = undefined;
    await fixture.api.start({ id: "deferred-race", input: { requestId: "request-race" } });
    await vi.waitFor(() => expect(deferred?.execution.id).toBe("deferred-race"));
    const raceResult = fixture.api
      .result({ execution: { id: "deferred-race" }, follow: "run" })
      .then(
        () => "completed" as const,
        () => "failed" as const,
      );
    const racedCompletion = fixture.api.activities
      .complete({
        invocation: deferred!,
        result: { receipt: "receipt-race" },
      })
      .then(
        () => "completed" as const,
        () => "rejected" as const,
      );
    fixture.clock.advance({ milliseconds: 10 });
    await racedCompletion;
    let closing: "workflow.activity.completed" | "workflow.activity.attempt.failed" | undefined;
    await vi.waitFor(async () => {
      const raceHistory = await fixture.events.read({
        stream: "workflow:approval:deferred-race",
      });
      const closings = raceHistory.filter(
        ({ event }) =>
          event.type === "workflow.activity.completed" ||
          event.type === "workflow.activity.attempt.failed",
      );
      expect(closings).toHaveLength(1);
      closing = closings[0]?.event.type as typeof closing;
    });
    if (closing === "workflow.activity.completed") {
      await vi.waitFor(async () => {
        expect(
          (await fixture.api.describe({ execution: { id: "deferred-race" } })).state.phase,
        ).toBe("charged");
      });
      fixture.clock.advance({ milliseconds: 1_000 });
    }
    await expect(raceResult).resolves.toMatch(/^(?:completed|failed)$/);
    await expect(
      fixture.api.describe({ execution: { id: "deferred-race" } }),
    ).resolves.toBeDefined();
  });

  test("heartbeats and fails a deferred Activity through its typed external lifecycle", async () => {
    type Failure = Readonly<{
      type: "declined";
      data: Readonly<{ code: number }>;
      message?: string;
      retry?: Readonly<{ delay: number }>;
    }>;
    type Heartbeat = Readonly<{ progress: number }>;
    type Result = Readonly<{ receipt: string }>;
    let deferred: DeferredDependencyInvocation<Result, Failure, Heartbeat> | undefined;
    let calls = 0;
    const charge = vi.fn(
      async ({
        invocation,
      }: {
        input: { requestId: string };
        invocation: DependencyProviderInvocation<Failure, Heartbeat, Result>;
      }) => {
        calls += 1;
        if (calls === 1) {
          deferred = invocation.defer({ id: `completion:${invocation.id}` });
          return deferred;
        }
        expect(invocation.previousHeartbeat).toEqual({ progress: 1 });
        return { receipt: "receipt-retried" };
      },
    );
    const payments = conformExternalDependencies(
      [
        {
          name: "payments",
          binding: "envelope",
          operations: [
            {
              name: "charge",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "requestId",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              heartbeat: {
                kind: "record",
                fields: [
                  {
                    name: "progress",
                    optional: false,
                    type: { kind: "primitive", name: "number" },
                  },
                ],
              },
            },
          ],
        },
      ],
      { payments: { charge } },
    ).payments as Approval["Dependencies"]["payments"];
    await using fixture = await createWorkflowFixture(
      approvalWorkflow(
        "charge",
        "pending",
        true,
        { attempts: 2, delay: 100 },
        { attempt: 50, total: 100, heartbeat: 10 },
      ),
      { dependencies: { payments } },
    );

    await fixture.api.start({ id: "external-failure", input: { requestId: "request-failure" } });
    await vi.waitFor(() => expect(deferred).toBeDefined());
    fixture.clock.advance({ milliseconds: 8 });
    await fixture.api.activities.heartbeat({
      invocation: deferred!,
      details: { progress: 1 },
    });
    fixture.clock.advance({ milliseconds: 8 });
    expect((await fixture.api.describe({ execution: { id: "external-failure" } })).status).toBe(
      "running",
    );

    const failure = {
      type: "declined",
      data: { code: 402 },
      message: "Payment declined.",
      retry: { delay: 3 },
    } as const;
    await fixture.api.activities.fail({ invocation: deferred!, failure });
    await fixture.api.activities.fail({ invocation: deferred!, failure });
    await expect(
      fixture.api.activities.fail({
        invocation: deferred!,
        failure: { ...failure, data: { code: 409 } },
      }),
    ).rejects.toThrow("different failure");
    fixture.clock.advance({ milliseconds: 3 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      expect(
        (await fixture.api.describe({ execution: { id: "external-failure" } })).state.phase,
      ).toBe("charged");
    });
    fixture.clock.advance({ milliseconds: 1_000 });
    await expect(
      fixture.api.result({ execution: { id: "external-failure" }, follow: "run" }),
    ).resolves.toEqual({
      receipt: "receipt-retried",
      approved: false,
    });
    await expect(
      fixture.api.activities.heartbeat({
        invocation: deferred!,
        details: { progress: 2 },
      }),
    ).rejects.toThrow("no longer pending");

    const history = await fixture.events.read({
      stream: "workflow:approval:external-failure",
    });
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.heartbeat"),
    ).toHaveLength(1);
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.attempt.failed"),
    ).toHaveLength(1);
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.completed"),
    ).toHaveLength(1);
  });

  test("records and retries an Activity attempt abandoned by worker restart", async () => {
    let calls = 0;
    const charge = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<{ receipt: string }>(() => undefined)
        : Promise.resolve({ receipt: "receipt-recovered" });
    });
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: { payments: { charge, refund: async () => undefined } },
    });
    await fixture.api.start({ id: "abandoned", input: { requestId: "request-abandoned" } });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));

    await fixture.restart();
    await fixture.api.start({ id: "abandoned", input: { requestId: "request-abandoned" } });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(2));
    const history = await fixture.events.read({ stream: "workflow:approval:abandoned" });
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.attempt.started"),
    ).toHaveLength(2);
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.attempt.abandoned"),
    ).toHaveLength(1);
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.completed"),
    ).toHaveLength(1);

    fixture.clock.advance({ milliseconds: 1000 });
    await expect(
      fixture.api.result({ execution: { id: "abandoned" }, follow: "run" }),
    ).resolves.toMatchObject({
      receipt: "receipt-recovered",
    });
  });

  test("replays property-generated Signal traces across arbitrary worker restarts", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            amount: fc.integer({ min: -100, max: 100 }),
            restart: fc.boolean(),
          }),
          { maxLength: 20 },
        ),
        async (commands) => {
          const clock = createWorkflowTestClock();
          await using fixture = await createRawWorkflowFixture(counter, {
            name: "counter",
            clock,
            dependencies: {},
          });
          await fixture.api.start({ id: "trace", input: {} });
          await vi.waitFor(async () => {
            const history = await fixture.events.read({ stream: "workflow:counter:trace" });
            expect(history.map(({ event }) => event.type)).toContain("workflow.timer.scheduled");
          });

          let expected = 0;
          for (const command of commands) {
            await fixture.api.signal.add({
              execution: { id: "trace" },
              input: { amount: command.amount },
            });
            expected += command.amount;
            if (command.restart) await fixture.restart();
            await expect(
              fixture.api.query.count({
                execution: { id: "trace" },
                input: {},
                consistency: "current",
              }),
            ).resolves.toBe(expected);
          }

          clock.advance({ milliseconds: 1_000 });
          await expect(
            fixture.api.result({ execution: { id: "trace" }, follow: "run" }),
          ).resolves.toEqual({ count: expected });
          const history = await fixture.events.read({ stream: "workflow:counter:trace" });
          expect(history.map(({ revision }) => revision)).toEqual(
            history.map((_event, index) => index + 1),
          );
          expect(
            history.filter(({ event }) => event.type === "workflow.signal.received"),
          ).toHaveLength(commands.length);
          expect(
            history.filter(({ event }) => event.type === "workflow.timer.scheduled"),
          ).toHaveLength(1);
          expect(
            history.filter(({ event }) => event.type === "workflow.timer.completed"),
          ).toHaveLength(1);
          expect(history.filter(({ event }) => event.type === "workflow.completed")).toHaveLength(
            1,
          );
        },
      ),
      { numRuns: 30 },
    );
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
    const execution = await fixture.api.start({
      id: "retry",
      input: { requestId: "request-3" },
    });
    const result = fixture.api.result({ execution, follow: "run" });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    clock.advance({ milliseconds: 10 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(2));
    clock.advance({ milliseconds: 20 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(3));
    clock.advance({ milliseconds: 1000 });
    await expect(result).resolves.toMatchObject({ receipt: "receipt-3" });
    const history = await fixture.events.read({ stream: "workflow:approval:retry" });
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.scheduled"),
    ).toHaveLength(1);
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.attempt.started"),
    ).toHaveLength(3);
    expect(
      history
        .filter(({ event }) => event.type === "workflow.activity.attempt.failed")
        .map(({ event }) =>
          event.type === "workflow.activity.attempt.failed" ? event.retryAt : undefined,
        ),
    ).toEqual([10, 30]);
    expect(
      history.filter(({ event }) => event.type === "workflow.activity.completed"),
    ).toHaveLength(1);
  });

  test("delivers stable generic Dependency invocation identity across Activity retries", async () => {
    const invocations: DependencyInvocation[] = [];
    const payments = conformExternalDependencies(
      [
        {
          name: "payments",
          binding: "envelope",
          operations: [
            {
              name: "charge",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "requestId",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
            },
            {
              name: "refund",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: { kind: "primitive", name: "void" },
            },
          ],
        },
      ],
      {
        payments: {
          async charge({
            input,
            invocation,
          }: {
            input: { requestId: string };
            invocation: DependencyProviderInvocation<
              Readonly<{
                type: "temporary";
                data: Record<never, never>;
                retry?: Readonly<{ delay: number }>;
              }>
            >;
          }) {
            invocations.push(invocation);
            if (invocation.attempt === 1) {
              invocation.fail({
                type: "temporary",
                data: {},
                retry: { delay: 25 },
              });
            }
            return { receipt: input.requestId };
          },
          async refund() {},
        },
      },
    ).payments as Approval["Dependencies"]["payments"];
    const clock = createWorkflowTestClock();
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      clock,
      dependencies: { payments },
    });

    const execution = await fixture.api.start({
      id: "provider-envelope",
      input: { requestId: "receipt-envelope" },
    });
    const result = fixture.api.result({ execution, follow: "run" });
    await vi.waitFor(() => expect(invocations).toHaveLength(1));
    clock.advance({ milliseconds: 24 });
    expect(invocations).toHaveLength(1);
    clock.advance({ milliseconds: 1 });
    await vi.waitFor(() => expect(invocations).toHaveLength(2));
    clock.advance({ milliseconds: 1_000 });

    await expect(result).resolves.toMatchObject({ receipt: "receipt-envelope" });
    expect(invocations).toEqual([
      {
        id: "activity:approval:provider-envelope:1",
        attempt: 1,
        scheduledAt: 0,
        startedAt: 0,
        deadline: 30_000,
      },
      {
        id: "activity:approval:provider-envelope:1",
        attempt: 2,
        scheduledAt: 0,
        startedAt: 25,
        deadline: 30_025,
      },
    ]);
  });

  test("retries an Activity after its attempt deadline", async () => {
    let calls = 0;
    const charge = vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<{ receipt: string }>(() => undefined)
        : Promise.resolve({ receipt: "receipt-after-timeout" });
    });
    const clock = createWorkflowTestClock();
    await using fixture = await createWorkflowFixture(
      approvalWorkflow("charge", "pending", true, { attempts: 2, delay: 10 }, { attempt: 100 }),
      {
        clock,
        dependencies: { payments: { charge, refund: async () => undefined } },
      },
    );

    const execution = await fixture.api.start({
      id: "attempt-timeout",
      input: { requestId: "request-attempt-timeout" },
    });
    const result = fixture.api.result({ execution, follow: "run" });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    clock.advance({ milliseconds: 100 });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:approval:attempt-timeout",
      });
      expect(
        history.filter(({ event }) => event.type === "workflow.activity.attempt.failed"),
      ).toHaveLength(1);
    });
    clock.advance({ milliseconds: 10 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(2));
    clock.advance({ milliseconds: 1_000 });

    await expect(result).resolves.toMatchObject({ receipt: "receipt-after-timeout" });
    const history = await fixture.events.read({
      stream: "workflow:approval:attempt-timeout",
    });
    expect(
      history
        .filter(({ event }) => event.type === "workflow.activity.attempt.failed")
        .map(({ event }) =>
          event.type === "workflow.activity.attempt.failed" ? event.error : undefined,
        ),
    ).toEqual([
      {
        name: "WorkflowActivityTimeout",
        message: "Workflow Activity exceeded its attempt timeout.",
        data: { timeout: "attempt" },
      },
    ]);
  });

  test("persists Activity heartbeat details and resets the heartbeat deadline", async () => {
    const clock = createWorkflowTestClock();
    const invocations: Array<DependencyProviderInvocation<never, Readonly<{ completed: number }>>> =
      [];
    let heartbeat: ((completed: number) => void) | undefined;
    const charge = vi.fn(
      async ({
        input,
        invocation,
      }: {
        input: { requestId: string };
        invocation: DependencyProviderInvocation<never, Readonly<{ completed: number }>>;
      }) => {
        invocations.push(invocation);
        if (invocation.attempt === 1) {
          heartbeat = (completed) => invocation.heartbeat({ details: { completed } });
          invocation.heartbeat({ details: { completed: 1 } });
          return new Promise<{ receipt: string }>(() => undefined);
        }
        expect(invocation.previousHeartbeat).toEqual({ completed: 2 });
        return { receipt: input.requestId };
      },
    );
    const payments = conformExternalDependencies(
      [
        {
          name: "payments",
          binding: "envelope",
          operations: [
            {
              name: "charge",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "requestId",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              heartbeat: {
                kind: "record",
                fields: [
                  {
                    name: "completed",
                    optional: false,
                    type: { kind: "primitive", name: "number" },
                  },
                ],
              },
            },
          ],
        },
      ],
      { payments: { charge } },
    ).payments as Approval["Dependencies"]["payments"];
    await using fixture = await createWorkflowFixture(
      approvalWorkflow(
        "charge",
        "pending",
        true,
        { attempts: 2, delay: 10 },
        { attempt: 1_000, heartbeat: 50 },
      ),
      { clock, dependencies: { payments } },
    );

    const execution = await fixture.api.start({
      id: "heartbeat-timeout",
      input: { requestId: "receipt-after-heartbeat" },
    });
    const result = fixture.api.result({ execution, follow: "run" });
    await vi.waitFor(() => expect(invocations).toHaveLength(1));
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:approval:heartbeat-timeout",
      });
      expect(
        history.filter(({ event }) => event.type === "workflow.activity.heartbeat"),
      ).toHaveLength(1);
    });

    clock.advance({ milliseconds: 40 });
    heartbeat?.(2);
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:approval:heartbeat-timeout",
      });
      expect(
        history.filter(({ event }) => event.type === "workflow.activity.heartbeat"),
      ).toHaveLength(2);
    });
    clock.advance({ milliseconds: 49 });
    expect(invocations).toHaveLength(1);
    clock.advance({ milliseconds: 1 });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:approval:heartbeat-timeout",
      });
      expect(
        history.filter(({ event }) => event.type === "workflow.activity.attempt.failed"),
      ).toHaveLength(1);
    });
    clock.advance({ milliseconds: 10 });
    await vi.waitFor(() => expect(invocations).toHaveLength(2));
    clock.advance({ milliseconds: 1_000 });

    await expect(result).resolves.toMatchObject({ receipt: "receipt-after-heartbeat" });
    const history = await fixture.events.read({
      stream: "workflow:approval:heartbeat-timeout",
    });
    expect(
      history
        .filter(({ event }) => event.type === "workflow.activity.attempt.failed")
        .map(({ event }) =>
          event.type === "workflow.activity.attempt.failed" ? event.error.data : undefined,
        ),
    ).toEqual([{ timeout: "heartbeat" }]);
    expect(
      history
        .filter(({ event }) => event.type === "workflow.activity.heartbeat")
        .map(({ event }) =>
          event.type === "workflow.activity.heartbeat" ? event.details : undefined,
        ),
    ).toEqual([{ completed: 1 }, { completed: 2 }]);
  });

  test("delivers Workflow cancellation through the generic Activity invocation", async () => {
    let cancellationObserved = false;
    const charge = vi.fn(
      async ({
        input,
        invocation,
      }: {
        input: { requestId: string };
        invocation: DependencyProviderInvocation;
      }) => {
        await invocation.cancellation.wait();
        cancellationObserved = invocation.cancellation.requested();
        return { receipt: input.requestId };
      },
    );
    const payments = conformExternalDependencies(
      [
        {
          name: "payments",
          binding: "envelope",
          operations: [
            {
              name: "charge",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "requestId",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
            },
          ],
        },
      ],
      { payments: { charge } },
    ).payments as Approval["Dependencies"]["payments"];
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: { payments },
    });

    const execution = await fixture.api.start({
      id: "cancel-activity",
      input: { requestId: "cancelled-receipt" },
    });
    const result = expect(fixture.api.result({ execution, follow: "run" })).rejects.toMatchObject({
      failure: { name: "WorkflowCancelled" },
    });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    await fixture.api.cancel({ execution: { id: "cancel-activity" }, reason: "operator" });
    await vi.waitFor(() => expect(cancellationObserved).toBe(true));

    await result;
  });

  test("caps Activity retries at the total deadline", async () => {
    const charge = vi.fn(() => new Promise<{ receipt: string }>(() => undefined));
    const clock = createWorkflowTestClock();
    await using fixture = await createWorkflowFixture(
      approvalWorkflow(
        "charge",
        "pending",
        true,
        { attempts: 3, delay: 10 },
        { attempt: 100, total: 150 },
      ),
      {
        clock,
        dependencies: { payments: { charge, refund: async () => undefined } },
      },
    );

    const execution = await fixture.api.start({
      id: "total-timeout",
      input: { requestId: "request-total-timeout" },
    });
    const result = fixture.api.result({ execution, follow: "run" });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    clock.advance({ milliseconds: 100 });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:approval:total-timeout",
      });
      expect(
        history.filter(({ event }) => event.type === "workflow.activity.attempt.failed"),
      ).toHaveLength(1);
    });
    clock.advance({ milliseconds: 10 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(2));
    clock.advance({ milliseconds: 40 });

    await expect(result).rejects.toMatchObject({
      failure: {
        name: "WorkflowActivityTimeout",
        data: { timeout: "total" },
      },
    });
    expect(charge).toHaveBeenCalledTimes(2);
    const history = await fixture.events.read({
      stream: "workflow:approval:total-timeout",
    });
    expect(
      history
        .filter(({ event }) => event.type === "workflow.activity.attempt.failed")
        .map(({ event }) =>
          event.type === "workflow.activity.attempt.failed" ? event.error.data : undefined,
        ),
    ).toEqual([{ timeout: "attempt" }, { timeout: "total" }]);
  });

  test("enforces a durable queue deadline after restart", async () => {
    const clock = createWorkflowTestClock(101);
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    await events.append({
      stream: "workflow:approval:queue-timeout",
      expectedRevision: 0,
      events: [
        {
          type: "workflow.started",
          definitionVersion: WORKFLOW_DEFINITION_VERSION,
          protocolVersion: 9,
          run: "run-queue-timeout",
          input: { requestId: "request-queue-timeout" },
          state: { phase: "pending", approved: false },
          at: 0,
        },
        {
          type: "workflow.state",
          state: { phase: "pending", approved: false },
          reason: "activity",
          sequence: 1,
          at: 0,
        },
        {
          type: "workflow.activity.scheduled",
          sequence: 1,
          id: "activity:approval:queue-timeout:1",
          dependency: "payments",
          operation: "charge",
          input: { requestId: "request-queue-timeout" },
          policy: {
            timeout: { attempt: 1_000, total: null, queue: 100, heartbeat: null },
            retry: {
              attempts: 1,
              delay: 0,
              factor: 1,
              maximumDelay: null,
              nonRetryable: [],
            },
          },
          at: 0,
        },
      ],
    });
    const charge = vi.fn(async () => ({ receipt: "too-late" }));
    await using fixture = await createWorkflowFixture(
      approvalWorkflow("charge", "pending", true, { attempts: 1 }, { attempt: 1_000, queue: 100 }),
      {
        clock,
        events,
        dependencies: { payments: { charge, refund: async () => undefined } },
      },
    );

    await expect(
      fixture.api.result({ execution: { id: "queue-timeout" }, follow: "run" }),
    ).rejects.toMatchObject({
      failure: {
        name: "WorkflowActivityTimeout",
        data: { timeout: "queue" },
      },
    });
    expect(charge).not.toHaveBeenCalled();
  });

  test("preserves typed Dependency failure data and skips declared non-retryable failures", async () => {
    const charge = vi.fn(
      async ({
        invocation,
      }: {
        invocation: DependencyProviderInvocation<
          Readonly<{ type: "declined"; data: { code: number }; message?: string }>
        >;
      }) =>
        invocation.fail({
          type: "declined",
          data: { code: 4_003 },
          message: "Payment was declined.",
        }),
    );
    const payments = conformExternalDependencies(
      [
        {
          name: "payments",
          binding: "envelope",
          operations: [
            {
              name: "charge",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "requestId",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              failures: {
                kind: "record",
                fields: [
                  {
                    name: "declined",
                    optional: false,
                    type: {
                      kind: "record",
                      fields: [
                        {
                          name: "code",
                          optional: false,
                          type: { kind: "primitive", name: "number" },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              name: "refund",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: { kind: "primitive", name: "void" },
            },
          ],
        },
      ],
      { payments: { charge, async refund() {} } },
    ).payments as Approval["Dependencies"]["payments"];
    await using fixture = await createWorkflowFixture(
      approvalWorkflow("charge", "pending", true, {
        attempts: 3,
        nonRetryable: ["declined"],
      }),
      { dependencies: { payments } },
    );

    const execution = await fixture.api.start({
      id: "typed-failure",
      input: { requestId: "request-declined" },
    });
    const result = fixture.api.result({ execution, follow: "run" });

    await expect(result).rejects.toMatchObject({
      failure: {
        name: "declined",
        message: "Payment was declined.",
        data: { code: 4_003 },
      },
    });
    expect(charge).toHaveBeenCalledTimes(1);
    const history = await fixture.events.read({
      stream: "workflow:approval:typed-failure",
    });
    expect(
      history
        .filter(({ event }) => event.type === "workflow.activity.attempt.failed")
        .map(({ event }) => event),
    ).toEqual([
      expect.objectContaining({
        error: {
          name: "declined",
          message: "Payment was declined.",
          data: { code: 4_003 },
        },
      }),
    ]);
  });

  test("caps declarative Activity retry backoff", async () => {
    let attempts = 0;
    const charge = vi.fn(async () => {
      attempts += 1;
      if (attempts < 4) throw new Error("transient");
      return { receipt: "receipt-4" };
    });
    const clock = createWorkflowTestClock();
    await using fixture = await createWorkflowFixture(
      approvalWorkflow("charge", "pending", true, {
        attempts: 4,
        delay: 10,
        factor: 3,
        maximumDelay: 20,
      }),
      {
        clock,
        dependencies: { payments: { charge, refund: async () => undefined } },
      },
    );
    const execution = await fixture.api.start({
      id: "capped-retry",
      input: { requestId: "request-4" },
    });
    const result = fixture.api.result({ execution, follow: "run" });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(1));
    clock.advance({ milliseconds: 10 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(2));
    clock.advance({ milliseconds: 20 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(3));
    clock.advance({ milliseconds: 20 });
    await vi.waitFor(() => expect(charge).toHaveBeenCalledTimes(4));
    clock.advance({ milliseconds: 1000 });
    await expect(result).resolves.toMatchObject({ receipt: "receipt-4" });
  });

  test("rejects invalid Activity policy before accepting work", async () => {
    await expect(
      createWorkflowFixture(
        approvalWorkflow("charge", "pending", true, {
          attempts: 3,
          delay: 10,
          maximumDelay: 5,
        }),
        {
          dependencies: {
            payments: {
              charge: async () => ({ receipt: "unused" }),
              refund: async () => undefined,
            },
          },
        },
      ),
    ).rejects.toThrow(
      "Workflow Activity maximum retry delay must not be less than its retry delay.",
    );
  });

  test("makes concurrent starts idempotent and rejects conflicting input", async () => {
    const charge = vi.fn(async () => ({ receipt: "receipt-4" }));
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      dependencies: {
        payments: { charge, refund: async () => undefined },
      },
    });
    const [first, second] = await Promise.all([
      fixture.api.start({ id: "same", input: { requestId: "request-4" } }),
      fixture.api.start({ id: "same", input: { requestId: "request-4" } }),
    ]);
    expect(first).toEqual(second);
    expect(first.id).toBe("same");
    expect(first.run).toMatch(/^workflow-test-worker-/);
    await expect(fixture.api.describe({ execution: first })).resolves.toMatchObject({
      execution: first,
    });
    await expect(
      fixture.api.start({ id: "same", input: { requestId: "different" } }),
    ).rejects.toThrow("different input");
    const history = await fixture.events.read({ stream: "workflow:approval:same" });
    const started = history.filter(({ event }) => event.type === "workflow.started");
    expect(started).toHaveLength(1);
    expect(started[0]?.event).toMatchObject({ run: first.run });
  });

  test("rejects stale run selectors across the complete Workflow control surface", async () => {
    await using fixture = await createRawWorkflowFixture(counter, {
      name: "counter",
      dependencies: {},
    });
    const execution = await fixture.api.start({ id: "selected", input: {} });
    const stale = { ...execution, run: `${execution.run}-stale` };
    const mismatch = `has run ${JSON.stringify(execution.run)}, not ${JSON.stringify(stale.run)}`;

    await expect(fixture.api.describe({ execution: stale })).rejects.toThrow(mismatch);
    await expect(fixture.api.result({ execution: stale, follow: "run" })).rejects.toThrow(mismatch);
    await expect(fixture.api.cancel({ execution: stale })).rejects.toThrow(mismatch);
    await expect(
      fixture.api.signal.add({ execution: stale, input: { amount: 1 } }),
    ).rejects.toThrow(mismatch);
    await expect(
      fixture.api.query.count({ execution: stale, input: {}, consistency: "current" }),
    ).rejects.toThrow(mismatch);
    await expect(
      fixture.api.watch({ execution: stale })[Symbol.asyncIterator]().next(),
    ).rejects.toThrow(mismatch);

    await expect(
      fixture.api.query.count({ execution, input: {}, consistency: "current" }),
    ).resolves.toBe(0);
    await expect(fixture.api.signal.add({ execution, input: { amount: 1 } })).resolves.toEqual(
      execution,
    );
    await expect(
      fixture.api.query.count({
        execution: { id: execution.id },
        input: {},
        consistency: "current",
      }),
    ).resolves.toBe(1);
  });

  test("rejects an incompatible durable history before replay", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    await events.append({
      stream: "workflow:approval:incompatible",
      expectedRevision: 0,
      events: [
        {
          type: "workflow.started",
          definitionVersion: WORKFLOW_DEFINITION_VERSION,
          protocolVersion: 10,
          run: "run-incompatible",
          input: { requestId: "old" },
          state: { phase: "pending", approved: false },
          at: 0,
        } as unknown as WorkflowJournalEvent<Approval>,
      ],
    });
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      events,
      dependencies: {
        payments: {
          charge: async () => ({ receipt: "unused" }),
          refund: async () => undefined,
        },
      },
    });

    await expect(fixture.api.describe({ execution: { id: "incompatible" } })).rejects.toThrow(
      "uses protocol version 10; this runtime supports 9",
    );
  });

  test("rejects terminal cancellation without a durable request", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    await events.append({
      stream: "workflow:approval:invalid-cancellation",
      expectedRevision: 0,
      events: [
        {
          type: "workflow.started",
          definitionVersion: WORKFLOW_DEFINITION_VERSION,
          protocolVersion: 9,
          run: "run-invalid-cancellation",
          input: { requestId: "invalid" },
          state: { phase: "pending", approved: false },
          at: 0,
        },
        {
          type: "workflow.cancelled",
          state: { phase: "pending", approved: false },
          at: 1,
        },
      ],
    });
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      events,
      dependencies: {
        payments: {
          charge: async () => ({ receipt: "unused" }),
          refund: async () => undefined,
        },
      },
    });

    await expect(
      fixture.api.describe({ execution: { id: "invalid-cancellation" } }),
    ).rejects.toThrow("cancelled without a cancellation request");
  });

  test("rejects an impossible Activity history before replay", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    await events.append({
      stream: "workflow:approval:invalid-activity",
      expectedRevision: 0,
      events: [
        {
          type: "workflow.started",
          definitionVersion: WORKFLOW_DEFINITION_VERSION,
          protocolVersion: 9,
          run: "run-invalid-activity",
          input: { requestId: "invalid" },
          state: { phase: "pending", approved: false },
          at: 0,
        },
        {
          type: "workflow.state",
          state: { phase: "pending", approved: false },
          reason: "activity",
          sequence: 1,
          at: 0,
        },
        {
          type: "workflow.activity.scheduled",
          sequence: 1,
          id: "activity:approval:invalid-activity:1",
          dependency: "payments",
          operation: "charge",
          input: { requestId: "invalid" },
          policy: {
            timeout: {
              attempt: 30_000,
              total: null,
              queue: null,
              heartbeat: null,
            },
            retry: {
              attempts: 3,
              delay: 10,
              factor: 2,
              maximumDelay: null,
              nonRetryable: [],
            },
          },
          at: 0,
        },
        {
          type: "workflow.activity.completed",
          sequence: 1,
          attempt: 1,
          result: { receipt: "impossible" },
          at: 0,
        },
      ],
    });
    await using fixture = await createWorkflowFixture(approvalWorkflow(), {
      events,
      dependencies: {
        payments: {
          charge: async () => ({ receipt: "unused" }),
          refund: async () => undefined,
        },
      },
    });

    await expect(fixture.api.describe({ execution: { id: "invalid-activity" } })).rejects.toThrow(
      "closes an invalid Activity 1 attempt 1",
    );
  });

  test("rejects an impossible timer history before replay", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Alarm>>();
    await events.append({
      stream: "workflow:alarm:invalid-timer",
      expectedRevision: 0,
      events: [
        {
          type: "workflow.started",
          definitionVersion: WORKFLOW_DEFINITION_VERSION,
          protocolVersion: 9,
          run: "run-invalid-timer",
          input: { deadline: 100 },
          state: { phase: "waiting" },
          at: 0,
        },
        {
          type: "workflow.timer.scheduled",
          sequence: 1,
          deadline: 100,
          at: 0,
        },
      ],
    });
    await using fixture = await createRawWorkflowFixture(alarmWorkflow(), {
      name: "alarm",
      events,
      dependencies: {},
    });

    await expect(fixture.api.describe({ execution: { id: "invalid-timer" } })).rejects.toThrow(
      "schedules timer 1 without a state checkpoint",
    );
  });

  test("rejects an impossible condition history before replay", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Gate>>();
    await events.append({
      stream: "workflow:gate:invalid-condition",
      expectedRevision: 0,
      events: [
        {
          type: "workflow.started",
          definitionVersion: WORKFLOW_DEFINITION_VERSION,
          protocolVersion: 9,
          run: "run-invalid-condition",
          input: { timeout: 100 },
          state: { open: false },
          at: 0,
        },
        {
          type: "workflow.state",
          state: { open: false },
          reason: "condition",
          sequence: 1,
          at: 0,
        },
        {
          type: "workflow.condition.scheduled",
          sequence: 1,
          at: 0,
        },
        {
          type: "workflow.condition.completed",
          sequence: 1,
          outcome: "timed-out",
          at: 0,
        },
      ],
    });
    await using fixture = await createRawWorkflowFixture(gate, {
      name: "gate",
      events,
      dependencies: {},
    });

    await expect(fixture.api.describe({ execution: { id: "invalid-condition" } })).rejects.toThrow(
      "completes an invalid condition 1",
    );
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
    await expect(
      second.api.result({ execution: { id: "replicated" }, follow: "run" }),
    ).resolves.toEqual({
      receipt: "replicated-receipt",
      approved: false,
    });
    const history = await events.read({ stream: "workflow:approval:replicated" });
    expect(history.filter(({ event }) => event.type === "workflow.worker.claimed")).toHaveLength(1);
  });

  test("delivers durable Activity cancellation across server replicas", async () => {
    const events = createMemoryEventStore<WorkflowJournalEvent<Approval>>();
    const clock = createWorkflowTestClock();
    let cancellationObserved = false;
    const payments = conformExternalDependencies(
      [
        {
          name: "payments",
          binding: "envelope",
          operations: [
            {
              name: "charge",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "requestId",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
            },
            {
              name: "refund",
              mode: "asynchronous",
              input: {
                kind: "record",
                fields: [
                  {
                    name: "receipt",
                    optional: false,
                    type: { kind: "primitive", name: "string" },
                  },
                ],
              },
              output: { kind: "primitive", name: "void" },
            },
          ],
        },
      ],
      {
        payments: {
          async charge({
            input,
            invocation,
          }: {
            input: { requestId: string };
            invocation: DependencyProviderInvocation;
          }) {
            await invocation.cancellation.wait();
            cancellationObserved = invocation.cancellation.requested();
            return { receipt: input.requestId };
          },
          async refund() {},
        },
      },
    ).payments as Approval["Dependencies"]["payments"];
    const dependencies = { payments };
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

    const execution = await first.api.start({
      id: "cancel-replica",
      input: { requestId: "cancel-replica" },
    });
    const result = expect(first.api.result({ execution, follow: "run" })).rejects.toMatchObject({
      failure: { name: "WorkflowCancelled" },
    });
    await second.api.cancel({ execution: { id: "cancel-replica" }, reason: "remote operator" });
    await vi.waitFor(() => expect(cancellationObserved).toBe(true));
    await result;
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
      expect((await first.api.describe({ execution: { id: "long" } })).state.phase).toBe("charged");
    });
    clock.advance({ milliseconds: 1000 });
    await expect(
      second.api.result({ execution: { id: "long" }, follow: "run" }),
    ).resolves.toMatchObject({
      receipt: "long-receipt",
    });
  });

  test("fails replay with a precise diagnostic when durable Activity order changes", async () => {
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
    await expect(
      changed.api.result({ execution: { id: "history" }, follow: "run" }),
    ).rejects.toMatchObject({
      failure: expect.objectContaining({
        message: expect.stringContaining("changed durable Activity 1"),
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
    await expect(
      changed.api.result({ execution: { id: "state-history" }, follow: "run" }),
    ).rejects.toMatchObject({
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
      await original.api.signal.approve({
        execution: { id: "signal-history" },
        input: { by: "alice" },
      });
      await vi.waitFor(async () => {
        expect(
          await original.api.query.status({
            execution: { id: "signal-history" },
            input: {},
            consistency: "current",
          }),
        ).toMatchObject({ approved: true });
      });
    }
    await using changed = await createWorkflowFixture(
      approvalWorkflow("charge", "pending", false),
      { events, clock, dependencies },
    );
    await changed.api.start({ id: "signal-history", input: { requestId: "request-signal" } });
    await expect(
      changed.api.result({ execution: { id: "signal-history" }, follow: "run" }),
    ).rejects.toMatchObject({
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
    await fixture.api.cancel({ execution: { id: "cancel" }, reason: "no longer needed" });
    await vi.waitFor(async () => {
      expect((await fixture.api.describe({ execution: { id: "cancel" } })).status).toBe(
        "cancelled",
      );
    });
    fixture.clock.advance({ milliseconds: 1000 });
    await expect(
      fixture.api.result({ execution: { id: "cancel" }, follow: "run" }),
    ).rejects.toMatchObject({
      failure: { name: "WorkflowCancelled" },
    });
  });

  test("cancels one durable branch explicitly across worker restart", async () => {
    const clock = createWorkflowTestClock();
    await using fixture = await createRawWorkflowFixture(cancellationWorkflow, {
      name: "cancellation",
      dependencies: {},
      clock,
    });
    await fixture.api.start({ id: "manual-branch", input: { mode: "manual" } });
    await vi.waitFor(async () => {
      const history = await fixture.events.read({
        stream: "workflow:cancellation:manual-branch",
      });
      expect(history.filter(({ event }) => event.type === "workflow.timer.scheduled")).toHaveLength(
        1,
      );
      expect(
        history.filter(({ event }) => event.type === "workflow.condition.scheduled"),
      ).toHaveLength(1);
    });
    await fixture.restart();
    const result = fixture.api.result({ execution: { id: "manual-branch" }, follow: "run" });
    await fixture.api.signal.cancel({ execution: { id: "manual-branch" }, input: {} });

    await expect(result).resolves.toEqual({ outcome: "manually-cancelled" });
    const history = await fixture.events.read({
      stream: "workflow:cancellation:manual-branch",
    });
    expect(history.filter(({ event }) => event.type === "workflow.timer.cancelled")).toHaveLength(
      1,
    );
    expect(
      history.filter(({ event }) => event.type === "workflow.condition.completed"),
    ).toHaveLength(1);
    expect(history.filter(({ event }) => event.type === "workflow.completed")).toHaveLength(1);
  });

  test("uses a durable timeout to cancel a branch", async () => {
    const clock = createWorkflowTestClock();
    await using fixture = await createRawWorkflowFixture(cancellationWorkflow, {
      name: "cancellation",
      dependencies: {},
      clock,
    });
    const execution = await fixture.api.start({
      id: "timeout-branch",
      input: { mode: "timeout" },
    });
    const result = fixture.api.result({ execution, follow: "run" });
    clock.advance({ milliseconds: 100 });

    await expect(result).resolves.toEqual({ outcome: "timed-out" });
    const history = await fixture.events.read({
      stream: "workflow:cancellation:timeout-branch",
    });
    expect(history.filter(({ event }) => event.type === "workflow.timer.completed")).toHaveLength(
      1,
    );
    expect(history.filter(({ event }) => event.type === "workflow.timer.cancelled")).toHaveLength(
      1,
    );
  });

  test("propagates root cancellation into inherited branches", async () => {
    await using fixture = await createRawWorkflowFixture(cancellationWorkflow, {
      name: "cancellation",
      dependencies: {},
    });
    const execution = await fixture.api.start({
      id: "inherited",
      input: { mode: "inherit" },
    });
    const result = expect(fixture.api.result({ execution, follow: "run" })).rejects.toMatchObject({
      failure: { name: "WorkflowCancelled" },
    });
    await fixture.api.cancel({ execution: { id: "inherited" }, reason: "operator" });

    await result;
    const history = await fixture.events.read({ stream: "workflow:cancellation:inherited" });
    expect(
      history.filter(({ event }) => event.type === "workflow.cancellation.requested"),
    ).toHaveLength(1);
    expect(history.filter(({ event }) => event.type === "workflow.timer.cancelled")).toHaveLength(
      1,
    );
    expect(history.filter(({ event }) => event.type === "workflow.cancelled")).toHaveLength(1);
  });

  test("allows shielded durable cleanup after root cancellation is requested", async () => {
    const clock = createWorkflowTestClock();
    await using fixture = await createRawWorkflowFixture(cancellationWorkflow, {
      name: "cancellation",
      dependencies: {},
      clock,
    });
    const execution = await fixture.api.start({ id: "shielded", input: { mode: "shield" } });
    const result = fixture.api.result({ execution, follow: "run" });
    await fixture.api.cancel({ execution: { id: "shielded" }, reason: "operator" });
    clock.advance({ milliseconds: 100 });

    await expect(result).resolves.toEqual({ outcome: "cleaned" });
    const history = await fixture.events.read({ stream: "workflow:cancellation:shielded" });
    expect(
      history.filter(({ event }) => event.type === "workflow.cancellation.requested"),
    ).toHaveLength(1);
    expect(history.filter(({ event }) => event.type === "workflow.timer.completed")).toHaveLength(
      1,
    );
    expect(history.filter(({ event }) => event.type === "workflow.timer.cancelled")).toHaveLength(
      1,
    );
    expect(history.filter(({ event }) => event.type === "workflow.completed")).toHaveLength(1);
    expect(history.filter(({ event }) => event.type === "workflow.cancelled")).toHaveLength(0);
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
  state: ({ input: _input }) => ({ phase: "pending" }),
  async execute({ input, state, sleep }) {
    await sleep({ duration: 1 });
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

function workflowConformanceSystemSource(): string {
  return `
import {
  createFeature,
  createSystem,
  createWorkflow,
  type DeferredDependencyInvocation,
  type Dependency,
  type Program,
  type WorkflowApi,
  type WorkflowModel,
} from "@/index";
import type { ServerProcess } from "@/platforms/server/platform";

type Recorder = Dependency<{
  Operations: {
    read(input: {}): Promise<{
      scenarios: {
        id: string;
        mode: "manual" | "none" | "root";
        cancelAfter: number;
        inheritedDuration: number;
        inheritedTimeout: number;
        shieldedDuration: number;
      }[];
    }>;
    record(input: {
      value:
        | { kind: "activity"; message: string }
        | {
            kind: "interleaving";
            id: string;
            result: {
              inherited: "fulfilled" | "rejected";
              shielded: "fulfilled" | "rejected";
            };
          }
        | {
            kind: "observation";
            snapshot: {
              status: string;
              state: { phase: string; count: number };
              result: { delivered: boolean; count: number };
            };
            result: { delivered: boolean; count: number };
            status: { phase: string; count: number };
            watched: string;
            cancelled: string;
            deferred: string;
            deferredFailed: string;
            adjusted: { rescheduled: boolean; fired: boolean };
            executionStable: boolean;
            staleRunRejected: boolean;
            cancellationScopes: {
              manual: string;
              timeout: string;
              inherited: string;
              shielded: string;
            };
            deadlineFailed: boolean;
            conflictingStartRejected: boolean;
          };
    }): Promise<void>;
  };
}>;

type Formatter = Dependency<{
  Operations: {
    format(input: { value: string }): Promise<string>;
    deferred(input: { value: string }): Promise<string>;
    slow(input: { value: string }): Promise<string>;
  };
  Failures: {
    unavailable: { code: number };
  };
  Heartbeats: {
    deferred: { progress: number };
  };
}>;

type Formatting = {
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: {
          clock: { now(input: {}): number };
          timer: { sleep(input: { until: number }): Promise<void> };
        };
        Provides: { formatter: Formatter };
      }
    >;
  };
};

const formatting = createFeature<Formatting>({
  programs: {
    server: {
      start({ dependencies }) {
        return {
          formatter: {
            async format({ input, invocation }) {
              return \`${"${input.value}"}:${"${invocation.attempt}"}:${"${invocation.id}"}\`;
            },
            async deferred({ input, invocation }) {
              if (input.value === "portable-failure" && invocation.attempt > 1) {
                if (invocation.previousHeartbeat?.progress !== 1) {
                  throw new Error("Deferred Activity heartbeat did not survive its retry.");
                }
                return input.value;
              }
              return invocation.defer({ id: \`completion:${"${invocation.id}"}\` });
            },
            async slow({ input }) {
              await dependencies.timer.sleep({
                until: dependencies.clock.now({}) + 50,
              });
              return input.value;
            },
          },
        };
      },
    },
  },
});

type Reminder = WorkflowModel<{
  Name: "reminder";
  Input: { message: string };
  Result: { delivered: boolean; count: number };
  State: { phase: "pending" | "delivered"; count: number };
  Dependencies: { formatter: Formatter; recorder: Recorder };
  Signals: {
    increment(input: { amount: number }): void;
  };
  Queries: {
    status(input: {}): { phase: "pending" | "delivered"; count: number };
  };
}>;

type Failing = WorkflowModel<{
  Name: "failing";
  Input: { reason: string };
  Result: never;
  State: { phase: "pending" | "failed" };
  Dependencies: {};
  Signals: {};
  Queries: {};
}>;

type Cancellable = WorkflowModel<{
  Name: "cancellable";
  Input: {};
  Result: { completed: true };
  State: { phase: "waiting" };
  Dependencies: {};
  Signals: {};
  Queries: {};
}>;

type ScopedCancellation = WorkflowModel<{
  Name: "scopedCancellation";
  Input: { mode: "manual" | "timeout" | "inherited" | "shield" };
  Result: { outcome: string };
  State: { phase: "waiting" | "completed" };
  Dependencies: {};
  Signals: {};
  Queries: {};
}>;

type Deadline = WorkflowModel<{
  Name: "deadline";
  Input: {};
  Result: never;
  State: { phase: "pending" };
  Dependencies: { formatter: Formatter };
  Signals: {};
  Queries: {};
}>;

type Deferred = WorkflowModel<{
  Name: "deferred";
  Input: { value: string };
  Result: { value: string };
  State: { phase: "pending" | "completed" };
  Dependencies: { formatter: Formatter };
  Signals: {};
  Queries: {};
}>;

type Adjustable = WorkflowModel<{
  Name: "adjustable";
  Input: { timeout: number };
  Result: { rescheduled: boolean; fired: boolean };
  State: { timeout: number; rescheduled: boolean };
  Dependencies: {};
  Signals: {
    reschedule(input: { timeout: number }): void;
  };
  Queries: {};
}>;

type Interleaving = WorkflowModel<{
  Name: "interleaving";
  Input: {
    mode: "manual" | "none" | "root";
    cancelAfter: number;
    inheritedDuration: number;
    inheritedTimeout: number;
    shieldedDuration: number;
  };
  Result: {
    inherited: "fulfilled" | "rejected";
    shielded: "fulfilled" | "rejected";
  };
  State: { phase: "running" | "completed" };
  Dependencies: {};
  Signals: {};
  Queries: {};
}>;

const reminder = createWorkflow<Reminder>({
  state: ({ input: _input }) => ({ phase: "pending", count: 0 }),
  activities: {
    formatter: {
      format: { timeout: { attempt: 30_000 } },
      deferred: { timeout: { attempt: 30_000 } },
      slow: { timeout: { attempt: 30_000 } },
    },
    recorder: {
      read: { timeout: { attempt: 30_000 } },
      record: { timeout: { attempt: 30_000 } },
    },
  },
  async execute({ input, dependencies, state, sleep, wait }) {
    const message = await dependencies.formatter.format({ value: input.message });
    await dependencies.recorder.record({
      value: { kind: "activity", message },
    });
    const incremented = await wait({
      condition: () => state.count > 0,
      timeout: 30_000,
    });
    if (!incremented) {
      throw new Error("Workflow condition unexpectedly timed out.");
    }
    const impossible = await wait({
      condition: () => state.count > 99,
      timeout: 1,
    });
    if (impossible) {
      throw new Error("Workflow condition unexpectedly succeeded.");
    }
    await sleep({ duration: 20 });
    await sleep({ deadline: 0 });
    state.phase = "delivered";
    return { delivered: input.message.length > 0, count: state.count };
  },
  signals: {
    increment({ state, input }) {
      state.count += input.amount;
    },
  },
  queries: {
    status: ({ state }) => ({ phase: state.phase, count: state.count }),
  },
});

const failing = createWorkflow<Failing>({
  state: ({ input: _input }) => ({ phase: "pending" }),
  execute({ input, state }) {
    state.phase = "failed";
    throw new Error(input.reason);
  },
  signals: {},
  queries: {},
});

const cancellable = createWorkflow<Cancellable>({
  state: ({ input: _input }) => ({ phase: "waiting" }),
  async execute({ sleep }) {
    await sleep({ duration: 200 });
    return { completed: true };
  },
  signals: {},
  queries: {},
});

const scopedCancellation = createWorkflow<ScopedCancellation>({
  state: ({ input: _input }) => ({ phase: "waiting" }),
  async execute({ input, state, cancellation, sleep }) {
    const branch = cancellation.start({
      propagation: input.mode === "shield" ? "shield" : "inherit",
      ...(input.mode === "timeout" ? { timeout: 10 } : {}),
      async execute({ sleep }) {
        await sleep({ duration: input.mode === "shield" ? 20 : 200 });
        return input.mode === "shield" ? "shielded" : "unexpected";
      },
    });
    if (input.mode === "manual") {
      await sleep({ duration: 1 });
      branch.cancel({ reason: "manual" });
    }
    if (input.mode === "inherited") {
      await branch.result();
      return { outcome: "unexpected" };
    }
    try {
      const outcome = await branch.result();
      state.phase = "completed";
      return { outcome };
    } catch {
      state.phase = "completed";
      return { outcome: input.mode };
    }
  },
  signals: {},
  queries: {},
});

const deadline = createWorkflow<Deadline>({
  state: ({ input: _input }) => ({ phase: "pending" }),
  activities: {
    formatter: {
      slow: {
        timeout: { attempt: 10 },
        retry: { attempts: 2, delay: 1 },
      },
      format: { timeout: { attempt: 30_000 } },
      deferred: { timeout: { attempt: 30_000 } },
    },
  },
  async execute({ dependencies }) {
    await dependencies.formatter.slow({ value: "too slow" });
    throw new Error("The timed-out Activity unexpectedly completed.");
  },
  signals: {},
  queries: {},
});

const deferred = createWorkflow<Deferred>({
  state: ({ input: _input }) => ({ phase: "pending" }),
  activities: {
    formatter: {
      deferred: {
        timeout: { attempt: 30_000, heartbeat: 200 },
        retry: { attempts: 2, delay: 10 },
      },
      format: { timeout: { attempt: 30_000 } },
      slow: { timeout: { attempt: 30_000 } },
    },
  },
  async execute({ input, dependencies, state }) {
    const value = await dependencies.formatter.deferred({ value: input.value });
    state.phase = "completed";
    return { value };
  },
  signals: {},
  queries: {},
});

const adjustable = createWorkflow<Adjustable>({
  state: ({ input }) => ({ timeout: input.timeout, rescheduled: false }),
  async execute({ state, time, wait }) {
    while (true) {
      const startedAt = time.now();
      const timeout = state.timeout;
      const changed = await wait({
        condition: () => state.timeout !== timeout,
        timeout,
      });
      if (!changed) {
        return {
          rescheduled: state.rescheduled,
          fired: time.now() >= startedAt + timeout,
        };
      }
    }
  },
  signals: {
    reschedule({ state, input }) {
      state.timeout = input.timeout;
      state.rescheduled = true;
    },
  },
  queries: {},
});

const interleaving = createWorkflow<Interleaving>({
  state: ({ input: _input }) => ({ phase: "running" }),
  async execute({ input, state, cancellation, sleep }) {
    const inherited = cancellation.start({
      propagation: "inherit",
      timeout: input.inheritedTimeout,
      async execute({ sleep }) {
        await sleep({ duration: input.inheritedDuration });
        return "inherited";
      },
    });
    const shielded = cancellation.start({
      propagation: "shield",
      async execute({ sleep }) {
        await sleep({ duration: input.shieldedDuration });
        return "shielded";
      },
    });
    if (input.mode === "manual") {
      await sleep({ duration: input.cancelAfter });
      inherited.cancel({ reason: "manual" });
    }
    const results = await Promise.allSettled([
      inherited.result(),
      shielded.result(),
    ]);
    state.phase = "completed";
    return {
      inherited: results[0].status,
      shielded: results[1].status,
    };
  },
  signals: {},
  queries: {},
});

type Driver = {
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: {
          reminder: WorkflowApi<Reminder>;
          failing: WorkflowApi<Failing>;
          cancellable: WorkflowApi<Cancellable>;
          scopedCancellation: WorkflowApi<ScopedCancellation>;
          deadline: WorkflowApi<Deadline>;
          deferred: WorkflowApi<Deferred>;
          adjustable: WorkflowApi<Adjustable>;
          interleaving: WorkflowApi<Interleaving>;
          recorder: Recorder;
          clock: { now(input: {}): number };
          timer: { sleep(input: { until: number }): Promise<void> };
        };
      }
    >;
  };
};

const driver = createFeature<Driver>({
  programs: {
    server: {
      async start({ dependencies }) {
        const id = "conformance";
        const execution = await dependencies.reminder.start({
          id,
          input: { message: "portable" },
        });
        await dependencies.reminder.signal.increment({
          execution,
          input: { amount: 2 },
        });
        const result = await dependencies.reminder.result({ execution, follow: "run" });
        const status = await dependencies.reminder.query.status({
          execution,
          input: {},
          consistency: "current",
        });
        const snapshot = await dependencies.reminder.describe({ execution });
        if (result.count !== status.count || status.phase !== "delivered") {
          throw new Error("Workflow result and Query diverged.");
        }
        if (!snapshot.result || snapshot.result.count !== result.count) {
          throw new Error("Workflow Snapshot and result diverged.");
        }
        if (
          snapshot.execution.id !== execution.id ||
          snapshot.execution.run !== execution.run
        ) {
          throw new Error("Workflow Snapshot changed execution identity.");
        }
        let staleRunRejected = false;
        try {
          await dependencies.reminder.describe({
            execution: {
              id: execution.id,
              run: execution.run + "-stale",
            },
          });
        } catch {
          staleRunRejected = true;
        }
        if (!staleRunRejected) {
          throw new Error("Workflow accepted a stale run selector.");
        }
        let watched = "running";
        for await (const update of dependencies.reminder.watch({ execution })) {
          watched = update.status;
        }
        const repeated = await dependencies.reminder.start({
          id,
          input: { message: "portable" },
        });
        if (repeated.run !== execution.run) {
          throw new Error("Idempotent Workflow start changed run identity.");
        }
        let conflictingStartRejected = false;
        try {
          await dependencies.reminder.start({
            id,
            input: { message: "different" },
          });
        } catch {
          conflictingStartRejected = true;
        }
        if (!conflictingStartRejected) {
          throw new Error("Workflow accepted conflicting start input.");
        }
        const cancelId = "conformance-cancel";
        const cancelExecution = await dependencies.cancellable.start({ id: cancelId, input: {} });
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + 5,
        });
        await dependencies.cancellable.cancel({
          execution: cancelExecution,
          reason: "conformance",
        });
        let cancellationFailed = false;
        try {
          await dependencies.cancellable.result({ execution: cancelExecution, follow: "run" });
        } catch {
          cancellationFailed = true;
        }
        if (!cancellationFailed) {
          throw new Error("Workflow cancellation did not reject its result.");
        }
        const cancelled = await dependencies.cancellable.describe({ execution: cancelExecution });
        if (cancelled.status !== "cancelled") {
          throw new Error("Workflow cancellation was not observable.");
        }
        const deadlineId = "conformance-deadline";
        const deadlineExecution = await dependencies.deadline.start({ id: deadlineId, input: {} });
        let deadlineFailed = false;
        try {
          await dependencies.deadline.result({ execution: deadlineExecution, follow: "run" });
        } catch {
          deadlineFailed = true;
        }
        if (!deadlineFailed) {
          throw new Error("Workflow Activity deadline was not observable.");
        }
        const deferredId = "conformance-deferred";
        const deferredExecution = await dependencies.deferred.start({
          id: deferredId,
          input: { value: "portable-deferred" },
        });
        const invocation: DeferredDependencyInvocation<string> = {
          id: "completion:activity:deferred:conformance-deferred:1",
          activity: "activity:deferred:conformance-deferred:1",
          execution: {
            workflow: "deferred",
            id: deferredId,
            run: deferredExecution.run,
          },
          attempt: 1,
        };
        let deferredCompleted = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (!deferredCompleted) {
            try {
              await dependencies.deferred.activities.complete({
                invocation,
                result: "portable-deferred",
              });
              deferredCompleted = true;
            } catch {
              await dependencies.timer.sleep({
                until: dependencies.clock.now({}) + 5,
              });
            }
          }
        }
        if (!deferredCompleted) {
          throw new Error("Deferred Activity did not become pending.");
        }
        await dependencies.deferred.activities.complete({
          invocation,
          result: "portable-deferred",
        });
        const completedDeferred = await dependencies.deferred.result({
          execution: deferredExecution,
          follow: "run",
        });
        const failedDeferredId = "conformance-deferred-failure";
        const failedDeferredExecution = await dependencies.deferred.start({
          id: failedDeferredId,
          input: { value: "portable-failure" },
        });
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + 100,
        });
        const failedInvocation: DeferredDependencyInvocation<
          string,
          {
            type: "unavailable";
            data: { code: number };
            retry?: { delay: number };
          },
          { progress: number }
        > = {
          id: "completion:activity:deferred:conformance-deferred-failure:1",
          activity: "activity:deferred:conformance-deferred-failure:1",
          execution: {
            workflow: "deferred",
            id: failedDeferredId,
            run: failedDeferredExecution.run,
          },
          attempt: 1,
        };
        await dependencies.deferred.activities.heartbeat({
          invocation: failedInvocation,
          details: { progress: 1 },
        });
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + 150,
        });
        const deferredFailure = {
          type: "unavailable" as const,
          data: { code: 503 },
          retry: { delay: 1 },
        };
        await dependencies.deferred.activities.fail({
          invocation: failedInvocation,
          failure: deferredFailure,
        });
        await dependencies.deferred.activities.fail({
          invocation: failedInvocation,
          failure: deferredFailure,
        });
        const completedFailedDeferred = await dependencies.deferred.result({
          execution: failedDeferredExecution,
          follow: "run",
        });
        const adjustableId = "conformance-adjustable";
        const adjustableExecution = await dependencies.adjustable.start({
          id: adjustableId,
          input: { timeout: 100 },
        });
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + 5,
        });
        await dependencies.adjustable.signal.reschedule({
          execution: adjustableExecution,
          input: { timeout: 20 },
        });
        const adjusted = await dependencies.adjustable.result({
          execution: adjustableExecution,
          follow: "run",
        });
        const manualScope = await dependencies.scopedCancellation.start({
          id: "scope-manual",
          input: { mode: "manual" },
        });
        const manualScopeResult = await dependencies.scopedCancellation.result({
          execution: manualScope,
          follow: "run",
        });
        const timeoutScope = await dependencies.scopedCancellation.start({
          id: "scope-timeout",
          input: { mode: "timeout" },
        });
        const timeoutScopeResult = await dependencies.scopedCancellation.result({
          execution: timeoutScope,
          follow: "run",
        });
        const inheritedScope = await dependencies.scopedCancellation.start({
          id: "scope-inherited",
          input: { mode: "inherited" },
        });
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + 5,
        });
        await dependencies.scopedCancellation.cancel({
          execution: inheritedScope,
          reason: "root",
        });
        let inheritedScopeResult = "unexpected";
        try {
          await dependencies.scopedCancellation.result({
            execution: inheritedScope,
            follow: "run",
          });
        } catch {
          inheritedScopeResult = "cancelled";
        }
        const shieldedScope = await dependencies.scopedCancellation.start({
          id: "scope-shielded",
          input: { mode: "shield" },
        });
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + 5,
        });
        await dependencies.scopedCancellation.cancel({
          execution: shieldedScope,
          reason: "root",
        });
        const shieldedScopeResult = await dependencies.scopedCancellation.result({
          execution: shieldedScope,
          follow: "run",
        });
        await dependencies.recorder.record({
          value: {
            kind: "observation",
            snapshot: {
              status: snapshot.status,
              state: snapshot.state,
              result: snapshot.result,
            },
            result,
            status,
            watched,
            cancelled: cancelled.status,
            deferred: completedDeferred.value,
            deferredFailed: completedFailedDeferred.value,
            adjusted,
            executionStable: true,
            staleRunRejected,
            cancellationScopes: {
              manual: manualScopeResult.outcome,
              timeout: timeoutScopeResult.outcome,
              inherited: inheritedScopeResult,
              shielded: shieldedScopeResult.outcome,
            },
            deadlineFailed,
            conflictingStartRejected,
          },
        });
        const failureId = "conformance-failure";
        await dependencies.failing.start({
          id: failureId,
          input: { reason: "intentional failure" },
        });
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + 5,
        });
        const interleavingInput = await dependencies.recorder.read({});
        for (const scenario of interleavingInput.scenarios) {
          const interleavingExecution = await dependencies.interleaving.start({
            id: scenario.id,
            input: {
              mode: scenario.mode,
              cancelAfter: scenario.cancelAfter,
              inheritedDuration: scenario.inheritedDuration,
              inheritedTimeout: scenario.inheritedTimeout,
              shieldedDuration: scenario.shieldedDuration,
            },
          });
          if (scenario.mode === "root") {
            await dependencies.timer.sleep({
              until: dependencies.clock.now({}) + scenario.cancelAfter,
            });
            await dependencies.interleaving.cancel({
              execution: interleavingExecution,
              reason: "root",
            });
          }
          const interleavingResult = await dependencies.interleaving.result({
            execution: interleavingExecution,
            follow: "run",
          });
          await dependencies.recorder.record({
            value: {
              kind: "interleaving",
              id: scenario.id,
              result: interleavingResult,
            },
          });
        }
      },
    },
  },
});

export default createSystem({
  features: {
    formatting,
    reminder: reminder.server,
    failing: failing.server,
    cancellable: cancellable.server,
    scopedCancellation: scopedCancellation.server,
    deadline: deadline.server,
    deferred: deferred.server,
    adjustable: adjustable.server,
    interleaving: interleaving.server,
    driver,
  },
});
`;
}

function workflowRestartSystemSource(): string {
  return `
import {
  createFeature,
  createSystem,
  createWorkflow,
  type Program,
  type WorkflowApi,
  type WorkflowModel,
} from "@/index";
import type { ServerProcess } from "@/platforms/server/platform";

type Restartable = WorkflowModel<{
  Name: "restartable";
  Input: {};
  Result: { completed: true };
  State: { phase: "waiting" | "completed" };
  Dependencies: {};
  Signals: {};
  Queries: {};
}>;

const restartable = createWorkflow<Restartable>({
  state: ({ input: _input }) => ({ phase: "waiting" }),
  async execute({ state, sleep }) {
    await sleep({ duration: 3_000 });
    state.phase = "completed";
    return { completed: true };
  },
  signals: {},
  queries: {},
});

type RestartCancellation = WorkflowModel<{
  Name: "restartCancellation";
  Input: {};
  Result: { cleaned: true };
  State: { phase: "waiting" | "cleaned" };
  Dependencies: {};
  Signals: {};
  Queries: {};
}>;

const restartCancellation = createWorkflow<RestartCancellation>({
  state: ({ input: _input }) => ({ phase: "waiting" }),
  async execute({ state, cancellation }) {
    const cleanup = cancellation.start({
      propagation: "shield",
      async execute({ sleep }) {
        await sleep({ duration: 3_000 });
      },
    });
    await cleanup.result();
    state.phase = "cleaned";
    return { cleaned: true };
  },
  signals: {},
  queries: {},
});

type Driver = {
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: {
          restartable: WorkflowApi<Restartable>;
          restartCancellation: WorkflowApi<RestartCancellation>;
        };
      }
    >;
  };
};

const driver = createFeature<Driver>({
  programs: {
    server: {
      async start({ dependencies }) {
        await dependencies.restartable.start({ id: "restart", input: {} });
        const cancellation = await dependencies.restartCancellation.start({
          id: "restart",
          input: {},
        });
        await dependencies.restartCancellation.cancel({
          execution: cancellation,
          reason: "restart-cleanup",
        });
      },
    },
  },
});

export default createSystem({
  features: {
    restartable: restartable.server,
    restartCancellation: restartCancellation.server,
    driver,
  },
});
`;
}

function normalizeWorkflowEvent(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const event = value as Record<string, unknown>;
  if (event.type === "workflow.worker.claimed" || event.type === "workflow.worker.released") {
    return { type: event.type };
  }
  return Object.fromEntries(
    Object.entries(event)
      .filter(
        ([name]) => !["at", "deadline", "expiresAt", "owner", "retryAt", "run"].includes(name),
      )
      .map(([name, child]) => [
        name,
        Array.isArray(child) ? child.map(normalizeWorkflowEvent) : normalizeWorkflowEvent(child),
      ]),
  );
}

function activityRetryDelays(events: readonly Record<string, unknown>[]): number[] {
  return events.flatMap((event) =>
    event.type === "workflow.activity.attempt.failed" &&
    typeof event.at === "number" &&
    typeof event.retryAt === "number"
      ? [event.retryAt - event.at]
      : [],
  );
}

function normalizeConcurrentWorkflowHistory(events: readonly unknown[]): unknown {
  const normalized = events.map(normalizeWorkflowEvent) as readonly Record<string, unknown>[];
  const sequenceGroups = new Map<number, Record<string, unknown>[]>();
  for (const event of normalized) {
    if (typeof event.sequence !== "number") continue;
    const group = sequenceGroups.get(event.sequence) ?? [];
    group.push(Object.fromEntries(Object.entries(event).filter(([name]) => name !== "sequence")));
    sequenceGroups.set(event.sequence, group);
  }
  const canonicalSequences = new Map(
    [...sequenceGroups]
      .map(([sequence, group]) => ({
        sequence,
        signature: JSON.stringify(
          group
            .map(canonicalValue)
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        ),
      }))
      .sort(
        (left, right) =>
          left.signature.localeCompare(right.signature) || left.sequence - right.sequence,
      )
      .map(({ sequence }, index) => [sequence, index + 1] as const),
  );
  const canonical = normalized.map((event) =>
    typeof event.sequence === "number"
      ? { ...event, sequence: canonicalSequences.get(event.sequence)! }
      : event,
  );
  const states = canonical.filter(({ type }) => type === "workflow.state");
  const commands = canonical
    .filter(
      ({ type }) =>
        type !== "workflow.state" &&
        type !== "workflow.worker.claimed" &&
        type !== "workflow.worker.released",
    )
    .map((event) =>
      canonicalValue(
        Object.fromEntries(
          Object.entries(event).filter(
            ([name]) => name !== "boundary" && name !== "signalRevision",
          ),
        ),
      ),
    )
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    commands,
    stateCount: states.length,
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, child]) => [name, canonicalValue(child)]),
  );
}

function workflowRecorderDependency() {
  return defineServerProductionDependency({
    name: "workflow-recorder-fixture",
    dependency: "recorder",
    configuration: [
      { name: "output", environment: "KIT_RECORDER_OUTPUT", required: true },
      { name: "input", environment: "KIT_RECORDER_INPUT", required: true },
    ],
    crate: {
      package: "kit-server-recorder",
      directory: resolve(import.meta.dirname, "../adapters/server/production/fixtures/recorder"),
    },
    rust: {
      type: "kit_server_recorder::Recorder",
      constructor: "kit_server_recorder::create",
    },
  });
}

async function runNativeAfterReady(
  executable: string,
  databasePath: string,
  milliseconds: number,
): Promise<void> {
  const native = spawn(executable, {
    env: { ...process.env, KIT_DATABASE: databasePath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  native.stdout?.on("data", (value) => {
    diagnostics += String(value);
  });
  native.stderr?.on("data", (value) => {
    diagnostics += String(value);
  });
  try {
    await vi.waitFor(
      async () => {
        if (native.exitCode !== null && native.exitCode !== 0) {
          throw new Error(`Native Workflow fixture exited with ${native.exitCode}.`);
        }
        expect(await nativeDatabaseLocked(databasePath)).toBe(true);
      },
      { timeout: 30_000, interval: 50 },
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
  } catch (error) {
    if (native.exitCode === null) {
      native.kill("SIGINT");
      await new Promise<void>((resolvePromise) => native.once("exit", () => resolvePromise()));
    }
    throw new Error(`Native Workflow did not become ready.\n${diagnostics}`, { cause: error });
  }
  if (native.exitCode !== null) {
    if (native.exitCode !== 0) {
      throw new Error(`Native Workflow fixture exited with ${native.exitCode}.\n${diagnostics}`);
    }
    return;
  }
  native.kill("SIGINT");
  await new Promise<void>((resolvePromise, reject) => {
    native.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGINT") resolvePromise();
      else
        reject(new Error(`Native Workflow fixture exited with ${code ?? signal}.\n${diagnostics}`));
    });
  });
}

async function nativeDatabaseLocked(path: string): Promise<boolean> {
  await access(path);
  try {
    const database = await connect(path);
    await database.close();
    return false;
  } catch (error) {
    if (String(error).includes("locked by another process")) return true;
    throw error;
  }
}

async function readNativeWorkflowHistory(
  databasePath: string,
  stream: string,
): Promise<readonly Readonly<{ revision: number; event: Record<string, unknown> }>[]> {
  const database = (await connect(databasePath)) as unknown as {
    all(
      sql: string,
      ...parameters: readonly unknown[]
    ): Promise<readonly Record<string, unknown>[]>;
    close(): Promise<void>;
  };
  try {
    const rows = await database.all(
      "SELECT revision, event FROM kit_events WHERE stream = ? ORDER BY revision",
      stream,
    );
    return rows.map(({ revision, event }) => ({
      revision: Number(revision),
      event: JSON.parse(String(event)) as Record<string, unknown>,
    }));
  } finally {
    await database.close();
  }
}

async function waitForNativeExecution(
  process: ReturnType<typeof spawn>,
  diagnostics: () => string,
  completed: () => Promise<boolean>,
): Promise<void> {
  await vi.waitFor(
    async () => {
      if (process.exitCode !== null && process.exitCode !== 0) {
        throw new Error(
          `Native Workflow fixture exited with ${process.exitCode}.\n${diagnostics()}`,
        );
      }
      expect(await completed()).toBe(true);
    },
    { timeout: 30_000, interval: 20 },
  );
}
