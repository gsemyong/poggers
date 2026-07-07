import { describe, it, expect, beforeEach } from "bun:test";
import { connect } from "infra/client";
import { createTestApp } from "tests/helpers/test-app";
import { createMemoryClientStore } from "tests/helpers/memory-storage";
import { FakeWebSocket } from "tests/helpers/fake-websocket";

const app = createTestApp("test-token");

async function makeClient() {
  FakeWebSocket.reset();
  return connect(app, {
    wsUrl: "ws://localhost/ws",
    token: "test-token",
    storage: createMemoryClientStore(),
    WebSocket: FakeWebSocket as any,
    reconnectMs: 99999,
    persistIntervalMs: 99999,
  });
}

function ws(): FakeWebSocket {
  return FakeWebSocket.instances[0]!;
}

describe("integration: client protocol", () => {
  beforeEach(() => FakeWebSocket.reset());

  it("sends connect message on open", async () => {
    await makeClient();
    ws().connect();

    const msgs = ws().sentMessages.map((m) => JSON.parse(m));
    const connectMsg = msgs.find((m: any) => m.type === "connect");
    expect(connectMsg).toBeDefined();
    expect(connectMsg.token).toBe("test-token");
  });

  it("sends subscribe on first resource access", async () => {
    const client = await makeClient();
    ws().connect();
    ws().clearSent();

    client.counter({ counterId: "c1" });

    const msgs = ws().sentMessages.map((m) => JSON.parse(m));
    const subMsg = msgs.find((m: any) => m.type === "subscribe");
    expect(subMsg).toBeDefined();
    expect(subMsg.resource).toBe("counter");
    expect(subMsg.key).toEqual({ counterId: "c1" });
  });

  it("cached resource access does not resubscribe", async () => {
    const client = await makeClient();
    ws().connect();
    ws().clearSent();

    client.counter({ counterId: "c1" });
    const count1 = ws().sentMessages.length;
    client.counter({ counterId: "c1" });
    expect(ws().sentMessages.length).toBe(count1);
  });

  it("sends command with resource, key, and args", async () => {
    const client = await makeClient();
    ws().connect();
    ws().clearSent();

    const counter = client.counter({ counterId: "c1" });
    counter.increment(5);

    const msgs = ws().sentMessages.map((m) => JSON.parse(m));
    const cmdMsg = msgs.find((m: any) => m.type === "command");
    expect(cmdMsg).toBeDefined();
    expect(cmdMsg.name).toBe("increment");
    expect(cmdMsg.args).toEqual([5]);
    expect(cmdMsg.resource).toBe("counter");
    expect(cmdMsg.key).toEqual({ counterId: "c1" });
  });

  it("queues command when not connected", async () => {
    const client = await makeClient();
    const counter = client.counter({ counterId: "c1" });
    counter.increment(5);
    expect(ws().sentMessages.length).toBe(0);
  });
});
