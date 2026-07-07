import { describe, it, expect, beforeEach } from "bun:test";
import { connect } from "infra/client";
import { createTestApp } from "tests/helpers/test-app";
import { createMemoryClientStore } from "tests/helpers/memory-storage";
import { FakeWebSocket } from "tests/helpers/fake-websocket";

const app = createTestApp("test-token");

async function makeClient(opts?: { reconnectMs?: number }) {
  FakeWebSocket.reset();
  return connect(app, {
    wsUrl: "ws://localhost/ws",
    token: "test-token",
    storage: createMemoryClientStore(),
    WebSocket: FakeWebSocket as any,
    reconnectMs: opts?.reconnectMs ?? 100,
    persistIntervalMs: 99999,
  });
}

function ws(): FakeWebSocket {
  return FakeWebSocket.instances[0]!;
}

describe("integration: reconnect-outbox", () => {
  beforeEach(() => FakeWebSocket.reset());

  it("queues commands when disconnected", async () => {
    const client = await makeClient();
    const counter = client.counter({ counterId: "c1" });
    counter.increment(1);
    counter.increment(2);
    expect(ws().sentMessages.length).toBe(0);
  });

  it("flushes outbox on connect", async () => {
    const client = await makeClient();
    const counter = client.counter({ counterId: "c1" });
    counter.increment(1);
    expect(ws().sentMessages.length).toBe(0);

    ws().connect();

    const msgs = ws().sentMessages.map((m) => JSON.parse(m));
    const cmdMsgs = msgs.filter((m: any) => m.type === "command");
    expect(cmdMsgs.length).toBe(1);
    expect(cmdMsgs[0].name).toBe("increment");
    expect(cmdMsgs[0].args).toEqual([1]);
  });

  it("resubscribes active scopes on reconnect", async () => {
    const client = await makeClient();
    ws().connect();
    ws().clearSent();

    client.counter({ counterId: "c1" });

    ws().simulateDisconnect();
    ws().simulateReconnect();

    const msgs = ws().sentMessages.map((m) => JSON.parse(m));
    const subMsgs = msgs.filter((m: any) => m.type === "subscribe");
    expect(subMsgs.length).toBeGreaterThanOrEqual(1);
    expect(subMsgs[0].resource).toBe("counter");
  });

  it("marks stale on disconnect", async () => {
    const client = await makeClient();
    ws().connect();

    const counter = client.counter({ counterId: "c1" });
    ws().deliverMessage(
      JSON.stringify({ type: "synced", resource: "counter", key: { counterId: "c1" }, cursor: 3 }),
    );
    expect(counter.sync.stale).toBe(false);

    ws().simulateDisconnect();
    expect(counter.sync.stale).toBe(true);
  });

  it("outbox persists across disconnect and reconnect", async () => {
    const client = await makeClient();
    ws().connect();
    ws().clearSent();

    const counter = client.counter({ counterId: "c1" });

    ws().simulateDisconnect();
    counter.increment(1);
    counter.increment(2);

    ws().simulateReconnect();

    const msgs = ws().sentMessages.map((m) => JSON.parse(m));
    const cmdMsgs = msgs.filter((m: any) => m.type === "command");
    expect(cmdMsgs.length).toBe(2);
    expect(cmdMsgs[0].args[0]).toBe(1);
    expect(cmdMsgs[1].args[0]).toBe(2);
  });
});
