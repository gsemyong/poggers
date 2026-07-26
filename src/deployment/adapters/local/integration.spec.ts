import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, test } from "vitest";

import type { ProductionArtifacts } from "@/adapter";
import { compileSystem } from "@/compiler/source";
import type { System } from "@/core/system";
import {
  applyDeployment,
  createDeployment,
  createRelease,
  removeDeployment,
  type DependencyBinding,
} from "@/deployment";
import { createLocalDeploymentAdapter } from "@/deployment/adapters/local";
import { buildServerProgram } from "@/platforms/server/adapter/rust/compiler";
import {
  defineServerProductionDependency,
  jetStreamEventsDependency,
} from "@/platforms/server/adapter/rust/providers";

const directories: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGKILL");
      await new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
    }),
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test.skipIf(spawnSync("nats-server", ["--version"], { stdio: "ignore" }).status !== 0)(
  "realizes one durable Actor Program through local scale, replacement, and failure",
  { tags: ["production"], timeout: 180_000 },
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-local-production-deployment-"));
    directories.push(directory);
    const natsPort = await availablePort();
    const nats = await startNats(resolve(directory, "nats"), natsPort);
    children.push(nats);
    const source = resolve(directory, "src/system.ts");
    await mkdir(resolve(directory, "src"), { recursive: true });
    await writeFile(
      resolve(directory, "tsconfig.json"),
      JSON.stringify({
        extends: resolve(import.meta.dirname, "../../../../tsconfig.json"),
        compilerOptions: {
          paths: {
            "@/*": [resolve(import.meta.dirname, "../../../*")],
            kit: [resolve(import.meta.dirname, "../../../index.ts")],
            "kit/server": [resolve(import.meta.dirname, "../../../platforms/server/index.ts")],
          },
        },
      }),
    );
    await writeFile(source, actorSystemSource());
    const ir = compileSystem(source);
    const program = ir.programs.find(({ name }) => name === "server");
    if (!program) throw new Error("Local Deployment fixture has no server Program.");

    const releaseDirectory = resolve(directory, "release");
    const serverDirectory = resolve(releaseDirectory, "server");
    const executable = resolve(serverDirectory, "server");
    const built = await buildServerProgram({
      system: ir.system.name,
      dependencies: [jetStreamEventsDependency, recorderDependency()],
      directory,
      output: executable,
      program,
    });
    const artifacts: ProductionArtifacts = {
      directory: serverDirectory,
      entries: [
        {
          identity: program.id,
          kind: "program",
          deployment: "process",
          environment: program.environment.name,
          path: executable,
          entrypoint: executable,
          dependencies: Object.freeze(built.requirements.map(({ dependency }) => dependency)),
          configuration: Object.freeze(
            built.requirements.flatMap((requirement) =>
              requirement.configuration.map((field) => ({
                dependency: requirement.dependency,
                implementation: requirement.implementation,
                name: field.name,
                binding: { kind: "environment" as const, name: field.environment },
                required: field.required ?? false,
                ...(field.default === undefined ? {} : { default: field.default }),
                ...(field.allocation ? { allocation: field.allocation } : {}),
                ...(field.source ? { source: field.source } : {}),
              })),
            ),
          ),
          lifecycle: {
            shutdown: { kind: "signal", signal: "SIGINT" },
            status: { kind: "file", environment: "KIT_PROCESS_STATUS_FILE" },
          },
          target: { operatingSystem: process.platform, architecture: process.arch },
        },
      ],
    };
    const release = await createRelease({
      directory: releaseDirectory,
      system: ir.system.name,
      artifacts: { server: artifacts },
    });
    const state = resolve(directory, "deployment");
    const output = resolve(directory, "actor-output.jsonl");
    const server = `nats://127.0.0.1:${natsPort}`;
    const system = {} as System<{
      Programs: {
        server: {
          Environment: { Name: "server"; Platform: { Name: "server" } };
          Requires: { alarm: object; events: object; recorder: object };
          Provides: {};
        };
      };
    }>;
    const dependencies = (input: Readonly<{ id: string; key: string; amount: number }>) => ({
      alarm: binding("alarm", {
        servers: server,
        stream: `KIT_LOCAL_ALARMS_${natsPort}`,
        state: `KIT_LOCAL_ALARM_STATE_${natsPort}`,
        replicas: 1,
      }),
      events: binding("events-jetstream", {
        servers: server,
        stream: `KIT_LOCAL_EVENTS_${natsPort}`,
      }),
      recorder: binding("recorder-fixture", {
        input: JSON.stringify(input),
        output,
      }),
    });
    const adapter = createLocalDeploymentAdapter({
      artifacts: releaseDirectory,
      state,
      startupTimeoutMs: 10_000,
      shutdownTimeoutMs: 3_000,
    });
    const one = createDeployment(system, {
      adapter,
      programs: { server: { replicas: 1 } },
      dependencies: dependencies({ id: "first", key: "counter", amount: 1 }),
    });
    const initial = await applyDeployment(one, release);
    await expect.poll(() => recordedValues(output), { timeout: 20_000 }).toEqual([1]);
    const firstId = initial.state.artifacts[0]!.processes![0]!.id;

    const three = createDeployment(system, {
      adapter,
      programs: { server: { replicas: 3 } },
      dependencies: one.dependencies,
    });
    const scaled = await applyDeployment(three, release);
    expect(scaled.plan.operations).toEqual([
      expect.objectContaining({ type: "scale", from: 1, to: 3 }),
    ]);
    expect(scaled.state.artifacts[0]!.processes!.map(({ id }) => id)).toContain(firstId);
    await expect.poll(() => recordedValues(output), { timeout: 20_000 }).toEqual([1, 1, 1]);

    const reconfigured = createDeployment(system, {
      adapter,
      programs: { server: { replicas: 3 } },
      dependencies: dependencies({ id: "second", key: "counter", amount: 2 }),
    });
    const replaced = await applyDeployment(reconfigured, release);
    expect(replaced.plan.operations).toEqual([]);
    expect(replaced.state.artifacts[0]!.processes!.map(({ id }) => id)).not.toContain(firstId);
    await expect
      .poll(() => recordedValues(output), { timeout: 20_000 })
      .toEqual([1, 1, 1, 3, 3, 3]);

    const failed = replaced.state.artifacts[0]!.processes![0]!;
    process.kill(failed.pid!, "SIGKILL");
    await expect.poll(async () => (await adapter.inspect())?.converged).toBe(false);
    const healed = await applyDeployment(reconfigured, release);
    expect(healed.plan.operations).toEqual([
      expect.objectContaining({ type: "scale", from: 2, to: 3 }),
    ]);
    await expect
      .poll(() => recordedValues(output), { timeout: 20_000 })
      .toEqual([1, 1, 1, 3, 3, 3, 3]);

    const scaledIn = createDeployment(system, {
      adapter,
      programs: { server: { replicas: 1 } },
      dependencies: reconfigured.dependencies,
    });
    const final = await applyDeployment(scaledIn, release);
    expect(final.plan.operations).toEqual([
      expect.objectContaining({ type: "scale", from: 3, to: 1 }),
    ]);
    expect(final.state.artifacts[0]!.processes).toHaveLength(1);
    await removeDeployment(scaledIn);
  },
);

function binding(implementation: string, configuration: object): DependencyBinding {
  return { implementation, configuration } as DependencyBinding;
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
      directory: resolve(
        import.meta.dirname,
        "../../../platforms/server/adapter/rust/fixtures/recorder",
      ),
    },
    rust: {
      type: "kit_server_recorder::Recorder",
      constructor: "kit_server_recorder::create",
    },
  });
}

async function recordedValues(path: string): Promise<number[]> {
  const contents = await readFile(path, "utf8").catch(() => "");
  return contents
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { value?: unknown })
    .flatMap(({ value }) => (typeof value === "string" ? [Number(value)] : []));
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
  if (!address || typeof address === "string") throw new Error("Unable to allocate a NATS port.");
  return address.port;
}

function startNats(directory: string, port: number): Promise<ChildProcess> {
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

function actorSystemSource(): string {
  return `
import {
  createActor,
  createFeature,
  createSystem,
  type Actor,
  type Dependency,
  type Program,
} from "kit";
import type { ServerProcess } from "kit/server";

type Counter = Actor<{
  Name: "counter";
  Key: string;
  State: { value: number };
  Methods: {
    add: Actor.Method<{ amount: number }, { value: number }>;
  };
}>;
const counter = createActor<Counter>({
  state: () => ({ value: 0 }),
  methods: {
    add({ state, input }) {
      state.value += input.amount;
      return { value: state.value };
    },
  },
});

type Command = { id: string; key: string; amount: number };
type Recorder = Dependency<{
  Operations: {
    read(input: {}): Promise<Command>;
    record(input: { value: string }): Promise<void>;
  };
}>;
type Probe = {
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: {
          counter: Actor.Reference<typeof counter>;
          recorder: Recorder;
        };
      }
    >;
  };
};
const probe = createFeature<Probe>({
  programs: {
    server: {
      async start({ dependencies }) {
        const command = await dependencies.recorder.read({});
        const result = await dependencies.counter
          .get({ key: command.key })
          .add(
            { amount: command.amount },
            { idempotencyKey: command.id },
          );
        if (result.status !== "succeeded") throw new Error("Actor command failed.");
        await dependencies.recorder.record({ value: \`\${result.value.value}\` });
      },
    },
  },
});

export default createSystem({
  metadata: { name: "Local production Deployment" },
  features: { counter, probe },
});
`;
}
