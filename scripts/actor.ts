import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";

import { dependencyOperationIdentity } from "@/compiler/ir";
import { collectProgramManifest, linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { invokeDependency } from "@/core/dependency";
import { createMemoryEventStore } from "@/features/entity.testing";
import type { EventStore } from "@/platforms/server/platform";
import {
  createMemoryProcessDirectory,
  processPartition,
  startProcessDistribution,
  type ProcessDirectory,
  type ProcessNetwork,
  type RunningProcessDistribution,
} from "@/runtime/distribution";
import { executeLinkedProgramIR, type LinkedProgramExecution } from "@/runtime/interpreter";
import {
  createMemoryDependencyTransport,
  encodeDependencyWireMessage,
  type DependencyRequestHandler,
  type DependencyTransportSession,
  type DependencyWireRequest,
} from "@/runtime/transport";

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
  cacheHits?: number;
  cacheMisses?: number;
  networkBytes?: number;
  storageBytes?: number;
  relocationMilliseconds?: number;
}>;

type Benchmark = Readonly<{
  name: string;
  unit: "operation";
  samples: readonly number[];
  p50Microseconds: number;
  p95Microseconds: number;
  p99Microseconds: number;
  operationsPerSecond: number;
  approximateHeapDeltaBytes: number;
  cacheHitRate?: number;
  networkBytesPerOperation?: number;
  storageBytesPerOperation?: number;
  relocationMilliseconds?: number;
}>;

type RuntimeMeasurements = {
  cacheHits: number;
  cacheMisses: number;
};

const server = (() => {
  const ir = compileSystem(resolve(import.meta.dirname, "../src/features/actor.typecheck.ts"));
  const server = ir.programs.find(({ name }) => name === "server");
  if (server === undefined) throw new Error("Actor benchmark has no server Program.");
  return server;
})();
const program = linkProgram(server);
const contracts = collectProgramManifest(server).bindings;
const { accountContract, balanceOperation } = (() => {
  const contract = contracts.find(({ name }) => name === "account");
  if (contract === undefined) throw new Error("Actor benchmark has no account contract.");
  const operation = contract.operations.find(({ name }) => name === "balance");
  if (operation === undefined) throw new Error("Actor benchmark has no balance operation.");
  return { accountContract: contract, balanceOperation: operation };
})();

const results: Benchmark[] = [];

await benchmark("cold activation and first query", 5, async (sample) => {
  const operations = 25;
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  let storageBytes = 0;
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    const events = measureEvents(createMemoryEventStore<object>());
    await using execution = await actorExecution(events.dependency, manualAlarm(), measurements);
    const account = execution.dependencies.account as Account;
    const state = await account.balance({ key: `cold-${sample}-${index}` });
    if (state.balance !== 0) throw new Error("Cold activation returned incorrect state.");
    storageBytes += events.storageBytes();
  }
  return {
    milliseconds: performance.now() - started,
    operations,
    cacheHits: measurements.cacheHits,
    cacheMisses: measurements.cacheMisses,
    storageBytes,
  };
});

await benchmark("warm local call", 5, async (sample) => {
  const operations = 200;
  const events = measureEvents(createMemoryEventStore<object>());
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  await using execution = await actorExecution(events.dependency, manualAlarm(), measurements);
  const account = execution.dependencies.account as Account;
  const key = `local-${sample}`;
  await account.balance({ key });
  const hitsBefore = measurements.cacheHits;
  const missesBefore = measurements.cacheMisses;
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    if ((await account.balance({ key })).balance !== 0) {
      throw new Error("Warm local read returned incorrect state.");
    }
  }
  const cacheHits = measurements.cacheHits - hitsBefore;
  const cacheMisses = measurements.cacheMisses - missesBefore;
  return {
    milliseconds: performance.now() - started,
    operations,
    cacheHits,
    cacheMisses,
    storageBytes: events.storageBytes(),
  };
});

await benchmark("durable persistence", 5, async (sample) => {
  const operations = 100;
  const events = measureEvents(createMemoryEventStore<object>());
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  await using execution = await actorExecution(events.dependency, manualAlarm(), measurements);
  const account = execution.dependencies.account as Account;
  const key = `warm-${sample}`;
  await account.balance({ key });
  const hitsBefore = measurements.cacheHits;
  const missesBefore = measurements.cacheMisses;
  const bytesBefore = events.storageBytes();
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
  const cacheHits = measurements.cacheHits - hitsBefore;
  const cacheMisses = measurements.cacheMisses - missesBefore;
  return {
    milliseconds,
    operations,
    cacheHits,
    cacheMisses,
    storageBytes: events.storageBytes() - bytesBefore,
  };
});

await benchmark("warm remote call", 5, async (sample) => {
  const operations = 100;
  const events = measureEvents(createMemoryEventStore<object>());
  const directory = createMemoryProcessDirectory();
  const network = measureNetwork(createMemoryDependencyTransport());
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  let now = 0;
  const first = await distributedActorExecution(
    events.dependency,
    "remote-client",
    directory,
    network.dependency,
    () => now,
    measurements,
  );
  const second = await distributedActorExecution(
    events.dependency,
    "remote-owner",
    directory,
    network.dependency,
    () => now,
    measurements,
  );
  try {
    const key = await actorKeyOwnedBy(directory, "remote-owner", now, `remote-${sample}`);
    const account = first.execution.dependencies.account as Account;
    await account.balance({ key });
    const bytesBefore = network.bytes();
    const hitsBefore = measurements.cacheHits;
    const missesBefore = measurements.cacheMisses;
    const started = performance.now();
    for (let index = 0; index < operations; index += 1) {
      if ((await account.balance({ key })).balance !== 0) {
        throw new Error("Warm remote read returned incorrect state.");
      }
    }
    const cacheHits = measurements.cacheHits - hitsBefore;
    const cacheMisses = measurements.cacheMisses - missesBefore;
    const remoteCalls = first.distribution.status().metrics.remoteCalls;
    if (remoteCalls < operations) throw new Error("Remote benchmark used the local fast path.");
    return {
      milliseconds: performance.now() - started,
      operations,
      cacheHits,
      cacheMisses,
      networkBytes: network.bytes() - bytesBefore,
      storageBytes: events.storageBytes(),
    };
  } finally {
    await first.execution[Symbol.asyncDispose]();
    await second.execution[Symbol.asyncDispose]();
    now += 1;
  }
});

await benchmark("many independent keys", 5, async (sample) => {
  const operations = 100;
  const events = measureEvents(createMemoryEventStore<object>());
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  await using execution = await actorExecution(events.dependency, manualAlarm(), measurements);
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
  return {
    milliseconds: performance.now() - started,
    operations,
    cacheHits: measurements.cacheHits,
    cacheMisses: measurements.cacheMisses,
    storageBytes: events.storageBytes(),
  };
});

await benchmark("one concurrent hot key", 5, async (sample) => {
  const operations = 100;
  const events = measureEvents(createMemoryEventStore<object>());
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  await using execution = await actorExecution(events.dependency, manualAlarm(), measurements);
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
  return {
    milliseconds,
    operations,
    cacheHits: measurements.cacheHits,
    cacheMisses: measurements.cacheMisses,
    storageBytes: events.storageBytes(),
  };
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
  const events = measureEvents(createMemoryEventStore<object>());
  const alarm = manualAlarm();
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  await using execution = await actorExecution(events.dependency, alarm, measurements);
  const reminder = execution.dependencies.reminder as Reminder;
  const started = performance.now();
  for (let index = 0; index < operations; index += 1) {
    await reminder.schedule({
      key: `timer-${sample}-${index}`,
      input: { at: 10, generation: 1 },
      idempotencyKey: "schedule",
    });
  }
  await alarm.runDue(10, execution.dependencies);
  const milliseconds = performance.now() - started;
  for (let index = 0; index < operations; index += 1) {
    if ((await reminder.status({ key: `timer-${sample}-${index}` })).fired !== 1) {
      throw new Error("Timer benchmark lost a generation.");
    }
  }
  return {
    milliseconds,
    operations,
    cacheHits: measurements.cacheHits,
    cacheMisses: measurements.cacheMisses,
    storageBytes: events.storageBytes(),
  };
});

await benchmark("accepted-work restart recovery", 5, async (sample) => {
  const operations = 50;
  const events = measureEvents(createMemoryEventStore<object>());
  const alarm = manualAlarm();
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  const first = await actorExecution(events.dependency, alarm, measurements);
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
  const hitsBefore = measurements.cacheHits;
  const missesBefore = measurements.cacheMisses;
  await using recovered = await actorExecution(events.dependency, manualAlarm(), measurements);
  const recoveredAccount = recovered.dependencies.account as Account;
  for (let index = 0; index < operations; index += 1) {
    const state = await recoveredAccount.balance({ key: `failover-${sample}-${index}` });
    if (state.balance !== 1) throw new Error("Failover benchmark lost accepted work.");
  }
  const cacheHits = measurements.cacheHits - hitsBefore;
  const cacheMisses = measurements.cacheMisses - missesBefore;
  return {
    milliseconds: performance.now() - started,
    operations,
    cacheHits,
    cacheMisses,
    storageBytes: events.storageBytes(),
  };
});

await benchmark("snapshot recovery", 5, async (sample) => {
  const operations = 100;
  const events = measureEvents(createMemoryEventStore<object>());
  const measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 };
  const key = `snapshot-${sample}`;
  const first = await actorExecution(events.dependency, manualAlarm(), measurements);
  try {
    const account = first.dependencies.account as Account;
    for (let index = 0; index < operations; index += 1) {
      await account.deposit({
        key,
        input: { amount: 1 },
        idempotencyKey: `snapshot-${index}`,
      });
    }
  } finally {
    await first[Symbol.asyncDispose]();
  }
  const hitsBefore = measurements.cacheHits;
  const missesBefore = measurements.cacheMisses;
  const started = performance.now();
  await using recovered = await actorExecution(events.dependency, manualAlarm(), measurements);
  if ((await (recovered.dependencies.account as Account).balance({ key })).balance !== operations) {
    throw new Error("Snapshot recovery returned incorrect state.");
  }
  return {
    milliseconds: performance.now() - started,
    operations: 1,
    cacheHits: measurements.cacheHits - hitsBefore,
    cacheMisses: measurements.cacheMisses - missesBefore,
    storageBytes: events.storageBytes(),
  };
});

await benchmark("three-replica scale-out", 5, async (sample) => {
  const operations = 90;
  const events = measureEvents(createMemoryEventStore<object>());
  const directory = createMemoryProcessDirectory();
  const network = measureNetwork(createMemoryDependencyTransport());
  let now = 0;
  const first = await distributedActorExecution(
    events.dependency,
    "scale-one",
    directory,
    network.dependency,
    () => now,
  );
  const firstAccount = first.execution.dependencies.account as Account;
  for (let index = 0; index < operations; index += 1) {
    await firstAccount.balance({ key: `scale-${sample}-${index}` });
  }
  const second = await distributedActorExecution(
    events.dependency,
    "scale-two",
    directory,
    network.dependency,
    () => now,
  );
  const third = await distributedActorExecution(
    events.dependency,
    "scale-three",
    directory,
    network.dependency,
    () => now,
  );
  try {
    await first.distribution.rebalance();
    const APIs = [first, second, third].map(
      ({ execution }) => execution.dependencies.account as Account,
    );
    const bytesBefore = network.bytes();
    const started = performance.now();
    await Promise.all(
      Array.from({ length: operations }, (_, index) =>
        APIs[index % APIs.length]!.deposit({
          key: `scale-${sample}-${index}`,
          input: { amount: 1 },
          idempotencyKey: "scaled",
        }),
      ),
    );
    const milliseconds = performance.now() - started;
    const remoteCalls = [first, second, third].reduce(
      (sum, replica) => sum + replica.distribution.status().metrics.remoteCalls,
      0,
    );
    if (remoteCalls === 0) throw new Error("Scale-out benchmark moved no routed work.");
    return {
      milliseconds,
      operations,
      networkBytes: network.bytes() - bytesBefore,
      storageBytes: events.storageBytes(),
      relocationMilliseconds: milliseconds,
    };
  } finally {
    await first.execution[Symbol.asyncDispose]();
    await second.execution[Symbol.asyncDispose]();
    await third.execution[Symbol.asyncDispose]();
    now += 1;
  }
});

await benchmark("owner failover", 5, async (sample) => {
  const events = measureEvents(createMemoryEventStore<object>());
  const directory = createMemoryProcessDirectory();
  const network = measureNetwork(createMemoryDependencyTransport());
  let now = 0;
  const replicas = await Promise.all(
    ["fail-one", "fail-two", "fail-three"].map((id) =>
      distributedActorExecution(events.dependency, id, directory, network.dependency, () => now),
    ),
  );
  try {
    const key = await actorKeyOwnedBy(directory, "fail-two", now, `failover-${sample}`);
    const client = replicas[0]!.execution.dependencies.account as Account;
    await client.deposit({ key, input: { amount: 1 }, idempotencyKey: "before" });
    const failed = replicas[1]!;
    await directory.leave({
      id: failed.distribution.member.id,
      failureEpoch: failed.distribution.member.failureEpoch,
      now,
    });
    now = 1;
    await replicas[0]!.distribution.renew();
    await replicas[2]!.distribution.renew();
    const started = performance.now();
    const result = await client.deposit({
      key,
      input: { amount: 1 },
      idempotencyKey: "after",
    });
    const milliseconds = performance.now() - started;
    if (!("value" in result) || (result.value as { balance?: number }).balance !== 2) {
      throw new Error("Failover benchmark lost Actor state.");
    }
    return {
      milliseconds,
      operations: 1,
      networkBytes: network.bytes(),
      storageBytes: events.storageBytes(),
      relocationMilliseconds: milliseconds,
    };
  } finally {
    await Promise.all(replicas.map(({ execution }) => execution[Symbol.asyncDispose]()));
  }
});

console.log(
  JSON.stringify(
    {
      schema: 2,
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
      durability: "one shared in-memory EventStore with compare-and-append and snapshots",
      transport: "canonical in-memory Dependency wire protocol for remote scenarios",
      allocation:
        "positive retained JavaScript heap delta; an approximate lower bound rather than an allocator trace",
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
  const heapDeltas: number[] = [];
  let totalOperations = 0;
  let totalMilliseconds = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let networkBytes = 0;
  let storageBytes = 0;
  const relocations: number[] = [];
  for (let sample = 0; sample < repetitions; sample += 1) {
    const heapBefore = process.memoryUsage().heapUsed;
    const result = await run(sample);
    heapDeltas.push(Math.max(0, process.memoryUsage().heapUsed - heapBefore));
    const microseconds = (result.milliseconds * 1_000) / result.operations;
    samples.push(round(microseconds));
    totalOperations += result.operations;
    totalMilliseconds += result.milliseconds;
    cacheHits += result.cacheHits ?? 0;
    cacheMisses += result.cacheMisses ?? 0;
    networkBytes += result.networkBytes ?? 0;
    storageBytes += result.storageBytes ?? 0;
    if (result.relocationMilliseconds !== undefined) {
      relocations.push(result.relocationMilliseconds);
    }
  }
  const ordered = [...samples].sort((left, right) => left - right);
  const orderedHeap = [...heapDeltas].sort((left, right) => left - right);
  const orderedRelocations = relocations.toSorted((left, right) => left - right);
  const cacheObservations = cacheHits + cacheMisses;
  results.push({
    name,
    unit: "operation",
    samples,
    p50Microseconds: percentile(ordered, 0.5),
    p95Microseconds: percentile(ordered, 0.95),
    p99Microseconds: percentile(ordered, 0.99),
    operationsPerSecond: round((totalOperations * 1_000) / totalMilliseconds),
    approximateHeapDeltaBytes: percentile(orderedHeap, 0.5),
    ...(cacheObservations === 0 ? {} : { cacheHitRate: round(cacheHits / cacheObservations) }),
    ...(networkBytes === 0
      ? {}
      : { networkBytesPerOperation: round(networkBytes / totalOperations) }),
    ...(storageBytes === 0
      ? {}
      : { storageBytesPerOperation: round(storageBytes / totalOperations) }),
    ...(orderedRelocations.length === 0
      ? {}
      : { relocationMilliseconds: percentile(orderedRelocations, 0.5) }),
  });
}

function measureEvents(events: EventStore<object>): Readonly<{
  dependency: EventStore<object>;
  storageBytes(): number;
}> {
  const eventBytes = new Map<string, Map<number, number>>();
  const snapshotBytes = new Map<string, number>();
  const dependency: EventStore<object> = {
    async read(input) {
      return await events.read(input);
    },
    async append(input) {
      const appended = await events.append(input);
      if (appended) {
        let stream = eventBytes.get(input.stream);
        if (!stream) {
          stream = new Map();
          eventBytes.set(input.stream, stream);
        }
        for (const stored of appended) {
          stream.set(stored.revision, Buffer.byteLength(JSON.stringify(stored.event)));
        }
      }
      return appended;
    },
    subscribe(input) {
      return events.subscribe(input);
    },
    async loadSnapshot(input) {
      return await events.loadSnapshot(input);
    },
    async saveSnapshot(input) {
      const saved = await events.saveSnapshot(input);
      if (saved) {
        snapshotBytes.set(input.stream, Buffer.byteLength(JSON.stringify(input.snapshot)));
      }
      return saved;
    },
    async compact(input) {
      await events.compact(input);
      const stream = eventBytes.get(input.stream);
      if (stream) {
        for (const revision of stream.keys()) {
          if (revision <= input.through) stream.delete(revision);
        }
      }
    },
  };
  return {
    dependency,
    storageBytes() {
      let bytes = 0;
      for (const stream of eventBytes.values()) {
        for (const value of stream.values()) bytes += value;
      }
      for (const value of snapshotBytes.values()) bytes += value;
      return bytes;
    },
  };
}

function measureNetwork(network: ProcessNetwork): Readonly<{
  dependency: ProcessNetwork;
  bytes(): number;
}> {
  let bytes = 0;
  return {
    dependency: {
      bind(target: string, handler: DependencyRequestHandler) {
        return network.bind(target, handler);
      },
      open(input: Readonly<{ target: string; request: DependencyWireRequest }>) {
        bytes += Buffer.byteLength(encodeDependencyWireMessage(input.request));
        const session = network.open(input);
        const measured: DependencyTransportSession = {
          frames: {
            async *[Symbol.asyncIterator]() {
              for await (const frame of session.frames) {
                bytes += Buffer.byteLength(encodeDependencyWireMessage(frame));
                yield frame;
              }
            },
          },
          cancel(reason) {
            session.cancel(reason);
          },
        };
        return measured;
      },
    },
    bytes: () => bytes,
  };
}

async function distributedActorExecution(
  events: EventStore<object>,
  id: string,
  directory: ProcessDirectory,
  network: ProcessNetwork,
  now: () => number,
  measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 },
): Promise<
  Readonly<{
    execution: LinkedProgramExecution;
    distribution: RunningProcessDistribution;
  }>
> {
  let distribution: RunningProcessDistribution | undefined;
  const execution = await executeLinkedProgramIR(
    program,
    benchmarkHost(events, manualAlarm(), measurements),
    {
      async distribute({ program: programName, contracts: programContracts, providers }) {
        const running = await startProcessDistribution(programName, programContracts, providers, {
          id,
          target: `memory://${id}`,
          version: "benchmark-v1",
          directory,
          network,
          partitionCount: 64,
          membershipLease: 1_000,
          ownershipLease: 500,
          now,
        });
        distribution = running;
        return running;
      },
    },
  );
  if (!distribution) throw new Error("Actor benchmark did not start Process distribution.");
  return { execution, distribution };
}

async function actorKeyOwnedBy(
  directory: ProcessDirectory,
  owner: string,
  now: number,
  prefix: string,
): Promise<string> {
  for (let index = 0; index < 256; index += 1) {
    const key = `${prefix}-${index}`;
    const partition = processPartition("server", accountContract, { key }, 64);
    const ownership = await directory.locate({
      partition,
      operation: balanceOperation.name,
      contract: dependencyOperationIdentity(balanceOperation),
      now,
      leaseDuration: 500,
    });
    if (ownership.owner === owner) return key;
  }
  throw new Error(`Unable to find an Actor key owned by ${owner}.`);
}

async function actorExecution(
  events: EventStore<object>,
  alarm = manualAlarm(),
  measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 },
): Promise<LinkedProgramExecution> {
  return executeLinkedProgramIR(program, benchmarkHost(events, alarm, measurements));
}

function benchmarkHost(
  events: EventStore<object>,
  alarm = manualAlarm(),
  measurements: RuntimeMeasurements = { cacheHits: 0, cacheMisses: 0 },
) {
  let time = 0;
  const scopes = new AsyncLocalStorage<readonly object[]>();
  const tails = new Map<string, Promise<void>>();
  return {
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
    telemetry: {
      record(input: Readonly<{ name: string; value: number }>) {
        if (input.name === "actor.cache.hits") measurements.cacheHits += input.value;
        if (input.name === "actor.cache.misses") measurements.cacheMisses += input.value;
      },
    },
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
  };
}

function manualAlarm() {
  type Scheduled = Readonly<{
    at: number;
    target: Readonly<{ dependency: string; operation: string; input: object }>;
  }>;
  const scheduled = new Map<string, Scheduled>();
  return {
    schedule({
      id,
      at,
      target,
    }: Readonly<{
      id: string;
      at: number;
      target: Readonly<{ dependency: string; operation: string; input: object }>;
    }>) {
      scheduled.set(id, { at, target });
    },
    cancel({ id }: Readonly<{ id: string }>) {
      scheduled.delete(id);
    },
    async runDue(now: number, dependencies: Readonly<Record<string, unknown>>) {
      while (true) {
        const due = [...scheduled].find(([, entry]) => entry.at <= now);
        if (due === undefined) return;
        scheduled.delete(due[0]);
        const dependency = dependencies[due[1].target.dependency];
        if (!dependency || (typeof dependency !== "object" && typeof dependency !== "function")) {
          throw new Error(`Alarm ${due[0]} has no target Dependency.`);
        }
        await invokeDependency(dependency as object, due[1].target.operation, due[1].target.input, {
          id: `benchmark-alarm:${due[0]}`,
          attempt: 1,
          scheduledAt: due[1].at,
          startedAt: now,
        });
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
