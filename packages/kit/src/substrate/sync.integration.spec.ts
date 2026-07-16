import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve } from "#host/server";
import { createWebSocketSyncTransport } from "#host/sync.websocket";
import { createSingleNodeSubstrate } from "#substrate/adapter.memory";
import { connect, type ConnectOpts } from "#substrate/client";
import { createMemoryJournal } from "#substrate/journal";
import { createSqliteJournal } from "#substrate/journal.sqlite";
import { protocolVersion, validateServerMessage, type ServerOperation } from "#substrate/protocol";
import { createMemoryClientReplica } from "#testing/replica";
import { createTestApp } from "#testing/test-app";
import { poll, withSuppressedConsole } from "#testing/wait";

function createTempDir(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "poggers-test-"));
  return {
    path,
    cleanup: () => rmSync(path, { recursive: true, force: true }),
  };
}

const app = createTestApp("test-token");

function connectTestClient(options: Omit<ConnectOpts, "transport">) {
  return connect(app, { ...options, transport: createWebSocketSyncTransport });
}

function openWebSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
  });
}

function readServerOperations(event: MessageEvent): ServerOperation[] {
  const message = validateServerMessage(JSON.parse(String(event.data)));
  if (!message) return [];
  return message.type === "batch" ? [...message.operations] : [message];
}

let tempDir: ReturnType<typeof createTempDir> | null = null;

describe("e2e: real WebSocket", () => {
  let handle: ReturnType<typeof serve> | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.stop();
      handle = null;
    }
    if (tempDir) {
      tempDir.cleanup();
      tempDir = null;
    }
  });

  async function startServer() {
    const journal = createMemoryJournal();
    handle = serve(app, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      snapshotIntervalMs: 60000,
    });
    return { url: handle.url, journal };
  }

  it("client connects and receives init", async () => {
    const { url } = await startServer();

    const client = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "any" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);
  });

  it("command updates client state", async () => {
    const { url } = await startServer();

    const client = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "e2e-1" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "e2e-1" });
    counter.increment({ amount: 42 });

    await poll(() => counter.count === 42);
    expect(counter.count).toBe(42);
  });

  it("two clients in same scope converge", async () => {
    const { url } = await startServer();

    const clientA = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    const clientB = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
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

    counterA.increment({ amount: 100 });

    await poll(() => counterA.count === 100 && counterB.count === 100);
    expect(counterA.count).toBe(100);
    expect(counterB.count).toBe(100);
  });

  it("different scopes do not leak events", async () => {
    const { url } = await startServer();

    const clientA = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    const clientB = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
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

    counterA.increment({ amount: 50 });

    await poll(() => counterA.count === 50);
    expect(counterA.count).toBe(50);
    expect(counterB.count).toBe(0);
  });

  it("unauthorized client is rejected", async () => {
    const { url } = await startServer();

    const client = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "bad-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    let _subscribeFired = false;
    client.counter({ counterId: "bad-token-self" }).subscribe(() => {
      _subscribeFired = true;
    });
    const checkCounter = client.counter({ counterId: "bad-token-self" });

    await new Promise((r) => setTimeout(r, 300));

    expect(checkCounter.sessions.length).toBe(0);
  });

  it("multi-event command assigns sequential server seqs", async () => {
    const { url } = await startServer();

    const client = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "multi" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "multi" });
    counter.emitTwoEvents({});

    await poll(() => counter.count === 3 && counter.sync.cursor === 2);
    expect(counter.count).toBe(3);
    expect(counter.sync.cursor).toBe(2);
  });

  it("processes a bounded operation batch in order on one Resource", async () => {
    const { url } = await startServer();
    const ws = new WebSocket(`${url.origin.replace("http", "ws")}/ws`);
    const received: ServerOperation[] = [];
    ws.onmessage = (event) => {
      received.push(...readServerOperations(event));
    };
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    ws.send(
      JSON.stringify({
        type: "batch",
        operations: [
          { type: "connect", version: protocolVersion, token: "test-token" },
          { type: "subscribe", resource: "counter", key: { counterId: "batch" }, cursor: 0 },
          {
            type: "command",
            commandId: "batch/1",
            resource: "counter",
            key: { counterId: "batch" },
            name: "increment",
            args: [{ amount: 1 }],
            at: 1,
          },
          {
            type: "command",
            commandId: "batch/2",
            resource: "counter",
            key: { counterId: "batch" },
            name: "increment",
            args: [{ amount: 2 }],
            at: 2,
          },
        ],
      }),
    );

    await poll(() => received.filter((operation) => operation.type === "commandAck").length === 2);
    expect(
      received
        .filter((operation) => operation.type === "commandAck")
        .map((operation) => operation.commandId),
    ).toEqual(["batch/1", "batch/2"]);

    const client = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });
    const counter = client.counter({ counterId: "batch" });
    await poll(() => counter.count === 3);
    expect(counter.count).toBe(3);
    ws.close();
  });

  it("late subscriber receives server state", async () => {
    const { url } = await startServer();

    const client1 = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    let c1ok = false;
    client1.counter({ counterId: "delta" }).subscribe(() => {
      c1ok = true;
    });
    await poll(() => c1ok);

    const c1 = client1.counter({ counterId: "delta" });
    c1.increment({ amount: 10 });
    await poll(() => c1.count === 10);

    const client2 = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
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

    const client = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "malformed" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);

    withSuppressedConsole(["error"], () => {
      ws.send("not valid json{{{");
      ws.close();
    });

    await new Promise((r) => setTimeout(r, 100));

    const counter = client.counter({ counterId: "malformed" });
    counter.increment({ amount: 1 });
    await poll(() => counter.count === 1);
    expect(counter.count).toBe(1);
  });

  it("replaces Presence directly without leaking it to another Resource key", async () => {
    const { url } = await startServer();

    const clientA = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    const clientB = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    const docA = clientA.doc({ docId: "presence-test" });
    const docB = clientB.doc({ docId: "presence-test" });
    const other = clientB.doc({ docId: "presence-other" });
    await poll(() => docA.sessions.length === 2 && docB.sessions.length === 2);

    docA.setPresence({ status: "typing" });

    await poll(() => docB.sessions.some(({ presence }) => presence.status === "typing"));
    expect(docB.sessions.filter(({ presence }) => presence.status === "typing")).toHaveLength(1);
    expect(other.sessions.some(({ presence }) => presence.status === "typing")).toBe(false);
  });

  it("session leave propagates on disconnect", async () => {
    const { url } = await startServer();

    const clientA = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
    });

    const clientB = await connectTestClient({
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      reconnectMs: 99999,
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

    clientA.doc({ docId: "leave-test" });
    const docB = clientB.doc({ docId: "leave-test" });

    await poll(() => {
      return docB.sessions.length >= 2;
    });

    const aCount = docB.sessions.length;
    clientA.dispose();

    await poll(() => docB.sessions.length < aCount);
    expect(docB.sessions.length).toBe(aCount - 1);
  });

  describe("auth and protocol edge cases", () => {
    it("subscribe before auth is silently ignored", async () => {
      const { url } = await startServer();

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);

      ws.send(
        JSON.stringify({
          type: "subscribe",
          resource: "counter",
          key: { counterId: "test" },
          cursor: 0,
        }),
      );

      await new Promise((r) => setTimeout(r, 200));
      ws.close();

      const client = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "test" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);
      const counter = client.counter({ counterId: "test" });
      counter.increment({ amount: 1 });
      await poll(() => counter.count === 1);
      expect(counter.count).toBe(1);
    });

    it("command before auth is silently ignored", async () => {
      const { url } = await startServer();

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);

      ws.send(
        JSON.stringify({
          type: "command",
          resource: "counter",
          key: { counterId: "test" },
          name: "increment",
          args: [{ amount: 999 }],
        }),
      );

      await new Promise((r) => setTimeout(r, 200));
      ws.close();

      const client = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
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

      const client = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "check" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);

      ws.send(
        JSON.stringify({
          type: "connect",
          version: protocolVersion,
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      ws.send(
        JSON.stringify({
          type: "command",
          resource: "nonexistent",
          key: "k",
          name: "anything",
          args: [{}],
        }),
      );

      ws.close();
      await new Promise((r) => setTimeout(r, 200));

      const counter = client.counter({ counterId: "check" });
      counter.increment({ amount: 1 });
      await poll(() => counter.count === 1);
    });

    it("unauthorized client WebSocket is closed with reason", async () => {
      const { url } = await startServer();

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);
      let closeCode = 0;
      let closeReason = "";

      ws.onclose = (ev) => {
        closeCode = ev.code;
        closeReason = ev.reason;
      };

      ws.send(
        JSON.stringify({
          type: "connect",
          version: protocolVersion,
          token: "bad-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 300));

      expect(closeCode).toBe(4001);
      expect(closeReason).toBe("unauthorized");
    });

    it("unknown resource subscribe does not produce synced reply", async () => {
      const { url } = await startServer();

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);
      let gotSyncedReply = false;

      ws.send(
        JSON.stringify({
          type: "connect",
          version: protocolVersion,
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      ws.onmessage = (event) => {
        if (readServerOperations(event).some((operation) => operation.type === "synced")) {
          gotSyncedReply = true;
        }
      };

      ws.send(
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

    it("durable command rejection has no hidden Presence side effect", async () => {
      const { url } = await startServer();

      const clientA = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      const clientB = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      const counterA = clientA.counter({ counterId: "presence-safety" });
      const counterB = clientB.counter({ counterId: "presence-safety" });
      await poll(() => counterA.sessions.length === 2 && counterB.sessions.length === 2);
      counterA.setPresence({ status: "editing" });
      await poll(() => counterB.sessions.some(({ presence }) => presence.status === "editing"));

      expect(await counterA.throwError({})).toMatchObject({ ok: false });
      expect(counterB.sessions.some(({ presence }) => presence.status === "editing")).toBe(true);
    });
  });

  describe("command handler errors", () => {
    it("sends commandAck with ok:false when handler throws and dedups replayed commandId", async () => {
      const { url } = await startServer();

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);
      const acks: Array<{ ok: boolean }> = [];

      ws.onmessage = (event) => {
        for (const operation of readServerOperations(event)) {
          if (operation.type === "commandAck") acks.push(operation);
        }
      };

      ws.send(
        JSON.stringify({
          type: "connect",
          version: protocolVersion,
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      const cmdId = "throw-ack-" + Date.now();
      const commandAt = Date.now();

      ws.send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "throw-1" },
          name: "throwError",
          args: [{}],
          at: commandAt,
        }),
      );

      await new Promise((r) => setTimeout(r, 200));

      expect(acks.length).toBe(1);
      expect(acks[0]!.ok).toBe(false);

      ws.send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "throw-1" },
          name: "throwError",
          args: [{}],
          at: commandAt,
        }),
      );

      await new Promise((r) => setTimeout(r, 200));

      expect(acks.length).toBe(2);
      expect(acks[1]!.ok).toBe(false);

      ws.close();

      const client = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "throw-1" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);
      const counter = client.counter({ counterId: "throw-1" });
      expect(counter.count).toBe(0);
    });
  });

  describe("command dedup", () => {
    it("duplicate commandId produces one visible state change", async () => {
      const { url } = await startServer();

      const client = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      let connected = false;
      client.counter({ counterId: "dedup-c1" }).subscribe(() => {
        connected = true;
      });
      await poll(() => connected);

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);

      ws.send(
        JSON.stringify({
          type: "connect",
          version: protocolVersion,
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      const cmdId = "dedup-test-" + Date.now();
      const commandAt = Date.now();

      ws.send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "dedup-c1" },
          name: "increment",
          args: [{ amount: 5 }],
          at: commandAt,
        }),
      );

      ws.send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "dedup-c1" },
          name: "increment",
          args: [{ amount: 5 }],
          at: commandAt,
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
      const journalFile = join(tempDir.path, "journal.sqlite");
      const journal = createSqliteJournal({ file: journalFile });

      handle = serve(app, {
        port: 0,
        substrate: createSingleNodeSubstrate(journal),
        snapshotIntervalMs: 60000,
      });

      const ws1 = await openWebSocket(`${handle.url.origin.replace("http", "ws")}/ws`);

      ws1.send(
        JSON.stringify({
          type: "connect",
          version: protocolVersion,
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      const cmdId = "restart-dedup-" + Date.now();
      const commandAt = Date.now();

      ws1.send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "restart-1" },
          name: "increment",
          args: [{ amount: 10 }],
          at: commandAt,
        }),
      );

      await new Promise((r) => setTimeout(r, 200));
      await handle.stop();
      handle = null;
      await journal.close();

      await new Promise((r) => setTimeout(r, 100));

      const restartedJournal = createSqliteJournal({ file: journalFile });
      handle = serve(app, {
        port: 0,
        substrate: createSingleNodeSubstrate(restartedJournal),
        snapshotIntervalMs: 60000,
      });

      const client2 = await connectTestClient({
        wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      let connected2 = false;
      client2.counter({ counterId: "restart-1" }).subscribe(() => {
        connected2 = true;
      });
      await poll(() => connected2);
      const counter = client2.counter({ counterId: "restart-1" });
      await poll(() => counter.count >= 10);
      expect(counter.count).toBe(10);

      const ws2 = await openWebSocket(`${handle.url.origin.replace("http", "ws")}/ws`);

      ws2.send(
        JSON.stringify({
          type: "connect",
          version: protocolVersion,
          token: "test-token",
        }),
      );

      await new Promise((r) => setTimeout(r, 100));

      ws2.send(
        JSON.stringify({
          type: "command",
          commandId: cmdId,
          resource: "counter",
          key: { counterId: "restart-1" },
          name: "increment",
          args: [{ amount: 100 }],
          at: commandAt,
        }),
      );

      await new Promise((r) => setTimeout(r, 300));
      ws2.close();

      await poll(() => counter.sync.stale === false || counter.count === 10);
      expect(counter.count).toBe(10);
      await handle.stop();
      handle = null;
      await restartedJournal.close();
    });
  });

  describe("broadcast robustness", () => {
    it("evictClient followed by close handler is idempotent and fires sessionLeft once", async () => {
      const { url } = await startServer();

      const observer = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      const obsDoc = observer.doc({ docId: "evict-test" });
      await poll(() => obsDoc.sessions.length >= 1);

      const ws = await openWebSocket(`${url.origin.replace("http", "ws")}/ws`);
      let subscribed = false;
      ws.onmessage = (event) => {
        if (
          readServerOperations(event).some(
            (operation) =>
              operation.type === "synced" &&
              operation.resource === "doc" &&
              JSON.stringify(operation.key) === JSON.stringify({ docId: "evict-test" }),
          )
        ) {
          subscribed = true;
        }
      };
      ws.send(JSON.stringify({ type: "connect", version: protocolVersion, token: "test-token" }));
      ws.send(
        JSON.stringify({
          type: "subscribe",
          resource: "doc",
          key: { docId: "evict-test" },
          cursor: 0,
        }),
      );
      await poll(() => subscribed);

      await poll(() => obsDoc.sessions.length >= 2);
      const countBefore = obsDoc.sessions.length;

      ws.close(4000, "test close");

      await new Promise((r) => setTimeout(r, 300));

      const countAfter = obsDoc.sessions.length;
      expect(countAfter).toBe(countBefore - 1);
    });

    it("one bad subscriber in same scope does not block event delivery to healthy peers", async () => {
      const { url } = await startServer();

      const clientA = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      const clientB = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
      });

      const clientC = await connectTestClient({
        wsUrl: `${url.origin.replace("http", "ws")}/ws`,
        token: "test-token",
        replica: createMemoryClientReplica(),
        reconnectMs: 99999,
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

      clientB.dispose();

      counterA.increment({ amount: 100 });

      await poll(() => counterA.count === 100);
      await poll(() => counterC.count === 100);
      expect(counterA.count).toBe(100);
      expect(counterC.count).toBe(100);
    });
  });
});
