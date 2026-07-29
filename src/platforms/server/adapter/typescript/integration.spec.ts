import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, test } from "vitest";

import { createJetStreamEventStore } from "@/platforms/server/adapter/typescript/host";

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
    const directory = await mkdtemp(resolve(tmpdir(), "kit-jetstream-"));
    directories.push(directory);
    const port = await availablePort();
    const server = await startNatsServer(directory, port);
    processes.push(server);
    const options = {
      kind: "jetstream" as const,
      servers: `nats://127.0.0.1:${port}`,
      stream: `KIT_REPLICA_${port}`,
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
      const firstScan = await second.scan({ limit: 1 });
      expect(firstScan).toHaveLength(1);
      expect(firstScan[0]).toMatchObject({
        stream: "orders:one",
        revision: 1,
        event: { value: "created" },
      });
      await expect(second.scan({ after: firstScan[0]!.cursor, limit: 2 })).resolves.toEqual([
        {
          cursor: expect.any(String),
          stream: "orders:one",
          revision: 2,
          event: { value: "confirmed" },
        },
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
      await expect(first.compact({ stream: "orders:one", through: 4 })).rejects.toThrow(
        "has no safe snapshot",
      );
      await expect(
        first.saveSnapshot({
          stream: "orders:one",
          expectedRevision: 0,
          revision: 4,
          snapshot: { value: "shipped" },
        }),
      ).resolves.toBe(true);
      await expect(
        second.saveSnapshot({
          stream: "orders:one",
          expectedRevision: 0,
          revision: 4,
          snapshot: { value: "stale" },
        }),
      ).resolves.toBe(false);
      await first.compact({ stream: "orders:one", through: 4 });
      await expect(second.read({ stream: "orders:one" })).resolves.toEqual([]);
      await expect(
        second.append({
          stream: "orders:one",
          expectedRevision: 4,
          events: [{ value: "delivered" }],
        }),
      ).resolves.toEqual([
        {
          stream: "orders:one",
          revision: 5,
          event: { value: "delivered" },
        },
      ]);

      await second[Symbol.asyncDispose]();
      second = await createJetStreamEventStore<{ value: string }>(options);
      const caughtUp = await second.read({ stream: "orders:one" });
      expect(caughtUp.map(({ revision }) => revision)).toEqual([5]);
      await expect(second.loadSnapshot({ stream: "orders:one" })).resolves.toEqual({
        stream: "orders:one",
        revision: 4,
        snapshot: { value: "shipped" },
      });
    } finally {
      await Promise.allSettled([first[Symbol.asyncDispose](), second[Symbol.asyncDispose]()]);
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
