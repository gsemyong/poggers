import { expect, test } from "bun:test";

import { createWebSocketSyncTransport } from "#host/sync.websocket";
import { FakeWebSocket } from "#testing/fake-websocket";

test("the WebSocket transport carries opaque frames for one cancellable lifetime", async () => {
  FakeWebSocket.reset();
  const frames: string[] = [];
  let opens = 0;
  let closes = 0;
  const lifetime = new AbortController();
  const transport = createWebSocketSyncTransport(
    "ws://localhost/sync",
    {
      open: () => opens++,
      close: () => closes++,
      frame: (frame) => void frames.push(frame),
      error: () => undefined,
    },
    lifetime.signal,
    FakeWebSocket as unknown as typeof WebSocket,
  );
  const socket = FakeWebSocket.instances[0]!;

  expect(transport.state).toBe("connecting");
  socket.connect();
  expect(transport.state).toBe("open");
  expect(opens).toBe(1);

  transport.send('{"opaque":true}');
  expect(socket.sentMessages).toEqual(['{"opaque":true}']);
  await socket.deliverMessage('{"frame":1}');
  expect(frames).toEqual(['{"frame":1}']);

  lifetime.abort();
  lifetime.abort();
  expect(transport.state).toBe("closed");
  expect(closes).toBe(1);
});
