import { describe, it, expect, afterEach } from "bun:test";
import { serve } from "../src/server";
import { connect } from "../src/client";
import { createTestApp } from "./helpers/test-app";
import { createMemoryClientStore, createMemoryStore } from "./helpers/memory-storage";
import { createFileStore } from "@poggers/kit/storage";
import { createTempDir } from "./helpers/temp-dir";
import { poll, withSuppressedConsole } from "./helpers/wait";

const app = createTestApp("test-token");

let tempDir: ReturnType<typeof createTempDir> | null = null;

describe("e2e: real WebSocket", () => {
  let handle: ReturnType<typeof serve> | null = null;

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

  async function startServer() {
    const storage = createMemoryStore();
    handle = serve(app, {
      port: 0,
      storage,
      snapshotIntervalMs: 60000,
    });
    return { url: handle.url, storage };
  }

  it("client connects and receives init", async () => {
    const { url } = await startServer();

    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "any" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);
  });

  it("command updates client state", async () => {
    const { url } = await startServer();

    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "e2e-1" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "e2e-1" });
    counter.increment(42);

    await poll(() => counter.count === 42);
    expect(counter.count).toBe(42);
  });

  it("two clients in same scope converge", async () => {
    const { url } = await startServer();

    const clientA = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    const clientB = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let aOk = false,
      bOk = false;
    clientA.counter({ counterId: "shared" }).subscribe(() => {
      aOk = true;
    });
    clientB.counter({ counterId: "shared" }).subscribe(() => {
      bOk = true;
    });
    await poll(() => aOk && bOk);

    const counterA = clientA.counter({ counterId: "shared" });
    const counterB = clientB.counter({ counterId: "shared" });

    counterA.increment(100);

    await poll(() => counterA.count === 100 && counterB.count === 100);
    expect(counterA.count).toBe(100);
    expect(counterB.count).toBe(100);
  });

  it("different scopes do not leak events", async () => {
    const { url } = await startServer();

    const clientA = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    const clientB = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let aOk = false,
      bOk = false;
    clientA.counter({ counterId: "scope-a" }).subscribe(() => {
      aOk = true;
    });
    clientB.counter({ counterId: "scope-b" }).subscribe(() => {
      bOk = true;
    });
    await poll(() => aOk && bOk);

    const counterA = clientA.counter({ counterId: "scope-a" });
    const counterB = clientB.counter({ counterId: "scope-b" });

    counterA.increment(50);

    await poll(() => counterA.count === 50);
    expect(counterA.count).toBe(50);
    expect(counterB.count).toBe(0);
  });

  it("unauthorized client is rejected", async () => {
    const { url } = await startServer();

    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "bad-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let _subscribeFired = false;
    client.counter({ counterId: "bad-token-self" }).subscribe(() => {
      _subscribeFired = true;
    });
    const checkCounter = client.counter({ counterId: "bad-token-self" });

    await new Promise((r) => setTimeout(r, 300));

    expect((checkCounter as any).sessions.length).toBe(0);
  });

  it("multi-event command assigns sequential server seqs", async () => {
    const { url } = await startServer();

    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "multi" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "multi" });
    (counter as any).emitTwoEvents();

    await poll(() => counter.count === 3);
    expect(counter.count).toBe(3);
    expect(counter.sync.cursor).toBe(2);
  });

  it("late subscriber receives server state", async () => {
    const { url } = await startServer();

    const client1 = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let c1ok = false;
    client1.counter({ counterId: "delta" }).subscribe(() => {
      c1ok = true;
    });
    await poll(() => c1ok);

    const c1 = client1.counter({ counterId: "delta" });
    c1.increment(10);
    await poll(() => c1.count === 10);

    const client2 = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let c2ok = false;
    client2.counter({ counterId: "delta" }).subscribe(() => {
      c2ok = true;
    });
    await poll(() => c2ok);

    const c2 = client2.counter({ counterId: "delta" });
    await poll(() => c2.count === 10);
    expect(c2.count).toBe(10);
  });

  it("server does not crash on malformed JSON", async () => {
    const { url } = await startServer();

    const client = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "malformed" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
    await new Promise((r) => {
      (ws as any).onopen = r;
    });

    withSuppressedConsole(["error"], () => {
      (ws as any).send("not valid json{{{");
      ws.close();
    });

    await new Promise((r) => setTimeout(r, 100));

    const counter = client.counter({ counterId: "malformed" });
    counter.increment(1);
    await poll(() => counter.count === 1);
    expect(counter.count).toBe(1);
  });

  it("presence update via command propagates to other client", async () => {
    const { url } = await startServer();

    const clientA = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    const clientB = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let aOk = false,
      bOk = false;
    clientA.counter({ counterId: "any" }).subscribe(() => {
      aOk = true;
    });
    clientB.counter({ counterId: "any" }).subscribe(() => {
      bOk = true;
    });
    await poll(() => aOk && bOk);

    const docA = clientA.doc({ docId: "presence-test" });
    const docB = clientB.doc({ docId: "presence-test" });
    (docA as any).changeTitle("presence-via-title");

    await poll(() => (docB as any).title === "presence-via-title");
    expect((docB as any).title).toBe("presence-via-title");
  });

  it("session leave propagates on disconnect", async () => {
    const { url } = await startServer();

    const clientA = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    const clientB = await connect(app, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let aOk = false,
      bOk = false;
    clientA.counter({ counterId: "any" }).subscribe(() => {
      aOk = true;
    });
    clientB.counter({ counterId: "any" }).subscribe(() => {
      bOk = true;
    });
    await poll(() => aOk && bOk);

    const docB = clientB.doc({ docId: "leave-test" });

    await poll(() => {
      return (docB as any).sessions.length >= 2;
    });

    const aCount = (docB as any).sessions.length;
    (clientA as any).dispose();

    await poll(() => (docB as any).sessions.length < aCount);
    expect((docB as any).sessions.length).toBe(aCount - 1);
  });

  describe("auth and protocol edge cases", () => {
    it("subscribe before auth is silently ignored", async () => {
      const { url } = await startServer();

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).send(
        JSON.stringify({
          type: "subscribe",
          resource: "counter",
          key: { counterId: "test" },
          cursor: 0,
        }),
      );

      await new Promise((r) => setTimeout(r, 200));
      ws.close();

      const client = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "test" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);
      const counter = client.counter({ counterId: "test" });
      counter.increment(1);
      await poll(() => counter.count === 1);
      expect(counter.count).toBe(1);
    });

    it("command before auth is silently ignored", async () => {
      const { url } = await startServer();

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).send(
        JSON.stringify({
          type: "command",
          resource: "counter",
          key: { counterId: "test" },
          name: "increment",
          args: [999],
        }),
      );

      await new Promise((r) => setTimeout(r, 200));
      ws.close();

      const client = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "test" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);
      const counter = client.counter({ counterId: "test" });
      expect(counter.count).toBe(0);
    });

    it("server ignores unknown resource command", async () => {
      const { url } = await startServer();

      const client = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "check" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).send(
        JSON.stringify({
          type: "connect",
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      (ws as any).send(
        JSON.stringify({
          type: "command",
          resource: "nonexistent",
          key: "k",
          name: "anything",
          args: [],
        }),
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 200));

      const counter = client.counter({ counterId: "check" });
      counter.increment(1);
      await poll(() => counter.count === 1);
    });

    it("unauthorized client WebSocket is closed with reason", async () => {
      const { url } = await startServer();

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      let closeCode = 0;
      let closeReason = "";

      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).onclose = (ev: CloseEvent) => {
        closeCode = ev.code;
        closeReason = ev.reason;
      };

      (ws as any).send(
        JSON.stringify({
          type: "connect",
          token: "bad-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 300));

      expect(closeCode).toBe(4001);
      expect(closeReason).toBe("unauthorized");
    });

    it("unknown resource subscribe does not produce synced reply", async () => {
      const { url } = await startServer();

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      let gotSyncedReply = false;

      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).send(
        JSON.stringify({
          type: "connect",
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      (ws as any).onmessage = (ev: any) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "synced") gotSyncedReply = true;
        } catch {}
      };

      (ws as any).send(
        JSON.stringify({
          type: "subscribe",
          resource: "nonexistent",
          key: "k",
          cursor: 0,
        }),
      );

      await new Promise((r) => setTimeout(r, 200));
      ws.close();

      expect(gotSyncedReply).toBe(false);
    });

    it("command presence is broadcast only after successful commit", async () => {
      const { url } = await startServer();

      const clientA = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const clientB = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let aOk = false,
        bOk = false;
      clientA.counter({ counterId: "any" }).subscribe(() => {
        aOk = true;
      });
      clientB.counter({ counterId: "any" }).subscribe(() => {
        bOk = true;
      });
      await poll(() => aOk && bOk);

      const docA = clientA.doc({ docId: "presence-safety" });
      const docB = clientB.doc({ docId: "presence-safety" });
      (docA as any).changeTitle("before");

      await poll(() => (docB as any).title === "before");
      expect((docB as any).title).toBe("before");

      (docA as any).changeTitle("after");

      await poll(() => (docB as any).title === "after");
      expect((docB as any).title).toBe("after");
    });
  });

  describe("command handler errors", () => {
    it("sends commandAck with ok:false when handler throws and dedups replayed commandId", async () => {
      const { url } = await startServer();

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      const acks: Array<{ ok: boolean }> = [];

      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).onmessage = (ev: any) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "commandAck") acks.push(msg);
        } catch {}
      };

      (ws as any).send(
        JSON.stringify({
          type: "connect",
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      const cmdId = "throw-ack-" + Date.now();

      (ws as any).send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "throw-1" },
          name: "throwError",
          args: [],
        }),
      );

      await new Promise((r) => setTimeout(r, 200));

      expect(acks.length).toBe(1);
      expect(acks[0]!.ok).toBe(false);

      (ws as any).send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "throw-1" },
          name: "throwError",
          args: [],
        }),
      );

      await new Promise((r) => setTimeout(r, 200));

      expect(acks.length).toBe(2);
      expect(acks[1]!.ok).toBe(true);

      ws.close();

      const client = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "throw-1" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);
      const counter = client.counter({ counterId: "throw-1" });
      expect(counter.count).toBe(0);
    });

    it("command handler that throws does not update presence", async () => {
      const { url } = await startServer();

      const clientA = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const clientB = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let aOk = false,
        bOk = false;
      clientA.counter({ counterId: "any" }).subscribe(() => {
        aOk = true;
      });
      clientB.counter({ counterId: "any" }).subscribe(() => {
        bOk = true;
      });
      await poll(() => aOk && bOk);

      const docA = clientA.doc({ docId: "presence-throw" });
      const ack = await (docA as any).setStatusAndThrow("should-not-appear");
      expect(ack.ok).toBe(false);
    });
  });

  describe("command dedup", () => {
    it("duplicate commandId produces one visible state change", async () => {
      const { url } = await startServer();

      const client = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "dedup-c1" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).send(
        JSON.stringify({
          type: "connect",
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      const cmdId = "dedup-test-" + Date.now();

      (ws as any).send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "dedup-c1" },
          name: "increment",
          args: [5],
        }),
      );

      (ws as any).send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "dedup-c1" },
          name: "increment",
          args: [5],
        }),
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 200));

      const counter = client.counter({ counterId: "dedup-c1" });
      await poll(() => counter.count >= 5);
      expect(counter.count).toBe(5);
    });

    it("dedup survives server restart via event log", async () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);

      handle = serve(app, {
        port: 0,
        storage,
        snapshotIntervalMs: 60000,
      });

      const ws1 = new WebSocket(`${handle.url.origin.replace("http", "ws")}/ws`);
      await new Promise<void>((r) => {
        (ws1 as any).onopen = r;
      });

      (ws1 as any).send(
        JSON.stringify({
          type: "connect",
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      const cmdId = "restart-dedup-" + Date.now();

      (ws1 as any).send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "restart-1" },
          name: "increment",
          args: [10],
        }),
      );

      await new Promise((r) => setTimeout(r, 200));
      handle.stop();
      handle = null;

      await new Promise((r) => setTimeout(r, 100));

      handle = serve(app, {
        port: 0,
        storage: createFileStore(tempDir.path),
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
      client2.counter({ counterId: "restart-1" }).subscribe(() => {
        connected2 = true;
      });
      await poll(() => connected2);
      const counter = client2.counter({ counterId: "restart-1" });
      await poll(() => counter.count >= 10);
      expect(counter.count).toBe(10);

      const ws2 = new WebSocket(`${handle.url.origin.replace("http", "ws")}/ws`);
      await new Promise<void>((r) => {
        (ws2 as any).onopen = r;
      });

      (ws2 as any).send(
        JSON.stringify({
          type: "connect",
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      (ws2 as any).send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "restart-1" },
          name: "increment",
          args: [100],
        }),
      );

      await new Promise((r) => setTimeout(r, 300));
      ws2.close();

      await poll(() => counter.sync.stale === false || counter.count === 10);
      expect(counter.count).toBe(10);
    });
  });

  describe("broadcast robustness", () => {
    it("evictClient followed by close handler is idempotent and fires sessionLeft once", async () => {
      const { url } = await startServer();

      const observer = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const obsDoc = observer.doc({ docId: "evict-test" });
      await poll(() => (obsDoc as any).sessions.length >= 1);

      const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
      await new Promise<void>((r) => {
        (ws as any).onopen = r;
      });

      (ws as any).send(JSON.stringify({ type: "connect", token: "test-token" }));
      await new Promise((r) => setTimeout(r, 100));

      await poll(() => (obsDoc as any).sessions.length >= 2);
      const countBefore = (obsDoc as any).sessions.length;

      ws.close(4000, "test close");

      await new Promise((r) => setTimeout(r, 300));

      const countAfter = (obsDoc as any).sessions.length;
      expect(countAfter).toBe(countBefore - 1);
    });

    it("one bad subscriber in same scope does not block event delivery to healthy peers", async () => {
      const { url } = await startServer();

      const clientA = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const clientB = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const clientC = await connect(app, {
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        storage: createMemoryClientStore(),
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      let aOk = false,
        bOk = false,
        cOk = false;
      clientA.counter({ counterId: "fair-1" }).subscribe(() => {
        aOk = true;
      });
      clientB.counter({ counterId: "fair-1" }).subscribe(() => {
        bOk = true;
      });
      clientC.counter({ counterId: "fair-1" }).subscribe(() => {
        cOk = true;
      });
      await poll(() => aOk && bOk && cOk);

      const counterA = clientA.counter({ counterId: "fair-1" });
      const counterB = clientB.counter({ counterId: "fair-1" });
      const counterC = clientC.counter({ counterId: "fair-1" });

      await poll(() => counterA.sync.stale === false && counterB.sync.stale === false);

      (clientB as any).dispose();

      counterA.increment(100);

      await poll(() => counterA.count === 100);
      await poll(() => counterC.count === 100);
      expect(counterA.count).toBe(100);
      expect(counterC.count).toBe(100);
    });
  });
});
