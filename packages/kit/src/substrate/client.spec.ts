import { describe, it, expect, beforeEach } from "bun:test";

import { createWebSocketSyncTransportFactory } from "#host/sync.websocket";
import { defineApp, type JsonValue, type SessionData } from "#kernel/app";
import { connect, notifyAuthenticationChanged } from "#substrate/client";
import {
  maxProtocolBatch,
  protocolVersion,
  type ClientMessage,
  type ClientOperation,
  type CommittedEvent,
  type Snapshot,
} from "#substrate/protocol";
import { FakeWebSocket } from "#testing/fake-websocket";
import { createMemoryClientReplica, createFailingClientReplica } from "#testing/replica";
import { createTestApp } from "#testing/test-app";
import { poll, withSuppressedConsole } from "#testing/wait";

const app = createTestApp("test-token");

function parseSentOperations(socket: FakeWebSocket): ClientOperation[] {
  return socket.sentMessages.flatMap((message) => {
    const parsed = JSON.parse(message) as ClientMessage;
    return parsed.type === "batch" ? [...parsed.operations] : [parsed];
  });
}

async function waitForSentMessages<Type extends ClientOperation["type"]>(
  socket: FakeWebSocket,
  type: Type,
  count = 1,
): Promise<
  [Extract<ClientOperation, { type: Type }>, ...Extract<ClientOperation, { type: Type }>[]]
> {
  await poll(
    () => parseSentOperations(socket).filter((message) => message.type === type).length >= count,
  );
  return parseSentOperations(socket).filter(
    (message): message is Extract<ClientOperation, { type: Type }> => message.type === type,
  ) as [Extract<ClientOperation, { type: Type }>, ...Extract<ClientOperation, { type: Type }>[]];
}

function requireSentMessage<Type extends ClientOperation["type"]>(
  socket: FakeWebSocket,
  type: Type,
): Extract<ClientOperation, { type: Type }> {
  const message = parseSentOperations(socket).find(
    (candidate): candidate is Extract<ClientOperation, { type: Type }> => candidate.type === type,
  );
  if (!message) throw new Error(`Missing sent ${type} message.`);
  return message;
}

function makeEventMsg(resource: string, key: JsonValue, ev: CommittedEvent) {
  return JSON.stringify({ type: "event", resource, key, event: ev });
}

function makeSyncedMsg(
  resource: string,
  key: JsonValue,
  opts: {
    snapshot?: Snapshot;
    events?: CommittedEvent[];
    sessions?: SessionData[];
    cursor: number;
  },
) {
  return JSON.stringify({
    type: "synced",
    resource,
    key,
    snapshot: opts.snapshot,
    events: opts.events,
    sessions: opts.sessions ?? [],
    cursor: opts.cursor,
  });
}

function makeInitMsg(sessions: SessionData[], selfId: string) {
  const session =
    sessions.find((candidate) => candidate.id === selfId) ??
    ({ id: selfId, actor: { id: "test-user", name: "Test User" }, presence: {} } as const);
  return JSON.stringify({ type: "init", version: protocolVersion, session });
}

function makePresenceMsg(resource: string, key: JsonValue, session: SessionData) {
  return JSON.stringify({ type: "presence", resource, key, session });
}

function makePresenceLeftMsg(resource: string, key: JsonValue, sessionId: string) {
  return JSON.stringify({ type: "presenceLeft", resource, key, sessionId });
}

function makeCommandAckMsg(
  commandId: string,
  ok: boolean,
  cursor?: number,
  events?: CommittedEvent[],
) {
  return JSON.stringify({
    type: "commandAck",
    commandId,
    ok,
    ...(cursor !== undefined ? { cursor } : {}),
    ...(events ? { events } : {}),
  });
}

describe("client", () => {
  let replica: ReturnType<typeof createMemoryClientReplica>;

  function firstSocket(): FakeWebSocket {
    return FakeWebSocket.instances[0]!;
  }

  function createClient(opts?: {
    token?: string;
    wsUrl?: string;
    messageBytes?: number;
    inboundBytes?: number;
    commandUncertaintyMs?: number;
    limits?: Parameters<typeof connect>[1]["limits"];
  }) {
    FakeWebSocket.reset();

    return connect(app, {
      wsUrl: opts?.wsUrl ?? "ws://localhost/ws",
      token: opts?.token ?? "test-token",
      replica,
      transport: createWebSocketSyncTransportFactory(FakeWebSocket as unknown as typeof WebSocket),
      reconnectMs: 99999,
      messageBytes: opts?.messageBytes,
      inboundBytes: opts?.inboundBytes,
      commandUncertaintyMs: opts?.commandUncertaintyMs,
      limits: opts?.limits,
    });
  }

  beforeEach(() => {
    replica = createMemoryClientReplica();
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

      const connectMsg = requireSentMessage(ws, "connect");
      expect(connectMsg.token).toBe("test-token");
    });

    it("closes a slow consumer before queued frame bytes exceed their bound", async () => {
      const key = { counterId: "bounded-inbound" };
      const firstFrame = makeSyncedMsg("counter", key, {
        snapshot: { version: 1, seq: 0, data: { count: 0 } },
        cursor: 0,
      });
      const secondFrame = makePresenceMsg("counter", key, {
        id: "peer",
        actor: { id: "peer" },
        presence: { status: "x".repeat(256) },
      });
      const bytes = new TextEncoder();
      const inboundBytes =
        bytes.encode(firstFrame).byteLength + bytes.encode(secondFrame).byteLength - 1;
      const confirmStarted = Promise.withResolvers<void>();
      const releaseConfirm = Promise.withResolvers<void>();
      const confirm = replica.confirm.bind(replica);
      replica.confirm = async (input) => {
        confirmStarted.resolve();
        await releaseConfirm.promise;
        return confirm(input);
      };

      const client = await createClient({ inboundBytes });
      client.counter(key);
      const ws = firstSocket();
      ws.connect();
      const processing = ws.onmessage?.({ data: firstFrame });
      await confirmStarted.promise;
      ws.onmessage?.({ data: secondFrame });

      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      releaseConfirm.resolve();
      await processing;
      client.dispose();
    });

    it("reassembles a bounded server message split across transport frames", async () => {
      const key = { counterId: "chunked" };
      const client = await createClient({ messageBytes: 512, inboundBytes: 8_192 });
      const counter = client.counter(key);
      const ws = firstSocket();
      ws.connect();
      const message = makeSyncedMsg("counter", key, {
        snapshot: {
          version: 1,
          seq: 1,
          data: { count: 42, padding: "value".repeat(500) },
        },
        cursor: 1,
      });
      const bytes = Buffer.from(message);
      const chunkBytes = 192;
      const total = Math.ceil(bytes.byteLength / chunkBytes);
      for (let index = 0; index < total; index += 1) {
        await ws.deliverMessage(
          JSON.stringify({
            type: "poggers:chunk",
            id: "message-1",
            index,
            total,
            data: bytes
              .subarray(index * chunkBytes, Math.min(bytes.byteLength, (index + 1) * chunkBytes))
              .toString("base64"),
          }),
        );
      }
      expect(counter.count).toBe(42);
      expect(ws.readyState).toBe(FakeWebSocket.OPEN);
      client.dispose();
    });
  });

  describe("resource access", () => {
    it("returns undefined for unknown resource", async () => {
      const client = await createClient();
      expect(Reflect.get(client, "nonexistent")).toBeUndefined();
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

      const [subMsg] = await waitForSentMessages(ws, "subscribe");
      expect(subMsg.resource).toBe("counter");
      expect(subMsg.key).toEqual({ counterId: "c1" });
    });

    it("batches a synchronous subscription burst within protocol bounds", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      for (let index = 0; index < 300; index += 1) {
        client.counter({ counterId: `counter-${index}` });
      }

      await waitForSentMessages(ws, "subscribe", 300);
      const expectedFrames = Math.ceil(300 / maxProtocolBatch);
      expect(ws.sentMessages).toHaveLength(expectedFrames);
      expect(ws.sentMessages.map((message) => (JSON.parse(message) as ClientMessage).type)).toEqual(
        Array.from({ length: expectedFrames }, () => "batch"),
      );
      client.dispose();
    });

    it("cached accessor does not resubscribe", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      client.counter({ counterId: "c1" });
      await waitForSentMessages(ws, "subscribe");
      const count1 = ws.sentMessages.length;
      client.counter({ counterId: "c1" });
      expect(ws.sentMessages.length).toBe(count1);
    });
  });

  describe("admission limits", () => {
    it("bounds active Resources without retaining an unknown scope", async () => {
      const client = await createClient({ limits: { resources: 1 } });
      expect(client.counter({ counterId: "one" })).toBeDefined();
      expect(() => client.counter({ counterId: "two" })).toThrow("Resource limit 1");
      expect(Reflect.get(client, "unknown")).toBeUndefined();
    });

    it("bounds subscriptions and releases capacity exactly once", async () => {
      const client = await createClient({ limits: { subscriptions: 1 } });
      const first = client.counter({ counterId: "one" });
      const second = client.counter({ counterId: "two" });
      const stop = first.subscribe(() => undefined);
      expect(() => second.subscribe(() => undefined)).toThrow("subscription limit 1");
      stop();
      stop();
      const next = second.subscribe(() => undefined);
      next();
    });

    it("rejects new offline intents after the durable outbox reaches its bound", async () => {
      const client = await createClient({ limits: { pendingIntents: 1 } });
      const counter = client.counter({ counterId: "bounded" });
      void counter.increment({ amount: 1 });
      await Bun.sleep(5);
      expect(await counter.increment({ amount: 2 })).toEqual({ ok: false, error: "overloaded" });
      expect((await replica.load()).pending).toHaveLength(1);
      client.dispose();
    });

    it("closes and resynchronizes instead of growing a gap buffer past its bound", async () => {
      const client = await createClient({ limits: { bufferedEventsPerResource: 1 } });
      const ws = firstSocket();
      ws.connect();
      const counter = client.counter({ counterId: "gap" });
      const operation = (id: string, seq: number) =>
        makeEventMsg(
          "counter",
          { counterId: "gap" },
          {
            id,
            seq,
            at: seq,
            actor: { id: "u", name: "U" },
            name: "incremented",
            payload: { amount: 1 },
          },
        );
      await ws.deliverMessage(operation("future-2", 2));
      await ws.deliverMessage(operation("future-3", 3));
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(counter.sync.error).toBe("overloaded");
      client.dispose();
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

      await ws.deliverMessage(
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

    it("does not replace newer state with a delayed synced snapshot", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const key = { counterId: "monotonic" };
      const counter = client.counter(key);
      await ws.deliverMessage(
        makeSyncedMsg("counter", key, {
          snapshot: { version: 1, seq: 1, data: { count: 1 } },
          cursor: 1,
        }),
      );
      await ws.deliverMessage(
        makeEventMsg("counter", key, {
          id: "event-2",
          seq: 2,
          at: 2,
          actor: { id: "u", name: "U" },
          name: "incremented",
          payload: { amount: 1 },
        }),
      );

      expect(counter.count).toBe(2);
      expect(counter.sync.cursor).toBe(2);

      await ws.deliverMessage(
        makeSyncedMsg("counter", key, {
          snapshot: { version: 1, seq: 1, data: { count: 1 } },
          cursor: 1,
        }),
      );

      expect(counter.count).toBe(2);
      expect(counter.sync.cursor).toBe(2);
      client.dispose();
    });

    it("updates view after synced events", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      expect(counter.count).toBe(0);

      await ws.deliverMessage(
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

      await ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 0 }));

      let notified = false;
      counter.subscribe(() => {
        notified = true;
      });

      await ws.deliverMessage(
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

      await ws.deliverMessage(
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
      await ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 0 }));
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
      counter.increment({ amount: 5 });
      await poll(() => ws.sentMessages.some((message) => JSON.parse(message).type === "command"));

      const cmdMsg = requireSentMessage(ws, "command");
      expect(cmdMsg.name).toBe("increment");
      expect(cmdMsg.args).toEqual([{ amount: 5 }]);
      expect(cmdMsg.resource).toBe("counter");
    });

    it("queues command when not connected", async () => {
      const client = await createClient();
      const ws = firstSocket();
      const counter = client.counter({ counterId: "c1" });
      counter.increment({ amount: 5 });
      await poll(async () => (await replica.load()).pending.length === 1);
      expect(ws.sentMessages.length).toBe(0);
    });
  });

  describe("presence", () => {
    it("receives scoped sessions with the initial sync", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      const key = { counterId: "any" };
      const counter = client.counter(key);
      const session = {
        id: "user-abc123",
        actor: { id: "test-user", name: "Test User" },
        presence: {},
      };
      await ws.deliverMessage(makeInitMsg([session], "user-abc123"));
      await ws.deliverMessage(makeSyncedMsg("counter", key, { cursor: 0, sessions: [session] }));

      expect(counter.sessions).toEqual([session]);
    });

    it("applies a presence update only to its resource scope", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      await ws.deliverMessage(makeInitMsg([], "self-1"));
      const counterKey = { counterId: "same" };
      const docKey = { docId: "same" };
      const counter = client.counter(counterKey);
      const doc = client.doc(docKey);
      await ws.deliverMessage(makeSyncedMsg("counter", counterKey, { cursor: 0 }));
      await ws.deliverMessage(makeSyncedMsg("doc", docKey, { cursor: 0 }));
      const newSession = { id: "s2", actor: { id: "u2", name: "U2" }, presence: {} };
      await ws.deliverMessage(makePresenceMsg("counter", counterKey, newSession));

      expect(counter.sessions).toEqual([newSession]);
      expect(doc.sessions).toEqual([]);
    });

    it("removes a departed session only from its resource scope", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      await ws.deliverMessage(makeInitMsg([], "self-1"));
      const counterKey = { counterId: "same" };
      const docKey = { docId: "same" };
      const session = { id: "s1", actor: { id: "u1", name: "U1" }, presence: {} };
      const counter = client.counter(counterKey);
      const doc = client.doc(docKey);
      await ws.deliverMessage(
        makeSyncedMsg("counter", counterKey, { cursor: 0, sessions: [session] }),
      );
      await ws.deliverMessage(makeSyncedMsg("doc", docKey, { cursor: 0, sessions: [session] }));

      await ws.deliverMessage(makePresenceLeftMsg("counter", counterKey, "s1"));

      expect(counter.sessions).toEqual([]);
      expect(doc.sessions).toEqual([session]);
    });
  });

  describe("saved snapshots", () => {
    it("loads persisted snapshot on connect", async () => {
      FakeWebSocket.reset();

      const testReplica = createMemoryClientReplica();
      await testReplica.saveSnapshot({
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
        replica: testReplica,
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 99999,
      });

      const counter = client.counter({ counterId: "persisted" });
      expect(counter.count).toBe(99);
      expect(counter.sync.cursor).toBe(3);
    });

    it("ignores snapshot with mismatched version", async () => {
      FakeWebSocket.reset();

      const testReplica = createMemoryClientReplica();
      await testReplica.saveSnapshot({
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
        replica: testReplica,
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 99999,
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

      await ws.deliverMessage(makeInitMsg([], "self-1"));
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

      await ws.deliverMessage(makeInitMsg([], "self-1"));
      const before = callCount;

      unsub();
      await ws.deliverMessage(makeInitMsg([], "self-1"));
      expect(callCount).toBe(before);
    });

    it("invalidates only the scope and semantic value a subscriber reads", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      const first = client.counter({ counterId: "first" });
      client.counter({ counterId: "second" });
      const values: boolean[] = [];
      first.subscribe((scope) => values.push(scope.isPositive));

      const event = (id: string, seq: number) => ({
        id,
        seq,
        at: seq,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 1 },
      });
      await ws.deliverMessage(makeEventMsg("counter", { counterId: "second" }, event("second", 1)));
      expect(values).toEqual([false]);

      await ws.deliverMessage(makeEventMsg("counter", { counterId: "first" }, event("first-1", 1)));
      expect(values).toEqual([false, true]);

      await ws.deliverMessage(makeEventMsg("counter", { counterId: "first" }, event("first-2", 2)));
      expect(values).toEqual([false, true]);
    });

    it("publishes one coherent reactive update for a committed event batch", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      const counter = client.counter({ counterId: "batched" });
      const values: number[] = [];
      counter.subscribe((scope) => values.push(scope.count));

      const operation = (id: string, seq: number, amount: number) => ({
        type: "event",
        resource: "counter",
        key: { counterId: "batched" },
        event: {
          id,
          seq,
          at: seq,
          actor: { id: "u", name: "U" },
          name: "incremented",
          payload: { amount },
          commandId: "device/1",
        },
      });
      await ws.deliverMessage(
        JSON.stringify({
          type: "batch",
          operations: [operation("one", 1, 1), operation("two", 2, 2)],
        }),
      );

      expect(values).toEqual([0, 3]);
      expect(counter.sync.cursor).toBe(2);
    });

    it("checkpoints remote event bursts instead of cloning the full state per event", async () => {
      const confirm = replica.confirm.bind(replica);
      let confirmations = 0;
      replica.confirm = async (input) => {
        confirmations += 1;
        await confirm(input);
      };
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      const key = { counterId: "checkpointed" };
      const counter = client.counter(key);
      const operation = (seq: number) => ({
        type: "event" as const,
        resource: "counter",
        key,
        event: {
          id: `remote/${seq}`,
          seq,
          at: seq,
          actor: { id: "server", name: "Server" },
          name: "incremented",
          payload: { amount: 1 },
          commandId: `program/${seq}`,
        },
      });

      await ws.deliverMessage(
        JSON.stringify({
          type: "batch",
          operations: Array.from({ length: 127 }, (_, index) => operation(index + 1)),
        }),
      );
      expect(counter.count).toBe(127);
      expect(confirmations).toBe(0);

      await ws.deliverMessage(JSON.stringify({ type: "batch", operations: [operation(128)] }));
      expect(counter.count).toBe(128);
      expect(confirmations).toBe(1);
      client.dispose();
    });
  });

  describe("disconnect behavior", () => {
    it("marks scopes stale on disconnect", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      await ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 3 }));
      expect(counter.sync.stale).toBe(false);

      ws.simulateDisconnect();
      expect(counter.sync.stale).toBe(true);
    });

    it("ignores duplicate event with seq <= cursor", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });

      await ws.deliverMessage(
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

      await ws.deliverMessage(
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

      await ws.deliverMessage(
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

      await ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 5 }));

      await ws.deliverMessage(
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

      await ws.deliverMessage(
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

      const msgs = parseSentOperations(ws);
      const reSubMsg = msgs.find((message) => message.type === "subscribe" && message.cursor === 1);
      expect(reSubMsg).toBeTruthy();
    });

    it("dispose prevents reconnect after close", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 10,
      });

      const ws = FakeWebSocket.instances[0]!;
      ws.connect();

      client.dispose();

      await new Promise((r) => setTimeout(r, 50));

      expect(FakeWebSocket.instances.length).toBe(1);
    });
  });

  describe("presence writes", () => {
    it("updates the local session immediately and coalesces remote replacements", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      const key = { counterId: "any" };
      const session = {
        id: "self-1",
        actor: { id: "test-user", name: "Test User" },
        presence: {},
      };
      await ws.deliverMessage(makeInitMsg([session], "self-1"));
      const counter = client.counter(key);
      await ws.deliverMessage(makeSyncedMsg("counter", key, { cursor: 0, sessions: [session] }));

      counter.setPresence({ status: "first" });
      counter.setPresence({ status: "typing" });

      expect(counter.sessions).toEqual([{ ...session, presence: { status: "typing" } }]);
      const messages = await waitForSentMessages(ws, "presence");
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual({
        type: "presence",
        resource: "counter",
        key,
        value: { status: "typing" },
      });
    });

    it("rejects Presence values that cannot cross the JSON protocol", async () => {
      const client = await createClient();
      const counter = client.counter({ counterId: "invalid-presence" });
      const setPresence = counter.setPresence as (value: unknown) => void;
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      expect(() => setPresence({ status: undefined })).toThrow();
      expect(() => setPresence(cyclic)).toThrow();
      expect(counter.sessions).toEqual([]);
    });
  });

  describe("reconnect lifecycle", () => {
    it("interrupts reconnect backoff when browser authentication changes", async () => {
      const previousWindow = globalThis.window;
      const target = new EventTarget();
      Object.defineProperty(globalThis, "window", { configurable: true, value: target });
      try {
        const client = await connect(app, {
          wsUrl: "ws://localhost/ws",
          token: "test-token",
          replica: createMemoryClientReplica(),
          transport: createWebSocketSyncTransportFactory(
            FakeWebSocket as unknown as typeof WebSocket,
          ),
          reconnectMs: 99999,
        });
        const first = FakeWebSocket.instances[0]!;
        first.connect();
        first.simulateDisconnect();

        notifyAuthenticationChanged();

        expect(FakeWebSocket.instances).toHaveLength(2);
        client.dispose();
      } finally {
        if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
        else
          Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: previousWindow,
          });
      }
    });

    it("creates a new WebSocket on reconnect after close", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 5,
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

      requireSentMessage(ws2, "connect");
      const subMsg = requireSentMessage(ws2, "subscribe");
      expect(subMsg.resource).toBe("counter");
    });

    it("republishes the latest desired Presence after reconnect", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 5,
      });
      const key = { counterId: "presence-reconnect" };
      const ws1 = FakeWebSocket.instances[0]!;
      ws1.connect();
      await ws1.deliverMessage(makeInitMsg([], "first-session"));
      const counter = client.counter(key);
      await ws1.deliverMessage(makeSyncedMsg("counter", key, { cursor: 0 }));
      counter.setPresence({ status: "editing" });
      await waitForSentMessages(ws1, "presence");

      ws1.simulateDisconnect();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const ws2 = FakeWebSocket.instances[1]!;
      ws2.connect();

      expect(requireSentMessage(ws2, "presence")).toEqual({
        type: "presence",
        resource: "counter",
        key,
        value: { status: "editing" },
      });
    });

    it("does not republish Presence after authority forbids the scope", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 5,
      });
      const key = { counterId: "presence-forbidden" };
      const ws1 = FakeWebSocket.instances[0]!;
      ws1.connect();
      await ws1.deliverMessage(makeInitMsg([], "first-session"));
      const counter = client.counter(key);
      counter.setPresence({ status: "editing" });
      await waitForSentMessages(ws1, "presence");
      await ws1.deliverMessage(JSON.stringify({ type: "forbidden", resource: "counter", key }));

      ws1.simulateDisconnect();
      await new Promise((resolve) => setTimeout(resolve, 20));
      const ws2 = FakeWebSocket.instances[1]!;
      ws2.connect();

      expect(parseSentOperations(ws2).filter(({ type }) => type === "presence")).toEqual([]);
    });

    it("reaplies exponential backoff on consecutive reconnect failures", async () => {
      FakeWebSocket.reset();
      const caughtDelays: number[] = [];
      const originalSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((fn: TimerHandler, delay = 0, ...args: unknown[]) => {
        if (delay > 0 && delay <= 30000) {
          caughtDelays.push(delay);
        }
        return originalSetTimeout(fn, 0, ...args);
      }) as typeof setTimeout;

      try {
        await connect(app, {
          wsUrl: "ws://localhost/ws",
          token: "test-token",
          replica: createMemoryClientReplica(),
          transport: createWebSocketSyncTransportFactory(
            FakeWebSocket as unknown as typeof WebSocket,
          ),
          reconnectMs: 2000,
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

  describe("presence edge cases", () => {
    it("presenceLeft for self clears only the addressed scope", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      const key = { counterId: "any" };
      const session = { id: "self-1", actor: { id: "u", name: "U" }, presence: {} };
      await ws.deliverMessage(makeInitMsg([session], "self-1"));
      const counter = client.counter(key);
      await ws.deliverMessage(makeSyncedMsg("counter", key, { cursor: 0, sessions: [session] }));

      await ws.deliverMessage(makePresenceLeftMsg("counter", key, "self-1"));

      expect(counter.sessions).toEqual([]);
    });
  });

  describe("top-level snapshot version", () => {
    it("ignores saved snapshot when top-level version mismatches", async () => {
      FakeWebSocket.reset();
      const testReplica = createMemoryClientReplica();
      await testReplica.saveSnapshot({
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
        replica: testReplica,
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 99999,
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
      counter.increment({ amount: 1 });
      await poll(() => counter.count === 1);

      await withSuppressedConsole(["error"], async () => {
        await ws.deliverMessage("not valid json{{{");
      });

      expect(counter.count).toBe(1);
    });

    it("marks state stale when send throws on closed socket", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      await ws.deliverMessage(makeSyncedMsg("counter", { counterId: "c1" }, { cursor: 3 }));
      expect(counter.sync.stale).toBe(false);

      ws.send = () => {
        throw new Error("socket closed");
      };

      counter.increment({ amount: 1 });
      await poll(() => counter.sync.stale);

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

      counter.increment({ amount: 5 });
      const [cmdMsg] = await waitForSentMessages(ws, "command");
      expect(cmdMsg).toBeTruthy();
      expect(cmdMsg.commandId).toBeTruthy();

      await ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 1));

      counter.increment({ amount: 10 });
      await poll(
        () =>
          ws.sentMessages.filter((message) => JSON.parse(message).type === "command").length === 2,
      );

      const msgs2 = parseSentOperations(ws);
      const cmdMsgs = msgs2.filter((message) => message.type === "command");
      expect(cmdMsgs.length).toBe(2);
    });

    it("resends unacked commands on reconnect", async () => {
      FakeWebSocket.reset();
      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: createMemoryClientReplica(),
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 5,
      });

      const ws1 = FakeWebSocket.instances[0]!;
      ws1.connect();
      ws1.clearSent();

      const counter = client.counter({ counterId: "c1" });
      counter.increment({ amount: 99 });
      await waitForSentMessages(ws1, "command");

      ws1.simulateDisconnect();
      await new Promise((r) => setTimeout(r, 20));

      const ws2 = FakeWebSocket.instances[1]!;
      ws2.connect();

      const lookup = requireSentMessage(ws2, "receipt");
      expect(lookup).toBeTruthy();
      await ws2.deliverMessage(
        JSON.stringify({
          type: "commandAck",
          commandId: lookup.commandId,
          known: false,
          ok: false,
        }),
      );
      const recovered = ws2.sentMessages
        .map((m) => JSON.parse(m))
        .filter((m) => m.type === "command");
      expect(recovered.length).toBe(1);
      expect(recovered[0].name).toBe("increment");
      expect(recovered[0].args).toEqual([{ amount: 99 }]);
    });

    it("removes command from pending on ack", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();

      const counter = client.counter({ counterId: "c1" });
      ws.clearSent();

      counter.increment({ amount: 1 });
      const [cmdMsg] = await waitForSentMessages(ws, "command");
      expect(cmdMsg.commandId).toBeTruthy();

      await ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 1));
      ws.clearSent();

      counter.increment({ amount: 2 });
      const cmdMsgs2 = await waitForSentMessages(ws, "command");
      expect(cmdMsgs2.length).toBe(1);
      expect(cmdMsgs2[0].args).toEqual([{ amount: 2 }]);
    });

    it("exposes a reactive Submission that commits on acknowledgement", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      const submission = counter.increment({ amount: 5 });
      const phases: string[] = [];
      submission.subscribe((current) => phases.push(current.phase));
      expect(submission.phase).toBe("preparing");
      const [cmdMsg] = await waitForSentMessages(ws, "command");
      expect(submission.id).toBe(cmdMsg.commandId);
      expect(submission.phase).toBe("submitted");

      await ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 7));

      const result = await submission;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.cursor).toBe(7);
      }
      expect(submission.phase).toBe("committed");
      expect(submission.outcome).toEqual({ ok: true, cursor: 7 });
      expect(phases).toContain("queued");
      expect(phases.at(-1)).toBe("committed");
    });

    it("rejects the same Submission on a failed acknowledgement", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      const submission = counter.increment({ amount: 5 });
      const [cmdMsg] = await waitForSentMessages(ws, "command");

      await ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, false));

      const result = await submission;
      expect(result.ok).toBe(false);
      expect(submission.phase).toBe("rejected");
      expect(submission.outcome).toEqual({ ok: false, error: "internal" });
    });

    it("moves offline work through queued, submitted, uncertain, and late commit", async () => {
      const client = await createClient({ commandUncertaintyMs: 100 });
      const ws = firstSocket();
      const counter = client.counter({ counterId: "lifecycle" });
      const submission = counter.increment({ amount: 5 });

      await poll(() => submission.phase === "queued");
      expect(submission.pending).toBe(true);
      ws.connect();
      await poll(() => submission.phase === "submitted");
      await poll(() => submission.phase === "uncertain");
      expect(submission.settled).toBe(false);

      const commandId = submission.id!;
      await ws.deliverMessage(makeCommandAckMsg(commandId, true, 3));

      expect(await submission).toEqual({ ok: true, cursor: 3 });
      expect(submission.phase).toBe("committed");
      client.dispose();
    });

    it("marks an in-flight Submission uncertain as soon as transport is lost", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      const submission = client.counter({ counterId: "disconnect" }).increment({ amount: 1 });
      await waitForSentMessages(ws, "command");

      ws.simulateDisconnect();

      expect(submission.phase).toBe("uncertain");
      expect(submission.pending).toBe(true);
      client.dispose();
    });

    it("shows optimistic state immediately and rolls it back after rejection", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();
      const counter = client.counter({ counterId: "rollback" });

      const receipt = counter.increment({ amount: 5 });
      const [command] = await waitForSentMessages(ws, "command");
      expect(counter.count).toBe(5);
      await ws.deliverMessage(makeCommandAckMsg(command.commandId, false));

      expect((await receipt).ok).toBe(false);
      expect(counter.count).toBe(0);
    });

    it("confirms an intent once when its live event precedes its acknowledgement", async () => {
      const confirm = replica.confirm.bind(replica);
      let confirmations = 0;
      replica.confirm = async (input) => {
        confirmations += 1;
        await confirm(input);
      };
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();
      const key = { counterId: "event-before-ack" };
      const counter = client.counter(key);
      const receipt = counter.increment({ amount: 5 });
      const [command] = await waitForSentMessages(ws, "command");

      await ws.deliverMessage(
        makeEventMsg("counter", key, {
          id: "event-before-ack/1",
          commandId: command.commandId,
          seq: 1,
          at: 1,
          actor: { id: "test-user", name: "Test User" },
          name: "incremented",
          payload: { amount: 5 },
        }),
      );
      await ws.deliverMessage(makeCommandAckMsg(command.commandId, true, 1));

      expect((await receipt).ok).toBe(true);
      expect(counter.count).toBe(5);
      expect(confirmations).toBe(1);
      client.dispose();
    });

    it("receipt stays pending when connection drops before ack", async () => {
      const client = await createClient();
      const ws = firstSocket();
      ws.connect();
      ws.clearSent();

      const counter = client.counter({ counterId: "c1" });
      let resolved = false;
      const receipt = counter.increment({ amount: 5 });
      await waitForSentMessages(ws, "command");
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
      const receipt = counter.increment({ amount: 5 });
      const [cmdMsg] = await waitForSentMessages(ws, "command");

      const ackEvent = {
        id: "ev-1",
        seq: 1,
        at: 1000,
        actor: { id: "u", name: "U" },
        name: "incremented",
        payload: { amount: 5 },
      };

      await ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 1, [ackEvent]));

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
      const receipt = counter.increment({ amount: 5 });
      const [cmdMsg] = await waitForSentMessages(ws, "command");

      await ws.deliverMessage(
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

      expect(counter.count).toBe(5);
      expect(counter.sync.stale).toBe(true);

      await ws.deliverMessage(
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
      counter.increment({ amount: 1 });
      const [cmdMsg] = await waitForSentMessages(ws, "command");

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

      await ws.deliverMessage(makeCommandAckMsg(cmdMsg.commandId, true, 2, ackEvents));

      await new Promise((r) => setTimeout(r, 20));
      expect(counter.count).toBe(5);
    });
  });
  describe("persistence reliability", () => {
    it("fails closed when the Replica cannot load", async () => {
      FakeWebSocket.reset();
      const replica = createFailingClientReplica({ loadSnapshot: "throw" });
      await expect(
        connect(app, {
          wsUrl: "ws://localhost/ws",
          token: "test-token",
          replica,
          transport: createWebSocketSyncTransportFactory(
            FakeWebSocket as unknown as typeof WebSocket,
          ),
          reconnectMs: 99999,
        }),
      ).rejects.toThrow("Replica load failed");
    });

    it("survives saveSnapshot failure without losing in-memory state", async () => {
      FakeWebSocket.reset();
      const replica = createFailingClientReplica({ saveSnapshot: "throw" });
      let dispose: (() => void) | undefined;
      await withSuppressedConsole(["error"], async () => {
        const client = await connect(app, {
          wsUrl: "ws://localhost/ws",
          token: "test-token",
          replica,
          transport: createWebSocketSyncTransportFactory(
            FakeWebSocket as unknown as typeof WebSocket,
          ),
          reconnectMs: 99999,
        });
        dispose = client.dispose;
        const ws = FakeWebSocket.instances[0]!;
        ws.connect();
        await ws.deliverMessage(
          makeSyncedMsg(
            "counter",
            { counterId: "c1" },
            { snapshot: { version: 1, seq: 5, data: { count: 10 } }, cursor: 5 },
          ),
        );
        const counter = client.counter({ counterId: "c1" });
        expect(counter.count).toBe(10);
        await ws.deliverMessage(
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
      dispose?.();
    });

    it("persists pending command immediately on enqueue", async () => {
      FakeWebSocket.reset();
      const testReplica = createMemoryClientReplica();
      let enqueueCount = 0;
      const originalEnqueue = testReplica.enqueue.bind(testReplica);
      testReplica.enqueue = (intent) => {
        enqueueCount++;
        return originalEnqueue(intent);
      };

      const client = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: testReplica,
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 99999,
      });

      const ws = FakeWebSocket.instances[0]!;
      ws.connect();
      const counter = client.counter({ counterId: "c1" });
      counter.increment({ amount: 5 });
      await poll(() => enqueueCount === 1);
      expect(enqueueCount).toBe(1);
    });

    it("restores pending commands from snapshot after crash", async () => {
      const testReplica = createMemoryClientReplica();

      FakeWebSocket.reset();
      const clientA = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: testReplica,
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 99999,
      });

      const wsA = FakeWebSocket.instances[0]!;
      wsA.connect();
      wsA.clearSent();

      const counterA = clientA.counter({ counterId: "c1" });
      counterA.increment({ amount: 77 });
      await waitForSentMessages(wsA, "command");
      clientA.dispose();

      FakeWebSocket.reset();
      const clientB = await connect(app, {
        wsUrl: "ws://localhost/ws",
        token: "test-token",
        replica: testReplica,
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 99999,
      });

      const wsB = FakeWebSocket.instances[0]!;
      wsB.connect();

      const lookup = requireSentMessage(wsB, "receipt");
      await wsB.deliverMessage(
        JSON.stringify({
          type: "commandAck",
          commandId: lookup.commandId,
          known: false,
          ok: false,
        }),
      );
      const recovered = parseSentOperations(wsB).filter(
        (message): message is Extract<ClientOperation, { type: "command" }> =>
          message.type === "command",
      );
      expect(recovered.length).toBe(1);
      expect(recovered[0]?.name).toBe("increment");
      expect(recovered[0]?.args).toEqual([{ amount: 77 }]);

      const counterB = clientB.counter({ counterId: "c1" });
      expect(counterB.count).toBe(77);
    });

    it("migrates saved snapshot from older app version via previous chain", async () => {
      const v1 = defineApp<{
        Actor: { id: string; name: string };
        Resources: {
          counter: {
            Key: { counterId: string };
            State: { count: number };
            Presence: Record<string, never>;
            Events: { incremented: { amount: number } };
            Views: { count: number };
            Commands: {
              increment: { Input: { amount: number }; Event: "incremented"; Error: never };
            };
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
              increment(ctx, { amount }) {
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
              Presence: Record<string, never>;
              Events: { incremented: { amount: number } };
              Views: { total: number };
              Commands: {
                increment: { Input: { amount: number }; Event: "incremented"; Error: never };
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
              increment(ctx, { amount }) {
                return ctx.event.incremented({ amount });
              },
            },
          },
        },
      });

      FakeWebSocket.reset();
      const testReplica = createMemoryClientReplica();
      await testReplica.saveSnapshot({
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
        replica: testReplica,
        transport: createWebSocketSyncTransportFactory(
          FakeWebSocket as unknown as typeof WebSocket,
        ),
        reconnectMs: 99999,
      });

      const counter = client.counter({ counterId: "c1" });
      expect(counter.total).toBe(99);
      expect(counter.sync.cursor).toBe(3);
    });
  });
});

describe("resource policies", () => {
  const policyApp = defineApp<{
    Actor: { id: string };
    Resources: {
      preferences: {
        Policy: "device";
        Key: string;
        State: { density: number };
        Events: { changed: { density: number } };
        Views: { density: number };
        Commands: { setDensity: { Input: { density: number }; Event: "changed" } };
      };
      draft: {
        Policy: "memory";
        Key: string;
        State: { text: string };
        Events: { changed: { text: string } };
        Views: { text: string };
        Commands: { setText: { Input: { text: string }; Event: "changed" } };
      };
    };
  }>({
    version: 1,
    identify: ({ token }) => (token ? { id: token } : null),
    resources: {
      preferences: {
        policy: "device",
        state: { density: 1 },
        events: { changed: ({ state, payload }) => void (state.density = payload.density) },
        views: { density: ({ state }) => state.density },
        commands: { setDensity: (context, { density }) => context.event.changed({ density }) },
      },
      draft: {
        policy: "memory",
        state: { text: "" },
        events: { changed: ({ state, payload }) => void (state.text = payload.text) },
        views: { text: ({ state }) => state.text },
        commands: { setText: (context, { text }) => context.event.changed({ text }) },
      },
    },
  });

  async function policyClient(
    token: string,
    replica: ReturnType<typeof createMemoryClientReplica>,
  ) {
    FakeWebSocket.reset();
    const client = await connect(policyApp, {
      wsUrl: "ws://localhost/ws",
      token,
      replica,
      transport: createWebSocketSyncTransportFactory(FakeWebSocket as unknown as typeof WebSocket),
      reconnectMs: 99_999,
    });
    const socket = FakeWebSocket.instances[0]!;
    socket.connect();
    socket.clearSent();
    return { client, socket };
  }

  it("runs device and memory commands locally without server protocol messages", async () => {
    const { client, socket } = await policyClient("actor-a", createMemoryClientReplica());
    const preferences = client.preferences("settings");
    const draft = client.draft("composer");

    expect(await preferences.setDensity({ density: 2 })).toEqual({ ok: true, cursor: 1 });
    expect(await draft.setText({ text: "local" })).toEqual({ ok: true, cursor: 1 });
    expect(preferences.density).toBe(2);
    expect(draft.text).toBe("local");
    expect(socket.sentMessages).toEqual([]);
    client.dispose();
  });

  it("persists device state per actor while memory state resets", async () => {
    const replica = createMemoryClientReplica();
    const first = await policyClient("actor-a", replica);
    await first.client.preferences("settings").setDensity({ density: 3 });
    await first.client.draft("composer").setText({ text: "discard me" });
    first.client.dispose();

    const restored = await policyClient("actor-a", replica);
    expect(restored.client.preferences("settings").density).toBe(3);
    expect(restored.client.draft("composer").text).toBe("");
    restored.client.dispose();

    const anotherActor = await policyClient("actor-b", replica);
    expect(anotherActor.client.preferences("settings").density).toBe(1);
    anotherActor.client.dispose();
  });
});
