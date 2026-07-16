import type { SyncTransport, SyncTransportFactory, SyncTransportHandlers } from "#substrate/sync";

export function createWebSocketSyncTransport(
  url: string,
  handlers: SyncTransportHandlers,
  signal?: AbortSignal,
  WebSocket: typeof globalThis.WebSocket = globalThis.WebSocket,
): SyncTransport {
  const socket = new WebSocket(url);
  let closed = false;

  const abort = (): void => {
    if (!closed) socket.close();
  };
  socket.onopen = handlers.open;
  socket.onmessage = (event) => {
    if (typeof event.data === "string") return handlers.frame(event.data);
    handlers.error(new TypeError("The sync transport received a non-text frame."));
  };
  socket.onerror = handlers.error;
  socket.onclose = () => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener("abort", abort);
    handlers.close();
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  return {
    get state() {
      if (socket.readyState === WebSocket.CONNECTING) return "connecting";
      if (socket.readyState === WebSocket.OPEN) return "open";
      return "closed";
    },
    get bufferedBytes() {
      return socket.bufferedAmount ?? 0;
    },
    send(frame) {
      socket.send(frame);
    },
    close(code, reason) {
      socket.close(code, reason);
    },
  };
}

export function createWebSocketSyncTransportFactory(
  WebSocket: typeof globalThis.WebSocket,
): SyncTransportFactory {
  return (url, handlers, signal) => createWebSocketSyncTransport(url, handlers, signal, WebSocket);
}
