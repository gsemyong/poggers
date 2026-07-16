import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { serve, type ServerHandle } from "../src/host/server.ts";
import { createWebSocketSyncTransport } from "../src/host/sync.websocket.ts";
import { createFunctions, type FunctionsFeature } from "../src/index.ts";
import { featureResourceName } from "../src/kernel/feature.ts";
import { createSingleNodeSubstrate } from "../src/substrate/adapter.memory.ts";
import { connect } from "../src/substrate/client.ts";
import { createSqliteJournal } from "../src/substrate/journal.sqlite.ts";
import { defineApp, testFeature } from "../src/testing/application.ts";
import { createMemoryClientReplica } from "../src/testing/replica.ts";
import { poll } from "../src/testing/wait.ts";

const inngestVersion = "4.12.1";
const inngestTestVersion = "1.0.0";
const inngestServerVersion = "1.37.0";
const typescriptVersion = "7.0.2";
const command = process.argv[2] ?? "runtime";
const quick = process.argv.includes("--quick");
const keep = process.argv.includes("--keep");
const skipDrain = process.argv.includes("--skip-drain");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output="));
const outputFile = outputArgument?.slice("--output=".length);
const sizesArgument = process.argv.find((argument) => argument.startsWith("--sizes="));
const requestedSizes = sizesArgument
  ?.slice("--sizes=".length)
  .split(",")
  .map(Number)
  .filter((value) => Number.isInteger(value) && value >= 0);
const samplesArgument = process.argv.find((argument) => argument.startsWith("--samples="));
const requestedSamples = Number(samplesArgument?.slice("--samples=".length));
const shapesArgument = process.argv.find((argument) => argument.startsWith("--shapes="));
const requestedConcurrencyShapes = shapesArgument
  ?.slice("--shapes=".length)
  .split(",")
  .filter((shape): shape is ConcurrencyShape => shape === "hot" || shape === "independent");
const warmupsArgument = process.argv.find((argument) => argument.startsWith("--warmups="));
const requestedWarmups = Number(warmupsArgument?.slice("--warmups=".length));
const traceConcurrency = process.argv.includes("--trace-concurrency");
const timeoutArgument = process.argv.find((argument) => argument.startsWith("--timeout-ms="));
const requestedTimeoutMs = Number(timeoutArgument?.slice("--timeout-ms=".length));
const evidence: unknown[] = [];

function emit(value: unknown): void {
  evidence.push(value);
  console.log(JSON.stringify(value));
}

emit({
  kind: "environment",
  at: new Date().toISOString(),
  bun: Bun.version,
  typescript: typescriptVersion,
  inngest: inngestVersion,
  inngestTest: inngestTestVersion,
  inngestServer: inngestServerVersion,
  platform: process.platform,
  architecture: process.arch,
  logicalCpus: navigator.hardwareConcurrency,
});

type Mode = "sequential" | "parallel";
type ScaleContract = {
  Events: {
    "batch/run": { group: string; value: number };
    "behavior/release": { id: string };
    "behavior/run": { count: number; id: string };
    "cancel/run": { id: string };
    "concurrency/run": { count: number; lane: string; mode: Mode };
    "payload/run": { payload: string };
    "scale/run": { count: number; mode: Mode };
  };
  Functions: {
    batch: {
      Input: { group: string; value: number };
      Output: { count: number; total: number };
    };
    behavior: {
      Input: { count: number; id: string };
      Output: { child: string; release: string; retry: string; total: number };
    };
    cancel: {
      Input: { id: string };
      Output: { value: string };
    };
    child: {
      Input: { value: string };
      Output: { value: string };
    };
    concurrent: {
      Input: { count: number; lane: string; mode: Mode };
      Output: { total: number };
    };
    payload: {
      Input: { payload: string };
      Output: { payload: string };
    };
    scale: {
      Input: { count: number; mode: Mode };
      Output: { total: number };
    };
  };
  Dependencies: {};
};
type ScaleApp = {
  Actor: { id: string };
  Resources: {};
  Features: { scale: FunctionsFeature<ScaleContract> };
};

let handlerEntries = 0;
let operationDeclarations = 0;
const behaviorRetryAttempts = new Map<string, number>();
const scaleFeature = createFunctions<ScaleApp, ScaleContract>(
  { dependencies: {} },
  ({ createFunction }) => {
    const child = createFunction({ id: "child" }, async ({ event }) => ({
      value: `child:${event.data.value}`,
    }));
    createFunction(
      { id: "behavior", triggers: { event: "behavior/run" }, retries: 1 },
      async ({ event, step }) => {
        await step.sleep("timer", 2);
        const release = await step.waitForEvent("release", {
          event: "behavior/release",
          timeout: "1 second",
          match: "data.id",
        });
        const retry = await step.run("retry", () => {
          const attempt = (behaviorRetryAttempts.get(event.id) ?? 0) + 1;
          behaviorRetryAttempts.set(event.id, attempt);
          if (attempt === 1) throw new Error("expected evidence retry");
          return `retry:${event.data.id}`;
        });
        const invoked = await step.invoke("child", {
          function: child,
          data: { value: event.data.id },
        });
        const values = await Promise.all(
          Array.from({ length: event.data.count }, (_, index) =>
            step.run(`fan:${index}`, () => index),
          ),
        );
        return {
          child: invoked.value,
          release: release?.data.id ?? "timeout",
          retry,
          total: values.reduce((total, value) => total + value, 0),
        };
      },
    );
    createFunction(
      { id: "cancel", triggers: { event: "cancel/run" }, retries: 0 },
      async ({ event, step }) => {
        await step.waitForEvent("wait", { event: "behavior/release", timeout: "1 day" });
        return { value: event.data.id };
      },
    );
    createFunction(
      {
        id: "batch",
        triggers: { event: "batch/run" },
        batchEvents: { maxSize: 3, timeout: "250 milliseconds", key: "event.data.group" },
        retries: 0,
      },
      async ({ events }) => ({
        count: events.length,
        total: events.reduce((total, event) => total + event.data.value, 0),
      }),
    );
    createFunction(
      { id: "scale", triggers: { event: "scale/run" }, retries: 0 },
      async ({ event, step }) => {
        handlerEntries += 1;
        if (event.data.mode === "parallel") {
          const values = await Promise.all(
            Array.from({ length: event.data.count }, (_, index) => {
              operationDeclarations += 1;
              return step.run(`step-${index}`, () => index);
            }),
          );
          return { total: values.reduce((total, value) => total + value, 0) };
        }
        let total = 0;
        for (let index = 0; index < event.data.count; index += 1) {
          operationDeclarations += 1;
          total += await step.run(`step-${index}`, () => index);
        }
        return { total };
      },
    );
    createFunction(
      {
        id: "concurrent",
        triggers: { event: "concurrency/run" },
        concurrency: { limit: 256, key: "event.data.lane" },
        retries: 0,
      },
      async ({ event, step }) => {
        handlerEntries += 1;
        if (event.data.mode === "parallel") {
          const values = await Promise.all(
            Array.from({ length: event.data.count }, (_, index) => {
              operationDeclarations += 1;
              return step.run(`step-${index}`, () => index);
            }),
          );
          return { total: values.reduce((total, value) => total + value, 0) };
        }
        let total = 0;
        for (let index = 0; index < event.data.count; index += 1) {
          operationDeclarations += 1;
          total += await step.run(`step-${index}`, () => index);
        }
        return { total };
      },
    );
    createFunction(
      { id: "payload", triggers: { event: "payload/run" }, retries: 0 },
      async ({ event, step }) => ({
        payload: await step.run("roundtrip", () => event.data.payload),
      }),
    );
  },
);
const scaleApp = defineApp<ScaleApp>({
  version: 1,
  resources: {},
  features: { scale: scaleFeature },
});

async function runRuntimeSample(mode: Mode, count: number, identity: number) {
  const fixture = await testFeature(scaleApp, "scale", { actor: { id: "evidence" } });
  const entriesBefore = handlerEntries;
  const declarationsBefore = operationDeclarations;
  const id = `${mode}-${count}-${identity}`;
  const started = performance.now();
  await fixture.api.send({ id, name: "scale/run", data: { count, mode } });
  await fixture.drain();
  const elapsedMs = performance.now() - started;
  const run = fixture.api.getFunction("scale", `${id}:scale`).run;
  const entries = handlerEntries - entriesBefore;
  const declarations = operationDeclarations - declarationsBefore;
  if (run?.status !== "completed") throw new Error(`${mode} ${count} did not complete.`);
  if (entries !== 1 || declarations !== count || run.transitionCount !== 3 * count + 2) {
    throw new Error(
      `${mode} ${count} violated its work budget: ${entries} entries, ${declarations} declarations, ${run.transitionCount} transitions.`,
    );
  }
  await fixture.dispose();
  return { elapsedMs, entries, declarations, transitions: run.transitionCount };
}

async function runRuntimeEvidence(): Promise<void> {
  const sizes = requestedSizes?.length
    ? requestedSizes
    : quick
      ? [10, 1_000]
      : [0, 10, 100, 1_000, 10_000];
  const measuredSamples =
    Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 2 : 7;
  let identity = 0;
  for (const mode of ["sequential", "parallel"] satisfies Mode[]) {
    for (const count of sizes) {
      await runRuntimeSample(mode, count, identity++);
      const samples = [];
      for (let index = 0; index < measuredSamples; index += 1) {
        samples.push(await runRuntimeSample(mode, count, identity++));
      }
      const elapsed = samples.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
      emit({
        kind: "runtime",
        boundary: "in-memory semantic Resource/Program host",
        mode,
        operations: count,
        samples: measuredSamples,
        medianMs: percentile(elapsed, 0.5),
        p95Ms: percentile(elapsed, 0.95),
        rawMs: elapsed,
        handlerEntries: samples[0]!.entries,
        operationDeclarations: samples[0]!.declarations,
        transitions: samples[0]!.transitions,
      });
    }
  }
}

async function createPersistentScaleRuntime(file: string): Promise<{
  readonly api: ReturnType<typeof scaleFeature.api>;
  readonly stop: () => Promise<{
    readonly journalRecords: number;
    readonly recordsByResource: Readonly<Record<string, number>>;
  }>;
}> {
  const journal = createSqliteJournal({ file, durability: "strict", commit: "group" });
  const program = scaleApp.def.programs?.server;
  if (!program) throw new Error("The scale evidence app has no server Program.");
  let handle: ServerHandle | undefined;
  try {
    handle = serve(scaleApp, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      programs: [
        {
          env: "server",
          deps: { scale: {} },
          actor: { id: "evidence" },
          programId: "workflow-evidence",
        },
      ],
    });
    await handle.ready;
    const client = await connect(scaleApp, {
      wsUrl: new URL("/ws", handle.url).href.replace("http", "ws"),
      token: "evidence",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
    });
    await poll(() => client.connected);
    const apis = scaleApp.createAPIs({
      actor: { id: "evidence" },
      resolveResource(path, name) {
        const accessor = Reflect.get(client, featureResourceName(path, name));
        if (typeof accessor !== "function") {
          throw new Error(`Missing client Resource ${featureResourceName(path, name)}.`);
        }
        return accessor;
      },
    });
    const api = apis.features.scale?.api;
    if (!api) throw new Error("The scale evidence Feature API is unavailable.");
    let stopResult:
      | Promise<{
          readonly journalRecords: number;
          readonly recordsByResource: Readonly<Record<string, number>>;
        }>
      | undefined;
    return {
      api,
      stop() {
        stopResult ??= (async () => {
          client.dispose();
          await handle?.stop();
          let journalRecords = 0;
          const recordsByResource: Record<string, number> = {};
          for await (const record of journal.scan(0)) {
            journalRecords += 1;
            recordsByResource[record.address.resource] =
              (recordsByResource[record.address.resource] ?? 0) + 1;
          }
          await journal.close();
          return { journalRecords, recordsByResource };
        })();
        return stopResult;
      },
    };
  } catch (error) {
    await handle?.stop();
    await journal.close();
    throw error;
  }
}

async function runPersistentRuntimeSample(
  directory: string,
  mode: Mode,
  count: number,
  identity: number,
) {
  const file = join(directory, `${mode}-${identity}.sqlite`);
  const runtime = await createPersistentScaleRuntime(file);
  let sample:
    | {
        readonly elapsedMs: number;
        readonly transitions: number;
      }
    | undefined;
  let work:
    | {
        readonly journalRecords: number;
        readonly recordsByResource: Readonly<Record<string, number>>;
      }
    | undefined;
  try {
    const id = `${mode}-${count}-${identity}`;
    const started = performance.now();
    await runtime.api.send({ id, name: "scale/run", data: { count, mode } });
    const runId = `${id}:scale`;
    await poll(() => runtime.api.getFunction("scale", runId).run?.status === "completed", {
      timeoutMs: 120_000,
      intervalMs: 1,
    });
    const elapsedMs = performance.now() - started;
    const run = runtime.api.getFunction("scale", runId).run;
    if (run?.output?.total !== (count * (count - 1)) / 2) {
      throw new Error(`${mode} ${count} produced the wrong persistent result.`);
    }
    if (run.transitionCount !== 3 * count + 2) {
      throw new Error(
        `${mode} ${count} produced ${run.transitionCount} persistent transitions instead of ${3 * count + 2}.`,
      );
    }
    sample = { elapsedMs, transitions: run.transitionCount };
  } finally {
    work = await runtime.stop();
  }
  if (!sample || !work) throw new Error(`${mode} ${count} did not produce persistent evidence.`);
  const databaseBytes = Bun.file(file).size;
  return { ...sample, ...work, databaseBytes };
}

async function runPersistentRuntimeEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-persistent-"));
  try {
    const sizes = requestedSizes?.length ? requestedSizes : quick ? [0, 10] : [0, 10, 100, 1_000];
    const measuredSamples =
      Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 2 : 5;
    let identity = 0;
    for (const mode of ["sequential", "parallel"] satisfies Mode[]) {
      for (const count of sizes) {
        await runPersistentRuntimeSample(directory, mode, count, identity++);
        const samples = [];
        for (let index = 0; index < measuredSamples; index += 1) {
          samples.push(await runPersistentRuntimeSample(directory, mode, count, identity++));
        }
        const elapsed = samples
          .map(({ elapsedMs }) => elapsedMs)
          .sort((left, right) => left - right);
        emit({
          kind: "persistent-runtime",
          boundary: "SQLite FULL + server authority + WebSocket + client replica + Programs",
          durability: "power-safe",
          mode,
          operations: count,
          samples: measuredSamples,
          medianMs: percentile(elapsed, 0.5),
          p95Ms: percentile(elapsed, 0.95),
          rawMs: elapsed,
          transitions: samples[0]!.transitions,
          journalRecords: samples[0]!.journalRecords,
          recordsByResource: samples[0]!.recordsByResource,
          databaseBytes: samples[0]!.databaseBytes,
        });
      }
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

async function runPersistentRecoverySample(
  directory: string,
  mode: Mode,
  count: number,
  identity: number,
) {
  const file = join(directory, `recovery-${mode}-${identity}.sqlite`);
  const id = `recovery-${mode}-${count}-${identity}`;
  const runId = `${id}:scale`;
  const initial = await createPersistentScaleRuntime(file);
  await initial.api.send({ id, name: "scale/run", data: { count, mode } });
  await poll(() => initial.api.getFunction("scale", runId).run?.status === "completed", {
    timeoutMs: 120_000,
    intervalMs: 1,
  });
  await initial.stop();

  const entriesBefore = handlerEntries;
  const started = performance.now();
  const recovered = await createPersistentScaleRuntime(file);
  let work:
    | {
        readonly journalRecords: number;
        readonly recordsByResource: Readonly<Record<string, number>>;
      }
    | undefined;
  try {
    await poll(() => recovered.api.getFunction("scale", runId).run?.status === "completed", {
      timeoutMs: 120_000,
      intervalMs: 1,
    });
    const elapsedMs = performance.now() - started;
    const run = recovered.api.getFunction("scale", runId).run;
    if (
      run?.output?.total !== (count * (count - 1)) / 2 ||
      run.transitionCount !== 3 * count + 2 ||
      handlerEntries !== entriesBefore
    ) {
      throw new Error(`${mode} ${count} recovery changed completed workflow semantics.`);
    }
    work = await recovered.stop();
    return {
      elapsedMs,
      transitions: run.transitionCount,
      handlerEntries: handlerEntries - entriesBefore,
      journalRecords: work.journalRecords,
      recordsByResource: work.recordsByResource,
      databaseBytes: Bun.file(file).size,
    };
  } finally {
    if (!work) await recovered.stop();
  }
}

async function runPersistentRecoveryEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-recovery-"));
  try {
    const sizes = requestedSizes?.length ? requestedSizes : quick ? [0, 10] : [0, 10, 100, 1_000];
    const measuredSamples =
      Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 2 : 5;
    let identity = 0;
    for (const mode of ["sequential", "parallel"] satisfies Mode[]) {
      for (const count of sizes) {
        await runPersistentRecoverySample(directory, mode, count, identity++);
        const samples = [];
        for (let index = 0; index < measuredSamples; index += 1) {
          samples.push(await runPersistentRecoverySample(directory, mode, count, identity++));
        }
        const elapsed = samples
          .map(({ elapsedMs }) => elapsedMs)
          .sort((left, right) => left - right);
        emit({
          kind: "persistent-recovery",
          boundary:
            "SQLite FULL reopen + server startup + Program recovery + WebSocket + client projection",
          durability: "power-safe",
          mode,
          operations: count,
          samples: measuredSamples,
          medianMs: percentile(elapsed, 0.5),
          p95Ms: percentile(elapsed, 0.95),
          rawMs: elapsed,
          transitions: samples[0]!.transitions,
          handlerEntries: samples[0]!.handlerEntries,
          journalRecords: samples[0]!.journalRecords,
          recordsByResource: samples[0]!.recordsByResource,
          databaseBytes: samples[0]!.databaseBytes,
        });
      }
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

type ConcurrencyShape = "hot" | "independent";

async function runPersistentConcurrencySample(
  directory: string,
  shape: ConcurrencyShape,
  runs: number,
  identity: number,
) {
  const file = join(directory, `concurrency-${shape}-${identity}.sqlite`);
  const runtime = await createPersistentScaleRuntime(file);
  const operationsPerRun = 10;
  const entriesBefore = handlerEntries;
  const declarationsBefore = operationDeclarations;
  let work:
    | {
        readonly journalRecords: number;
        readonly recordsByResource: Readonly<Record<string, number>>;
      }
    | undefined;
  try {
    const events = Array.from({ length: runs }, (_, index) => ({
      id: `concurrency-${identity}-${index}`,
      name: "concurrency/run" as const,
      data: {
        count: operationsPerRun,
        lane: shape === "hot" ? "hot" : `lane-${index}`,
        mode: "parallel" as const,
      },
    }));
    const started = performance.now();
    await runtime.api.send(events);
    if (traceConcurrency) {
      emit({
        kind: "persistent-concurrency-phase",
        shape,
        runs,
        phase: "events-sent",
        elapsedMs: performance.now() - started,
      });
    }
    const handles = events.map(({ id }) =>
      runtime.api.getFunction("concurrent", `${id}:concurrent`),
    );
    if (traceConcurrency) {
      emit({
        kind: "persistent-concurrency-phase",
        shape,
        runs,
        phase: "handles-created",
        elapsedMs: performance.now() - started,
      });
    }
    const traceInterval = traceConcurrency
      ? setInterval(() => {
          const statuses: Record<string, number> = {};
          const detailStatuses: Record<string, number> = {};
          for (const { run } of handles) {
            const status = run?.status ?? "missing";
            statuses[status] = (statuses[status] ?? 0) + 1;
          }
          for (const handle of handles) {
            if (handle.run) continue;
            const status = handle.details?.status ?? "missing";
            detailStatuses[status] = (detailStatuses[status] ?? 0) + 1;
          }
          emit({
            kind: "persistent-concurrency-phase",
            shape,
            runs,
            phase: "progress",
            elapsedMs: performance.now() - started,
            statuses,
            detailStatuses,
          });
        }, 5_000)
      : undefined;
    try {
      await poll(() => handles.every(({ run }) => run?.status === "completed"), {
        timeoutMs:
          Number.isInteger(requestedTimeoutMs) && requestedTimeoutMs > 0
            ? requestedTimeoutMs
            : 180_000,
        intervalMs: 1,
      });
    } finally {
      if (traceInterval) clearInterval(traceInterval);
    }
    const elapsedMs = performance.now() - started;
    if (
      handles.some(
        ({ run }) =>
          run?.output?.total !== (operationsPerRun * (operationsPerRun - 1)) / 2 ||
          run.transitionCount !== 3 * operationsPerRun + 2,
      )
    ) {
      throw new Error(`${shape} ${runs} concurrent runs produced an invalid result.`);
    }
    const entries = handlerEntries - entriesBefore;
    const declarations = operationDeclarations - declarationsBefore;
    if (entries !== runs || declarations !== runs * operationsPerRun) {
      throw new Error(
        `${shape} ${runs} runs used ${entries} entries and ${declarations} declarations.`,
      );
    }
    work = await runtime.stop();
    return {
      elapsedMs,
      runs,
      operations: runs * operationsPerRun,
      handlerEntries: entries,
      operationDeclarations: declarations,
      transitions: runs * (3 * operationsPerRun + 2),
      journalRecords: work.journalRecords,
      recordsByResource: work.recordsByResource,
      databaseBytes: Bun.file(file).size,
    };
  } finally {
    if (!work) await runtime.stop();
  }
}

async function runPersistentConcurrencyEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-concurrency-"));
  try {
    const sizes = requestedSizes?.length ? requestedSizes : quick ? [1, 10] : [1, 10, 100, 1_000];
    const measuredSamples =
      Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 1 : 3;
    const warmups =
      Number.isInteger(requestedWarmups) && requestedWarmups >= 0 ? requestedWarmups : 1;
    let identity = 0;
    const shapes = requestedConcurrencyShapes?.length
      ? requestedConcurrencyShapes
      : (["hot", "independent"] satisfies ConcurrencyShape[]);
    for (const shape of shapes) {
      for (const runs of sizes) {
        for (let index = 0; index < warmups; index += 1) {
          await runPersistentConcurrencySample(directory, shape, runs, identity++);
        }
        const samples = [];
        for (let index = 0; index < measuredSamples; index += 1) {
          samples.push(await runPersistentConcurrencySample(directory, shape, runs, identity++));
        }
        const elapsed = samples
          .map(({ elapsedMs }) => elapsedMs)
          .sort((left, right) => left - right);
        emit({
          kind: "persistent-concurrency",
          boundary: "SQLite FULL + server authority + WebSocket + client projections + Programs",
          durability: "power-safe",
          shape,
          runs,
          operationsPerRun: 10,
          samples: measuredSamples,
          medianMs: percentile(elapsed, 0.5),
          p95Ms: percentile(elapsed, 0.95),
          p99Ms: percentile(elapsed, 0.99),
          rawMs: elapsed,
          handlerEntries: samples[0]!.handlerEntries,
          operationDeclarations: samples[0]!.operationDeclarations,
          transitions: samples[0]!.transitions,
          journalRecords: samples[0]!.journalRecords,
          recordsByResource: samples[0]!.recordsByResource,
          databaseBytes: samples[0]!.databaseBytes,
        });
      }
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

async function runPersistentPayloadSample(
  directory: string,
  payloadBytes: number,
  identity: number,
) {
  const file = join(directory, `payload-${payloadBytes}-${identity}.sqlite`);
  const runtime = await createPersistentScaleRuntime(file);
  let work:
    | {
        readonly journalRecords: number;
        readonly recordsByResource: Readonly<Record<string, number>>;
      }
    | undefined;
  try {
    const id = `payload-${payloadBytes}-${identity}`;
    const payload = "x".repeat(payloadBytes);
    const started = performance.now();
    await runtime.api.send({ id, name: "payload/run", data: { payload } });
    const handle = runtime.api.getFunction("payload", `${id}:payload`);
    await poll(() => handle.run?.status === "completed", { timeoutMs: 120_000, intervalMs: 1 });
    await poll(() => handle.details?.status === "completed", {
      timeoutMs: 120_000,
      intervalMs: 1,
    });
    const elapsedMs = performance.now() - started;
    if (
      handle.run?.output?.payload !== payload ||
      handle.details?.operations.roundtrip?.result !== payload
    ) {
      throw new Error(`${payloadBytes}-byte payload did not survive every durable projection.`);
    }
    work = await runtime.stop();
    return {
      elapsedMs,
      payloadBytes,
      transitions: handle.run.transitionCount,
      journalRecords: work.journalRecords,
      databaseBytes: Bun.file(file).size,
    };
  } finally {
    if (!work) await runtime.stop();
  }
}

async function runPersistentPayloadEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-payload-"));
  try {
    const sizes = requestedSizes?.length
      ? requestedSizes
      : quick
        ? [0, 4_096]
        : [0, 128, 4_096, 65_536, 262_144];
    const measuredSamples =
      Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 1 : 3;
    let identity = 0;
    for (const payloadBytes of sizes) {
      await runPersistentPayloadSample(directory, payloadBytes, identity++);
      const samples = [];
      for (let index = 0; index < measuredSamples; index += 1) {
        samples.push(await runPersistentPayloadSample(directory, payloadBytes, identity++));
      }
      const elapsed = samples.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
      emit({
        kind: "persistent-payload",
        boundary: "event + durable operation result + function output + client details projection",
        durability: "power-safe",
        payloadBytes,
        samples: measuredSamples,
        medianMs: percentile(elapsed, 0.5),
        p95Ms: percentile(elapsed, 0.95),
        p99Ms: percentile(elapsed, 0.99),
        rawMs: elapsed,
        transitions: samples[0]!.transitions,
        journalRecords: samples[0]!.journalRecords,
        databaseBytes: samples[0]!.databaseBytes,
      });
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

async function runPersistentBehaviorSample(directory: string, identity: number) {
  const file = join(directory, `behavior-${identity}.sqlite`);
  const runtime = await createPersistentScaleRuntime(file);
  let work:
    | {
        readonly journalRecords: number;
        readonly recordsByResource: Readonly<Record<string, number>>;
      }
    | undefined;
  try {
    const started = performance.now();
    const behaviorEventId = `behavior-${identity}`;
    const behaviorRunId = `${behaviorEventId}:behavior`;
    behaviorRetryAttempts.delete(behaviorEventId);
    await runtime.api.send({
      id: behaviorEventId,
      name: "behavior/run",
      data: { id: behaviorEventId, count: 32 },
    });
    const behavior = runtime.api.getFunction("behavior", behaviorRunId);
    await poll(() => behavior.details?.operations.release?.status === "scheduled", {
      timeoutMs: 30_000,
      intervalMs: 1,
    });
    await runtime.api.send({
      id: `release-${identity}`,
      name: "behavior/release",
      data: { id: behaviorEventId },
    });
    await poll(() => behavior.run?.status === "completed", {
      timeoutMs: 30_000,
      intervalMs: 1,
    });
    await poll(() => behavior.details?.status === "completed", {
      timeoutMs: 30_000,
      intervalMs: 1,
    });

    const cancelEventId = `cancel-${identity}`;
    const cancelled = runtime.api.getFunction("cancel", `${cancelEventId}:cancel`);
    await runtime.api.send({
      id: cancelEventId,
      name: "cancel/run",
      data: { id: cancelEventId },
    });
    await poll(() => cancelled.details?.operations.wait?.status === "scheduled", {
      timeoutMs: 30_000,
      intervalMs: 1,
    });
    await cancelled.cancel("evidence_cancel");
    await poll(() => cancelled.run?.status === "cancelled", {
      timeoutMs: 30_000,
      intervalMs: 1,
    });

    const firstBatchId = `batch-a-${identity}`;
    await runtime.api.send([
      {
        id: firstBatchId,
        name: "batch/run",
        data: { group: `group-${identity}`, value: 20 },
      },
      {
        id: `batch-b-${identity}`,
        name: "batch/run",
        data: { group: `group-${identity}`, value: 22 },
      },
    ]);
    const batch = runtime.api.getFunction("batch", `${firstBatchId}:batch:batch`);
    await poll(() => batch.run?.status === "completed", {
      timeoutMs: 30_000,
      intervalMs: 1,
    });
    const elapsedMs = performance.now() - started;

    const behaviorOutput = behavior.run?.output;
    if (
      behaviorOutput?.child !== `child:${behaviorEventId}` ||
      behaviorOutput.release !== behaviorEventId ||
      behaviorOutput.retry !== `retry:${behaviorEventId}` ||
      behaviorOutput.total !== 496 ||
      behaviorRetryAttempts.get(behaviorEventId) !== 2 ||
      behavior.details?.operations.timer?.status !== "succeeded" ||
      behavior.details.operations.release?.status !== "succeeded" ||
      behavior.details.operations.retry?.status !== "succeeded" ||
      behavior.details.operations.child?.status !== "succeeded" ||
      behavior.details.operations["fan:31"]?.status !== "succeeded"
    ) {
      throw new Error(
        `Persistent behavior run was incomplete: ${JSON.stringify(behavior.details)}.`,
      );
    }
    const behaviorExecution = behavior.run;
    const cancelledExecution = cancelled.run;
    const batchExecution = batch.run;
    if (!behaviorExecution || !cancelledExecution || !batchExecution) {
      throw new Error("Persistent behavior evidence has a missing execution projection.");
    }
    if (cancelledExecution.error !== "evidence_cancel") {
      throw new Error(`Persistent cancellation produced ${JSON.stringify(cancelledExecution)}.`);
    }
    if (batchExecution.output?.count !== 2 || batchExecution.output.total !== 42) {
      throw new Error(`Persistent batch produced ${JSON.stringify(batchExecution)}.`);
    }

    work = await runtime.stop();
    return {
      elapsedMs,
      behaviorTransitions: behaviorExecution.transitionCount,
      cancellationTransitions: cancelledExecution.transitionCount,
      batchTransitions: batchExecution.transitionCount,
      journalRecords: work.journalRecords,
      recordsByResource: work.recordsByResource,
      databaseBytes: Bun.file(file).size,
    };
  } finally {
    if (!work) await runtime.stop();
  }
}

async function runPersistentBehaviorEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-behavior-"));
  try {
    const measuredSamples =
      Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 1 : 3;
    let identity = 0;
    await runPersistentBehaviorSample(directory, identity++);
    const samples = [];
    for (let index = 0; index < measuredSamples; index += 1) {
      samples.push(await runPersistentBehaviorSample(directory, identity++));
    }
    const elapsed = samples.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
    emit({
      kind: "persistent-behavior",
      boundary: "SQLite FULL + server authority + WebSocket + client projections + Programs",
      durability: "power-safe",
      workloads: [
        "timer",
        "wait",
        "retry",
        "child",
        "fan-out/fan-in",
        "cancellation",
        "timed batch",
      ],
      fanOut: 32,
      samples: measuredSamples,
      medianMs: percentile(elapsed, 0.5),
      p95Ms: percentile(elapsed, 0.95),
      p99Ms: percentile(elapsed, 0.99),
      rawMs: elapsed,
      behaviorTransitions: samples[0]!.behaviorTransitions,
      cancellationTransitions: samples[0]!.cancellationTransitions,
      batchTransitions: samples[0]!.batchTransitions,
      journalRecords: samples[0]!.journalRecords,
      recordsByResource: samples[0]!.recordsByResource,
      databaseBytes: samples[0]!.databaseBytes,
    });
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

type CrashContract = {
  Events: { "crash/run": { id: string } };
  Functions: { crash: { Input: { id: string }; Output: { value: string } } };
  Dependencies: {
    work: { execute(id: string, idempotencyKey: string): Promise<string> };
  };
};
type CrashApp = {
  Actor: { id: string };
  Resources: {};
  Features: { crash: FunctionsFeature<CrashContract> };
};
type CrashMarker = {
  readonly attempts: readonly string[];
  readonly effects: Readonly<Record<string, string>>;
};
type CrashPhase = "crash" | "recover";

function readCrashMarker(file: string): CrashMarker {
  if (!existsSync(file)) return { attempts: [], effects: {} };
  const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!value || typeof value !== "object" || !("attempts" in value) || !("effects" in value)) {
    throw new Error("The external-effect marker is invalid.");
  }
  const { attempts, effects } = value;
  if (
    !Array.isArray(attempts) ||
    !attempts.every((attempt) => typeof attempt === "string") ||
    !effects ||
    typeof effects !== "object" ||
    !Object.values(effects).every((effect) => typeof effect === "string")
  ) {
    throw new Error("The external-effect marker has an invalid shape.");
  }
  return { attempts, effects: effects as Readonly<Record<string, string>> };
}

function writeCrashMarker(file: string, marker: CrashMarker): void {
  const descriptor = openSync(file, "w");
  try {
    writeFileSync(descriptor, `${JSON.stringify(marker)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function createPersistentCrashRuntime(file: string, markerFile: string, phase: CrashPhase) {
  let handlerEntries = 0;
  const work: CrashContract["Dependencies"]["work"] = {
    async execute(id, idempotencyKey) {
      const marker = readCrashMarker(markerFile);
      const value = marker.effects[idempotencyKey] ?? `committed:${id}`;
      writeCrashMarker(markerFile, {
        attempts: [...marker.attempts, idempotencyKey],
        effects: { ...marker.effects, [idempotencyKey]: value },
      });
      if (phase === "crash") {
        process.kill(process.pid, "SIGKILL");
        await new Promise<never>(() => undefined);
      }
      return value;
    },
  };
  const feature = createFunctions<CrashApp, CrashContract>(
    { appVersion: "crash-v1", dependencies: { work } },
    ({ createFunction, dependencies }) => {
      createFunction(
        { id: "crash", triggers: { event: "crash/run" }, retries: 0 },
        async ({ event, runId, step }) => {
          handlerEntries += 1;
          const value = await step.run("external", () =>
            dependencies.work.execute(event.data.id, `${runId}:external`),
          );
          return { value };
        },
      );
    },
  );
  const app = defineApp<CrashApp>({
    version: 1,
    resources: {},
    features: { crash: feature },
  });
  const journal = createSqliteJournal({ file, durability: "strict", commit: "group" });
  const program = app.def.programs?.server;
  if (!program) throw new Error("The crash evidence app has no server Program.");
  let handle: ServerHandle | undefined;
  try {
    handle = serve(app, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      programs: [
        {
          env: "server",
          deps: { crash: { work } },
          actor: { id: "evidence" },
          programId: "workflow-crash-evidence",
        },
      ],
    });
    await handle.ready;
    const client = await connect(app, {
      wsUrl: new URL("/ws", handle.url).href.replace("http", "ws"),
      token: "evidence",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
    });
    await poll(() => client.connected);
    const api = app.createAPIs({
      actor: { id: "evidence" },
      resolveResource(path, name) {
        const accessor = Reflect.get(client, featureResourceName(path, name));
        if (typeof accessor !== "function") {
          throw new Error(`Missing client Resource ${featureResourceName(path, name)}.`);
        }
        return accessor;
      },
    }).features.crash.api;
    let stopped = false;
    return {
      api,
      handlerEntries: () => handlerEntries,
      async stop() {
        if (stopped) return;
        stopped = true;
        client.dispose();
        await handle?.stop();
        await journal.close();
      },
    };
  } catch (error) {
    await handle?.stop();
    await journal.close();
    throw error;
  }
}

async function runCrashRecoveryChild(): Promise<void> {
  const file = process.argv[3];
  const markerFile = process.argv[4];
  const phase = process.argv[5] as CrashPhase | undefined;
  if (!file || !markerFile || (phase !== "crash" && phase !== "recover")) {
    throw new TypeError("Crash child requires a Journal, marker, and crash/recover phase.");
  }
  const runtime = await createPersistentCrashRuntime(file, markerFile, phase);
  if (phase === "crash") {
    await runtime.api.send({ id: "effect", name: "crash/run", data: { id: "one" } });
    await new Promise<never>(() => undefined);
  }
  try {
    await poll(() => runtime.api.getFunction("crash", "effect:crash").run?.status === "completed", {
      timeoutMs: 120_000,
      intervalMs: 1,
    });
    await poll(
      () => runtime.api.getFunction("crash", "effect:crash").details?.status === "completed",
      { timeoutMs: 120_000, intervalMs: 1 },
    );
    const handle = runtime.api.getFunction("crash", "effect:crash");
    const marker = readCrashMarker(markerFile);
    console.log(
      JSON.stringify({
        kind: "crash-child-recovered",
        output: handle.run?.output,
        status: handle.run?.status,
        transitions: handle.run?.transitionCount,
        uncertainAttempts: handle.details?.operations.external?.uncertainAttempts ?? [],
        handlerEntries: runtime.handlerEntries(),
        attempts: marker.attempts,
        sideEffects: Object.keys(marker.effects).length,
      }),
    );
  } finally {
    await runtime.stop();
  }
}

async function spawnCrashChild(
  file: string,
  markerFile: string,
  phase: CrashPhase,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn(
    [process.execPath, import.meta.path, "crash-child", file, markerFile, phase],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function runPersistentCrashRecoveryEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-crash-"));
  try {
    const file = join(directory, "journal.sqlite");
    const marker = join(directory, "external-effect.json");
    const crashed = await spawnCrashChild(file, marker, "crash");
    if (crashed.exitCode === 0) {
      throw new Error(`The crash worker exited normally.\n${crashed.stdout}\n${crashed.stderr}`);
    }
    const started = performance.now();
    const recovered = await spawnCrashChild(file, marker, "recover");
    const elapsedMs = performance.now() - started;
    if (recovered.exitCode !== 0) {
      throw new Error(`The recovery worker failed.\n${recovered.stdout}\n${recovered.stderr}`);
    }
    const result = recovered.stdout
      .trim()
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as { readonly kind?: string };
        } catch {
          return {};
        }
      })
      .find(({ kind }) => kind === "crash-child-recovered") as
      | {
          readonly output?: unknown;
          readonly status?: string;
          readonly transitions?: number;
          readonly uncertainAttempts?: readonly number[];
          readonly handlerEntries?: number;
          readonly attempts?: readonly string[];
          readonly sideEffects?: number;
        }
      | undefined;
    if (
      result?.status !== "completed" ||
      JSON.stringify(result.output) !== JSON.stringify({ value: "committed:one" }) ||
      JSON.stringify(result.uncertainAttempts) !== JSON.stringify([1]) ||
      result.handlerEntries !== 1 ||
      result.attempts?.length !== 2 ||
      new Set(result.attempts).size !== 1 ||
      result.sideEffects !== 1
    ) {
      throw new Error(`Crash recovery violated effect semantics: ${JSON.stringify(result)}.`);
    }
    emit({
      ...result,
      kind: "persistent-crash-recovery",
      boundary: "SIGKILL during external effect + SQLite FULL reopen + Program recovery",
      elapsedMs,
    });
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

type AdmissionContract = {
  Events: {
    "admission/run": { id: number };
    "admission/release": { id: number };
  };
  Functions: {
    queue: {
      Input: { id: number };
      Output: { id: number };
    };
  };
  Dependencies: {};
};
type AdmissionApp = {
  Actor: { id: string };
  Resources: {};
  Features: { admission: FunctionsFeature<AdmissionContract> };
};

const admissionEntered = new Set<string>();

const admissionFeature = createFunctions<AdmissionApp, AdmissionContract>(
  { dependencies: {} },
  ({ createFunction }) => {
    createFunction(
      {
        id: "queue",
        triggers: { event: "admission/run" },
        concurrency: 1,
        cancelOn: [{ event: "admission/release", match: "data.id" }],
        retries: 0,
      },
      async ({ event, runId, step }) => {
        await step.run("hold", () => {
          admissionEntered.add(runId);
          return new Promise<null>(() => {});
        });
        return { id: event.data.id };
      },
    );
  },
);
const admissionApp = defineApp<AdmissionApp>({
  version: 1,
  resources: {},
  features: { admission: admissionFeature },
});

async function runAdmissionSample(count: number, identity: number) {
  const fixture = await testFeature(admissionApp, "admission", {
    actor: { id: `admission-${identity}` },
  });
  const events = Array.from({ length: count }, (_, index) => ({
    id: `${identity}-${index}`,
    name: "admission/run" as const,
    data: { id: index },
  }));
  let indexed = 0;
  const stopObserving = fixture.observeEvents(({ resource, event }) => {
    if (!resource.endsWith("/index") || event.name !== "changed") return;
    const payload = event.payload as { readonly type?: string; readonly active?: boolean };
    if (payload.type === "run" && payload.active === true) indexed += 1;
  });
  const started = performance.now();
  await fixture.api.send(events);
  const runIds = events.map(({ id }) => `${id}:queue`);
  await poll(() => indexed === count && admissionEntered.size === 1, { intervalMs: 0 });
  const elapsedMs = performance.now() - started;
  stopObserving();
  const running = runIds.filter(
    (id) => fixture.api.getFunction("queue", id).run?.status === "running",
  ).length;
  const executing = runIds.filter((id) => admissionEntered.has(id)).length;
  if (running !== count) throw new Error(`Expected ${count} started runs, received ${running}.`);
  if (executing !== 1) throw new Error(`Expected one admitted step, received ${executing}.`);
  await fixture.dispose();
  for (const id of runIds) {
    admissionEntered.delete(id);
  }
  return { elapsedMs, executing, queued: count - executing, running };
}

async function runAdmissionEvidence(): Promise<void> {
  const sizes = requestedSizes?.length
    ? requestedSizes
    : quick
      ? [10, 100, 1_000]
      : [10, 100, 1_000, 10_000];
  const measuredSamples =
    Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 2 : 5;
  let identity = 0;
  for (const count of sizes) {
    await runAdmissionSample(count, identity++);
    const samples = [];
    for (let index = 0; index < measuredSamples; index += 1) {
      samples.push(await runAdmissionSample(count, identity++));
    }
    const elapsed = samples.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
    emit({
      kind: "admission",
      boundary: "in-memory semantic Resource/Program host",
      policy: "global concurrency=1 with one active execution segment",
      submissions: count,
      samples: measuredSamples,
      medianMs: percentile(elapsed, 0.5),
      p95Ms: percentile(elapsed, 0.95),
      rawMs: elapsed,
      activeRuns: samples[0]!.running,
      activeSteps: samples[0]!.executing,
      queuedSteps: samples[0]!.queued,
    });
  }

  if (skipDrain) return;
  const drainSizes = requestedSizes?.length ? requestedSizes : quick ? [10, 100] : [10, 100, 1_000];
  const drainSamples =
    Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 2 : 3;
  for (const count of drainSizes) {
    await runAdmissionDrainSample(count, identity++);
    const samples = [];
    for (let index = 0; index < drainSamples; index += 1) {
      samples.push(await runAdmissionDrainSample(count, identity++));
    }
    const elapsed = samples.sort((left, right) => left - right);
    emit({
      kind: "admission-drain",
      boundary: "in-memory semantic Resource/Program host",
      policy: "global step concurrency=1 with correlated cancellation",
      releases: count,
      samples: drainSamples,
      medianMs: percentile(elapsed, 0.5),
      p95Ms: percentile(elapsed, 0.95),
      rawMs: elapsed,
    });
  }
}

async function runAdmissionDrainSample(count: number, identity: number): Promise<number> {
  const fixture = await testFeature(admissionApp, "admission", {
    actor: { id: `admission-drain-${identity}` },
  });
  const events = Array.from({ length: count }, (_, index) => ({
    id: `${identity}-${index}`,
    name: "admission/run" as const,
    data: { id: index },
  }));
  await fixture.api.send(events);
  const runIds = events.map(({ id }) => `${id}:queue`);
  await poll(() => runIds.filter((id) => admissionEntered.has(id)).length === 1, {
    intervalMs: 0,
  });
  const started = performance.now();
  for (let index = 0; index < count; index += 1) {
    await fixture.api.send({
      id: `${identity}-release-${index}`,
      name: "admission/release",
      data: { id: index },
    });
    await poll(
      () =>
        fixture.api.getFunction("queue", runIds[index]!).run?.status === "cancelled" &&
        (index === count - 1 || admissionEntered.has(runIds[index + 1]!)),
      { intervalMs: 0 },
    );
  }
  const elapsedMs = performance.now() - started;
  const final = fixture.api.getFunction("queue", `${identity}-${count - 1}:queue`).run;
  if (final?.status !== "cancelled") {
    throw new Error(`Expected the final admitted run to be cancelled, received ${final?.status}.`);
  }
  await fixture.dispose();
  for (const id of runIds) {
    admissionEntered.delete(id);
  }
  return elapsedMs;
}

type TypeMetrics = {
  instantiations: number;
  checkMs: number;
  totalMs: number;
  memoryMb: number;
};

type TypeScriptCompiler = {
  executable: string;
  version: string;
};

async function runTypeEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-evidence-"));
  try {
    const packageDirectory = resolve(import.meta.dir, "..");
    await runProcess(["bun", "run", "build"], packageDirectory);
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: {
          "@poggers/kit": `file:${packageDirectory}`,
          inngest: inngestVersion,
          typescript: typescriptVersion,
        },
      }),
    );
    await runProcess(["bun", "install", "--no-progress"], directory);
    const compiler = await resolveTypeScriptCompiler(directory);
    emit({
      kind: "type-environment",
      compiler: "typescript",
      version: compiler.version,
      executable: "node_modules/typescript/bin/tsc",
    });
    const sizes = requestedSizes?.length ? requestedSizes : quick ? [1, 100] : [1, 100, 500, 1_000];
    const runs =
      Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 1 : 3;
    for (const size of sizes) {
      await Promise.all([
        Bun.write(join(directory, `poggers-${size}.ts`), createPoggersTypeFixture(size)),
        Bun.write(join(directory, `poggers-split-${size}.ts`), createPoggersSplitTypeFixture(size)),
        Bun.write(join(directory, `poggers-features-${size}.ts`), createFeatureTypeFixture(size)),
        Bun.write(join(directory, `inngest-${size}.ts`), createInngestTypeFixture(size)),
      ]);
      for (const platform of ["poggers", "poggers-split", "poggers-features", "inngest"] as const) {
        const samples: TypeMetrics[] = [];
        for (let index = 0; index < runs; index += 1) {
          samples.push(await compileTypeFixture(directory, `${platform}-${size}.ts`, compiler));
        }
        emit({
          kind: "types",
          platform,
          functions: size,
          samples: runs,
          instantiations: median(samples.map(({ instantiations }) => instantiations)),
          checkMs: median(samples.map(({ checkMs }) => checkMs)),
          totalMs: median(samples.map(({ totalMs }) => totalMs)),
          memoryMb: median(samples.map(({ memoryMb }) => memoryMb)),
          raw: samples,
        });
      }
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

function createFeatureTypeFixture(size: number): string {
  const mounts = lines(size, (index) => `    feature${index}: CounterFeature;`);
  const definitions = lines(size, (index) => `    feature${index}: counter,`);
  return `import type { AppDef, Submission, FeatureDef } from "@poggers/kit";

type CounterFeature = {
  Resources: {
    counters: {
      Key: string;
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: { increment: { Input: { by: number }; Event: "incremented" } };
    };
  };
  Components: {};
  Dependencies: { server: { clock: { now(): number } } };
  Programs: { server: { initialize: {} } };
  API: {
    counter(id: string): {
      readonly count: number;
      increment(input: { by: number }): Submission;
    };
  };
};

type App = {
  Actor: { id: string };
  Resources: {};
  Features: {
${mounts}
  };
  API: { readonly mounted: number };
};

const counter = {
  resources: {
    counters: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
        },
      },
      views: { count: ({ state }) => state.count },
      commands: {
        increment(context, { by }) {
          context.event.incremented({ by });
        },
      },
    },
  },
  features: {},
  dependencies: { server: { clock: { now: () => 1 } } },
  programs: {
    server: {
      initialize({ api }, { clock }) {
        void api.counter("evidence").increment({ by: clock.now() });
      },
    },
  },
  api: ({ resources }) => ({
    counter(id) {
      const resource = resources.counters(id);
      return {
        get count() {
          return resource.count;
        },
        increment: resource.increment,
      };
    },
  }),
  components: {},
} satisfies FeatureDef<App, CounterFeature>;

export const app = {
  version: 1,
  resources: {},
  features: {
${definitions}
  },
  api: () => ({ mounted: ${size} }),
} satisfies AppDef<App>;
`;
}

function createPoggersSplitTypeFixture(size: number): string {
  const events = lines(size, (index) => `    "event/${index}": { id: string; value: number };`);
  const functions = lines(
    size,
    (index) =>
      `    fn${index}: { Input: { id: string; value: number }; Output: { value: number } };`,
  );
  const groupSize = 50;
  const groups = Array.from({ length: Math.ceil(size / groupSize) }, (_, group) => {
    const start = group * groupSize;
    const end = Math.min(size, start + groupSize);
    const definitions = Array.from(
      { length: end - start },
      (_, offset) => `  createFunction(
    { id: "fn${start + offset}", triggers: { event: "event/${start + offset}" } },
    async ({ event, step }) => ({
      value: await step.run("compute", () => event.data.value + 1),
    }),
  );`,
    ).join("\n");
    return `function define${group}(createFunction: CreateFunction<Contract>): void {
${definitions}
}`;
  });
  const calls = groups.map((_, index) => `    define${index}(createFunction);`).join("\n");
  return `import { createFunctions, type CreateFunction, type FunctionsFeature } from "@poggers/kit";

type Contract = {
  Events: {
${events}
  };
  Functions: {
${functions}
  };
  Dependencies: {};
};
type App = {
  Actor: { id: string };
  Resources: {};
  Features: { workflows: FunctionsFeature<Contract> };
};
${groups.join("\n\n")}
export const feature = createFunctions<App, Contract>(
  { dependencies: {} },
  ({ createFunction }) => {
${calls}
  },
);
`;
}

async function runInngestTestEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-inngest-test-evidence-"));
  try {
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: {
          "@inngest/test": inngestTestVersion,
          inngest: inngestVersion,
        },
      }),
    );
    await Bun.write(join(directory, "run.ts"), inngestTestRunner);
    await runProcess(["bun", "install", "--no-progress"], directory);
    const cases = quick
      ? ([
          ["sequential", 10],
          ["parallel", 10],
        ] as const)
      : ([
          ["sequential", 0],
          ["sequential", 10],
          ["sequential", 100],
          ["parallel", 10],
          ["parallel", 100],
        ] as const);
    for (const [mode, count] of cases) {
      const result = await runProcessWithTimeout(
        ["bun", "run.ts", mode, String(count), quick ? "2" : count === 100 ? "5" : "15"],
        directory,
        quick ? 15_000 : 30_000,
      );
      if (result === null) {
        emit({
          kind: "upstream-test-engine",
          platform: "inngest",
          mode,
          operations: count,
          status: "timed_out",
        });
      } else {
        emit(JSON.parse(result.trim()) as unknown);
      }
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

async function runInngestServerEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-inngest-server-evidence-"));
  try {
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        type: "module",
        dependencies: { inngest: inngestVersion },
      }),
    );
    await Bun.write(join(directory, "run.ts"), inngestServerRunner);
    await runProcess(["bun", "install", "--no-progress"], directory);
    const binary = await downloadInngestServer(directory);
    const sizes = requestedSizes?.length ? requestedSizes : quick ? [0, 10] : [0, 10, 100, 1_000];
    const samples =
      Number.isInteger(requestedSamples) && requestedSamples > 0 ? requestedSamples : quick ? 2 : 5;
    for (const mode of ["sequential", "parallel"] satisfies Mode[]) {
      for (const count of sizes) {
        let output: string | null;
        try {
          output = await runProcessWithTimeout(
            [
              "bun",
              "run.ts",
              binary,
              mode,
              String(count),
              String(samples),
              join(directory, `state-${mode}-${count}`),
            ],
            directory,
            count >= 1_000 ? 300_000 : 120_000,
          );
        } catch (error) {
          if (!String(error).includes("Timed out waiting for Inngest function completion.")) {
            throw error;
          }
          output = null;
        }
        if (output === null) {
          emit({
            kind: "upstream-server",
            platform: "inngest",
            mode,
            operations: count,
            status: "timed_out",
          });
          continue;
        }
        const line = output
          .trim()
          .split("\n")
          .reverse()
          .find((candidate) => candidate.startsWith('{"kind":"upstream-server"'));
        if (!line) throw new Error(`Inngest server runner produced no result:\n${output}`);
        emit(JSON.parse(line) as unknown);
      }
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

async function downloadInngestServer(directory: string): Promise<string> {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error(`Pinned Inngest evidence does not support ${process.platform}.`);
  }
  const architecture = process.arch === "x64" ? "amd64" : process.arch;
  if (architecture !== "amd64" && architecture !== "arm64") {
    throw new Error(`Pinned Inngest evidence does not support ${process.arch}.`);
  }
  const archive = `inngest_${inngestServerVersion}_${process.platform}_${architecture}.tar.gz`;
  const checksums: Readonly<Record<string, string>> = {
    "inngest_1.37.0_darwin_amd64":
      "d187f4e74400d91b4dc07c3d08c7a8dd89d1a7bda7edb8aee10efd73000cfa96",
    "inngest_1.37.0_darwin_arm64":
      "3f5dfe9d5b442d4b0b675cd35fce9b2ee84927bf0f55dff173af30e9cf2dd459",
    "inngest_1.37.0_linux_amd64":
      "5edfde6efd97a56dece2ec0d20e2abca2b609af13ba93f0564296688fdaa88b9",
    "inngest_1.37.0_linux_arm64":
      "86ea700743d8514b65abf148b11878bb60bbd24a576c3c3a8814ef533fbbe308",
  };
  const checksum = checksums[archive.slice(0, -".tar.gz".length)];
  if (!checksum) throw new Error(`No checksum is pinned for ${archive}.`);
  const response = await fetch(
    `https://github.com/inngest/inngest/releases/download/v${inngestServerVersion}/${archive}`,
  );
  if (!response.ok) throw new Error(`Unable to download ${archive}: ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (actual !== checksum) throw new Error(`Checksum mismatch for ${archive}.`);
  const archivePath = join(directory, archive);
  await Bun.write(archivePath, bytes);
  await runProcess(["tar", "-xzf", archivePath, "-C", directory], directory);
  const binary = join(directory, "inngest");
  await runProcess(["chmod", "+x", binary], directory);
  return binary;
}

const inngestTestRunner = `import { InngestTestEngine } from "@inngest/test";
import { ConsoleLogger, Inngest, eventType, staticSchema } from "inngest";

const mode = process.argv[2] as "sequential" | "parallel";
const count = Number(process.argv[3]);
const samples = Number(process.argv[4]);
const client = new Inngest({ id: "evidence", logger: new ConsoleLogger({ level: "silent" }) });
const trigger = eventType("scale/run", {
  schema: staticSchema<{ count: number; mode: "sequential" | "parallel" }>(),
});
const fn = client.createFunction(
  { id: "scale", triggers: [trigger], retries: 0 },
  async ({ event, step }) => {
    if (event.data.mode === "parallel") {
      const values = await Promise.all(
        Array.from({ length: event.data.count }, (_, index) =>
          step.run(\`step-\${index}\`, () => index),
        ),
      );
      return values.reduce((total, value) => total + value, 0);
    }
    let total = 0;
    for (let index = 0; index < event.data.count; index += 1) {
      total += await step.run(\`step-\${index}\`, () => index);
    }
    return total;
  },
);
const engine = new InngestTestEngine({ function: fn });
async function execute(id: number) {
  const result = await engine.execute({
    events: [{ id: String(id), name: "scale/run", data: { count, mode }, ts: id }],
  });
  if (result.error || result.result === undefined) throw result.error ?? new Error("missing result");
}
await execute(-1);
const elapsed: number[] = [];
for (let index = 0; index < samples; index += 1) {
  const start = performance.now();
  await execute(index);
  elapsed.push(performance.now() - start);
}
elapsed.sort((left, right) => left - right);
const percentile = (value: number) =>
  elapsed[Math.min(elapsed.length - 1, Math.ceil(elapsed.length * value) - 1)] ?? 0;
console.log(JSON.stringify({
  kind: "upstream-test-engine",
  boundary: "InngestTestEngine",
  platform: "inngest",
  mode,
  operations: count,
  samples,
  medianMs: percentile(0.5),
  p95Ms: percentile(0.95),
  rawMs: elapsed,
}));
`;

const inngestServerRunner = `import { ConsoleLogger, Inngest, eventType, staticSchema } from "inngest";
import { serve } from "inngest/bun";

const [binary, mode, countValue, samplesValue, stateDirectory] = process.argv.slice(2);
if (!binary || !stateDirectory || (mode !== "sequential" && mode !== "parallel")) {
  throw new TypeError("Invalid Inngest server evidence arguments.");
}
const count = Number(countValue);
const samples = Number(samplesValue);
const pending = new Map<string, (value: number) => void>();
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const serverPort = reservation.port;
reservation.stop(true);
const client = new Inngest({
  id: "evidence",
  baseUrl: "http://127.0.0.1:" + serverPort,
  eventKey: "evidence",
  isDev: true,
  logger: new ConsoleLogger({ level: "silent" }),
});
const trigger = eventType("scale/run", {
  schema: staticSchema<{ count: number; mode: "sequential" | "parallel" }>(),
});
const fn = client.createFunction(
  { id: "scale", triggers: [trigger], retries: 0 },
  async ({ event, step }) => {
    let total = 0;
    if (event.data.mode === "parallel") {
      const values = await Promise.all(
        Array.from({ length: event.data.count }, (_, index) =>
          step.run("step-" + index, () => index),
        ),
      );
      total = values.reduce((sum, value) => sum + value, 0);
    } else {
      for (let index = 0; index < event.data.count; index += 1) {
        total += await step.run("step-" + index, () => index);
      }
    }
    pending.get(event.id)?.(total);
    return { total };
  },
);
const handler = serve({ client, functions: [fn] });
const appServer = Bun.serve({
  port: 0,
  fetch(request) {
    return new URL(request.url).pathname === "/api/inngest"
      ? handler(request)
      : new Response("Not found", { status: 404 });
  },
});
const cli = Bun.spawn(
  [
    binary,
    "dev",
    "--no-discovery",
    "--no-poll",
    "--port=" + serverPort,
    "--sdk-url=http://127.0.0.1:" + appServer.port + "/api/inngest",
    "--persist",
    "--sqlite-dir=" + stateDirectory,
    "--tick=1",
    "--queue-workers=100",
  ],
  {
    env: {
      ...process.env,
      INNGEST_TELEMETRY_DISABLED: "1",
      LOG_LEVEL: "error",
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
);
const cliStdout = new Response(cli.stdout).text();
const cliStderr = new Response(cli.stderr).text();

async function waitForRegistration(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:" + serverPort + "/dev");
      if (response.ok) {
        const info = (await response.json()) as { functions?: readonly { id?: string }[] };
        if ((info.functions?.length ?? 0) > 0) return;
      }
    } catch {}
    if ((await Promise.race([cli.exited, Bun.sleep(25).then(() => null)])) !== null) break;
    await Bun.sleep(25);
  }
  throw new Error("Pinned Inngest Dev Server did not register the evidence function.");
}

async function execute(identity: string): Promise<number> {
  let resolve!: (value: number) => void;
  const completed = new Promise<number>((done) => (resolve = done));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Timed out waiting for Inngest function completion.")),
      90_000,
    );
  });
  pending.set(identity, resolve);
  const started = performance.now();
  try {
    await client.send({ id: identity, name: "scale/run", data: { count, mode } });
    const total = await Promise.race([completed, timedOut]);
    if (total !== (count * (count - 1)) / 2) throw new Error("Inngest produced the wrong result.");
    return performance.now() - started;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    pending.delete(identity);
  }
}

let succeeded = false;
try {
  await waitForRegistration();
  await execute("warmup");
  const elapsed: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    elapsed.push(await execute("sample-" + index));
  }
  elapsed.sort((left, right) => left - right);
  const percentile = (value: number) =>
    elapsed[Math.min(elapsed.length - 1, Math.ceil(elapsed.length * value) - 1)] ?? 0;
  console.log(JSON.stringify({
    kind: "upstream-server",
    boundary: "Inngest Dev Server 1.37.0 + official Bun SDK 4.12.1 + persisted SQLite history/config + periodically snapshotted in-memory run state",
    durability: "not power-safe per operation",
    platform: "inngest",
    mode,
    operations: count,
    samples,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    rawMs: elapsed,
  }));
  succeeded = true;
} finally {
  appServer.stop(true);
  cli.kill("SIGTERM");
  const exitCode = await cli.exited;
  const [stdout, stderr] = await Promise.all([cliStdout, cliStderr]);
  if (!succeeded || (exitCode !== 0 && exitCode !== 143)) {
    console.error("Inngest server exit " + exitCode + "\\n" + stdout + "\\n" + stderr);
  }
}
`;

function createPoggersTypeFixture(size: number): string {
  const events = lines(size, (index) => `    "event/${index}": { id: string; value: number };`);
  const functions = lines(
    size,
    (index) =>
      `    fn${index}: { Input: { id: string; value: number }; Output: { value: number } };`,
  );
  const definitions = lines(
    size,
    (index) => `  createFunction(
    { id: "fn${index}", triggers: { event: "event/${index}" } },
    async ({ event, step }) => ({
      value: await step.run("compute", () => event.data.value + 1),
    }),
  );`,
  );
  return `import { createFunctions, type FunctionsFeature } from "@poggers/kit";

type Contract = {
  Events: {
${events}
  };
  Functions: {
${functions}
  };
  Dependencies: {};
};
type App = {
  Actor: { id: string };
  Resources: {};
  Features: { workflows: FunctionsFeature<Contract> };
};
export const feature = createFunctions<App, Contract>(
  { dependencies: {} },
  ({ createFunction }) => {
${definitions}
  },
);
`;
}

function createInngestTypeFixture(size: number): string {
  const definitions = lines(
    size,
    (index) => `  inngest.createFunction(
    {
      id: "fn${index}",
      triggers: [
        eventType("event/${index}", {
          schema: staticSchema<{ id: string; value: number }>(),
        }),
      ],
    },
    async ({ event, step }) => ({
      value: await step.run("compute", () => event.data.value + 1),
    }),
  ),`,
  );
  return `import { Inngest, eventType, staticSchema } from "inngest";

const inngest = new Inngest({ id: "benchmark" });
export const functions = [
${definitions}
] as const;
`;
}

async function resolveTypeScriptCompiler(directory: string): Promise<TypeScriptCompiler> {
  const executable = join(directory, "node_modules", "typescript", "bin", "tsc");
  const versionOutput = (await runProcess([executable, "--version"], directory)).trim();
  const version = /^Version (.+)$/.exec(versionOutput)?.[1];
  if (version !== typescriptVersion) {
    throw new Error(
      `Expected TypeScript ${typescriptVersion} at ${executable}, received ${versionOutput}.`,
    );
  }
  return { executable, version };
}

async function compileTypeFixture(
  directory: string,
  file: string,
  compiler: TypeScriptCompiler,
): Promise<TypeMetrics> {
  const output = await runProcess(
    [
      compiler.executable,
      "--ignoreConfig",
      "--noEmit",
      "--skipLibCheck",
      "--strict",
      "--target",
      "esnext",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--extendedDiagnostics",
      file,
    ],
    directory,
  );
  const read = (pattern: RegExp): number => Number(pattern.exec(output)?.[1]);
  return {
    instantiations: read(/Instantiations:\s+([\d]+)/),
    checkMs: read(/Check time:\s+([\d.]+)s/) * 1_000,
    totalMs: read(/Total time:\s+([\d.]+)s/) * 1_000,
    memoryMb: read(/Memory used:\s+([\d]+)K/) / 1_024,
  };
}

async function runProcess(arguments_: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn([...arguments_], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${arguments_.join(" ")}\n${stdout}\n${stderr}`);
  return stdout;
}

async function runProcessWithTimeout(
  arguments_: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<string | null> {
  const child = Bun.spawn([...arguments_], { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const timeout = Symbol("timeout");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof timeout>((resolveTimeout) => {
    timeoutId = setTimeout(() => resolveTimeout(timeout), timeoutMs);
  });
  const result = await Promise.race([child.exited, expired]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);
  if (result === timeout) {
    child.kill();
    await child.exited;
    await Promise.all([stdout, stderr]);
    return null;
  }
  const [output, error] = await Promise.all([stdout, stderr]);
  if (result !== 0) throw new Error(`${arguments_.join(" ")}\n${output}\n${error}`);
  return output;
}

function lines(size: number, create: (index: number) => string): string {
  return Array.from({ length: size }, (_, index) => create(index)).join("\n");
}

function median(values: readonly number[]): number {
  return percentile(
    [...values].sort((left, right) => left - right),
    0.5,
  );
}

function percentile(sorted: readonly number[], percentile_: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile_) - 1)] ?? 0;
}

const evidenceCommands = [
  "runtime",
  "persistent",
  "recovery",
  "concurrency",
  "payload",
  "behavior",
  "crash-recovery",
  "admission",
  "types",
  "test-engine",
  "server",
] as const;

async function runAllEvidence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "poggers-workflow-all-"));
  const forwarded = process.argv.slice(3).filter((argument) => !argument.startsWith("--output="));
  try {
    for (const phase of evidenceCommands) {
      const phaseOutput = join(directory, `${phase}.json`);
      const child = Bun.spawn(
        [process.execPath, import.meta.path, phase, ...forwarded, `--output=${phaseOutput}`],
        { stdout: "inherit", stderr: "inherit" },
      );
      const exitCode = await child.exited;
      if (exitCode !== 0) throw new Error(`Evidence phase ${phase} exited with code ${exitCode}.`);
      const records = (await Bun.file(phaseOutput).json()) as unknown[];
      evidence.push(
        ...records.filter(
          (record) =>
            !record ||
            typeof record !== "object" ||
            (record as { kind?: unknown }).kind !== "environment",
        ),
      );
    }
  } finally {
    if (!keep) await rm(directory, { force: true, recursive: true });
    else emit({ kind: "temporary-directory", path: directory });
  }
}

if (command === "all") await runAllEvidence();
if (command === "runtime") await runRuntimeEvidence();
if (command === "persistent") await runPersistentRuntimeEvidence();
if (command === "recovery") await runPersistentRecoveryEvidence();
if (command === "concurrency") await runPersistentConcurrencyEvidence();
if (command === "payload") await runPersistentPayloadEvidence();
if (command === "behavior") await runPersistentBehaviorEvidence();
if (command === "crash-child") await runCrashRecoveryChild();
if (command === "crash-recovery") await runPersistentCrashRecoveryEvidence();
if (command === "admission") await runAdmissionEvidence();
if (command === "types") await runTypeEvidence();
if (command === "test-engine") await runInngestTestEvidence();
if (command === "server") await runInngestServerEvidence();
if (
  command !== "runtime" &&
  command !== "persistent" &&
  command !== "recovery" &&
  command !== "concurrency" &&
  command !== "payload" &&
  command !== "behavior" &&
  command !== "crash-child" &&
  command !== "crash-recovery" &&
  command !== "admission" &&
  command !== "types" &&
  command !== "test-engine" &&
  command !== "server" &&
  command !== "all"
) {
  throw new TypeError(
    "Usage: workflow-evidence.ts [runtime|persistent|recovery|concurrency|payload|behavior|crash-recovery|admission|types|test-engine|server|all] [--quick] [--output=FILE]",
  );
}
if (outputFile) await Bun.write(resolve(outputFile), `${JSON.stringify(evidence, null, 2)}\n`);
