import { describe, it, expect, afterEach } from "bun:test";
import { serve } from "infra/server";
import { connect } from "infra/client";
import { createTestApp } from "tests/helpers/test-app";
import { createMemoryClientStore } from "tests/helpers/memory-storage";
import { createTempDir } from "tests/helpers/temp-dir";
import { createFileStore } from "infra/store/fs";
import { createSingleNodeAdapter } from "infra/store/single-node";
import { poll } from "tests/helpers/wait";

const app = createTestApp("test-token");

describe("e2e: FS recovery", () => {
  let handle: ReturnType<typeof serve> | null = null;
  let tempDir: ReturnType<typeof createTempDir> | null = null;

  afterEach(() => {
    if (handle) {
      handle.stop();
      handle = null;
    }
    if (tempDir) {
      tempDir.cleanup();
      tempDir = null;
    }
  });

  it("recovers state from snapshot after restart", async () => {
    tempDir = createTempDir();
    const storage = createFileStore(tempDir.path);

    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(storage),
      snapshotIntervalMs: 100,
    });

    const url = handle.url;

    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "recovery" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "recovery" });
    counter.increment(100);

    await poll(() => counter.count === 100);

    await new Promise((r) => setTimeout(r, 300));
    handle.stop();
    handle = null;

    await new Promise((r) => setTimeout(r, 100));

    const storage2 = createFileStore(tempDir.path);
    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(storage2),
      snapshotIntervalMs: 60000,
    });

    const client2 = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected2 = false;
    client2.counter({ counterId: "recovery" }).subscribe(() => {
      connected2 = true;
    });
    await poll(() => connected2);
    const counter2 = client2.counter({ counterId: "recovery" });
    await poll(() => counter2.count === 100);
    expect(counter2.count).toBe(100);
  });

  it("recovers state from event log when restart before snapshot", async () => {
    tempDir = createTempDir();
    const storage = createFileStore(tempDir.path);

    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(storage),
      snapshotIntervalMs: 60000,
    });

    const url = handle.url;

    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "event-log" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "event-log" });
    counter.increment(50);

    await poll(() => counter.count === 50);

    handle.stop();
    handle = null;

    await new Promise((r) => setTimeout(r, 100));

    const storage2 = createFileStore(tempDir.path);
    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(storage2),
      snapshotIntervalMs: 60000,
    });

    const client2 = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected2 = false;
    client2.counter({ counterId: "event-log" }).subscribe(() => {
      connected2 = true;
    });
    await poll(() => connected2);
    const counter2 = client2.counter({ counterId: "event-log" });
    await poll(() => counter2.count === 50);
    expect(counter2.count).toBe(50);
  });

  it("recovers multiple scopes after restart", async () => {
    tempDir = createTempDir();
    const storage = createFileStore(tempDir.path);

    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(storage),
      snapshotIntervalMs: 100,
    });

    const url = handle.url;
    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "multi-a" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const c1 = client.counter({ counterId: "multi-a" });
    const c2 = client.counter({ counterId: "multi-b" });
    c1.increment(10);
    c2.increment(20);

    await poll(() => c1.count === 10 && c2.count === 20);
    await new Promise((r) => setTimeout(r, 300));

    handle.stop();
    handle = null;

    await new Promise((r) => setTimeout(r, 100));

    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(createFileStore(tempDir.path)),
      snapshotIntervalMs: 60000,
    });

    const client2 = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected2 = false;
    client2.counter({ counterId: "multi-a" }).subscribe(() => {
      connected2 = true;
    });
    await poll(() => connected2);

    const r1 = client2.counter({ counterId: "multi-a" });
    const r2 = client2.counter({ counterId: "multi-b" });

    await poll(() => r1.count === 10 && r2.count === 20);
    expect(r1.count).toBe(10);
    expect(r2.count).toBe(20);
  });

  it("server stops replay at event log sequence gap", async () => {
    tempDir = createTempDir();
    const storage = createFileStore(tempDir.path);

    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(storage),
      snapshotIntervalMs: 60000,
    });

    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "gap-test" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "gap-test" });
    counter.increment(10);
    counter.increment(20);
    counter.increment(30);

    await poll(() => counter.count === 60);
    handle.stop();
    handle = null;

    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { scopeId } = await import("infra/protocol");

    const id = scopeId("counter", { counterId: "gap-test" });
    const encoded = encodeURIComponent(id);
    const logPath = join(tempDir.path, `${encoded}.events.jsonl`);

    writeFileSync(
      logPath,
      JSON.stringify({
        id: "a",
        seq: 1,
        at: 1,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 10 },
      }) +
        "\n" +
        JSON.stringify({
          id: "b",
          seq: 3,
          at: 2,
          actor: { id: "u", name: "U" },
          name: "incremented",
          payload: { amount: 30 },
        }) +
        "\n",
      "utf8",
    );

    handle = serve(app, {
      port: 0,
      adapter: createSingleNodeAdapter(createFileStore(tempDir.path)),
      snapshotIntervalMs: 60000,
    });

    const client2 = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected2 = false;
    client2.counter({ counterId: "gap-test" }).subscribe(() => {
      connected2 = true;
    });
    await poll(() => connected2);
    const c2 = client2.counter({ counterId: "gap-test" });

    await poll(() => c2.count === 10, { timeoutMs: 2000 });

    expect(c2.count).toBe(10);
  });
});
