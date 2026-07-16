import { describe, it, expect, beforeEach } from "bun:test";

import { createWebSocketSyncTransportFactory } from "#host/sync.websocket";
import { connect } from "#substrate/client";
import type { ClientOperation } from "#substrate/protocol";
import { FakeWebSocket } from "#testing/fake-websocket";
import { createMemoryClientReplica } from "#testing/replica";
import { createTestApp } from "#testing/test-app";
import { poll } from "#testing/wait";

const app = createTestApp("test-token");

async function settleClient(): Promise<void> {
  await Bun.sleep(5);
}

async function makeClient() {
  FakeWebSocket.reset();
  return connect(app, {
    wsUrl: "ws://localhost/ws",
    token: "test-token",
    replica: createMemoryClientReplica(),
    transport: createWebSocketSyncTransportFactory(FakeWebSocket as unknown as typeof WebSocket),
    reconnectMs: 100,
  });
}

function ws(): FakeWebSocket {
  return FakeWebSocket.instances[0]!;
}

function sentOperations(socket: FakeWebSocket): ClientOperation[] {
  return socket.sentMessages.flatMap((message) => {
    const parsed = JSON.parse(message) as ClientOperation | { operations: ClientOperation[] };
    return "operations" in parsed ? parsed.operations : [parsed];
  });
}

describe("client receipt recovery", () => {
  beforeEach(() => FakeWebSocket.reset());

  it("settles a durable intent from an authority receipt without evaluating it again", async () => {
    const client = await makeClient();
    const counter = client.counter({ counterId: "c1" });
    counter.increment({ amount: 1 });
    await settleClient();

    ws().connect();
    await poll(() => sentOperations(ws()).some((message) => message.type === "receipt"));
    const lookup = sentOperations(ws()).find((message) => message.type === "receipt");
    if (!lookup || lookup.type !== "receipt") throw new Error("Missing receipt lookup operation.");

    await ws().deliverMessage(
      JSON.stringify({
        type: "commandAck",
        commandId: lookup.commandId,
        known: true,
        ok: true,
        cursor: 1,
        events: [
          {
            id: "event-1",
            seq: 1,
            at: 1,
            actor: { id: "test" },
            name: "incremented",
            payload: { amount: 1 },
            commandId: lookup.commandId,
          },
        ],
      }),
    );

    expect(sentOperations(ws()).some((message) => message.type === "command")).toBe(false);
    expect(counter.count).toBe(1);

    ws().clearSent();
    ws().simulateDisconnect();
    ws().simulateReconnect();
    expect(sentOperations(ws()).some((message) => message.type === "receipt")).toBe(false);
  });
});
