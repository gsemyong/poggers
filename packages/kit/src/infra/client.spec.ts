import { describe, it, expect, beforeEach } from "bun:test";
import { connect } from "./client";
import { defineApp } from "./app";
import { createTestApp } from "tests/helpers/test-app";
import { createMemoryClientStore, createFailingClientStore } from "tests/helpers/memory-storage";
import { FakeWebSocket } from "tests/helpers/fake-websocket";
import { withSuppressedConsole } from "tests/helpers/wait";

const app = createTestApp("test-token");

function makeEventMsg(resource: string, key: any, ev: any) {
  return JSON.stringify({ type: "event", resource, key, event: ev });
}

function makeSyncedMsg(
  resource: string,
  key: any,
  opts: { snapshot?: any; events?: any[]; cursor: number },
) {
  return JSON.stringify({
    type: "synced",
    resource,
    key,
    snapshot: opts.snapshot,
    events: opts.events,
    cursor: opts.cursor,
  });
}

function makeInitMsg(sessions: any[], selfId: string) {
  return JSON.stringify({ type: "init", sessions, selfId });
}

function makeSessionMsg(session: any) {
  return JSON.stringify({ type: "session", session });
}

function makeSessionLeftMsg(sessionId: string) {
  return JSON.stringify({ type: "sessionLeft", sessionId });
}

function makeCommandAckMsg(commandId: string, ok: boolean, cursor?: number, events?: any[]) {
  return JSON.stringify({
    type: "commandAck",
    commandId,
    ok,
    ...(cursor !== undefined ? { cursor } : {}),
    ...(events ? { events } : {}),
  });
}

describe("client", () => {
  let storage: ReturnType<typeof createMemoryClientStore>;

  function firstSocket(): FakeWebSocket {
    return FakeWebSocket.instances[0]!;
  }

  function createClient(opts?: { token?: string; wsUrl?: string }) {
    FakeWebSocket.reset();

    return connect(app, {
      wsUrl: opts?.wsUrl ?? "ws://localhost/ws",
      token: opts?.token ?? "test-token",
      storage,
      WebSocket: FakeWebSocket as any,
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });
  }

  beforeEach(() => {
    storage = createMemoryClientStore();
    FakeWebSocket.reset();
  });

  describe("connection", () => {
    it("opens WebSocket to configured URL", async () => {
      await createClient({ wsUrl: "ws://custom:8080/ws" });
      expect(firstSocket().url).toBe("ws://custom:8080/ws");
    });

    it("sends connect message on open", async () => {
      await createClient();
      const ws = firstSocket();
      ws.connect();

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const connectMsg = msgs.find((m: any) => m.type === "connect");
      expect(connectMsg).toBeDefined();
      expect(connectMsg.token).toBe("test-token");
    });
  });

  describe("resource access", () => {
    it("returns undefined for unknown resource", async () => {
      const client = await createClient();
      expect((client as any).nonexistent).toBeUndefined();
    });

    it("resource accessor returns proxy with sync meta", async () => {
      const client = await createClient();
      const counter = client.counter({ counterId: "c1" });
      expect(counter.sync).toBeDefined();
      expect(counter.sync.cursor).toBe(0);
    });

    it("lazy access sends subscribe when connected", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      client.counter({ counterId: "c1" });

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const subMsg = msgs.find((m: any) => m.type === "subscribe");
      expect(subMsg).toBeDefined();
      expect(subMsg.resource).toBe("counter");
      expect(subMsg.key).toEqual({ counterId: "c1" });
    });

    it("cached accessor does not resubscribe", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      client.counter({ counterId: "c1" });
      const count1 = ws.sentMessages.length;
      client.counter({ counterId: "c1" });
      expect(ws.sentMessages.length).toBe(count1);
    });
  });

  describe("views", () => {
    it("returns default state through view", async () => {
      const client = await createClient();
      const counter = client.counter({ counterId: "c1" });
      expect(counter.count).toBe(0);
      expect(counter.isPositive).toBe(false);
    });

    it("updates view after synced snapshot", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      expect(counter.count).toBe(0);

      ws.deliverMessage(
        makeSyncedMsg(
          "counter",
          { counterId: "c1" },
          {
            snapshot: { version: 1, seq: 5, data: { count: 42 } },
            cursor: 5,
          },
        ),
      );

      expect(counter.count).toBe(42);
    });

    it("updates view after synced events", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      expect(counter.count).toBe(0);

      ws.deliverMessage(
        makeSyncedMsg(
          "counter",
          { counterId: "c1" },
          {
            events: [
              {
                id: "e1",
                seq: 1,
                at: 1000,
                actor: { id: "u", name: "U" },
                name: "incremented",
                payload: { amount: 3 },
              },
              {
                id: "e2",
                seq: 2,
                at: 1001,
                actor: { id: "u", name: "U" },
                name: "incremented",
                payload: { amount: 7 },
              },
            ],
            cursor: 2,
          },
        ),
      );

      expect(counter.count).toBe(10);
    });
  });

  describe("events", () => {
    it("applies server event and notifies subscriber", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      expect(counter.count).toBe(0);

      ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 0 }));

      let notified = false;
      counter.subscribe(() => {
        notified = true;
      });

      ws.deliverMessage(
        makeEventMsg(
          "counter",
          { counterId: "c1" },
          {
            id: "e1",
            seq: 1,
            at: 1000,
            actor: { id: "u", name: "U" },
            name: "incremented",
            payload: { amount: 5 },
          },
        ),
      );

      expect(counter.count).toBe(5);
      expect(notified).toBe(true);
    });
  });

  describe("sync meta", () => {
    it("tracks cursor after synced", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      expect(counter.sync.cursor).toBe(0);

      ws.deliverMessage(
        makeSyncedMsg(
          "counter",
          { counterId: "c1" },
          {
            events: [
              {
                id: "e1",
                seq: 1,
                at: 1000,
                actor: { id: "u", name: "U" },
                name: "incremented",
                payload: { amount: 1 },
              },
              {
                id: "e2",
                seq: 2,
                at: 1001,
                actor: { id: "u", name: "U" },
                name: "incremented",
                payload: { amount: 1 },
              },
              {
                id: "e3",
                seq: 3,
                at: 1002,
                actor: { id: "u", name: "U" },
                name: "incremented",
                payload: { amount: 1 },
              },
            ],
            cursor: 3,
          },
        ),
      );

      expect(counter.sync.cursor).toBe(3);
      expect(counter.sync.syncing).toBe(false);
    });

    it("marks stale when resource accessed before connect", async () => {
      const client = await createClient();
      const counter = client.counter({ counterId: "c1" });
      expect(counter.sync.stale).toBe(true);
    });

    it("clears stale after synced", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 0 }));
      expect(counter.sync.stale).toBe(false);
    });
  });

  describe("commands", () => {
    it("sends command when connected", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      counter.increment(5);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command");
      expect(cmdMsg).toBeDefined();
      expect(cmdMsg.name).toBe("increment");
      expect(cmdMsg.args).toEqual([5]);
      expect(cmdMsg.resource).toBe("counter");
    });

    it("queues command when not connected", async () => {
      const client = await createClient();
      const ws = firstSocket();
      const counter = client.counter({ counterId: "c1" });
      counter.increment(5);
      expect(ws.sentMessages.length).toBe(0);
    });
  });

  describe("sessions", () => {
    it("receives init with self session", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      let subscribeCalled = false;
      client.counter({ counterId: "any" }).subscribe(() => {
        subscribeCalled = true;
      });

      const session = {
        id: "user-abc123",
        actor: { id: "test-user", name: "Test User" },
        presence: {},
      };
      ws.deliverMessage(makeInitMsg([session], "user-abc123"));

      expect(subscribeCalled).toBe(true);
    });

    it("handles session join", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.deliverMessage(makeInitMsg([], "self-1"));

      let subscribeCalled = false;
      client.counter({ counterId: "any" }).subscribe(() => {
        subscribeCalled = true;
      });

      const newSession = { id: "s2", actor: { id: "u2", name: "U2" }, presence: {} };
      ws.deliverMessage(makeSessionMsg(newSession));

      expect(subscribeCalled).toBe(true);
    });

    it("handles session leave", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.deliverMessage(
        makeInitMsg([{ id: "s1", actor: { id: "u1", name: "U1" }, presence: {} }], "self-1"),
      );

      let subscribeCalled = false;
      client.counter({ counterId: "any" }).subscribe(() => {
        subscribeCalled = true;
      });

      ws.deliverMessage(makeSessionLeftMsg("s1"));

      expect(subscribeCalled).toBe(true);
    });
  });

  describe("saved snapshots", () => {
    it("loads persisted snapshot on connect", async () => {
      FakeWebSocket.reset();

      const testStorage = createMemoryClientStore();
      await testStorage.saveSnapshot({
        version: 1,
        scopes: [
          {
            resource: "counter",
            key: { counterId: "persisted" },
            snapshot: { version: 1, seq: 3, data: { count: 99 } },
          },
        ],
      });

      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: testStorage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const counter = client.counter({ counterId: "persisted" });
      expect(counter.count).toBe(99);
      expect(counter.sync.cursor).toBe(3);
    });

    it("ignores snapshot with mismatched version", async () => {
      FakeWebSocket.reset();

      const testStorage = createMemoryClientStore();
      await testStorage.saveSnapshot({
        version: 999,
        scopes: [
          {
            resource: "counter",
            key: { counterId: "stale" },
            snapshot: { version: 999, seq: 0, data: { count: 99 } },
          },
        ],
      });

      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: testStorage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const counter = client.counter({ counterId: "stale" });
      expect(counter.count).toBe(0);
    });
  });

  describe("subscribe", () => {
    it("notifies subscribers", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      let callCount = 0;
      client.counter({ counterId: "any" }).subscribe(() => {
        callCount++;
      });

      ws.deliverMessage(makeInitMsg([], "self-1"));
      expect(callCount).toBeGreaterThan(0);
    });

    it("unsubscribe stops notifications", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      let callCount = 0;
      const unsub = client.counter({ counterId: "any" }).subscribe(() => {
        callCount++;
      });

      ws.deliverMessage(makeInitMsg([], "self-1"));
      const before = callCount;

      unsub();
      ws.deliverMessage(makeInitMsg([], "self-1"));
      expect(callCount).toBe(before);
    });
  });

  describe("disconnect behavior", () => {
    it("marks scopes stale on disconnect", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 3 }));
      expect(counter.sync.stale).toBe(false);

      ws.simulateDisconnect();
      expect(counter.sync.stale).toBe(true);
    });

    it("ignores duplicate event with seq <= cursor", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });

      ws.deliverMessage(
        makeSyncedMsg(
          "counter",
          { counterId: "c1" },
          {
            snapshot: { version: 1, seq: 5, data: { count: 10 } },
            cursor: 5,
          },
        ),
      );

      expect(counter.count).toBe(10);

      ws.deliverMessage(
        makeEventMsg(
          "counter",
          { counterId: "c1" },
          {
            id: "stale-1",
            seq: 3,
            at: 1000,
            actor: { id: "u", name: "U" },
            name: "incremented",
            payload: { amount: 999 },
          },
        ),
      );

      expect(counter.count).toBe(10);

      ws.deliverMessage(
        makeEventMsg(
          "counter",
          { counterId: "c1" },
          {
            id: "new-1",
            seq: 6,
            at: 1001,
            actor: { id: "u", name: "U" },
            name: "incremented",
            payload: { amount: 1 },
          },
        ),
      );

      expect(counter.count).toBe(11);
    });

    it("ignores event with seq gap (seq > cursor+1) and marks stale", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });

      ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 5 }));

      ws.deliverMessage(
        makeEventMsg(
          "counter",
          { counterId: "c1" },
          {
            id: "gap-1",
            seq: 8,
            at: 1000,
            actor: { id: "u", name: "U" },
            name: "incremented",
            payload: { amount: 999 },
          },
        ),
      );

      expect(counter.sync.stale).toBe(true);
      expect(counter.count).toBe(0);
    });

    it("synced events stop applying at gap and cursor stays at last applied", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });

      ws.clearSent();

      ws.deliverMessage(
        makeSyncedMsg(
          "counter",
          { counterId: "c1" },
          {
            cursor: 5,
            events: [
              {
                id: "e1",
                seq: 1,
                at: 1000,
                actor: { id: "u", name: "U" },
                name: "incremented",
                payload: { amount: 1 },
              },
              {
                id: "e3",
                seq: 3,
                at: 1002,
                actor: { id: "u", name: "U" },
                name: "incremented",
                payload: { amount: 3 },
              },
            ],
          },
        ),
      );

      expect(counter.count).toBe(1);
      expect(counter.sync.cursor).toBe(1);
      expect(counter.sync.stale).toBe(true);
      expect(counter.sync.syncing).toBe(true);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const reSubMsg = msgs.find((m: any) => m.type === "subscribe" && m.cursor === 1);
      expect(reSubMsg).toBeTruthy();
    });

    it("dispose prevents reconnect after close", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: createMemoryClientStore(),
        WebSocket: FakeWebSocket as any,
        reconnectMs: 10,
        persistIntervalMs: 99999,
      });

      const ws = FakeWebSocket.instances[0]!;
      ws.connect();

      (client as any).dispose();

      await new Promise((r) => setTimeout(r, 50));

      expect(FakeWebSocket.instances.length).toBe(1);
    });
  });

  describe("presence self-update", () => {
    it("updates self session on own session update", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      ws.deliverMessage(
        makeInitMsg(
          [{ id: "self-1", actor: { id: "test-user", name: "Test User" }, presence: {} }],
          "self-1",
        ),
      );

      let subscribeCalled = false;
      client.counter({ counterId: "any" }).subscribe(() => {
        subscribeCalled = true;
      });

      ws.deliverMessage(
        JSON.stringify({
          type: "session",
          session: {
            id: "self-1",
            actor: { id: "test-user", name: "Test User" },
            presence: { status: "typing" },
          },
        }),
      );

      expect(subscribeCalled).toBe(true);
    });
  });

  describe("reconnect lifecycle", () => {
    it("creates a new WebSocket on reconnect after close", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: createMemoryClientStore(),
        WebSocket: FakeWebSocket as any,
        reconnectMs: 5,
        persistIntervalMs: 99999,
      });

      const ws1 = FakeWebSocket.instances[0]!;
      ws1.connect();
      ws1.clearSent();

      client.counter({ counterId: "c1" });

      ws1.simulateDisconnect();

      await new Promise((r) => setTimeout(r, 20));

      expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2);
      const ws2 = FakeWebSocket.instances[1]!;
      ws2.connect();

      const msgs = ws2.sentMessages.map((m) => JSON.parse(m));
      const connectMsg = msgs.find((m: any) => m.type === "connect");
      expect(connectMsg).toBeTruthy();

      const subMsg = msgs.find((m: any) => m.type === "subscribe");
      expect(subMsg).toBeTruthy();
      expect(subMsg.resource).toBe("counter");
    });

    it("reaplies exponential backoff on consecutive reconnect failures", async () => {
      FakeWebSocket.reset();
      const caughtDelays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      (globalThis as any).setTimeout = (fn: any, delay: number, ...args: any[]) => {
        if (delay > 0 && delay <= 30000) {
          caughtDelays.push(delay);
        }
        return originalSetTimeout(fn, 0, ...args);
      };

      try {
        await connect(app, {
          wsUrl: "ws://localhost/ws",
          token: "test-token",
          storage: createMemoryClientStore(),
          WebSocket: FakeWebSocket as any,
          reconnectMs: 2000,
          persistIntervalMs: 99999,
        });

        const ws = FakeWebSocket.instances[0]!;
        ws.connect();

        ws.simulateDisconnect();
        await new Promise((r) => setTimeout(r, 10));

        FakeWebSocket.instances[1]!.simulateDisconnect();
        await new Promise((r) => setTimeout(r, 10));

        const backoffDelays = caughtDelays.filter((d) => d >= 1000);
        expect(backoffDelays.length).toBeGreaterThanOrEqual(2);
        expect(backoffDelays[0]).toBe(2000);
        expect(backoffDelays[1]).toBe(4000);
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
    });
  });

  describe("session edge cases", () => {
    it("sessionLeft for self clears selfSession", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      ws.deliverMessage(
        makeInitMsg([{ id: "self-1", actor: { id: "u", name: "U" }, presence: {} }], "self-1"),
      );

      let subscribeCalled = false;
      client.counter({ counterId: "any" }).subscribe(() => {
        subscribeCalled = true;
      });

      ws.deliverMessage(makeSessionLeftMsg("self-1"));

      expect(subscribeCalled).toBe(true);
    });
  });

  describe("top-level snapshot version", () => {
    it("ignores saved snapshot when top-level version mismatches", async () => {
      FakeWebSocket.reset();
      const testStorage = createMemoryClientStore();
      await testStorage.saveSnapshot({
        version: 999,
        scopes: [
          {
            resource: "counter",
            key: { counterId: "stale" },
            snapshot: { version: 1, seq: 3, data: { count: 99 } },
          },
        ],
      });

      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: testStorage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const counter = client.counter({ counterId: "stale" });
      expect(counter.count).toBe(0);
    });
  });

  describe("error handling", () => {
    it("ignores malformed JSON without crashing", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      counter.increment(1);

      withSuppressedConsole(["error"], () => {
        ws.deliverMessage("not valid json{{{");
      });

      expect(counter.count).toBe(0);
    });

    it("marks state stale when send throws on closed socket", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 3 }));
      expect(counter.sync.stale).toBe(false);

      ws.send = () => {
        throw new Error("socket closed");
      };

      counter.increment(1);

      expect(counter.sync.stale).toBe(true);
    });
  });

  describe("command ack and dedup", () => {
    it("receives ack after sending command", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      ws.clearSent();

      counter.increment(5);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command");
      expect(cmdMsg).toBeTruthy();
      expect(cmdMsg.commandId).toBeTruthy();

      ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 1));

      counter.increment(10);

      const msgs2 = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsgs = msgs2.filter((m: any) => m.type === "command");
      expect(cmdMsgs.length).toBe(2);
    });

    it("resends unacked commands on reconnect", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: createMemoryClientStore(),
        WebSocket: FakeWebSocket as any,
        reconnectMs: 5,
        persistIntervalMs: 99999,
      });

      const ws1 = FakeWebSocket.instances[0]!;
      ws1.connect();
      ws1.clearSent();

      const counter = client.counter({ counterId: "c1" });
      counter.increment(99);

      ws1.simulateDisconnect();
      await new Promise((r) => setTimeout(r, 20));

      const ws2 = FakeWebSocket.instances[1]!;
      ws2.connect();

      const msgs = ws2.sentMessages.map((m) => JSON.parse(m));
      const cmdMsgs = msgs.filter((m: any) => m.type === "command");
      expect(cmdMsgs.length).toBeGreaterThanOrEqual(1);
      expect(cmdMsgs[0].name).toBe("increment");
      expect(cmdMsgs[0].args).toEqual([99]);
    });

    it("removes command from pending on ack", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      ws.clearSent();

      counter.increment(1);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command")!;
      expect(cmdMsg.commandId).toBeTruthy();

      ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 1));
      ws.clearSent();

      counter.increment(2);

      const msgs2 = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsgs2 = msgs2.filter((m: any) => m.type === "command");
      expect(cmdMsgs2.length).toBe(1);
      expect(cmdMsgs2[0].args).toEqual([2]);
    });

    it("returns a receipt that resolves with ok:true and cursor on ack", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      const receipt = counter.increment(5);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command")!;

      ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 7));

      const result = await receipt;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.cursor).toBe(7);
      }
    });

    it("returns a receipt that resolves with ok:false on failed ack", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      const receipt = counter.increment(5);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command")!;

      ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, false));

      const result = await receipt;
      expect(result.ok).toBe(false);
    });

    it("receipt stays pending when connection drops before ack", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      let resolved = false;
      const receipt = counter.increment(5);
      receipt.then(() => {
        resolved = true;
      });

      ws.simulateDisconnect();
      await new Promise((r) => setTimeout(r, 50));
      expect(resolved).toBe(false);
    });

    it("applies events from commandAck to local state immediately", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      const receipt = counter.increment(5);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command")!;

      const ackEvent = {
        id: "ev-1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 5 },
      };

      ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 1, [ackEvent]));

      const result = await receipt;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.cursor).toBe(1);
      }
      expect(counter.count).toBe(5);
    });

    it("drains buffered live events after commandAck fills the sequence gap", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "out-of-order-ack" });
      const receipt = counter.increment(5);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command")!;

      ws.deliverMessage(
        makeEventMsg(
          "counter",
          { counterId: "out-of-order-ack" },
          {
            id: "ev-2",
            seq: 2,
            at: 1001,
            actor: { id: "worker", name: "Worker" },
            name: "incremented",
            payload: { amount: 7 },
          },
        ),
      );

      expect(counter.count).toBe(0);
      expect(counter.sync.stale).toBe(true);

      ws.deliverMessage(
        makeCommandAckMsg(cmdMsg.commandId, true, 1, [
          {
            id: "ev-1",
            seq: 1,
            at: 1000,
            actor: { id: "u", name: "U" },
            name: "incremented",
            payload: { amount: 5 },
          },
        ]),
      );

      const result = await receipt;
      expect(result.ok).toBe(true);
      expect(counter.count).toBe(12);
      expect(counter.sync.cursor).toBe(2);
      expect(counter.sync.stale).toBe(false);
    });

    it("applies multiple events from commandAck in order", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "multi-ack" });
      counter.increment(1);

      const msgs = ws.sentMessages.map((m) => JSON.parse(m));
      const cmdMsg = msgs.find((m: any) => m.type === "command")!;

      const ackEvents = [
        {
          id: "ev-1",
          seq: 1,
          at: 1000,
          actor: { id: "u", name: "U" },
          name: "incremented",
          payload: { amount: 2 },
        },
        {
          id: "ev-2",
          seq: 2,
          at: 1001,
          actor: { id: "u", name: "U" },
          name: "incremented",
          payload: { amount: 3 },
        },
      ];

      ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 2, ackEvents));

      await new Promise((r) => setTimeout(r, 20));
      expect(counter.count).toBe(5);
    });
  });
  describe("persistence reliability", () => {
    it("connects with empty state when loadSnapshot throws", async () => {
      FakeWebSocket.reset();
      const storage = createFailingClientStore({ loadSnapshot: "throw" });
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });
      const ws = FakeWebSocket.instances[0]!;
      ws.connect();
      const counter = client.counter({ counterId: "c1" });
      expect(counter.count).toBe(0);
    });

    it("survives saveSnapshot failure without losing in-memory state", async () => {
      FakeWebSocket.reset();
      const storage = createFailingClientStore({ saveSnapshot: "throw" });
      let clientDispose: any;
      await withSuppressedConsole(["error"], async () => {
        clientDispose = await connect(app, {
          wsUrl: "ws://localhost/ws",
          token: "test-token",
          storage,
          WebSocket: FakeWebSocket as any,
          reconnectMs: 99999,
          persistIntervalMs: 50,
        });
        const ws = FakeWebSocket.instances[0]!;
        ws.connect();
        ws.deliverMessage(
          makeSyncedMsg(
            "counter",
            { counterId: "c1" },
            { snapshot: { version: 1, seq: 5, data: { count: 10 } }, cursor: 5 },
          ),
        );
        const counter = clientDispose.counter({ counterId: "c1" });
        expect(counter.count).toBe(10);
        ws.deliverMessage(
          makeEventMsg(
            "counter",
            { counterId: "c1" },
            {
              id: "e1",
              seq: 6,
              at: 1000,
              actor: { id: "u", name: "U" },
              name: "incremented",
              payload: { amount: 5 },
            },
          ),
        );
        expect(counter.count).toBe(15);
        await new Promise((r) => setTimeout(r, 150));
        expect(counter.count).toBe(15);
      });
      clientDispose.dispose();
    });

    it("persists pending command immediately on enqueue", async () => {
      FakeWebSocket.reset();
      const testStorage = createMemoryClientStore();
      let saveCount = 0;
      const origSave = testStorage.saveSnapshot.bind(testStorage);
      testStorage.saveSnapshot = (s: unknown) => {
        saveCount++;
        return origSave(s);
      };

      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: testStorage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const ws = FakeWebSocket.instances[0]!;
      ws.connect();
      const counter = client.counter({ counterId: "c1" });
      counter.increment(5);
      expect(saveCount).toBeGreaterThanOrEqual(1);
    });

    it("restores pending commands from snapshot after crash", async () => {
      const testStorage = createMemoryClientStore();

      FakeWebSocket.reset();
      const clientA = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: testStorage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const wsA = FakeWebSocket.instances[0]!;
      wsA.connect();
      wsA.clearSent();

      const counterA = clientA.counter({ counterId: "c1" });
      counterA.increment(77);
      (clientA as any).dispose();

      FakeWebSocket.reset();
      const clientB = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        storage: testStorage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const wsB = FakeWebSocket.instances[0]!;
      wsB.connect();

      const msgs = wsB.sentMessages.map((m) => JSON.parse(m));
      const cmdMsgs = msgs.filter((m: any) => m.type === "command");
      expect(cmdMsgs.length).toBeGreaterThanOrEqual(1);
      expect(cmdMsgs[0].name).toBe("increment");
      expect(cmdMsgs[0].args).toEqual([77]);

      const counterB = clientB.counter({ counterId: "c1" });
      expect(counterB.count).toBe(0);
    });

    it("migrates saved snapshot from older app version via previous chain", async () => {
      const v1 = defineApp<{
        Actor: { id: string; name: string };
        Resources: {
          counter: {
            Key: { counterId: string };
            State: { count: number };
            Presence: any;
            Events: { incremented: { amount: number } };
            Views: { count: number };
            Commands: { increment: { args: [amount: number]; event: "incremented"; error: never } };
          };
        };
      }>({
        version: 1,
        identify({ token }) {
          if (token === "tok") return { id: "u", name: "U" };
          return null;
        },
        resources: {
          counter: {
            state: { count: 0 },
            presence: {},
            events: {
              incremented({ state, payload }) {
                state.count += payload.amount;
              },
            },
            views: {
              count({ state }) {
                return state.count;
              },
            },
            commands: {
              increment(ctx, amount) {
                return ctx.event.incremented({ amount });
              },
            },
          },
        },
      });

      const v2 = defineApp<
        {
          Actor: { id: string; name: string };
          Resources: {
            counter: {
              Key: { counterId: string };
              State: { total: number; max: number };
              Presence: any;
              Events: { incremented: { amount: number } };
              Views: { total: number };
              Commands: {
                increment: { args: [amount: number]; event: "incremented"; error: never };
              };
            };
          };
        },
        typeof v1
      >({
        version: 2,
        previous: v1,
        migrate: {
          state: {
            counter(data) {
              return { total: data.count, max: 100 };
            },
          },
        },
        identify({ token }) {
          if (token === "tok") return { id: "u", name: "U" };
          return null;
        },
        resources: {
          counter: {
            state: { total: 0, max: 100 },
            presence: {},
            events: {
              incremented({ state, payload }) {
                state.total += payload.amount;
              },
            },
            views: {
              total({ state }) {
                return state.total;
              },
            },
            commands: {
              increment(ctx, amount) {
                return ctx.event.incremented({ amount });
              },
            },
          },
        },
      });

      FakeWebSocket.reset();
      const testStorage = createMemoryClientStore();
      await testStorage.saveSnapshot({
        version: 1,
        scopes: [
          {
            resource: "counter",
            key: { counterId: "c1" },
            snapshot: { version: 1, seq: 3, data: { count: 99 } },
          },
        ],
      });

      const client = await connect(v2, {
        wsUrl: "ws://localhost/ws",
        token: "tok",
        storage: testStorage,
        WebSocket: FakeWebSocket as any,
        reconnectMs: 99999,
        persistIntervalMs: 99999,
      });

      const counter = client.counter({ counterId: "c1" });
      expect(counter.total).toBe(99);
      expect(counter.sync.cursor).toBe(3);
    });
  });
});
