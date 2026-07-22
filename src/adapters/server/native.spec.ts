import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import fc from "fast-check";
import { afterEach, expect, test } from "vitest";

import { buildNativeServerProgram } from "@/adapters/server/native";
import { nativeJetStreamEvents } from "@/adapters/server/native/capabilities";
import { defineNativeCapabilityAdapter } from "@/contracts/native";
import type { ProgramIR, SourceSpan } from "@/core/compiler/ir";
import { compileApplication } from "@/core/compiler/source";
import { executeLinkedProgramIR } from "@/core/development";

const directories: string[] = [];
const processes: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(processes.splice(0).map(stopProcess));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

test("caches native artifacts by semantic output rather than source spans", async () => {
  const directory = await temporaryDirectory();
  const cache = resolve(directory, "cache");
  const first = await buildNativeServerProgram({
    application: "cache-fixture",
    cache,
    directory,
    output: resolve(directory, "first"),
    program: emptyProgram({ file: "first.ts", line: 1, column: 1 }),
  });
  const second = await buildNativeServerProgram({
    application: "cache-fixture",
    cache,
    directory,
    output: resolve(directory, "second"),
    program: emptyProgram({ file: "renamed.ts", line: 200, column: 40 }),
  });

  expect(first.cache).toBe("miss");
  expect(second.cache).toBe("hit");
  expect(second.semanticHash).toBe(first.semanticHash);
  expect(second.workspace).toBe(first.workspace);
  await expect(access(second.executable)).resolves.toBeUndefined();
}, 120_000);

test("rejects unknown external Capabilities and host source before Cargo", async () => {
  const directory = await temporaryDirectory();
  const program = emptyProgram({ file: "program.ts", line: 1, column: 1 });
  await expect(
    buildNativeServerProgram({
      application: "invalid",
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
  ).rejects.toThrow('missing Capability "unknown"');

  await expect(
    buildNativeServerProgram({
      application: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "incompatible"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            requires: [{ name: "clock", type: { kind: "primitive", name: "number" } }],
          },
        ],
      },
    }),
  ).rejects.toThrow('cannot bind incompatible Capability "clock"');

  await expect(
    buildNativeServerProgram({
      application: "invalid",
      cache: resolve(directory, "cache"),
      directory,
      output: resolve(directory, "source"),
      program: {
        ...program,
        contributions: [
          {
            ...program.contributions[0]!,
            implementation: {
              kind: "source",
              reason: "host-source",
              span: { file: "program.ts", line: 4, column: 3 },
            },
          },
        ],
      },
    }),
  ).rejects.toThrow("is source, not native-realizable product meaning");
});

test("keeps shipped Feature and infrastructure policy out of generic native machinery", async () => {
  const sources = await Promise.all(
    [
      resolve(import.meta.dirname, "native.ts"),
      resolve(import.meta.dirname, "native/program.ts"),
      resolve(import.meta.dirname, "native/runtime/src/lib.rs"),
      resolve(import.meta.dirname, "../../contracts/native.ts"),
      resolve(import.meta.dirname, "../../core/compiler/source.ts"),
    ].map((path) => readFile(path, "utf8")),
  );
  const genericMachinery = sources.join("\n");

  for (const forbidden of [
    "createIdentity",
    "createEntity",
    "poggers_users",
    "poggers_sessions",
    "poggers_events",
    "POGGERS_DATABASE",
  ]) {
    expect(genericMachinery, `${forbidden} leaked into generic machinery`).not.toContain(forbidden);
  }
});

test("injects an unrelated native Capability into an expanded generic Feature", async () => {
  const directory = await temporaryDirectory();
  const source = resolve(directory, "src/app.ts");
  await mkdir(resolve(directory, "src"), { recursive: true });
  await writeFile(source, genericFeatureSource());
  const ir = compileApplication(source);
  const program = ir.programs.find(({ name }) => name === "worker");
  if (!program) throw new Error("Fixture has no worker Program.");
  const executable = resolve(directory, "worker");
  const build = await buildNativeServerProgram({
    application: ir.application.name,
    adapters: [recorderAdapter()],
    cache: resolve(directory, "cache"),
    directory,
    output: executable,
    program,
  });
  const generatedProgram = await readFile(resolve(build.workspace, "src/program.rs"), "utf8");
  const generatedMain = await readFile(resolve(build.workspace, "src/main.rs"), "utf8");
  expect(generatedProgram).toContain("recorder");
  expect(generatedProgram).toContain("format");
  expect(generatedMain).toContain("program::start");
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
        const execution = await executeLinkedProgramIR(program, {
          recorder: {
            async read() {
              return input;
            },
            async record(value: unknown) {
              reference.push(value);
            },
          },
        });
        await execution[Symbol.asyncDispose]();
        const output = resolve(directory, `native-output-${run++}.jsonl`);
        const native = await runNativeFixture(executable, output, input);
        expect(native).toEqual(reference);
      },
    ),
    { numRuns: 20 },
  );
}, 120_000);

test.skipIf(spawnSync("nats-server", ["--version"], { stdio: "ignore" }).status !== 0)(
  "coordinates independent native replicas through a selected JetStream adapter",
  async () => {
    const directory = await temporaryDirectory();
    const natsPort = await availablePort();
    const nats = await startNatsServer(resolve(directory, "nats"), natsPort);
    processes.push(nats);
    const source = resolve(directory, "src/app.ts");
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(source, networkFeatureSource());
    const ir = compileApplication(source);
    const program = ir.programs.find(({ name }) => name === "worker");
    if (!program) throw new Error("Network fixture has no worker Program.");
    const executable = resolve(directory, "worker");
    await buildNativeServerProgram({
      application: ir.application.name,
      adapters: [nativeJetStreamEvents, networkRecorderAdapter()],
      cache: resolve(directory, "cache"),
      directory,
      lint: true,
      output: executable,
      program,
    });
    const environment = {
      NATS_URL: `nats://127.0.0.1:${natsPort}`,
      POGGERS_EVENT_STREAM: `POGGERS_NATIVE_REPLICAS_${natsPort}`,
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
  180_000,
);

function emptyProgram(span: SourceSpan): ProgramIR {
  return {
    id: "program/worker",
    name: "worker",
    environment: { name: "server", platform: "server" },
    contributions: [
      {
        id: "feature/worker/program/worker",
        feature: "worker",
        requires: [],
        provides: [],
        implementation: { kind: "none" },
        span,
      },
    ],
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-native-adapter-"));
  directories.push(directory);
  return directory;
}

function recorderAdapter() {
  return defineNativeCapabilityAdapter({
    name: "recorder-fixture",
    platform: "server",
    contract: {
      name: "recorder",
      operations: [
        {
          name: "read",
          mode: "asynchronous",
          input: { kind: "record", fields: [] },
          output: {
            kind: "record",
            fields: [
              {
                name: "left",
                optional: false,
                type: { kind: "primitive", name: "number" },
              },
              {
                name: "right",
                optional: false,
                type: { kind: "primitive", name: "number" },
              },
            ],
          },
        },
        {
          name: "record",
          mode: "asynchronous",
          input: {
            kind: "record",
            fields: [
              {
                name: "value",
                optional: false,
                type: { kind: "primitive", name: "string" },
              },
            ],
          },
          output: { kind: "primitive", name: "void" },
        },
      ],
    },
    configuration: [
      { name: "output", environment: "POGGERS_RECORDER_OUTPUT", required: true },
      { name: "input", environment: "POGGERS_RECORDER_INPUT", required: true },
    ],
    crate: {
      package: "poggers-native-recorder",
      directory: resolve(import.meta.dirname, "native/fixtures/recorder"),
    },
    rust: {
      type: "poggers_native_recorder::Recorder",
      constructor: "poggers_native_recorder::create",
    },
  });
}

function networkRecorderAdapter() {
  return defineNativeCapabilityAdapter({
    ...recorderAdapter(),
    name: "network-recorder-fixture",
    contract: {
      name: "recorder",
      operations: [
        {
          name: "read",
          mode: "asynchronous",
          input: { kind: "record", fields: [] },
          output: { kind: "any" },
        },
        {
          name: "record",
          mode: "asynchronous",
          input: {
            kind: "record",
            fields: [{ name: "value", optional: false, type: { kind: "any" } }],
          },
          output: { kind: "primitive", name: "void" },
        },
      ],
    },
  });
}

function genericFeatureSource(): string {
  return `
type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
type Feature<C> = unknown;
type Application<C> = unknown;
type Formatter = { format(input: { value: string }): Promise<string> };
type Recorder = {
  read(input: {}): Promise<{ left: number; right: number }>;
  record(input: { value: string }): Promise<void>;
};
type Formatting = { Programs: { worker: Program<Environment, { Requires: { recorder: Recorder }; Provides: { formatter: Formatter } }> } };
type Consumer = { Programs: { worker: Program<Environment, { Requires: { formatter: Formatter; recorder: Recorder } }> } };
type App = { Features: { formatting: Formatting; consumer: Consumer } };

function createFormatting<const Prefix extends string>(prefix: Prefix): Feature<Formatting> {
  return {
    programs: {
      worker: {
        start({ capabilities }: { capabilities: { recorder: Recorder } }) {
          return {
            formatter: {
              async format({ value }: { value: string }) {
                return \`${"${prefix}"}${"${value}"}\`;
              },
              async [Symbol.asyncDispose]() {
                await capabilities.recorder.record({ value: "disposed" });
              },
            },
          };
        },
      },
    },
  } as Feature<Formatting>;
}

const formatting = createFormatting("native:");
const consumer = {
  programs: {
    worker: {
      async start({ capabilities }: { capabilities: { formatter: Formatter; recorder: Recorder } }) {
        const input = await capabilities.recorder.read({});
        const value = await capabilities.formatter.format({ value: \`${"${input.left + input.right}"}\` });
        await capabilities.recorder.record({ value });
      },
    },
  },
} satisfies Feature<Consumer>;

export default {
  metadata: { name: "Generic native fixture" },
  features: { formatting, consumer },
} satisfies Application<App>;
`;
}

function networkFeatureSource(): string {
  return `
type Platform = { readonly Name: "server" };
type Environment = { readonly Name: "server"; readonly Platform: Platform };
type Program<E extends Environment, C extends object = {}> = Readonly<C & { Environment: E }>;
type Feature<C> = unknown;
type Application<C> = unknown;
type StoredEvent = { stream: string; revision: number; event: { value: string } };
type Events = {
  read(input: { stream: string; after?: number }): Promise<readonly StoredEvent[]>;
  append(input: { stream: string; expectedRevision: number; events: readonly { value: string }[] }): Promise<readonly StoredEvent[] | undefined>;
  subscribe(input: { stream: string; after?: number }): AsyncIterable<StoredEvent>;
};
type Command = { action: string; stream: string; expectedRevision: number; after: number; value: string };
type Recorder = {
  read(input: {}): Promise<Command>;
  record(input: { value: string }): Promise<void>;
};
type Worker = { Programs: { worker: Program<Environment, { Requires: { events: Events; recorder: Recorder } }> } };
type App = { Features: { worker: Worker } };

const worker = {
  programs: {
    worker: {
      async start({ capabilities }: { capabilities: { events: Events; recorder: Recorder } }) {
        const command = await capabilities.recorder.read({});
        if (command.action === "append") {
          const appended = await capabilities.events.append({
            stream: command.stream,
            expectedRevision: command.expectedRevision,
            events: [{ value: command.value }],
          });
          await capabilities.recorder.record({ value: appended ? "appended" : "conflict" });
          return;
        }
        if (command.action === "read") {
          const history = await capabilities.events.read({ stream: command.stream, after: command.after });
          await capabilities.recorder.record({ value: JSON.stringify(history) });
          return;
        }
        for await (const event of capabilities.events.subscribe({ stream: command.stream, after: command.after })) {
          await capabilities.recorder.record({ value: JSON.stringify(event) });
          return;
        }
      },
    },
  },
} satisfies Feature<Worker>;

export default {
  metadata: { name: "Native network fixture" },
  features: { worker },
} satisfies Application<App>;
`;
}

async function runNativeFixture(
  executable: string,
  output: string,
  input: unknown,
): Promise<readonly unknown[]> {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      POGGERS_RECORDER_INPUT: JSON.stringify(input),
      POGGERS_RECORDER_OUTPUT: output,
    },
    stdio: "pipe",
  });
  let error = "";
  child.stderr.setEncoding("utf8").on("data", (value: string) => (error += value));
  await expect
    .poll(async () => readFile(output, "utf8").catch(() => ""), { timeout: 10_000 })
    .toContain("native:");
  child.kill("SIGINT");
  await new Promise<void>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGINT") resolvePromise();
      else reject(new Error(error || `Native fixture exited ${code ?? signal}.`));
    });
  });
  return (await readFile(output, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
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
      POGGERS_RECORDER_INPUT: JSON.stringify(input),
      POGGERS_RECORDER_OUTPUT: output,
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
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
  child.kill("SIGTERM");
  await exited;
}
