import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { placePrograms } from "@/core/feature";
import { ActorError, createActor, type Actor } from "@/features/actor";
import { createMemoryEventStore } from "@/features/entity.testing";
import { executeLinkedProgramIR } from "@/runtime/interpreter";

let actorWorkerIdentity = 0;
let compiledActorFixture: ReturnType<typeof compileSystem> | undefined;

function actorFixtureSystem(): ReturnType<typeof compileSystem> {
  compiledActorFixture ??= compileSystem(resolve(import.meta.dirname, "actor.typecheck.ts"));
  return compiledActorFixture;
}

function actorFixtureServer() {
  const server = actorFixtureSystem().programs.find(({ name }) => name === "server");
  if (!server) throw new Error("Actor fixture has no server Program.");
  return server;
}

describe("Actor", () => {
  it("contributes one ordinary server Program without exposing placement", () => {
    type Counter = Actor<{
      Name: "counter";
      Key: string;
      State: { value: number };
    }>;
    const definition = {
      state: (_context: Actor.Initial<Counter>): Counter["State"] => ({ value: 0 }),
      commands: {
        increment({ state }: Actor.Command<Counter>) {
          state.value += 1;
          return { value: state.value };
        },
      },
      queries: {},
    } satisfies Actor.Definition<Counter>;

    const feature = createActor(definition);

    expect(Object.keys(feature)).toEqual(["programs"]);
    expect(typeof feature.programs.server.start).toBe("function");
    expect(Reflect.has(feature.programs.server, "actor")).toBe(false);
  });

  it("keeps infrastructure failures separate from product outcomes", () => {
    const error = new ActorError({
      type: "overloaded",
      retryAt: 1_000,
    });

    expect(error).toBeInstanceOf(ActorError);
    expect(new Error("domain")).not.toBeInstanceOf(ActorError);
    expect(error.failure).toEqual({ type: "overloaded", retryAt: 1_000 });
  });

  it("uses ordinary Program placement", () => {
    type Counter = Actor<{
      Name: "counter";
      Key: string;
      State: { value: number };
    }>;
    const counter = createActor({
      state: (_context: Actor.Initial<Counter>): Counter["State"] => ({ value: 0 }),
      commands: {},
      queries: {},
    } satisfies Actor.Definition<Counter>);

    const placed = placePrograms(counter, { server: "workers" });

    expect(Object.keys(placed.programs)).toEqual(["workers"]);
  });

  it("lowers the Feature factory to ordinary portable Programs and Dependencies", () => {
    const ir = actorFixtureSystem();
    const server = ir.programs.find(({ name }) => name === "server");

    expect(
      server?.contributions.map(({ implementation }) =>
        implementation.kind === "source"
          ? { kind: implementation.kind, diagnostic: implementation.diagnostic }
          : { kind: implementation.kind },
      ),
    ).toEqual([
      { kind: "portable" },
      { kind: "portable" },
      { kind: "portable" },
      { kind: "portable" },
      { kind: "portable" },
      { kind: "portable" },
      { kind: "portable" },
      { kind: "portable" },
    ]);
    expect(
      server?.contributions.flatMap(({ provides }) => provides.map(({ name }) => name)).sort(),
    ).toEqual([
      "account",
      "agent",
      "cycleA",
      "cycleB",
      "document",
      "inventory",
      "ledger",
      "reminder",
    ]);
    expect(JSON.stringify(ir)).not.toContain('"kind":"actor"');
  });

  it("executes generated Actor APIs through the ordinary linked Dependency graph", async () => {
    const server = actorFixtureServer();

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const inventory = execution.dependencies.inventory as Readonly<{
      reserve(request: Readonly<{ key: string; input: { quantity: number } }>): Promise<{
        status: "succeeded";
        value: { remaining: number };
      }>;
      availability(request: Readonly<{ key: string }>): Promise<{ available: number }>;
    }>;
    const account = execution.dependencies.account as Readonly<{
      deposit(request: Readonly<{ key: string; input: { amount: number } }>): Promise<{
        status: "succeeded";
        value: { balance: number };
      }>;
      purchase(
        request: Readonly<{
          key: string;
          input: { item: string; quantity: number; amount: number };
        }>,
      ): Promise<{
        status: "succeeded";
        value: { balance: number; reservation: string };
      }>;
    }>;

    await expect(inventory.availability({ key: "item-1" })).resolves.toEqual({
      available: 10,
    });
    await expect(inventory.reserve({ key: "item-1", input: { quantity: 20 } })).resolves.toEqual({
      status: "failed",
      failure: { type: "unavailable", data: { available: 10 } },
    });
    await expect(inventory.availability({ key: "item-1" })).resolves.toEqual({
      available: 10,
    });
    await expect(inventory.reserve({ key: "item-1", input: { quantity: 3 } })).resolves.toEqual({
      status: "succeeded",
      value: { remaining: 7 },
    });
    await expect(inventory.availability({ key: "item-1" })).resolves.toEqual({
      available: 7,
    });
    await expect(account.deposit({ key: "account-1", input: { amount: 10 } })).resolves.toEqual({
      status: "succeeded",
      value: { balance: 10 },
    });
    await expect(
      account.purchase({
        key: "account-1",
        input: { item: "item-1", quantity: 2, amount: 4 },
      }),
    ).resolves.toEqual({
      status: "succeeded",
      value: {
        balance: 6,
        reservation: expect.any(String),
      },
    });
    await expect(inventory.availability({ key: "item-1" })).resolves.toEqual({
      available: 5,
    });
  });

  it("rejects synchronous Actor call cycles and permits durable acceptance to break them", async () => {
    const events = createMemoryEventStore<object>();
    await using execution = await executeLinkedProgramIR(linkProgram(actorFixtureServer()), {
      ...createActorHost(events),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const cycleA = execution.dependencies.cycleA as Readonly<{
      ping(
        request: Readonly<{ key: string }>,
      ): Promise<Readonly<{ status: "succeeded"; value: { actor: "a" } }>>;
      pingAccepted(
        request: Readonly<{ key: string }>,
      ): Promise<Readonly<{ status: "succeeded"; value: { actor: "a" } }>>;
      status(request: Readonly<{ key: string }>): Promise<Readonly<{ finished: number }>>;
    }>;

    await expect(cycleA.ping({ key: "synchronous-cycle" })).rejects.toMatchObject({
      failure: {
        type: "cycle",
        path: [
          { actor: "cycleA", key: "synchronous-cycle" },
          { actor: "cycleB", key: "synchronous-cycle" },
          { actor: "cycleA", key: "synchronous-cycle" },
        ],
      },
    });

    await expect(cycleA.pingAccepted({ key: "accepted-cycle" })).resolves.toEqual({
      status: "succeeded",
      value: { actor: "a" },
    });
    await expect(cycleA.status({ key: "accepted-cycle" })).resolves.toEqual({
      finished: 1,
    });
    for (const actor of ["cycleA", "cycleB"]) {
      const history = await events.read({ stream: actorStream(actor, "synchronous-cycle") });
      expect(
        history.filter(({ event }) => (event as { type?: string }).type === "actor.command.failed"),
      ).toHaveLength(1);
    }
  });

  it("coordinates a conversational agent through model, tool, approval, and cancellation APIs", async () => {
    await using execution = await executeLinkedProgramIR(linkProgram(actorFixtureServer()), {
      ...createActorHost(),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const agent = execution.dependencies.agent as AgentApi;
    const key = "agent-1";

    await expect(agent.ask({ key, input: { prompt: "use tool" } })).resolves.toEqual({
      status: "succeeded",
      value: { status: "approval" },
    });
    await expect(agent.status({ key })).resolves.toMatchObject({
      status: "approval",
      tool: { name: "echo", input: "use tool" },
    });
    await expect(agent.cancel({ key })).resolves.toEqual({
      status: "succeeded",
      value: { status: "ready" },
    });
    await expect(agent.ask({ key, input: { prompt: "use tool again" } })).resolves.toEqual({
      status: "succeeded",
      value: { status: "approval" },
    });
    await expect(agent.approve({ key })).resolves.toEqual({
      status: "succeeded",
      value: { status: "ready" },
    });
    await expect(agent.status({ key })).resolves.toMatchObject({
      status: "ready",
      conversation: expect.arrayContaining(["tool:echo:use tool again"]),
    });
  });

  it("serializes concurrent collaborative edits and returns one typed conflict", async () => {
    await using execution = await executeLinkedProgramIR(linkProgram(actorFixtureServer()), {
      ...createActorHost(),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const document = execution.dependencies.document as DocumentApi;
    const key = "document-1";
    await document.create({
      key,
      input: { owner: "user-1", content: "initial" },
    });

    const outcomes = await Promise.all([
      document.edit({
        key,
        input: { content: "left", expectedRevision: 1 },
        idempotencyKey: "left",
      }),
      document.edit({
        key,
        input: { content: "right", expectedRevision: 1 },
        idempotencyKey: "right",
      }),
    ]);

    expect(outcomes.filter(({ status }) => status === "succeeded")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "failed")).toEqual([
      {
        status: "failed",
        failure: { type: "conflict", data: { actualRevision: 2 } },
      },
    ]);
    await expect(document.snapshot({ key })).resolves.toMatchObject({
      owner: "user-1",
      revision: 2,
    });
  });

  it("recovers committed state and deduplicates explicit invocations across restarts", async () => {
    const server = actorFixtureServer();
    const linked = linkProgram(server);
    const events = createMemoryEventStore<object>();
    const payments = {
      async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
        return { receipt: `${input.account}:${input.amount}` };
      },
    };

    await using first = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      payments,
    });
    const firstAccount = first.dependencies.account as AccountApi;
    await expect(
      firstAccount.deposit({
        key: "persistent-account",
        input: { amount: 7 },
        idempotencyKey: "deposit-1",
      }),
    ).resolves.toEqual({ status: "succeeded", value: { balance: 7 } });
    await first[Symbol.asyncDispose]();

    await using second = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      payments,
    });
    const secondAccount = second.dependencies.account as AccountApi;
    await expect(secondAccount.balance({ key: "persistent-account" })).resolves.toEqual({
      balance: 7,
    });
    await expect(
      secondAccount.deposit({
        key: "persistent-account",
        input: { amount: 7 },
        idempotencyKey: "deposit-1",
      }),
    ).resolves.toEqual({ status: "succeeded", value: { balance: 7 } });
    await expect(secondAccount.balance({ key: "persistent-account" })).resolves.toEqual({
      balance: 7,
    });
  });

  it("serializes concurrent commands for one Actor key", async () => {
    const server = actorFixtureServer();

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        account.deposit({
          key: "concurrent-account",
          input: { amount: 1 },
          idempotencyKey: `deposit-${index}`,
        }),
      ),
    );

    await expect(account.balance({ key: "concurrent-account" })).resolves.toEqual({
      balance: 20,
    });
  });

  it("keeps suspended command mutations invisible until commit", async () => {
    const server = actorFixtureServer();
    let releasePayment: (() => void) | undefined;
    let paymentStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      paymentStarted = resolveStarted;
    });
    const released = new Promise<void>((resolvePayment) => {
      releasePayment = resolvePayment;
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          paymentStarted?.();
          await released;
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi & PurchaseApi;
    await account.deposit({ key: "suspended-account", input: { amount: 10 } });
    const purchase = account.purchase({
      key: "suspended-account",
      input: { item: "item-1", quantity: 1, amount: 4 },
    });
    await started;

    await expect(account.balance({ key: "suspended-account" })).resolves.toEqual({
      balance: 10,
    });
    await expect(
      account.deposit({ key: "independent-account", input: { amount: 3 } }),
    ).resolves.toEqual({
      status: "succeeded",
      value: { balance: 3 },
    });
    releasePayment?.();
    await expect(purchase).resolves.toEqual({
      status: "succeeded",
      value: { balance: 6, reservation: expect.any(String) },
    });
    await expect(account.balance({ key: "suspended-account" })).resolves.toEqual({
      balance: 6,
    });
  });

  it("resumes an admitted command that has no completion after restart", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    const key = "crashed-account";
    const invocation = "idempotency:deposit-after-crash";
    await events.append({
      stream: actorStream("account", key),
      expectedRevision: 0,
      events: [
        {
          type: "actor.command.accepted",
          invocation,
          operation: "deposit",
          input: { amount: 9 },
          at: 1,
        },
      ],
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;

    await expect(
      account.deposit({
        key,
        input: { amount: 9 },
        idempotencyKey: "deposit-after-crash",
      }),
    ).resolves.toEqual({ status: "succeeded", value: { balance: 9 } });
    await expect(account.balance({ key })).resolves.toEqual({ balance: 9 });
  });

  it("preserves one committed order across concurrent replicas sharing storage", async () => {
    const server = actorFixtureServer();
    const linked = linkProgram(server);
    const events = createMemoryEventStore<object>();
    const payments = {
      async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
        return { receipt: `${input.account}:${input.amount}` };
      },
    };
    await using first = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      payments,
    });
    await using second = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      payments,
    });
    const replicas = [
      first.dependencies.account as AccountApi,
      second.dependencies.account as AccountApi,
    ] as const;

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        replicas[index % replicas.length]!.deposit({
          key: "replicated-account",
          input: { amount: 1 },
          idempotencyKey: `replica-deposit-${index}`,
        }),
      ),
    );

    await expect(replicas[0].balance({ key: "replicated-account" })).resolves.toEqual({
      balance: 20,
    });
    await expect(replicas[1].balance({ key: "replicated-account" })).resolves.toEqual({
      balance: 20,
    });
  });

  it("rejects reuse of one invocation identity for different command meaning", async () => {
    const server = actorFixtureServer();

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;
    await account.deposit({
      key: "conflicted-account",
      input: { amount: 1 },
      idempotencyKey: "same",
    });

    await expect(
      account.deposit({
        key: "conflicted-account",
        input: { amount: 2 },
        idempotencyKey: "same",
      }),
    ).rejects.toMatchObject({ name: "ActorError" });
  });

  it("retains the latest 1,024 command results and reports older results as expired", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    const key = "retained-account";
    const history = Array.from({ length: 1_025 }, (_, index) => {
      const invocation = `idempotency:retained-${index}`;
      const balance = index + 1;
      return [
        {
          type: "actor.command.accepted",
          invocation,
          operation: "deposit",
          input: { amount: 1 },
          commandVersion: 0,
          at: balance * 2 - 1,
        },
        {
          type: "actor.command.completed",
          invocation,
          state: { balance },
          stateVersion: 0,
          outcome: { status: "succeeded", value: { balance } },
          at: balance * 2,
        },
      ];
    }).flat();
    await events.append({
      stream: actorStream("account", key),
      expectedRevision: 0,
      events: history,
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;

    await expect(
      account.deposit({
        key,
        input: { amount: 1 },
        idempotencyKey: "retained-0",
      }),
    ).rejects.toMatchObject({
      name: "ActorError",
      failure: {
        type: "result-expired",
        invocation: "idempotency:retained-0",
      },
    });
    await expect(
      account.deposit({
        key,
        input: { amount: 1 },
        idempotencyKey: "retained-1024",
      }),
    ).resolves.toEqual({
      status: "succeeded",
      value: { balance: 1_025 },
    });
    await expect(account.balance({ key })).resolves.toEqual({ balance: 1_025 });
  });

  it("lets commands carry stable invocation identity into idempotent effects", async () => {
    const server = actorFixtureServer();
    const charges: string[] = [];

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(),
      payments: {
        async charge({
          input,
        }: {
          input: Readonly<{ account: string; amount: number; idempotencyKey: string }>;
        }) {
          charges.push(input.idempotencyKey);
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi & PurchaseApi;
    const inventory = execution.dependencies.inventory as Readonly<{
      availability(request: Readonly<{ key: string }>): Promise<{ available: number }>;
    }>;
    await account.deposit({ key: "effect-account", input: { amount: 10 } });
    const request = {
      key: "effect-account",
      input: { item: "effect-item", quantity: 2, amount: 4 },
      idempotencyKey: "purchase-1",
    } as const;

    const first = await account.purchase(request);
    const duplicate = await account.purchase(request);

    expect(duplicate).toEqual(first);
    expect(charges).toEqual(["idempotency:purchase-1:payment"]);
    await expect(account.balance({ key: "effect-account" })).resolves.toEqual({ balance: 6 });
    await expect(inventory.availability({ key: "effect-item" })).resolves.toEqual({
      available: 8,
    });
  });

  it("recovers a command after an effect succeeds but its state commit crashes", async () => {
    const server = actorFixtureServer();
    const linked = linkProgram(server);
    const memory = createMemoryEventStore<object>();
    let failCompletion = true;
    const events = {
      read: memory.read,
      subscribe: memory.subscribe,
      async append(input: Parameters<typeof memory.append>[0]) {
        if (
          failCompletion &&
          input.events.some(
            (event) =>
              (event as { type?: string; invocation?: string }).type ===
                "actor.command.completed" &&
              (event as { invocation?: string }).invocation === "idempotency:crash-after-effect",
          )
        ) {
          failCompletion = false;
          throw new Error("simulated completion failure");
        }
        return memory.append(input);
      },
    };
    const receipts = new Map<string, string>();
    const charges: string[] = [];
    const payments = {
      async charge({
        input,
      }: {
        input: Readonly<{ account: string; amount: number; idempotencyKey: string }>;
      }) {
        const existing = receipts.get(input.idempotencyKey);
        if (existing !== undefined) return { receipt: existing };
        const receipt = `${input.account}:${input.amount}`;
        receipts.set(input.idempotencyKey, receipt);
        charges.push(input.idempotencyKey);
        return { receipt };
      },
    };
    let now = 1;
    const host = () => ({
      ...createActorHost(events),
      clock: { now: () => now },
      payments,
    });
    const request = {
      key: "recovered-effect-account",
      input: { item: "recovered-item", quantity: 1, amount: 4 },
      idempotencyKey: "crash-after-effect",
    } as const;

    await using first = await executeLinkedProgramIR(linked, host());
    const firstAccount = first.dependencies.account as AccountApi & PurchaseApi;
    await firstAccount.deposit({ key: request.key, input: { amount: 10 } });
    await expect(firstAccount.purchase(request)).rejects.toThrow("simulated completion failure");
    await first[Symbol.asyncDispose]();

    now = 40_000;
    await using second = await executeLinkedProgramIR(linked, host());
    const secondAccount = second.dependencies.account as AccountApi & PurchaseApi;
    await expect(secondAccount.purchase(request)).resolves.toMatchObject({
      status: "succeeded",
      value: { balance: 6 },
    });
    expect(charges).toEqual(["idempotency:crash-after-effect:payment"]);
    await expect(secondAccount.balance({ key: request.key })).resolves.toEqual({ balance: 6 });
  });

  it("recovers idempotently from failures at every durable command boundary", async () => {
    const server = actorFixtureServer();
    const linked = linkProgram(server);
    const boundaries = [
      "read",
      "actor.registered",
      "actor.command.accepted",
      "actor.command.claimed",
      "actor.command.completed",
    ] as const;

    for (const boundary of boundaries) {
      const memory = createMemoryEventStore<object>();
      let failed = false;
      const events = {
        subscribe: memory.subscribe,
        async read(input: Parameters<typeof memory.read>[0]) {
          if (!failed && boundary === "read" && input.stream.startsWith("actor:")) {
            failed = true;
            throw new Error(`simulated ${boundary} failure`);
          }
          return memory.read(input);
        },
        async append(input: Parameters<typeof memory.append>[0]) {
          if (
            !failed &&
            boundary !== "read" &&
            input.events.some((event) => (event as { type?: string }).type === boundary)
          ) {
            failed = true;
            throw new Error(`simulated ${boundary} failure`);
          }
          return memory.append(input);
        },
      };
      await using execution = await executeLinkedProgramIR(linked, {
        ...createActorHost(events),
        payments: {
          async charge() {
            return { receipt: "unused" };
          },
        },
      });
      const account = execution.dependencies.account as AccountApi;
      const request = {
        key: `fault-${boundary}`,
        input: { amount: 1 },
        idempotencyKey: `fault-${boundary}`,
      } as const;

      await expect(account.deposit(request)).rejects.toThrow(`simulated ${boundary} failure`);
      await expect(account.deposit(request)).resolves.toEqual({
        status: "succeeded",
        value: { balance: 1 },
      });
      await expect(account.balance({ key: request.key })).resolves.toEqual({ balance: 1 });
      const history = await memory.read({ stream: actorStream("account", request.key) });
      expect(
        history.filter(
          ({ event }) => (event as { type?: string }).type === "actor.command.completed",
        ),
      ).toHaveLength(1);
    }
  });

  it("retries compare-and-append conflicts at every durable command write", async () => {
    const server = actorFixtureServer();
    const linked = linkProgram(server);
    const boundaries = [
      "actor.registered",
      "actor.command.accepted",
      "actor.command.claimed",
      "actor.command.completed",
    ] as const;

    for (const boundary of boundaries) {
      const memory = createMemoryEventStore<object>();
      let conflicted = false;
      const events = {
        read: memory.read,
        subscribe: memory.subscribe,
        async append(input: Parameters<typeof memory.append>[0]) {
          if (
            !conflicted &&
            input.events.some((event) => (event as { type?: string }).type === boundary)
          ) {
            conflicted = true;
            return undefined;
          }
          return memory.append(input);
        },
      };
      await using execution = await executeLinkedProgramIR(linked, {
        ...createActorHost(events),
        payments: {
          async charge() {
            return { receipt: "unused" };
          },
        },
      });
      const account = execution.dependencies.account as AccountApi;
      const key = `conflict-${boundary}`;

      await expect(
        account.deposit({
          key,
          input: { amount: 1 },
          idempotencyKey: `conflict-${boundary}`,
        }),
      ).resolves.toEqual({
        status: "succeeded",
        value: { balance: 1 },
      });
      expect(conflicted).toBe(true);
      await expect(account.balance({ key })).resolves.toEqual({ balance: 1 });
      const history = await memory.read({ stream: actorStream("account", key) });
      expect(
        history.filter(
          ({ event }) => (event as { type?: string }).type === "actor.command.completed",
        ),
      ).toHaveLength(1);
    }
  });

  it("fences concurrent replicas before an external effect", async () => {
    const server = actorFixtureServer();
    const linked = linkProgram(server);
    const events = createMemoryEventStore<object>();
    let releasePayment: (() => void) | undefined;
    let paymentStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      paymentStarted = resolveStarted;
    });
    const released = new Promise<void>((resolvePayment) => {
      releasePayment = resolvePayment;
    });
    const charges: string[] = [];
    const payments = {
      async charge({
        input,
      }: {
        input: Readonly<{ account: string; amount: number; idempotencyKey: string }>;
      }) {
        charges.push(input.idempotencyKey);
        paymentStarted?.();
        await released;
        return { receipt: `${input.account}:${input.amount}` };
      },
    };
    const fixedClock = { now: () => 1 };
    await using first = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      clock: fixedClock,
      payments,
    });
    await using second = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      clock: fixedClock,
      payments,
    });
    const firstAccount = first.dependencies.account as AccountApi & PurchaseApi;
    const secondAccount = second.dependencies.account as AccountApi & PurchaseApi;
    await firstAccount.deposit({ key: "fenced-account", input: { amount: 10 } });
    const request = {
      key: "fenced-account",
      input: { item: "fenced-item", quantity: 1, amount: 4 },
      idempotencyKey: "fenced-purchase",
    } as const;

    const firstPurchase = firstAccount.purchase(request);
    const secondPurchase = secondAccount.purchase(request);
    await started;
    await Promise.resolve();
    expect(charges).toEqual(["idempotency:fenced-purchase:payment"]);
    releasePayment?.();

    await expect(Promise.all([firstPurchase, secondPurchase])).resolves.toEqual([
      {
        status: "succeeded",
        value: { balance: 6, reservation: expect.any(String) },
      },
      {
        status: "succeeded",
        value: { balance: 6, reservation: expect.any(String) },
      },
    ]);
    expect(charges).toEqual(["idempotency:fenced-purchase:payment"]);
  });

  it("prevents a clock-skewed stale replica from committing after takeover", async () => {
    const linked = linkProgram(actorFixtureServer());
    const events = createMemoryEventStore<object>();
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      firstStarted = resolveStarted;
    });
    const blocked = new Promise<void>((resolveFirst) => {
      releaseFirst = resolveFirst;
    });
    const receipts = new Map<string, string>();
    let attempts = 0;
    const payments = {
      async charge({
        input,
      }: {
        input: Readonly<{ account: string; amount: number; idempotencyKey: string }>;
      }) {
        attempts += 1;
        if (attempts === 1) {
          firstStarted?.();
          await blocked;
        }
        const existing = receipts.get(input.idempotencyKey);
        if (existing !== undefined) return { receipt: existing };
        const receipt = `${input.account}:${input.amount}`;
        receipts.set(input.idempotencyKey, receipt);
        return { receipt };
      },
    };
    await using first = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      clock: { now: () => 1 },
      payments,
    });
    await using second = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      clock: { now: () => 40_000 },
      payments,
    });
    const firstAccount = first.dependencies.account as AccountApi & PurchaseApi;
    const secondAccount = second.dependencies.account as AccountApi & PurchaseApi;
    const key = "stale-owner-account";
    const request = {
      key,
      input: { item: "stale-owner-item", quantity: 1, amount: 4 },
      idempotencyKey: "stale-owner-purchase",
    } as const;
    await firstAccount.deposit({ key, input: { amount: 10 } });

    const stale = firstAccount.purchase(request);
    await started;
    const takeover = secondAccount.purchase(request);
    await expect(takeover).resolves.toMatchObject({
      status: "succeeded",
      value: { balance: 6 },
    });
    releaseFirst?.();
    await expect(stale).resolves.toEqual(await takeover);

    expect(attempts).toBe(2);
    expect(receipts.size).toBe(1);
    await expect(firstAccount.balance({ key })).resolves.toEqual({ balance: 6 });
    const history = await events.read({ stream: actorStream("account", key) });
    expect(
      history.filter(
        ({ event }) => (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toHaveLength(2);
    expect(
      history.filter(
        ({ event }) =>
          (event as { invocation?: string }).invocation === "idempotency:stale-owner-purchase" &&
          (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toHaveLength(1);
  });

  it("recovers accepted work across a storage partition without duplicate execution", async () => {
    const linked = linkProgram(actorFixtureServer());
    const memory = createMemoryEventStore<object>();
    let partitioned = false;
    const partitionableEvents = {
      subscribe: memory.subscribe,
      async read(input: Parameters<typeof memory.read>[0]) {
        if (partitioned) throw new Error("storage partition");
        return memory.read(input);
      },
      async append(input: Parameters<typeof memory.append>[0]) {
        if (partitioned) throw new Error("storage partition");
        return memory.append(input);
      },
    };
    const firstAlarm = createManualAlarm();
    await using first = await executeLinkedProgramIR(linked, {
      ...createActorHost(partitionableEvents),
      alarm: firstAlarm.dependency,
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const firstAccount = first.dependencies.account as AccountApi;
    const request = {
      key: "partitioned-account",
      input: { amount: 7 },
      idempotencyKey: "partitioned-deposit",
      wait: "accepted",
    } as const;

    await expect(firstAccount.deposit(request)).resolves.toEqual({
      id: "idempotency:partitioned-deposit",
    });
    partitioned = true;
    await expect(firstAccount.balance({ key: request.key })).rejects.toThrow("storage partition");

    await using second = await executeLinkedProgramIR(linked, {
      ...createActorHost(memory),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const secondAccount = second.dependencies.account as AccountApi;
    await expect(secondAccount.deposit(request)).resolves.toEqual({
      id: "idempotency:partitioned-deposit",
    });
    await expect(secondAccount.balance({ key: request.key })).resolves.toEqual({
      balance: 7,
    });

    partitioned = false;
    await expect(firstAccount.balance({ key: request.key })).resolves.toEqual({
      balance: 7,
    });
    const history = await memory.read({ stream: actorStream("account", request.key) });
    expect(
      history.filter(
        ({ event }) =>
          (event as { invocation?: string }).invocation === "idempotency:partitioned-deposit" &&
          (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toHaveLength(1);
  });

  it("makes duplicate and reordered delivery deterministic at the Actor API boundary", async () => {
    const events = createMemoryEventStore<object>();
    await using execution = await executeLinkedProgramIR(linkProgram(actorFixtureServer()), {
      ...createActorHost(events),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const document = execution.dependencies.document as DocumentApi;
    const key = "reordered-document";
    await document.create({ key, input: { owner: "owner", content: "initial" } });
    const deliveredEarly = {
      key,
      input: { content: "second", expectedRevision: 2 },
      idempotencyKey: "second-edit",
    } as const;
    const conflict = {
      status: "failed",
      failure: { type: "conflict", data: { actualRevision: 1 } },
    } as const;

    await expect(document.edit(deliveredEarly)).resolves.toEqual(conflict);
    await expect(document.edit(deliveredEarly)).resolves.toEqual(conflict);
    await expect(
      document.edit({
        key,
        input: { content: "first", expectedRevision: 1 },
        idempotencyKey: "first-edit",
      }),
    ).resolves.toEqual({ status: "succeeded", value: { revision: 2 } });
    await expect(document.edit(deliveredEarly)).resolves.toEqual(conflict);
    await expect(
      document.edit({
        key,
        input: { content: "second", expectedRevision: 2 },
        idempotencyKey: "second-edit-after-conflict",
      }),
    ).resolves.toEqual({ status: "succeeded", value: { revision: 3 } });
    await expect(document.snapshot({ key })).resolves.toEqual({
      owner: "owner",
      content: "second",
      revision: 3,
    });

    const history = await events.read({ stream: actorStream("document", key) });
    expect(
      history.filter(
        ({ event }) =>
          (event as { invocation?: string }).invocation === "idempotency:second-edit" &&
          (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toHaveLength(1);
  });

  it("takes over admitted work after the previous owner's claim expires", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    const key = "failed-over-account";
    const stream = actorStream("account", key);
    await events.append({
      stream,
      expectedRevision: 0,
      events: [
        {
          type: "actor.command.accepted",
          invocation: "idempotency:failed-over-deposit",
          operation: "deposit",
          input: { amount: 11 },
          commandVersion: 0,
          at: 1,
        },
        {
          type: "actor.command.claimed",
          invocation: "idempotency:failed-over-deposit",
          owner: "lost-worker",
          attempt: 1,
          until: 5,
          at: 1,
        },
      ],
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      clock: { now: () => 10 },
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;
    await expect(
      account.deposit({
        key,
        input: { amount: 11 },
        idempotencyKey: "failed-over-deposit",
      }),
    ).resolves.toEqual({
      status: "succeeded",
      value: { balance: 11 },
    });
    const history = await events.read({ stream });
    expect(
      history.filter(({ event }) => (event as { type?: string }).type === "actor.command.claimed"),
    ).toHaveLength(2);
    expect(
      history.filter(
        ({ event }) => (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toHaveLength(1);
  });

  it("relocates keys across a changing replica set without losing state or accepted work", async () => {
    const linked = linkProgram(actorFixtureServer());
    const events = createMemoryEventStore<object>();
    const payments = {
      async charge() {
        return { receipt: "unused" };
      },
    };
    const host = () => ({ ...createActorHost(events), payments });
    const keys = Array.from({ length: 12 }, (_, index) => `relocated-${index}`);

    await using original = await executeLinkedProgramIR(linked, host());
    const originalAccount = original.dependencies.account as AccountApi;
    for (const key of keys) {
      await originalAccount.deposit({
        key,
        input: { amount: 1 },
        idempotencyKey: `initial-${key}`,
      });
    }
    await originalAccount.deposit({
      key: keys[0]!,
      input: { amount: 3 },
      idempotencyKey: "accepted-before-relocation",
      wait: "accepted",
    });
    await original[Symbol.asyncDispose]();

    const replicas = await Promise.all(
      Array.from({ length: 3 }, () => executeLinkedProgramIR(linked, host())),
    );
    try {
      const APIs = replicas.map(({ dependencies }) => dependencies.account as AccountApi);
      await expect(APIs[2]!.balance({ key: keys[0]! })).resolves.toEqual({ balance: 4 });
      for (const [index, key] of keys.entries()) {
        await APIs[(index + 1) % APIs.length]!.deposit({
          key,
          input: { amount: 1 },
          idempotencyKey: `after-relocation-${key}`,
        });
      }
    } finally {
      await Promise.all(replicas.map((replica) => replica[Symbol.asyncDispose]()));
    }

    await using final = await executeLinkedProgramIR(linked, host());
    const finalAccount = final.dependencies.account as AccountApi;
    for (const [index, key] of keys.entries()) {
      await expect(finalAccount.balance({ key })).resolves.toEqual({
        balance: index === 0 ? 5 : 2,
      });
    }
  });

  it("bounds admission while another replica owns the unavailable hot key", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    const key = "overloaded-account";
    const stream = actorStream("account", key);
    await events.append({
      stream,
      expectedRevision: 0,
      events: [
        {
          type: "actor.command.accepted",
          invocation: "existing-0",
          operation: "deposit",
          input: { amount: 1 },
          commandVersion: 0,
          at: 1,
        },
        {
          type: "actor.command.claimed",
          invocation: "existing-0",
          owner: "unavailable-owner",
          attempt: 1,
          until: 1_000,
          at: 1,
        },
        ...Array.from({ length: 1_023 }, (_, index) => ({
          type: "actor.command.accepted",
          invocation: `existing-${index + 1}`,
          operation: "deposit",
          input: { amount: 1 },
          commandVersion: 0,
          at: 1,
        })),
      ],
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;

    await expect(
      account.deposit({
        key,
        input: { amount: 1 },
        idempotencyKey: "overflow",
      }),
    ).rejects.toMatchObject({
      name: "ActorError",
      failure: { type: "overloaded" },
    });
    const history = await events.read({ stream });
    expect(
      history.filter(({ event }) => (event as { type?: string }).type === "actor.command.accepted"),
    ).toHaveLength(1_024);
    expect(history).toHaveLength(1_025);
  });

  it("marks repeatedly abandoned work as poisoned without blocking later commands", async () => {
    const server = actorFixtureServer();
    const memory = createMemoryEventStore<object>();
    let poisonAttempt = 0;
    const events = {
      read: memory.read,
      subscribe: memory.subscribe,
      async append(input: Parameters<typeof memory.append>[0]) {
        if (
          input.events.some(
            (event) => (event as { type?: string }).type === "actor.command.poisoned",
          )
        ) {
          poisonAttempt += 1;
          if (poisonAttempt === 1) throw new Error("simulated poison append failure");
          if (poisonAttempt === 2) return undefined;
        }
        return memory.append(input);
      },
    };
    const key = "poisoned-account";
    const stream = actorStream("account", key);
    await events.append({
      stream,
      expectedRevision: 0,
      events: [
        {
          type: "actor.command.accepted",
          invocation: "idempotency:poison",
          operation: "deposit",
          input: { amount: 1 },
          commandVersion: 0,
          at: 1,
        },
        ...Array.from({ length: 3 }, (_, index) => ({
          type: "actor.command.claimed",
          invocation: "idempotency:poison",
          owner: `lost-${index}`,
          attempt: index + 1,
          until: index + 2,
          at: index + 1,
        })),
      ],
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      clock: { now: () => 10 },
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;

    const poisoned = {
      key,
      input: { amount: 1 },
      idempotencyKey: "poison",
    } as const;
    await expect(account.deposit(poisoned)).rejects.toThrow("simulated poison append failure");
    await expect(account.deposit(poisoned)).rejects.toMatchObject({
      name: "ActorError",
      failure: {
        type: "poisoned",
        invocation: "idempotency:poison",
        attempts: 3,
      },
    });
    expect(poisonAttempt).toBe(3);
    expect(
      (await memory.read({ stream })).filter(
        ({ event }) => (event as { type?: string }).type === "actor.command.poisoned",
      ),
    ).toHaveLength(1);
    await expect(
      account.deposit({
        key,
        input: { amount: 2 },
        idempotencyKey: "after-poison",
      }),
    ).resolves.toEqual({
      status: "succeeded",
      value: { balance: 2 },
    });
  });

  it("returns after durable acceptance and executes the command on the next Actor turn", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    const alarm = createManualAlarm();
    const now = 100;

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      alarm: alarm.dependency,
      clock: { now: () => now },
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;
    const key = "accepted-account";

    await expect(
      account.deposit({
        key,
        input: { amount: 4 },
        idempotencyKey: "accepted-deposit",
        wait: "accepted",
      }),
    ).resolves.toEqual({ id: "idempotency:accepted-deposit" });
    const acceptedHistory = await events.read({ stream: actorStream("account", key) });
    expect(
      acceptedHistory.some(
        ({ event }) => (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toBe(false);

    await alarm.runDue(now);
    const completedHistory = await events.read({ stream: actorStream("account", key) });
    expect(
      completedHistory.some(
        ({ event }) => (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toBe(true);
    await expect(account.balance({ key })).resolves.toEqual({ balance: 4 });
  });

  it("persists one-shot timers and fires them once after restart", async () => {
    const server = actorFixtureServer();
    const linked = linkProgram(server);
    const events = createMemoryEventStore<object>();
    let now = 100;
    const firstAlarm = createManualAlarm();
    const firstHost = () => ({
      ...createActorHost(events),
      alarm: firstAlarm.dependency,
      clock: { now: () => now },
    });

    await using first = await executeLinkedProgramIR(linked, {
      ...firstHost(),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const firstReminder = first.dependencies.reminder as ReminderApi;
    await expect(
      firstReminder.schedule({
        key: "restart-reminder",
        input: { at: 1_000, generation: 1 },
      }),
    ).resolves.toEqual({ status: "succeeded", value: { due: 1_000 } });
    await expect(firstReminder.status({ key: "restart-reminder" })).resolves.toEqual({
      due: 1_000,
      fired: 0,
    });
    await first[Symbol.asyncDispose]();

    now = 1_000;
    const secondAlarm = createManualAlarm();
    await using second = await executeLinkedProgramIR(linked, {
      ...createActorHost(events),
      alarm: secondAlarm.dependency,
      clock: { now: () => now },
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const secondReminder = second.dependencies.reminder as ReminderApi;
    await secondAlarm.runDue(now);
    const autonomousHistory = await events.read({
      stream: actorStream("reminder", "restart-reminder"),
    });
    expect(
      autonomousHistory.filter(
        ({ event }) => (event as { type?: string }).type === "actor.timer.fired",
      ),
    ).toHaveLength(1);
    await expect(secondReminder.status({ key: "restart-reminder" })).resolves.toEqual({
      due: null,
      fired: 1,
    });
    await expect(secondReminder.status({ key: "restart-reminder" })).resolves.toEqual({
      due: null,
      fired: 1,
    });

    const history = await events.read({
      stream: actorStream("reminder", "restart-reminder"),
    });
    expect(
      history.filter(({ event }) => (event as { type?: string }).type === "actor.timer.fired"),
    ).toHaveLength(1);
    expect(
      history.filter(
        ({ event }) =>
          (event as { invocation?: string }).invocation === "timer:wake:1" &&
          (event as { type?: string }).type === "actor.command.completed",
      ),
    ).toHaveLength(1);
  });

  it("uses timer generations to fence rescheduling and cancellation", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    let now = 100;
    const alarm = createManualAlarm();

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      alarm: alarm.dependency,
      clock: { now: () => now },
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const reminder = execution.dependencies.reminder as ReminderApi;
    const key = "generation-reminder";
    await reminder.schedule({ key, input: { at: 500, generation: 1 } });
    await reminder.schedule({ key, input: { at: 900, generation: 2 } });

    now = 500;
    await expect(reminder.status({ key })).resolves.toEqual({ due: 900, fired: 0 });
    await reminder.cancel({ key });
    now = 1_000;
    await alarm.runDue(now);
    await expect(reminder.status({ key })).resolves.toEqual({ due: null, fired: 0 });

    await reminder.schedule({ key, input: { at: 1_100, generation: 3 } });
    now = 1_100;
    await alarm.runDue(now);
    await expect(reminder.status({ key })).resolves.toEqual({ due: null, fired: 1 });

    const history = await events.read({ stream: actorStream("reminder", key) });
    expect(
      history
        .filter(
          ({ event }) =>
            (event as { type?: string }).type === "actor.timer.scheduled" ||
            (event as { type?: string }).type === "actor.timer.cancelled",
        )
        .map(({ event }) => (event as { generation: number }).generation),
    ).toEqual([1, 2, 3, 4]);
  });

  it("recovers atomically from failures at every durable timer boundary", async () => {
    const memory = createMemoryEventStore<object>();
    let target: string | undefined;
    const failed = new Set<string>();
    const conflicted = new Set<string>();
    const events = {
      read: memory.read,
      subscribe: memory.subscribe,
      async append(input: Parameters<typeof memory.append>[0]) {
        if (
          target !== undefined &&
          input.events.some((event) => (event as { type?: string }).type === target)
        ) {
          if (!conflicted.has(target)) {
            conflicted.add(target);
            return undefined;
          }
          if (failed.has(target)) return memory.append(input);
          failed.add(target);
          throw new Error(`simulated ${target} failure`);
        }
        return memory.append(input);
      },
    };
    const alarm = createManualAlarm();
    let now = 100;
    await using execution = await executeLinkedProgramIR(linkProgram(actorFixtureServer()), {
      ...createActorHost(events),
      alarm: alarm.dependency,
      clock: { now: () => now },
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const reminder = execution.dependencies.reminder as ReminderApi;

    target = "actor.timer.scheduled";
    const scheduled = {
      key: "timer-intent-fault",
      input: { at: 500, generation: 1 },
      idempotencyKey: "schedule",
    } as const;
    await expect(reminder.schedule(scheduled)).rejects.toThrow(
      "simulated actor.timer.scheduled failure",
    );
    await expect(reminder.schedule(scheduled)).resolves.toEqual({
      status: "succeeded",
      value: { due: 500 },
    });

    target = "actor.timer.cancelled";
    const cancelled = {
      key: scheduled.key,
      idempotencyKey: "cancel",
    } as const;
    await expect(reminder.cancel(cancelled)).rejects.toThrow(
      "simulated actor.timer.cancelled failure",
    );
    await expect(reminder.cancel(cancelled)).resolves.toEqual({
      status: "succeeded",
      value: { cancelled: true },
    });

    target = undefined;
    await reminder.schedule({
      key: "timer-fire-fault",
      input: { at: 200, generation: 1 },
      idempotencyKey: "fire",
    });
    target = "actor.timer.fired";
    now = 200;
    await alarm.runDue(now);
    await expect(reminder.status({ key: "timer-fire-fault" })).resolves.toEqual({
      due: null,
      fired: 1,
    });

    expect([...failed].sort()).toEqual([
      "actor.timer.cancelled",
      "actor.timer.fired",
      "actor.timer.scheduled",
    ]);
    expect([...conflicted].sort()).toEqual([...failed].sort());
    for (const [key, eventType] of [
      [scheduled.key, "actor.timer.scheduled"],
      [scheduled.key, "actor.timer.cancelled"],
      ["timer-fire-fault", "actor.timer.fired"],
    ] as const) {
      const history = await memory.read({ stream: actorStream("reminder", key) });
      expect(
        history.filter(({ event }) => (event as { type?: string }).type === eventType),
      ).toHaveLength(1);
    }
  });

  it("recovers terminal cycle recording after its durable append fails", async () => {
    const memory = createMemoryEventStore<object>();
    let failureAppendAttempt = 0;
    const events = {
      read: memory.read,
      subscribe: memory.subscribe,
      async append(input: Parameters<typeof memory.append>[0]) {
        if (
          input.events.some((event) => (event as { type?: string }).type === "actor.command.failed")
        ) {
          failureAppendAttempt += 1;
          if (failureAppendAttempt === 1) {
            throw new Error("simulated actor.command.failed failure");
          }
          if (failureAppendAttempt === 2) return undefined;
        }
        return memory.append(input);
      },
    };
    await using execution = await executeLinkedProgramIR(linkProgram(actorFixtureServer()), {
      ...createActorHost(events),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const cycleA = execution.dependencies.cycleA as Readonly<{
      ping(request: Readonly<{ key: string; idempotencyKey?: string }>): Promise<object>;
    }>;
    const request = { key: "cycle-fault", idempotencyKey: "cycle-fault" } as const;

    await expect(cycleA.ping(request)).rejects.toThrow("simulated actor.command.failed failure");
    await expect(cycleA.ping(request)).rejects.toMatchObject({
      failure: { type: "cycle" },
    });
    expect(failureAppendAttempt).toBeGreaterThanOrEqual(3);
    for (const actor of ["cycleA", "cycleB"]) {
      const history = await memory.read({ stream: actorStream(actor, request.key) });
      expect(
        history.filter(({ event }) => (event as { type?: string }).type === "actor.command.failed"),
      ).toHaveLength(1);
    }
  });

  it("self-reschedules through durable typed timer commands", async () => {
    const events = createMemoryEventStore<object>();
    let now = 100;
    const alarm = createManualAlarm();

    await using execution = await executeLinkedProgramIR(linkProgram(actorFixtureServer()), {
      ...createActorHost(events),
      alarm: alarm.dependency,
      clock: { now: () => now },
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const reminder = execution.dependencies.reminder as ReminderApi;
    const key = "repeating-reminder";
    await reminder.repeat({
      key,
      input: { at: 200, interval: 100, count: 3, generation: 1 },
    });

    for (const at of [200, 300, 400]) {
      now = at;
      await alarm.runDue(now);
    }

    await expect(reminder.status({ key })).resolves.toEqual({ due: null, fired: 3 });
    const history = await events.read({ stream: actorStream("reminder", key) });
    expect(
      history.filter(({ event }) => (event as { type?: string }).type === "actor.timer.fired"),
    ).toHaveLength(3);
  });

  it("migrates durable state and accepted command input before execution", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    const key = "ledger-1";
    const stream = actorStream("ledger", key);
    await events.append({
      stream,
      expectedRevision: 0,
      events: [
        {
          type: "actor.command.accepted",
          invocation: "old-completed",
          operation: "credit",
          input: { amount: 5 },
          commandVersion: 0,
          at: 1,
        },
        {
          type: "actor.command.completed",
          invocation: "old-completed",
          state: { balance: 5 },
          stateVersion: 0,
          outcome: {
            status: "succeeded",
            value: { balance: 5 },
          },
          at: 2,
        },
        {
          type: "actor.command.accepted",
          invocation: "idempotency:old-pending",
          operation: "credit",
          input: { amount: 3 },
          commandVersion: 0,
          at: 3,
        },
      ],
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      payments: {
        async charge({ input }: { input: Readonly<{ account: string; amount: number }> }) {
          return { receipt: `${input.account}:${input.amount}` };
        },
      },
    });
    const ledger = execution.dependencies.ledger as LedgerApi;

    await expect(
      ledger.credit({
        key,
        input: { amount: 3, expectedRevision: 0 },
        idempotencyKey: "old-pending",
      }),
    ).resolves.toEqual({
      status: "succeeded",
      value: { balance: 8, revision: 1 },
    });
    await expect(ledger.snapshot({ key })).resolves.toEqual({
      balance: 8,
      revision: 1,
    });
    await expect(events.read({ stream })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            type: "actor.command.completed",
            invocation: "idempotency:old-pending",
            stateVersion: 1,
          }),
        }),
      ]),
    );
  });

  it("fails activation when persisted state is newer than the authored migrations", async () => {
    const server = actorFixtureServer();
    const events = createMemoryEventStore<object>();
    const key = "future-account";
    await events.append({
      stream: actorStream("account", key),
      expectedRevision: 0,
      events: [
        {
          type: "actor.command.completed",
          invocation: "future",
          state: { balance: 10 },
          stateVersion: 1,
          outcome: { status: "succeeded", value: { balance: 10 } },
          at: 1,
        },
      ],
    });

    await using execution = await executeLinkedProgramIR(linkProgram(server), {
      ...createActorHost(events),
      payments: {
        async charge() {
          return { receipt: "unused" };
        },
      },
    });
    const account = execution.dependencies.account as AccountApi;

    await expect(account.balance({ key })).rejects.toMatchObject({
      name: "ActorError",
      failure: { type: "incompatible", schema: "state:1" },
    });
  });
});

type AccountApi = Readonly<{
  deposit(
    request: Readonly<{
      key: string;
      input: { amount: number };
      idempotencyKey?: string;
      wait?: "completed";
    }>,
  ): Promise<{
    status: "succeeded";
    value: { balance: number };
  }>;
  deposit(
    request: Readonly<{
      key: string;
      input: { amount: number };
      idempotencyKey?: string;
      wait: "accepted";
    }>,
  ): Promise<{ id: string }>;
  balance(request: Readonly<{ key: string }>): Promise<{ balance: number }>;
}>;

type LedgerApi = Readonly<{
  credit(
    request: Readonly<{
      key: string;
      input: { amount: number; expectedRevision: number };
      idempotencyKey?: string;
    }>,
  ): Promise<{
    status: "succeeded";
    value: { balance: number; revision: number };
  }>;
  snapshot(request: Readonly<{ key: string }>): Promise<{
    balance: number;
    revision: number;
  }>;
}>;

type PurchaseApi = Readonly<{
  purchase(
    request: Readonly<{
      key: string;
      input: { item: string; quantity: number; amount: number };
      idempotencyKey?: string;
    }>,
  ): Promise<{
    status: "succeeded";
    value: { balance: number; reservation: string };
  }>;
}>;

type ReminderApi = Readonly<{
  schedule(
    request: Readonly<{
      key: string;
      input: { at: number; generation: number };
      idempotencyKey?: string;
    }>,
  ): Promise<{
    status: "succeeded";
    value: { due: number };
  }>;
  cancel(request: Readonly<{ key: string; idempotencyKey?: string }>): Promise<{
    status: "succeeded";
    value: { cancelled: boolean };
  }>;
  repeat(
    request: Readonly<{
      key: string;
      input: { at: number; interval: number; count: number; generation: number };
    }>,
  ): Promise<{
    status: "succeeded";
    value: { due: number };
  }>;
  status(request: Readonly<{ key: string }>): Promise<{ due: number | null; fired: number }>;
}>;

type AgentApi = Readonly<{
  ask(request: Readonly<{ key: string; input: { prompt: string } }>): Promise<{
    status: "succeeded";
    value: { status: "ready" | "approval" | "awaitingApproval" };
  }>;
  approve(request: Readonly<{ key: string }>): Promise<{
    status: "succeeded";
    value: { status: "ready" | "approval" };
  }>;
  cancel(request: Readonly<{ key: string }>): Promise<{
    status: "succeeded";
    value: { status: "ready" | "approval" };
  }>;
  status(request: Readonly<{ key: string }>): Promise<{
    status: "ready" | "approval";
    conversation: readonly string[];
    tool?: { name: string; input: string };
  }>;
}>;

type DocumentApi = Readonly<{
  create(
    request: Readonly<{
      key: string;
      input: { owner: string; content: string };
    }>,
  ): Promise<{
    status: "succeeded";
    value: { revision: number };
  }>;
  edit(
    request: Readonly<{
      key: string;
      input: { content: string; expectedRevision: number };
      idempotencyKey?: string;
    }>,
  ): Promise<
    | Readonly<{
        status: "succeeded";
        value: { revision: number };
      }>
    | Readonly<{
        status: "failed";
        failure:
          | Readonly<{ type: "notCreated"; data: Record<never, never> }>
          | Readonly<{ type: "conflict"; data: { actualRevision: number } }>;
      }>
  >;
  snapshot(request: Readonly<{ key: string }>): Promise<{
    owner?: string;
    content: string;
    revision: number;
  }>;
}>;

function createActorHost(events = createMemoryEventStore<object>()) {
  let time = 0;
  return {
    alarm: {
      register() {},
      schedule() {},
      cancel() {},
    },
    events,
    executionContext: createTestExecutionContext(),
    synchronization: createTestSynchronization(),
    clock: { now: () => ++time },
    identifiers: { create: () => `actor-worker-${++actorWorkerIdentity}` },
    timer: {
      async sleep() {
        await Promise.resolve();
      },
    },
    language: {
      async answer({
        input,
      }: {
        input: Readonly<{ conversation: readonly string[]; prompt: string }>;
      }) {
        return {
          text: `answer:${input.prompt}`,
          ...(input.prompt.includes("tool") ? { tool: { name: "echo", input: input.prompt } } : {}),
        };
      },
    },
    tools: {
      async execute({ input }: { input: Readonly<{ name: string; input: string }> }) {
        return { output: `tool:${input.name}:${input.input}` };
      },
    },
  };
}

function createTestExecutionContext() {
  const storage = new AsyncLocalStorage<readonly object[]>();
  return {
    current() {
      return storage.getStore() ?? [];
    },
    async run({ scope, task }: Readonly<{ scope: object; task(): Promise<object> }>) {
      return await storage.run([...(storage.getStore() ?? []), scope], task);
    },
  };
}

function createTestSynchronization() {
  const tails = new Map<string, Promise<void>>();
  return {
    async exclusive({
      key,
      task,
    }: Readonly<{ key: string; task(): Promise<object> }>): Promise<object> {
      const previous = tails.get(key) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      tails.set(key, tail);
      await previous;
      try {
        return await task();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}

function createManualAlarm() {
  const handlers = new Map<string, () => Promise<void>>();
  const scheduled = new Map<string, number>();
  return {
    dependency: {
      register({ id, run }: Readonly<{ id: string; run(): Promise<void> }>) {
        handlers.set(id, run);
      },
      schedule({ id, at }: Readonly<{ id: string; at: number }>) {
        if (!handlers.has(id)) throw new Error(`Alarm ${id} is not registered.`);
        scheduled.set(id, at);
      },
      cancel({ id }: Readonly<{ id: string }>) {
        scheduled.delete(id);
      },
    },
    async runDue(now: number) {
      for (let turn = 0; turn < 128; turn += 1) {
        const due = [...scheduled]
          .filter(([, at]) => at <= now)
          .sort(([leftId, leftAt], [rightId, rightAt]) =>
            leftAt === rightAt ? leftId.localeCompare(rightId) : leftAt - rightAt,
          )[0];
        if (due === undefined) return;
        const [id] = due;
        scheduled.delete(id);
        const run = handlers.get(id);
        if (run === undefined) throw new Error(`Alarm ${id} has no handler.`);
        await run();
      }
      throw new Error("Manual Alarm exceeded its due-work limit.");
    },
  };
}

function actorStream(name: string, key: string): string {
  return `actor:${name.length}:${name}:${key.length}:${key}`;
}
