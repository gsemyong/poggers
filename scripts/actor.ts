import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";

import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { createMemoryEventStore } from "@/features/entity.testing";
import type { EventStore } from "@/platforms/server/platform";
import { executeLinkedProgramIR, type LinkedProgramExecution } from "@/runtime/interpreter";

type Account = Readonly<{
  deposit(
    request: Readonly<{
      key: string;
      input: { amount: number };
      idempotencyKey?: string;
      wait?: "accepted" | "completed";
    }>,
  ): Promise<object>;
  balance(request: Readonly<{ key: string }>): Promise<{ balance: number }>;
}>;

type Reminder = Readonly<{
  schedule(
    request: Readonly<{
      key: string;
      input: { at: number; generation: number };
      idempotencyKey?: string;
    }>,
  ): Promise<object>;
  status(request: Readonly<{ key: string }>): Promise<{ due: number | null; fired: number }>;
}>;

type Sample = Readonly<{
  milliseconds: number;
  operations: number;
}>;

type Benchmark = Readonly<{
  name: string;
  unit: "operation";
  samples: readonly number[];
  medianMicroseconds: number;
  p95Microseconds: number;
  operationsPerSecond: number;
}>;

const program = (() => {
  const ir = compileSystem(resolve(import.meta.dirname, "../src/features/actor.typecheck.ts"));
  const server = ir.programs.find(({ name }) => name === "server");
  if (server === undefined) throw new Error("Actor benchmark has no server Program.");
  return linkProgram(server);
})();

const results: Benchmark[] = [];

await benchmark("cold activation and first query", 5, async (sample) => {
  const operations = 25;
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    await using execution = await actorExecution(createMemoryEventStore<object>());
    const account = execution.dependencies.account as Account;
    const state = await account.balance({ key: `cold-${sample}-${index}` });
    if (state.balance !== 0) throw new Error("Cold activation returned incorrect state.");
  }
  return { milliseconds: performance.now() - started, operations };
});

await benchmark("warm durable command", 5, async (sample) => {
  const operations = 100;
  await using execution = await actorExecution(createMemoryEventStore<object>());
  const account = execution.dependencies.account as Account;
  const key = `warm-${sample}`;
  await account.balance({ key });
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    await account.deposit({
      key,
      input: { amount: 1 },
      idempotencyKey: `warm-${index}`,
    });
  }
  const milliseconds = performance.now() - started;
  if ((await account.balance({ key })).balance !== operations) {
    throw new Error("Warm dispatch lost committed state.");
  }
  return { milliseconds, operations };
});

await benchmark("many independent keys", 5, async (sample) => {
  const operations = 100;
  await using execution = await actorExecution(createMemoryEventStore<object>());
  const account = execution.dependencies.account as Account;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: operations }, (_, index) =>
      account.deposit({
        key: `many-${sample}-${index}`,
        input: { amount: 1 },
        idempotencyKey: "create",
      }),
    ),
  );
  return { milliseconds: performance.now() - started, operations };
});

await benchmark("one concurrent hot key", 5, async (sample) => {
  const operations = 100;
  await using execution = await actorExecution(createMemoryEventStore<object>());
  const account = execution.dependencies.account as Account;
  const key = `hot-${sample}`;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: operations }, (_, index) =>
      account.deposit({
        key,
        input: { amount: 1 },
        idempotencyKey: `hot-${index}`,
      }),
    ),
  );
  const milliseconds = performance.now() - started;
  if ((await account.balance({ key })).balance !== operations) {
    throw new Error("Hot-key dispatch lost committed state.");
  }
  return { milliseconds, operations };
});

await benchmark("bounded overload rejection", 5, async (sample) => {
  const operations = 100;
  const events = createMemoryEventStore<object>();
  const key = `overload-${sample}`;
  const stream = actorStream("account", key);
  await events.append({
    stream,
    expectedRevision: 0,
    events: Array.from({ length: 1_024 }, (_, index) => ({
      type: "actor.command.accepted",
      invocation: `existing-${index}`,
      operation: "deposit",
      input: { amount: 1 },
      at: index,
    })),
  });
  await using execution = await actorExecution(events);
  const account = execution.dependencies.account as Account;
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    try {
      await account.deposit({
        key,
        input: { amount: 1 },
        idempotencyKey: `overflow-${index}`,
      });
      throw new Error("Overloaded Actor accepted excess work.");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.name !== "ActorError" ||
        (error as Error & { failure?: { type?: string } }).failure?.type !== "overloaded"
      ) {
        throw error;
      }
    }
  }
  return { milliseconds: performance.now() - started, operations };
});

await benchmark("durable timer generation", 5, async (sample) => {
  const operations = 50;
  const events = createMemoryEventStore<object>();
  const alarm = manualAlarm();
  await using execution = await actorExecution(events, alarm);
  const reminder = execution.dependencies.reminder as Reminder;
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    await reminder.schedule({
      key: `timer-${sample}-${index}`,
      input: { at: 10, generation: 1 },
      idempotencyKey: "schedule",
    });
  }
  await alarm.runDue(10);
  const milliseconds = performance.now() - started;
  for (let index = 0; index < operations; index += 1) {
    if ((await reminder.status({ key: `timer-${sample}-${index}` })).fired !== 1) {
      throw new Error("Timer benchmark lost a generation.");
    }
  }
  return { milliseconds, operations };
});

await benchmark("accepted-work failover", 5, async (sample) => {
  const operations = 50;
  const events = createMemoryEventStore<object>();
  const alarm = manualAlarm();
  const first = await actorExecution(events, alarm);
  const firstAccount = first.dependencies.account as Account;
  for (let index = 0; index < operations; index += 1) {
    await firstAccount.deposit({
      key: `failover-${sample}-${index}`,
      input: { amount: 1 },
      idempotencyKey: "accepted",
      wait: "accepted",
    });
  }
  await first[Symbol.asyncDispose]();

  const started = performance.now();
  await using recovered = await actorExecution(events);
  const recoveredAccount = recovered.dependencies.account as Account;
  for (let index = 0; index < operations; index += 1) {
    const state = await recoveredAccount.balance({ key: `failover-${sample}-${index}` });
    if (state.balance !== 1) throw new Error("Failover benchmark lost accepted work.");
  }
  return { milliseconds: performance.now() - started, operations };
});

await benchmark("three-replica relocation", 5, async (sample) => {
  const operations = 90;
  const events = createMemoryEventStore<object>();
  await using original = await actorExecution(events);
  const originalAccount = original.dependencies.account as Account;
  for (let index = 0; index < operations; index += 1) {
    await originalAccount.deposit({
      key: `relocate-${sample}-${index}`,
      input: { amount: 1 },
      idempotencyKey: "initial",
    });
  }

  const replicas = await Promise.all(Array.from({ length: 3 }, () => actorExecution(events)));
  try {
    const APIs = replicas.map(({ dependencies }) => dependencies.account as Account);
    const started = performance.now();
    await Promise.all(
      Array.from({ length: operations }, (_, index) =>
        APIs[index % APIs.length]!.deposit({
          key: `relocate-${sample}-${index}`,
          input: { amount: 1 },
          idempotencyKey: "relocated",
        }),
      ),
    );
    return { milliseconds: performance.now() - started, operations };
  } finally {
    await Promise.all(replicas.map((replica) => replica[Symbol.asyncDispose]()));
  }
});

console.log(
  JSON.stringify(
    {
      schema: 1,
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
      durability: "in-memory EventStore with compare-and-append",
      warmup: 1,
      results,
    },
    undefined,
    2,
  ),
);

async function benchmark(
  name: string,
  repetitions: number,
  run: (sample: number) => Promise<Sample>,
): Promise<void> {
  await run(-1);
  const samples: number[] = [];
  let totalOperations = 0;
  let totalMilliseconds = 0;
  for (let sample = 0; sample < repetitions; sample += 1) {
    const result = await run(sample);
    const microseconds = (result.milliseconds * 1_000) / result.operations;
    samples.push(round(microseconds));
    totalOperations += result.operations;
    totalMilliseconds += result.milliseconds;
  }
  const ordered = [...samples].sort((left, right) => left - right);
  results.push({
    name,
    unit: "operation",
    samples,
    medianMicroseconds: percentile(ordered, 0.5),
    p95Microseconds: percentile(ordered, 0.95),
    operationsPerSecond: round((totalOperations * 1_000) / totalMilliseconds),
  });
}

async function actorExecution(
  events: EventStore<object>,
  alarm = manualAlarm(),
): Promise<LinkedProgramExecution> {
  let time = 0;
  const scopes = new AsyncLocalStorage<readonly object[]>();
  const tails = new Map<string, Promise<void>>();
  return executeLinkedProgramIR(program, {
    alarm,
    events,
    executionContext: {
      current() {
        return scopes.getStore() ?? [];
      },
      async run({ scope, task }: Readonly<{ scope: object; task(): Promise<object> }>) {
        return scopes.run([...(scopes.getStore() ?? []), scope], task);
      },
    },
    synchronization: {
      async exclusive({
        key,
        task,
      }: Readonly<{ key: string; task(): Promise<object> }>): Promise<object> {
        const previous = tails.get(key) ?? Promise.resolve();
        let release = () => {};
        const current = new Promise<void>((resolvePromise) => {
          release = resolvePromise;
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
    },
    clock: { now: () => ++time },
    identifiers: { create: () => `benchmark-worker-${time}` },
    timer: { async sleep() {} },
    payments: {
      async charge() {
        return { receipt: "benchmark" };
      },
    },
    language: {
      async answer() {
        return { text: "benchmark" };
      },
    },
    tools: {
      async execute() {
        return { output: "benchmark" };
      },
    },
  });
}

function manualAlarm() {
  const handlers = new Map<string, () => Promise<void>>();
  const scheduled = new Map<string, number>();
  return {
    register({ id, run }: Readonly<{ id: string; run(): Promise<void> }>) {
      handlers.set(id, run);
    },
    schedule({ id, at }: Readonly<{ id: string; at: number }>) {
      scheduled.set(id, at);
    },
    cancel({ id }: Readonly<{ id: string }>) {
      scheduled.delete(id);
    },
    async runDue(now: number) {
      while (true) {
        const due = [...scheduled].find(([, at]) => at <= now);
        if (due === undefined) return;
        scheduled.delete(due[0]);
        const run = handlers.get(due[0]);
        if (run !== undefined) await run();
      }
    },
  };
}

function actorStream(name: string, key: string): string {
  return `actor:${name.length}:${name}:${key.length}:${key}`;
}

function percentile(ordered: readonly number[], value: number): number {
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * value))] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
