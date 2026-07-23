import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, test } from "vitest";

import { createJetStreamEventStore, createNodeHost } from "@/adapters/server/development/host";
import { createEntity, type EntityEvent, type EntityModel } from "@/features/entity";
import { createProgramContributionInstance } from "@/runtime/process";

type Note = Readonly<{ id: string; ownerId: string; text: string }>;
type Notes = EntityModel<{
  Name: "notes";
  Principal: Readonly<{ id: string }>;
  Value: Note;
  Create: Readonly<{ text: string }>;
  Update: Readonly<{ text?: string }>;
  Filter: Readonly<Record<string, never>>;
}>;

const notes = createEntity<Notes>({
  name: "notes",
  create: ({ id, principal, input }) => ({ id, ownerId: principal.id, text: input.text }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: ({ principal, entity }) => principal.id === entity.ownerId,
});

const available = spawnSync("nats-server", ["--version"], { stdio: "ignore" }).status === 0;
const directories: string[] = [];
const processes: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(processes.splice(0).map(stopProcess));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

test.skipIf(!available)(
  "two isolated replicas share contiguous durable JetStream history",
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-jetstream-"));
    directories.push(directory);
    const port = await availablePort();
    const server = await startNatsServer(directory, port);
    processes.push(server);
    const options = {
      kind: "jetstream" as const,
      servers: `nats://127.0.0.1:${port}`,
      stream: `POGGERS_REPLICA_${port}`,
    };
    const [first, initialSecond] = await Promise.all([
      createJetStreamEventStore<{ value: string }>(options),
      createJetStreamEventStore<{ value: string }>(options),
    ]);
    let second = initialSecond;
    try {
      expect(
        await first.append({
          stream: "orders:one",
          expectedRevision: 0,
          events: [{ value: "created" }, { value: "confirmed" }],
        }),
      ).toHaveLength(2);
      expect(await second.read({ stream: "orders:one" })).toEqual([
        { stream: "orders:one", revision: 1, event: { value: "created" } },
        { stream: "orders:one", revision: 2, event: { value: "confirmed" } },
      ]);

      const contenders = await Promise.all([
        first.append({
          stream: "orders:one",
          expectedRevision: 2,
          events: [{ value: "first" }],
        }),
        second.append({
          stream: "orders:one",
          expectedRevision: 2,
          events: [{ value: "second" }],
        }),
      ]);
      expect(contenders.filter(Boolean)).toHaveLength(1);
      expect(contenders.filter((result) => result === undefined)).toHaveLength(1);

      const iterator = first.subscribe({ stream: "orders:one", after: 3 })[Symbol.asyncIterator]();
      const pending = iterator.next();
      expect(
        await second.append({
          stream: "orders:one",
          expectedRevision: 3,
          events: [{ value: "shipped" }],
        }),
      ).toHaveLength(1);
      await expect(pending).resolves.toEqual({
        done: false,
        value: { stream: "orders:one", revision: 4, event: { value: "shipped" } },
      });
      await iterator.return?.();

      await second[Symbol.asyncDispose]();
      second = await createJetStreamEventStore<{ value: string }>(options);
      const caughtUp = await second.read({ stream: "orders:one" });
      expect(caughtUp.map(({ revision }) => revision)).toEqual([1, 2, 3, 4]);
    } finally {
      await Promise.allSettled([first[Symbol.asyncDispose](), second[Symbol.asyncDispose]()]);
    }
  },
);

test.skipIf(!available)(
  "two isolated Program replicas authorize and catch up through a network authority",
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-program-replicas-"));
    directories.push(directory);
    const natsPort = await availablePort();
    const server = await startNatsServer(directory, natsPort);
    processes.push(server);
    const firstPort = await availablePort();
    const secondPort = await availablePort();
    const options = {
      kind: "jetstream" as const,
      servers: `nats://127.0.0.1:${natsPort}`,
      stream: `POGGERS_PROGRAM_REPLICAS_${natsPort}`,
    };
    const first = await startReplica(resolve(directory, "first"), firstPort, options);
    let second = await startReplica(resolve(directory, "second"), secondPort, options);
    try {
      const created = await request<Note>(firstPort, "alice", "/api/notes", {
        method: "POST",
        body: JSON.stringify({ text: "Network authority" }),
        headers: {
          "content-type": "application/json",
          "x-poggers-command": "create-network-note",
          "x-poggers-entity": "network-note",
        },
      });
      await expect
        .poll(
          async () =>
            (await request<{ entities: readonly Note[] }>(secondPort, "alice", "/api/notes"))
              .entities,
        )
        .toEqual([created]);
      await expect(request(secondPort, "bob", "/api/notes")).resolves.toMatchObject({
        entities: [],
      });

      await second.dispose();
      second = await startReplica(resolve(directory, "second-restarted"), secondPort, options);
      await expect(request(secondPort, "alice", "/api/notes")).resolves.toMatchObject({
        revision: 1,
        entities: [created],
      });
    } finally {
      await Promise.allSettled([first.dispose(), second.dispose()]);
    }
  },
);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("Unable to allocate NATS port.");
  return address.port;
}

async function startReplica(
  directory: string,
  port: number,
  eventStore: Parameters<typeof createJetStreamEventStore>[0],
) {
  const [events, host] = await Promise.all([
    createJetStreamEventStore<EntityEvent<Note>>(eventStore),
    createNodeHost({
      dependencies: [
        {
          name: "http",
          operations: [
            {
              name: "route",
              mode: "synchronous",
              input: { kind: "opaque", name: "Input" },
              output: { kind: "opaque", name: "Disposable" },
            },
          ],
        },
      ] as const,
      directory,
      host: "127.0.0.1",
      port,
    }),
  ]);
  const process = createProgramContributionInstance(notes.server.programs.server as never, {
    address: { program: "api", feature: "notes" },
    provides: ["notes"],
    dependencies: {
      events,
      http: host.http,
      identifiers: { create: randomUUID },
      clock: { now: Date.now },
      identity: {
        authenticate: async ({ cookie }: { cookie: string | undefined }) =>
          cookie ? { id: cookie } : undefined,
      },
    },
  });
  try {
    await process.start();
  } catch (error) {
    await Promise.allSettled([events[Symbol.asyncDispose](), host.http[Symbol.asyncDispose]()]);
    throw error;
  }
  let disposed = false;
  return {
    async dispose() {
      if (disposed) return;
      disposed = true;
      await process.dispose();
      await Promise.all([events[Symbol.asyncDispose](), host.http[Symbol.asyncDispose]()]);
    },
  };
}

async function request<Value>(
  port: number,
  principal: string,
  path: string,
  init: RequestInit = {},
): Promise<Value> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { cookie: principal, ...Object.fromEntries(new Headers(init.headers)) },
  });
  if (!response.ok) throw new Error(`Replica request failed with ${response.status}.`);
  return (await response.json()) as Value;
}

function startNatsServer(directory: string, port: number): Promise<ChildProcess> {
  const child = spawn(
    "nats-server",
    ["--jetstream", "--store_dir", directory, "--addr", "127.0.0.1", "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let output = "";
    const receive = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Server is ready")) resolve(child);
    };
    child.stdout?.on("data", receive);
    child.stderr?.on("data", receive);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`nats-server exited ${code}: ${output}`)));
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  await exited;
}
