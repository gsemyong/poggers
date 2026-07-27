import { AsyncLocalStorage } from "node:async_hooks";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import fc from "fast-check";
import { afterEach, expect, test } from "vitest";

import type { ProgramIR, SourceSpan } from "@/compiler/ir";
import { linkProgram } from "@/compiler/linker";
import { compileSystem } from "@/compiler/source";
import { dependencyInvocation } from "@/core/dependency";
import { createMemoryEventStore } from "@/features/entity";
import { SERVER_COMPILER_IR_VERSION, serverCompilerExtension } from "@/platforms/server/adapter";
import { buildServerProgram } from "@/platforms/server/adapter/rust/compiler";
import {
  defineServerProductionDependency,
  jetStreamEventsDependency,
} from "@/platforms/server/adapter/rust/providers";
import { executeServerLinkedProgramIR as executeLinkedProgramIR } from "@/platforms/server/adapter/typescript/runtime";

const directories: string[] = [];
const processes: ChildProcess[] = [];
const processErrors = new WeakMap<ChildProcess, () => string>();

afterEach(async () => {
  for (const process of processes.splice(0).reverse()) await stopProcess(process);
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test(
  "caches production artifacts by semantic output rather than source spans",
  { tags: ["compiler"], timeout: 120_000 },
  async () => {
    const directory = await temporaryDirectory();
    const cache = resolve(directory, "cache");
    const first = await buildServerProgram({
      system: "cache-fixture",
      cache,
      directory,
      output: resolve(directory, "first"),
      program: emptyProgram({ file: "first.ts", line: 1, column: 1 }),
    });
    await rm(first.workspace, { force: true, recursive: true });
    const path = process.env.PATH;
    const second = await (async () => {
      try {
        process.env.PATH = "";
        return await buildServerProgram({
          system: "cache-fixture",
          cache,
          directory,
          output: resolve(directory, "second"),
          program: emptyProgram({ file: "renamed.ts", line: 200, column: 40 }),
        });
      } finally {
        process.env.PATH = path;
      }
    })();

    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit");
    expect(second.semanticHash).toBe(first.semanticHash);
    expect(second.workspace).toBe(first.workspace);
    await expect(access(second.executable)).resolves.toBeUndefined();
    await expect(access(resolve(second.workspace, "src/program.rs"))).resolves.toBeUndefined();
  },
);

test("rejects unknown external Dependencies and host source before Cargo", async () => {
  const directory = await temporaryDirectory();
  const program = emptyProgram({ file: "program.ts", line: 1, column: 1 });
  await expect(
    buildServerProgram({
      system: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "unknown"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            requires: [{ name: "unknown", type: { kind: "record", fields: [] } }],
          },
        ],
      },
    }),
  ).rejects.toThrow('missing Dependency "unknown"');

  await expect(
    buildServerProgram({
      system: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "mismatched"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            requires: [
              {
                name: "clock",
                type: { kind: "primitive", name: "number" },
              },
            ],
          },
        ],
      },
    }),
  ).rejects.toThrow('Dependency "clock" must be a record of operations');

  await expect(
    buildServerProgram({
      system: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "source"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            extensions: {
              server: {
                version: SERVER_COMPILER_IR_VERSION,
                execution: {
                  kind: "source",
                  span: { file: "program.ts", line: 4, column: 3 },
                },
              },
            },
          },
        ],
      },
    }),
  ).rejects.toThrow("is source, not production-realizable product meaning");
});

test("keeps shipped Feature and infrastructure policy out of production compiler machinery", async () => {
  const sources = await Promise.all(
    [
      resolve(import.meta.dirname, "compiler.ts"),
      resolve(import.meta.dirname, "../../../../compiler/rust/lowering.ts"),
      resolve(import.meta.dirname, "../../../../compiler/rust/runtime/src/lib.rs"),
      resolve(import.meta.dirname, "../../../../compiler/source.ts"),
    ].map((path) => readFile(path, "utf8")),
  );
  const genericMachinery = sources.join("\n");

  for (const forbidden of [
    "ActorRuntime",
    "createIdentity",
    "createActor",
    "createEntity",
    "kit_users",
    "kit_sessions",
    "kit_events",
    "KIT_DATABASE",
  ]) {
    expect(genericMachinery, `${forbidden} leaked into generic machinery`).not.toContain(forbidden);
  }
});

test("enforces generic compiler and Feature target boundaries", async () => {
  const compiler = await implementationSources(
    resolve(import.meta.dirname, "../../../../compiler"),
  );
  const features = await implementationSources(
    resolve(import.meta.dirname, "../../../../features"),
  );

  for (const file of compiler) {
    expect(await readFile(file, "utf8"), `${file} imports Feature policy`).not.toMatch(
      /from\s+["']@\/features(?:\/|["'])/,
    );
  }
  for (const file of features) {
    const source = await readFile(file, "utf8");
    expect(source, `${file} imports a target adapter`).not.toMatch(
      /from\s+["']@\/adapters(?:\/|["'])/,
    );
    expect(source, `${file} owns native target generation`).not.toMatch(
      /\b(?:generateRust|RustProgramGenerator|rustc|cargo\s+build)\b/,
    );
  }
});

test(
  "injects an unrelated production Dependency into an expanded generic Feature",
  { tags: ["compiler"], timeout: 120_000 },
  async () => {
    const directory = await temporaryDirectory();
    const source = resolve(directory, "src/system.ts");
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(resolve(directory, "tsconfig.json"), compilerFixtureConfig());
    await writeFile(source, genericFeatureSource());
    const ir = compileSystem(source, [serverCompilerExtension]);
    const program = ir.programs.find(({ name }) => name === "worker");
    if (!program) throw new Error("Fixture has no worker Program.");
    const executable = resolve(directory, "worker");
    const build = await buildServerProgram({
      system: ir.system.name,
      dependencies: [recorderDependency()],
      directory,
      output: executable,
      program,
    });
    const generatedProgram = await readFile(resolve(build.workspace, "src/program.rs"), "utf8");
    const generatedMain = await readFile(resolve(build.workspace, "src/main.rs"), "utf8");
    const generatedManifest = await readFile(resolve(build.workspace, "Cargo.toml"), "utf8");
    expect(generatedProgram).toContain("recorder");
    expect(generatedProgram).toContain("format");
    expect(generatedMain).toContain("program::start");
    expect(generatedMain).not.toContain("kit_server_distribution");
    expect(generatedManifest).not.toContain("kit-server-distribution");
    expect(generatedMain).not.toContain("program.json");
    await expect(access(resolve(build.workspace, "program.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    let run = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          left: fc.integer({ min: -10_000, max: 10_000 }),
          right: fc.integer({ min: -10_000, max: 10_000 }),
        }),
        async (input) => {
          const reference: unknown[] = [];
          const execution = await executeLinkedProgramIR(linkProgram(program), {
            recorder: {
              async read() {
                return input;
              },
              async record({ input: value }: Readonly<{ input: unknown }>) {
                reference.push(value);
              },
            },
          });
          await execution[Symbol.asyncDispose]();
          const output = resolve(directory, `native-output-${run++}.jsonl`);
          const native = await runNativeFixture(executable, output, input);
          expect(native[0]).toEqual({
            value: `format:native:${input.left + input.right}:1:direct:formatter:format:1`,
          });
          expect(native).toEqual(reference);
        },
      ),
      { numRuns: 20 },
    );
  },
);

test(
  "rejects native provider drift at the generated operation boundary",
  { tags: ["compiler"], timeout: 120_000 },
  async () => {
    const directory = await temporaryDirectory();
    const source = resolve(directory, "src/system.ts");
    const provider = resolve(directory, "missing-provider");
    await mkdir(resolve(directory, "src"), { recursive: true });
    await mkdir(resolve(provider, "src"), { recursive: true });
    await writeFile(resolve(directory, "tsconfig.json"), compilerFixtureConfig());
    await writeFile(source, genericFeatureSource());
    await writeFile(
      resolve(provider, "Cargo.toml"),
      `[package]
name = "missing-provider"
version = "0.0.0"
edition = "2024"

[dependencies]
kit-server-runtime = { path = ${JSON.stringify(
        resolve(import.meta.dirname, "../../../../compiler/rust/runtime"),
      )} }
`,
    );
    await writeFile(
      resolve(provider, "src/lib.rs"),
      `use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeFuture, NativeResult, Value,
};

pub struct Provider;

pub async fn create(_context: DependencyContext) -> NativeResult<Provider> {
    Ok(Provider)
}

impl Dependency for Provider {
    fn call(
        &self,
        _engine: Engine,
        _operation: &str,
        _input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        Box::pin(async { Ok(Value::Undefined) })
    }
}
`,
    );
    const ir = compileSystem(source, [serverCompilerExtension]);
    const program = ir.programs.find(({ name }) => name === "worker");
    if (!program) throw new Error("Fixture has no worker Program.");

    await expect(
      buildServerProgram({
        system: ir.system.name,
        cache: resolve(directory, "cache"),
        dependencies: [
          defineServerProductionDependency({
            name: "missing-provider",
            dependency: "recorder",
            configuration: [],
            crate: { package: "missing-provider", directory: provider },
            rust: { type: "missing_provider::Provider", constructor: "missing_provider::create" },
          }),
        ],
        directory,
        output: resolve(directory, "worker"),
        program,
      }),
    ).rejects.toThrow(/operation_(?:read|record)/);
  },
);

test(
  "compiles Actor Features through the generic production Program backend",
  { tags: ["compiler"], timeout: 120_000 },
  async () => {
    const directory = await temporaryDirectory();
    const source = resolve(directory, "src/system.ts");
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(resolve(directory, "tsconfig.json"), compilerFixtureConfig());
    await writeFile(source, actorFeatureSource());
    const ir = compileSystem(source, [serverCompilerExtension]);
    const program = ir.programs.find(({ name }) => name === "server");
    if (!program) throw new Error("Actor fixture has no server Program.");
    const build = await buildServerProgram({
      system: ir.system.name,
      dependencies: [recorderDependency()],
      directory,
      output: resolve(directory, "actor-server"),
      profile: process.env.KIT_NATIVE_PROFILE === "release" ? "release" : "debug",
      program,
    });

    await expect(access(build.executable)).resolves.toBeUndefined();
    const generated = await readFile(resolve(build.workspace, "src/program.rs"), "utf8");
    const generatedMain = await readFile(resolve(build.workspace, "src/main.rs"), "utf8");
    const generatedManifest = await readFile(resolve(build.workspace, "Cargo.toml"), "utf8");
    expect(generated).toContain('"counter"');
    expect(generated).not.toContain("ActorRuntime");
    expect(generatedMain).toContain("kit_server_distribution::start");
    expect(generatedMain).toContain('name: "counter"');
    expect(generatedMain).toContain("DistributionOperationMode::Asynchronous");
    expect(generatedManifest).toContain("kit-server-distribution");

    const runReference = async (input: Readonly<{ key: string; amount: number }>) => {
      const reference: unknown[] = [];
      let time = 0;
      await using _execution = await executeLinkedProgramIR(linkProgram(program), {
        alarm: {
          async schedule() {},
          async cancel() {},
        },
        events: directDependencyProvider(createMemoryEventStore()),
        executionContext: createTestExecutionContext(),
        synchronization: createTestSynchronization(),
        telemetry: { record() {} },
        clock: { now: () => ++time },
        identifiers: { create: () => "reference-actor-worker" },
        timer: {
          async sleep() {
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
          },
        },
        recorder: {
          async read() {
            return input;
          },
          async record({ input: value }: { input: unknown }) {
            reference.push(value);
          },
        },
      });
      return reference;
    };

    const corpus = [
      { key: "counter-zero", amount: 0 },
      { key: "counter-positive", amount: 3 },
      { key: "counter-large", amount: 1_000 },
    ] as const;
    for (const [index, input] of corpus.entries()) {
      const reference = await runReference(input);
      const nativeDatabase = resolve(directory, `actor-${index}.sqlite`);
      const telemetry = resolve(directory, `actor-${index}.telemetry.jsonl`);
      const native = await runNativeFixture(
        build.executable,
        resolve(directory, `native-actor-${index}.jsonl`),
        input,
        { KIT_DATABASE: nativeDatabase, KIT_TELEMETRY_FILE: telemetry },
      );
      expect(native).toEqual(reference);
      if (index === 0) {
        expect(await readFile(telemetry, "utf8")).toContain('"name":"actor.calls"');
        const restarted = await runNativeFixture(
          build.executable,
          resolve(directory, "native-actor-restarted.jsonl"),
          input,
          { KIT_DATABASE: nativeDatabase, KIT_TELEMETRY_FILE: telemetry },
        );
        expect(restarted).toEqual(reference);
      }
    }
  },
);

test.skipIf(spawnSync("nats-server", ["--version"], { stdio: "ignore" }).status !== 0)(
  "coordinates independent production replicas through a selected JetStream adapter",
  { tags: ["compiler"], timeout: 180_000 },
  async () => {
    const directory = await temporaryDirectory();
    const natsPort = await availablePort();
    const nats = await startNatsServer(resolve(directory, "nats"), natsPort);
    processes.push(nats);
    const source = resolve(directory, "src/system.ts");
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(source, networkFeatureSource());
    const ir = compileSystem(source, [serverCompilerExtension]);
    const program = ir.programs.find(({ name }) => name === "worker");
    if (!program) throw new Error("Network fixture has no worker Program.");
    const executable = resolve(directory, "worker");
    await buildServerProgram({
      system: ir.system.name,
      dependencies: [jetStreamEventsDependency, networkRecorderDependency()],
      directory,
      lint: true,
      output: executable,
      program,
    });
    const environment = {
      NATS_URL: `nats://127.0.0.1:${natsPort}`,
      KIT_EVENT_STREAM: `KIT_NATIVE_REPLICAS_${natsPort}`,
    };

    const first = await runRecorderProgram(
      executable,
      resolve(directory, "first.jsonl"),
      { action: "append", stream: "orders/one", expectedRevision: 0, after: 0, value: "created" },
      environment,
    );
    expect(recordedValue(first)).toBe("appended");

    const contenders = await Promise.all([
      runRecorderProgram(
        executable,
        resolve(directory, "contender-a.jsonl"),
        { action: "append", stream: "orders/one", expectedRevision: 1, after: 0, value: "a" },
        environment,
      ),
      runRecorderProgram(
        executable,
        resolve(directory, "contender-b.jsonl"),
        { action: "append", stream: "orders/one", expectedRevision: 1, after: 0, value: "b" },
        environment,
      ),
    ]);
    expect(contenders.map(recordedValue).sort()).toEqual(["appended", "conflict"]);

    const read = await runRecorderProgram(
      executable,
      resolve(directory, "read.jsonl"),
      { action: "read", stream: "orders/one", expectedRevision: 0, after: 0, value: "" },
      environment,
    );
    expect(recordedValue(read)).toHaveLength(2);

    const subscription = startRecorderProgram(
      executable,
      resolve(directory, "subscribe.jsonl"),
      { action: "subscribe", stream: "orders/one", expectedRevision: 0, after: 2, value: "" },
      environment,
    );
    await runRecorderProgram(
      executable,
      resolve(directory, "append-live.jsonl"),
      { action: "append", stream: "orders/one", expectedRevision: 2, after: 0, value: "live" },
      environment,
    );
    await expect(subscription.then(recordedValue)).resolves.toEqual({
      stream: "orders/one",
      revision: 3,
      event: { value: "live" },
    });
  },
);

test.skipIf(spawnSync("nats-server", ["--version"], { stdio: "ignore" }).status !== 0)(
  "routes one native Actor Program through scale, duplicates, latency, skew, mixed versions, drain, kill, and partition recovery",
  { tags: ["compiler"], timeout: 240_000 },
  async () => {
    const directory = await temporaryDirectory();
    const natsPort = await availablePort();
    const natsDirectory = resolve(directory, "nats-actors");
    let nats = await startNatsServer(natsDirectory, natsPort);
    processes.push(nats);
    const source = resolve(directory, "src/system.ts");
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(resolve(directory, "tsconfig.json"), compilerFixtureConfig());
    await writeFile(source, clusteredActorSource());
    const ir = compileSystem(source, [serverCompilerExtension]);
    const program = ir.programs.find(({ name }) => name === "server");
    if (!program) throw new Error("Cluster Actor fixture has no server Program.");
    const executable = resolve(directory, "actor-cluster");
    await buildServerProgram({
      system: ir.system.name,
      dependencies: [jetStreamEventsDependency, recorderDependency()],
      directory,
      output: executable,
      program,
    });
    const environment = {
      NATS_URL: `nats://127.0.0.1:${natsPort}`,
      KIT_NATS_URL: `nats://127.0.0.1:${natsPort}`,
      KIT_EVENT_STREAM: `KIT_NATIVE_ACTOR_EVENTS_${natsPort}`,
      KIT_DISTRIBUTION_STREAM: `KIT_NATIVE_ACTOR_DIRECTORY_${natsPort}`,
      KIT_PROCESS_CLUSTER: `native-actors-${natsPort}`,
      KIT_PROCESS_MEMBERSHIP_LEASE_MS: "1000",
      KIT_PROCESS_OWNERSHIP_LEASE_MS: "500",
      KIT_PROCESS_PARTITIONS: "64",
    };
    const key = "shared-counter";
    const replicas = new Map<string, ChildProcess>();
    const output = resolve(directory, "cluster.jsonl");
    const start = (
      id: string,
      input: Readonly<{
        id: string;
        key: string;
        amount: number;
        delay: number;
        duplicateDelay?: number;
        workDelay?: number;
        nextAmount?: number;
        nextDelay?: number;
        disabled?: boolean;
      }>,
      processEnvironment: Readonly<Record<string, string>> = {},
    ) => {
      const child = startPersistentRecorderProgram(executable, output, input, {
        ...environment,
        KIT_PROCESS_ID: id,
        ...processEnvironment,
      });
      processes.push(child);
      replicas.set(id, child);
      return child;
    };

    const p1 = start("p1", {
      id: "first",
      key,
      amount: 1,
      delay: 500,
      duplicateDelay: 200,
    });
    await expect.poll(() => recordedActorValues(output, p1), { timeout: 15_000 }).toEqual([1, 1]);

    start(
      "p2",
      { id: "second", key, amount: 2, delay: 1_500, workDelay: 100 },
      { KIT_CLOCK_OFFSET_MS: "100" },
    );
    start("p3", { id: "third", key, amount: 3, delay: 1_500 });
    await expect
      .poll(
        async () =>
          (await recordedActorValues(output, undefined))
            .toSorted((left, right) => left - right)
            .join(","),
        { timeout: 20_000 },
      )
      .toMatch(/^1,1,(?:3,6|4,6)$/);

    const owner = nativeActorOwner(key, ["p1", "p2", "p3"], 64);
    const failed = replicas.get(owner);
    if (!failed) throw new Error(`Unable to find native Actor owner ${owner}.`);
    await terminateProcess(failed, "SIGKILL");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_200));

    const p4 = start(
      "p4",
      {
        id: "after-failover",
        key,
        amount: 4,
        delay: 800,
        nextAmount: 5,
        nextDelay: 2_000,
      },
      { KIT_PROCESS_VERSION: "implementation-v2" },
    );
    await expect
      .poll(async () => (await recordedActorValues(output, replicas.get("p4"))).includes(10), {
        timeout: 20_000,
      })
      .toBe(true);

    for (const [id, child] of replicas) {
      if (id === owner || id === "p4") continue;
      await terminateProcess(child, "SIGINT");
    }
    await terminateProcess(nats, "SIGKILL");
    await terminateProcess(p4, "SIGKILL");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    nats = await startNatsServer(natsDirectory, natsPort);
    processes.push(nats);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_200));
    const p5 = start("p5", {
      id: "recovered-reminder",
      key,
      amount: 0,
      delay: 60_000,
      disabled: true,
    });
    await expect
      .poll(async () => (await recordedActorValues(output, p5)).includes(15), {
        timeout: 20_000,
      })
      .toBe(true);
  },
);

function emptyProgram(span: SourceSpan): ProgramIR {
  return {
    id: "program/worker",
    name: "worker",
    logicalName: "worker",
    environment: { name: "server", platform: "server" },
    contributions: [
      {
        id: "feature/worker/program/worker",
        feature: "worker",
        requires: [],
        provides: [],
        extensions: {
          server: {
            version: SERVER_COMPILER_IR_VERSION,
            execution: { kind: "none" },
          },
        },
        span,
      },
    ],
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "kit-server-adapter-"));
  directories.push(directory);
  return directory;
}

function compilerFixtureConfig(): string {
  return JSON.stringify({
    extends: resolve(import.meta.dirname, "../../../../../tsconfig.json"),
    compilerOptions: {
      paths: { "@/*": [resolve(import.meta.dirname, "../../../../*")] },
    },
  });
}

function recorderDependency() {
  return defineServerProductionDependency({
    name: "recorder-fixture",
    dependency: "recorder",
    configuration: [
      { name: "output", environment: "KIT_RECORDER_OUTPUT", required: true },
      { name: "input", environment: "KIT_RECORDER_INPUT", required: true },
    ],
    crate: {
      package: "kit-server-recorder",
      directory: resolve(import.meta.dirname, "fixtures/recorder"),
    },
    rust: {
      type: "kit_server_recorder::Recorder",
      constructor: "kit_server_recorder::create",
    },
  });
}

function createTestExecutionContext() {
  const storage = new AsyncLocalStorage<readonly object[]>();
  return {
    current() {
      return storage.getStore() ?? [];
    },
    async run({
      input: { scope, task },
    }: Readonly<{ input: { scope: object; task(): Promise<object> } }>) {
      return await storage.run([...(storage.getStore() ?? []), scope], task);
    },
  };
}

function createTestSynchronization() {
  const tails = new Map<string, Promise<void>>();
  return {
    async exclusive({
      input: { key, task },
    }: Readonly<{ input: { key: string; task(): Promise<object> } }>): Promise<object> {
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

function directDependencyProvider(implementation: object) {
  return {
    [dependencyInvocation](operation: string, input: unknown) {
      const method = Reflect.get(implementation, operation);
      if (typeof method !== "function") {
        throw new Error(`Unknown direct Dependency operation ${operation}.`);
      }
      return Reflect.apply(method, implementation, [input]);
    },
  };
}

function networkRecorderDependency() {
  return defineServerProductionDependency({
    ...recorderDependency(),
    name: "network-recorder-fixture",
  });
}

function compositionSource(): string {
  return `
declare const featureContract: unique symbol;
declare const dependencyDefinition: unique symbol;
type Dependency<Definition extends { Operations: object }> = Readonly<
  Definition["Operations"] & { readonly [dependencyDefinition]?: Definition }
>;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createSystem(definition: object): object {
  return definition;
}
`;
}

function genericFeatureSource(): string {
  return `
import { dependencyInvocation } from "@/core/dependency";

type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionSource()}
type Formatter = Dependency<{
  Operations: {
    format(input: { value: string }): Promise<string>;
  };
}>;
type Recorder = Dependency<{
  Operations: {
    read(input: {}): Promise<{ left: number; right: number }>;
    record(input: { value: string }): Promise<void>;
  };
}>;
type Peer = Dependency<{
  Operations: {
    read(input: {}): Promise<string>;
    readPeer(input: {}): Promise<string>;
  };
}>;
type Formatting = { Programs: { worker: Program<Environment, { Requires: { recorder: Recorder }; Provides: { formatter: Formatter } }> } };
type Left = { Programs: { worker: Program<Environment, { Requires: { right: Peer }; Provides: { left: Peer } }> } };
type Right = { Programs: { worker: Program<Environment, { Requires: { left: Peer }; Provides: { right: Peer } }> } };
type Consumer = { Programs: { worker: Program<Environment, { Requires: { formatter: Formatter; left: Peer; recorder: Recorder; right: Peer } }> } };

const stableSuffix = (value: string): string => \`${"${value}"}!\`;

function createFormatting<const Prefix extends string>(prefix: Prefix): Feature<Formatting> {
  return {
    programs: {
      worker: {
        start({ dependencies }: { dependencies: { recorder: Recorder } }) {
          const selectedSuffix = stableSuffix;
          const staticOperations = { suffix: stableSuffix };
          if (staticOperations.suffix !== selectedSuffix || selectedSuffix("ok") !== "ok!") {
            throw new Error("Static function identity changed.");
          }
          const operations: Readonly<
            Record<
              string,
              (
                input: { value: string },
                invocation: { id: string; attempt: number },
              ) => string
            >
          > = {
            format(
              input: { value: string },
              invocation: { id: string; attempt: number },
            ) {
              return \`${"${prefix}"}${"${input.value}"}:${"${invocation.attempt}"}:${"${invocation.id}"}\`;
            },
          };
          const formatOperation = Object.keys(operations).find(
            (name) => operations[name] === operations.format,
          );
          if (formatOperation === undefined) throw new Error("Unable to resolve operation.");
          return {
            formatter: {
              async [dependencyInvocation](
                operation: "format",
                input: { value: string },
                invocation: { id: string; attempt: number },
              ) {
                const handler = operations[operation];
                if (handler === undefined) throw new Error("Unknown operation.");
                return \`${"${formatOperation}"}:${"${handler(input, invocation)}"}\`;
              },
              async [Symbol.asyncDispose]() {
                await dependencies.recorder.record({ value: "disposed" });
              },
            },
          };
        },
      },
    },
  } as Feature<Formatting>;
}

const formatting = createFormatting("native:");
const left = createFeature<Left>({
  programs: {
    worker: {
      start({ dependencies }: { dependencies: { right: Peer } }) {
        return {
          left: {
            read(_input: {}) {
              return "left";
            },
            async readPeer(_input: {}) {
              return await dependencies.right.read({});
            },
          },
        };
      },
    },
  },
});
const right = createFeature<Right>({
  programs: {
    worker: {
      start({ dependencies }: { dependencies: { left: Peer } }) {
        return {
          right: {
            read(_input: {}) {
              return "right";
            },
            async readPeer(_input: {}) {
              return await dependencies.left.read({});
            },
          },
        };
      },
    },
  },
});
const consumer = createFeature<Consumer>({
  programs: {
    worker: {
      async start({ dependencies }: { dependencies: { formatter: Formatter; left: Peer; recorder: Recorder; right: Peer } }) {
        try {
          throw new Error("handled");
        } catch {
        }
        const input = await dependencies.recorder.read({});
        const state = { value: input.left };
        state.value += input.right;
        const restored = JSON.parse(JSON.stringify(state)) as { value: number };
        restored.value += 1;
        const value = await dependencies.formatter.format({ value: \`${"${restored.value - 1}"}\` });
        const computed: Record<string, string> = {};
        const selected = "value";
        computed[selected] = value;
        await dependencies.recorder.record({ value: computed[selected] });
        await dependencies.recorder.record({
          value: \`${"${await dependencies.left.readPeer({})}"}:${"${await dependencies.right.readPeer({})}"}\`,
        });
      },
    },
  },
});

export default createSystem({
  metadata: { name: "Generic production fixture" },
  features: { formatting, left, right, consumer },
});
`;
}

function actorFeatureSource(): string {
  return `
import {
  createFeature,
  createSystem,
  type Dependency,
  type Feature,
} from "@/index";
import { createActor, type Actor } from "@/features/actor";
import type {
  Clock,
  EventStore,
  ServerProcess,
  Timer,
} from "@/platforms/server";

type Counter = Actor<{
  Name: "counter";
  Key: string;
  State: { value: number };
  Methods: {
    add: Actor.Method<
      { amount: number },
      { value: number },
      { negative: { amount: number } }
    >;
    value: Actor.Read<undefined, { value: number }>;
  };
}>;
const counter = createActor<Counter>({
  state: (_context) => ({ value: 0 }),
  methods: {
    add({ state, input, fail }) {
      if (input.amount < 0) {
        fail({ type: "negative", data: { amount: input.amount } });
      }
      state.value += input.amount;
      return { value: state.value };
    },
    value({ state }) {
      return { value: state.value };
    },
  },
});

type FireInput = Readonly<{ at: number; remaining: number }>;
type Reminder = Actor<{
  Name: "reminder";
  Key: string;
  State: { fired: number };
  Methods: {
    fire: Actor.Method<FireInput, Readonly<{ fired: number }>>;
    schedule: Actor.Method<undefined, Readonly<{ scheduled: boolean }>>;
    status: Actor.Read<undefined, Readonly<{ fired: number }>>;
  };
}>;
const fireReminder: Actor.Handler<Reminder, "fire"> = ({ state, input, reminders }) => {
  state.fired += 1;
  if (input.remaining > 1) {
    reminders.schedule({
      id: "fire",
      at: input.at,
      method: fireReminder,
      input: { at: input.at, remaining: input.remaining - 1 },
    });
  }
  return { fired: state.fired };
};
const reminder = createActor<Reminder>({
  state: (_context) => ({ fired: 0 }),
  methods: {
    fire: fireReminder,
    schedule({ reminders }) {
      reminders.schedule({
        id: "fire",
        at: 0,
        method: fireReminder,
        input: { at: 0, remaining: 3 },
      });
      return { scheduled: true };
    },
    status({ state }) {
      return { fired: state.fired };
    },
  },
});

type CycleAMethods = {
  ping: Actor.Method<undefined, Readonly<{ actor: "a" }>>;
  pingAccepted: Actor.Method<undefined, Readonly<{ actor: "a" }>>;
  finish: Actor.Method<undefined, Readonly<{ finished: number }>>;
  status: Actor.Read<undefined, Readonly<{ finished: number }>>;
};
type CycleBMethods = {
  ping: Actor.Method<undefined, Readonly<{ actor: "b" }>>;
  pingAccepted: Actor.Method<undefined, Readonly<{ actor: "b" }>>;
};
type CycleA = Actor<{
  Name: "cycleA";
  Key: string;
  State: { finished: number };
  Dependencies: {
    cycleB: Actor.Reference<{ Key: string; Methods: CycleBMethods }>;
  };
  Methods: CycleAMethods;
}>;
type CycleB = Actor<{
  Name: "cycleB";
  Key: string;
  State: Record<never, never>;
  Dependencies: {
    cycleA: Actor.Reference<{ Key: string; Methods: CycleAMethods }>;
  };
  Methods: CycleBMethods;
}>;
const cycleA = createActor<CycleA>({
  state: (_context) => ({ finished: 0 }),
  methods: {
    async ping({ key, dependencies }) {
      await dependencies.cycleB.get({ key }).ping();
      return { actor: "a" as const };
    },
    async pingAccepted({ key, dependencies }) {
      await dependencies.cycleB.get({ key }).pingAccepted();
      return { actor: "a" as const };
    },
    finish({ state }) {
      state.finished += 1;
      return { finished: state.finished };
    },
    status({ state }) {
      return { finished: state.finished };
    },
  },
});
const cycleB = createActor<CycleB>({
  state: (_context) => ({}),
  methods: {
    async ping({ key, dependencies }) {
      await dependencies.cycleA.get({ key }).finish();
      return { actor: "b" as const };
    },
    async pingAccepted({ key, dependencies }) {
      await dependencies.cycleA.get({ key }).finish({ wait: "accepted" });
      return { actor: "b" as const };
    },
  },
});

type Recorder = Dependency<{
  Operations: {
    read(input: {}): Promise<{ key: string; amount: number }>;
    record(input: { value: string }): Promise<void>;
  };
}>;
type JournalEvent = Readonly<{
  type: string;
  invocation?: string;
  operation?: string;
  input?: object;
  state?: object;
  outcome?: object;
  failure?: object;
  attempt?: number;
  attempts?: number;
  timer?: string;
  generation?: number;
  dueAt?: number;
}>;
function actorStream(name: string, key: string): string {
  return \`actor:${"${name.length}"}:${"${name}"}:${"${key.length}"}:${"${key}"}\`;
}
async function normalizedJournal(
  events: EventStore<object>,
  name: string,
  key: string,
): Promise<readonly object[]> {
  const normalized: object[] = [];
  const stored = await events.read({ stream: actorStream(name, key) });
  for (const entry of stored) {
    const event = entry.event as JournalEvent;
    if (event.type === "actor.command.accepted") {
      normalized.push({
        type: event.type,
        invocation: event.invocation,
        operation: event.operation,
        input: event.input,
      });
    } else if (event.type === "actor.command.claimed") {
      normalized.push({
        type: event.type,
        invocation: event.invocation,
        attempt: event.attempt,
      });
    } else if (event.type === "actor.command.completed") {
      normalized.push({
        type: event.type,
        invocation: event.invocation,
        state: event.state,
        outcome: event.outcome,
      });
    } else if (event.type === "actor.command.failed") {
      normalized.push({
        type: event.type,
        invocation: event.invocation,
        failure: event.failure,
      });
    } else if (event.type === "actor.command.poisoned") {
      normalized.push({
        type: event.type,
        invocation: event.invocation,
        attempts: event.attempts,
      });
    } else if (event.type === "actor.timer.scheduled") {
      normalized.push({
        type: event.type,
        timer: event.timer,
        generation: event.generation,
        dueAt: event.dueAt,
        operation: event.operation,
        input: event.input,
      });
    } else if (event.type === "actor.timer.cancelled") {
      normalized.push({
        type: event.type,
        timer: event.timer,
        generation: event.generation,
      });
    } else if (event.type === "actor.timer.fired") {
      normalized.push({
        type: event.type,
        timer: event.timer,
        generation: event.generation,
        invocation: event.invocation,
      });
    }
  }
  return normalized;
}
type Probe = {
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: {
        counter: Actor.Reference<typeof counter>;
        cycleA: Actor.Reference<typeof cycleA>;
        events: EventStore<object>;
        reminder: Actor.Reference<typeof reminder>;
        recorder: Recorder;
        clock: Clock;
        timer: Timer;
      };
    };
  };
};
const probe = createFeature<Probe>({
  programs: {
    server: {
      async start({ dependencies }: {
        dependencies: {
          counter: Actor.Reference<typeof counter>;
          cycleA: Actor.Reference<typeof cycleA>;
          events: EventStore<object>;
          reminder: Actor.Reference<typeof reminder>;
          recorder: Recorder;
          clock: Clock;
          timer: Timer;
        };
      }) {
        const input = await dependencies.recorder.read({});
        const counter = dependencies.counter.get({ key: input.key });
        const first = await counter.add(
          { amount: input.amount },
          {
            idempotencyKey: "same",
          },
        );
        const duplicate = await counter.add(
          { amount: input.amount },
          {
            idempotencyKey: "same",
          },
        );
        const concurrent = await Promise.all([
          counter.add(
            { amount: 2 },
            {
              idempotencyKey: "concurrent",
            },
          ),
          counter.add(
            { amount: 2 },
            {
              idempotencyKey: "concurrent",
            },
          ),
        ]);
        const failed = await counter.add(
          { amount: -1 },
          {
            idempotencyKey: "negative",
          },
        );
        const accepted = await counter.add(
          { amount: 1 },
          {
            idempotencyKey: "accepted",
            wait: "accepted",
          },
        );
        await dependencies.timer.sleep({ until: dependencies.clock.now({}) + 10 });
        const afterAccepted = await counter.value();
        const current = await counter.value();
        const reminderActor = dependencies.reminder.get({ key: input.key });
        await reminderActor.schedule({
          idempotencyKey: "reminder",
        });
        await dependencies.timer.sleep({ until: dependencies.clock.now({}) + 10 });
        const reminder = await reminderActor.status();
        let cycleFailure: object = {};
        try {
          await dependencies.cycleA.get({ key: "synchronous-cycle" }).ping({
            idempotencyKey: "cycle-failure",
          });
        } catch (error) {
          cycleFailure = (error as Actor.Error).failure;
        }
        const acceptedCycle = await dependencies.cycleA.get({ key: "accepted-cycle" }).pingAccepted({
          idempotencyKey: "cycle-accepted",
        });
        await dependencies.timer.sleep({ until: dependencies.clock.now({}) + 10 });
        const cycleStatus = await dependencies.cycleA.get({ key: "accepted-cycle" }).status();
        const journals = {
          counter: await normalizedJournal(dependencies.events, "counter", input.key),
          reminder: await normalizedJournal(dependencies.events, "reminder", input.key),
          cycleA: await normalizedJournal(
            dependencies.events,
            "cycleA",
            "synchronous-cycle",
          ),
          cycleB: await normalizedJournal(
            dependencies.events,
            "cycleB",
            "synchronous-cycle",
          ),
          acceptedCycleA: await normalizedJournal(
            dependencies.events,
            "cycleA",
            "accepted-cycle",
          ),
          acceptedCycleB: await normalizedJournal(
            dependencies.events,
            "cycleB",
            "accepted-cycle",
          ),
        };
        await dependencies.recorder.record({
          value: \`native:\${JSON.stringify({
            first,
            duplicate,
            concurrent,
            current,
            failed,
            accepted,
            afterAccepted,
            reminder,
            cycleFailure,
            acceptedCycle,
            cycleStatus,
            journals,
          })}\`,
        });
      },
    },
  },
}) as Feature<Probe>;

export default createSystem({
  metadata: { name: "Native Actor fixture" },
  features: { counter, cycleA, cycleB, reminder, probe },
});
`;
}

function clusteredActorSource(): string {
  return `
import {
  createFeature,
  createSystem,
  type Dependency,
} from "@/index";
import { createActor, type Actor } from "@/features/actor";
import type { Alarm, Clock, ServerProcess, Timer } from "@/platforms/server";

type ActorClock = Dependency<{ Operations: Clock }>;
type ActorTimer = Dependency<{ Operations: Timer }>;

type Counter = Actor<{
  Name: "counter";
  Key: string;
  State: { value: number };
  Dependencies: { clock: ActorClock; timer: ActorTimer };
  Methods: {
    add: Actor.Method<{ amount: number; workDelay?: number }, { value: number }>;
  };
}>;
const counter = createActor<Counter>({
  state: () => ({ value: 0 }),
  methods: {
    async add({ state, input, dependencies }) {
      if (input.workDelay !== undefined) {
        await dependencies.timer.sleep({
          until: dependencies.clock.now({}) + input.workDelay,
        });
      }
      state.value += input.amount;
      return { value: state.value };
    },
  },
});

type Command = {
  id: string;
  key: string;
  amount: number;
  delay: number;
  duplicateDelay?: number;
  workDelay?: number;
  nextAmount?: number;
  nextDelay?: number;
  disabled?: boolean;
};
type Recorder = Dependency<{
  Operations: {
    read(input: {}): Promise<Command>;
    record(input: { value: string }): Promise<void>;
  };
}>;
type Driver = Dependency<{
  Operations: {
    run(input: Command): Promise<void>;
  };
}>;
type Probe = {
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: {
        alarm: Alarm;
        clock: ActorClock;
        counter: Actor.Reference<typeof counter>;
        recorder: Recorder;
      };
      Provides: { driver: Driver };
    };
  };
};
const probe = createFeature<Probe>({
  programs: {
    server: {
      async start({ dependencies }) {
        const command = await dependencies.recorder.read({});
        if (!command.disabled) {
          await dependencies.alarm.schedule({
            id: \`driver:${"${command.id}"}\`,
            at: dependencies.clock.now({}) + command.delay,
            target: {
              dependency: "driver",
              operation: "run",
              input: command,
            },
          });
        }
        return {
          driver: {
            async run({ input }) {
              const result = await dependencies.counter
                .get({ key: input.key })
                .add(
                  { amount: input.amount, workDelay: input.workDelay },
                  { idempotencyKey: input.id },
                );
              if (result.status !== "succeeded") {
                throw new Error("Counter method failed.");
              }
              if (input.nextAmount !== undefined && input.nextDelay !== undefined) {
                const next = {
                  id: \`${"${input.id}"}:next\`,
                  key: input.key,
                  amount: input.nextAmount,
                  delay: input.nextDelay,
                };
                await dependencies.alarm.schedule({
                  id: \`driver:${"${next.id}"}\`,
                  at: dependencies.clock.now({}) + input.nextDelay,
                  target: {
                    dependency: "driver",
                    operation: "run",
                    input: next,
                  },
                });
              }
              await dependencies.recorder.record({
                value: \`native:\${JSON.stringify({
                  id: input.id,
                  value: result.value.value,
                })}\`,
              });
              if (input.duplicateDelay !== undefined) {
                await dependencies.alarm.schedule({
                  id: \`driver:${"${input.id}"}:duplicate\`,
                  at: dependencies.clock.now({}) + input.duplicateDelay,
                  target: {
                    dependency: "driver",
                    operation: "run",
                    input: {
                      id: input.id,
                      key: input.key,
                      amount: input.amount,
                      delay: 0,
                      workDelay: input.workDelay,
                    },
                  },
                });
              }
            },
          },
        };
      },
    },
  },
});

export default createSystem({
  metadata: { name: "Native clustered Actor fixture" },
  features: { counter, probe },
});
`;
}

function networkFeatureSource(): string {
  return `
type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
${compositionSource()}
type StoredEvent = { stream: string; revision: number; event: { value: string } };
type Events = Dependency<{
  Operations: {
    read(input: {
      stream: string;
      after?: number;
      limit?: number;
    }): Promise<readonly StoredEvent[]>;
    append(input: { stream: string; expectedRevision: number; events: readonly { value: string }[] }): Promise<readonly StoredEvent[] | undefined>;
    subscribe(input: { stream: string; after?: number }): AsyncIterable<StoredEvent>;
  };
}>;
type Command = { action: string; stream: string; expectedRevision: number; after: number; value: string };
type Recorder = Dependency<{
  Operations: {
    read(input: {}): Promise<Command>;
    record(input: { value: string }): Promise<void>;
  };
}>;
type Worker = { Programs: { worker: Program<Environment, { Requires: { events: Events; recorder: Recorder } }> } };

const worker = createFeature<Worker>({
  programs: {
    worker: {
      async start({ dependencies }: { dependencies: { events: Events; recorder: Recorder } }) {
        const command = await dependencies.recorder.read({});
        if (command.action === "append") {
          const appended = await dependencies.events.append({
            stream: command.stream,
            expectedRevision: command.expectedRevision,
            events: [{ value: command.value }],
          });
          await dependencies.recorder.record({ value: appended ? "appended" : "conflict" });
          return;
        }
        if (command.action === "read") {
          const history = await dependencies.events.read({ stream: command.stream, after: command.after });
          await dependencies.recorder.record({ value: JSON.stringify(history) });
          return;
        }
        for await (const event of dependencies.events.subscribe({ stream: command.stream, after: command.after })) {
          await dependencies.recorder.record({ value: JSON.stringify(event) });
          return;
        }
      },
    },
  },
});

export default createSystem({
  metadata: { name: "Native network fixture" },
  features: { worker },
});
`;
}

async function runNativeFixture(
  executable: string,
  output: string,
  input: unknown,
  environment: Readonly<Record<string, string>> = {},
): Promise<readonly unknown[]> {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      ...environment,
      KIT_RECORDER_INPUT: JSON.stringify(input),
      KIT_RECORDER_OUTPUT: output,
    },
    stdio: "pipe",
  });
  let error = "";
  child.stderr.setEncoding("utf8").on("data", (value: string) => (error += value));
  await expect
    .poll(
      async () => {
        const contents = await readFile(output, "utf8").catch(() => "");
        try {
          const records = contents
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as unknown);
          return records.some((record) => JSON.stringify(record).includes("native:"));
        } catch {
          return false;
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  child.kill("SIGINT");
  await new Promise<void>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGINT") resolvePromise();
      else reject(new Error(error || `Production fixture exited ${code ?? signal}.`));
    });
  });
  return (await readFile(output, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function startPersistentRecorderProgram(
  executable: string,
  output: string,
  input: unknown,
  environment: Readonly<Record<string, string>>,
): ChildProcess {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      ...environment,
      KIT_RECORDER_INPUT: JSON.stringify(input),
      KIT_RECORDER_OUTPUT: output,
    },
    stdio: "pipe",
  });
  let error = "";
  child.stderr.setEncoding("utf8").on("data", (value: string) => (error += value));
  processErrors.set(child, () => error);
  return child;
}

async function recordedActorValues(
  output: string,
  child: ChildProcess | undefined,
): Promise<number[]> {
  if (child && (child.exitCode !== null || child.signalCode !== null)) {
    throw new Error(
      processErrors.get(child)?.() ||
        `Persistent native fixture exited ${child.exitCode ?? child.signalCode}.`,
    );
  }
  const contents = await readFile(output, "utf8").catch(() => "");
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { value?: unknown })
    .flatMap((record) => {
      if (typeof record.value !== "string" || !record.value.startsWith("native:")) return [];
      const value = JSON.parse(record.value.slice("native:".length)) as { value?: unknown };
      return typeof value.value === "number" ? [value.value] : [];
    });
}

function nativeActorOwner(key: string, members: readonly string[], partitions: number): string {
  const identity = JSON.stringify(["server", "counter", [["key", key]]]);
  const partition = stableUtf16Hash(identity) % partitions;
  const scope = JSON.stringify(["kit.process.partition", 1, "server", "counter", partition]);
  return members.reduce((winner, candidate) => {
    const score = stableUtf16Hash(`${scope}\u0000${candidate}\u0000${1}`);
    const winnerScore = stableUtf16Hash(`${scope}\u0000${winner}\u0000${1}`);
    return score > winnerScore || (score === winnerScore && candidate < winner)
      ? candidate
      : winner;
  });
}

function stableUtf16Hash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

async function terminateProcess(child: ChildProcess, signal: "SIGINT" | "SIGKILL"): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
  child.kill(signal);
  await exited;
}

function startRecorderProgram(
  executable: string,
  output: string,
  input: unknown,
  environment: Readonly<Record<string, string>>,
): Promise<readonly unknown[]> {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      ...environment,
      KIT_RECORDER_INPUT: JSON.stringify(input),
      KIT_RECORDER_OUTPUT: output,
    },
    stdio: "pipe",
  });
  let error = "";
  child.stderr.setEncoding("utf8").on("data", (value: string) => (error += value));
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Native recorder fixture timed out for ${JSON.stringify(input)}${error ? `: ${error}` : "."}`,
        ),
      );
    }, 15_000);
    child.once("error", (spawnError) => {
      clearTimeout(timeout);
      reject(spawnError);
    });
    child.once("exit", async (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(error || `Native recorder fixture exited ${code}.`));
        return;
      }
      try {
        resolvePromise(
          (await readFile(output, "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as unknown),
        );
      } catch (readError) {
        reject(readError);
      }
    });
  });
}

async function runRecorderProgram(
  executable: string,
  output: string,
  input: unknown,
  environment: Readonly<Record<string, string>>,
): Promise<readonly unknown[]> {
  return startRecorderProgram(executable, output, input, environment);
}

function recordedValue(output: readonly unknown[]): unknown {
  const value = (output[0] as { value?: unknown } | undefined)?.value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function implementationSources(directory: string): Promise<string[]> {
  const sources: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      sources.push(...(await implementationSources(path)));
    } else if (
      entry.isFile() &&
      /\.(?:rs|tsx?)$/.test(entry.name) &&
      !/\.(?:spec|testing|typecheck)\.tsx?$/.test(entry.name)
    ) {
      sources.push(path);
    }
  }
  return sources.sort();
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  await new Promise<void>((resolvePromise, reject) =>
    server.close((error) => (error ? reject(error) : resolvePromise())),
  );
  if (!address || typeof address === "string") throw new Error("Unable to allocate NATS port.");
  return address.port;
}

function startNatsServer(directory: string, port: number): Promise<ChildProcess> {
  const child = spawn(
    "nats-server",
    ["--jetstream", "--store_dir", directory, "--addr", "127.0.0.1", "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const receive = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Server is ready")) resolvePromise(child);
    };
    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`nats-server exited ${code}: ${output}`)));
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  await terminateProcess(child, "SIGINT");
}
