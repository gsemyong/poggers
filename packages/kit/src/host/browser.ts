import { createWebSocketSyncTransport } from "#host/sync.websocket";
import type { ConnectOpts } from "#substrate/client";
import { createIndexedDbReplicaStore } from "#substrate/replica.indexeddb";

export { defineApp, installAppMigrations } from "#kernel/app";
export { startDependencyGroups } from "#kernel/dependency";
export { createHooks } from "#ui/web/component";
export { render, type HotRenderState } from "#ui/web/runtime";

export function createBrowserConnectOptions(): ConnectOpts | undefined {
  if (typeof location === "undefined") return undefined;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const token = new URLSearchParams(location.search).get("token") ?? "local";
  return {
    wsUrl: `${protocol}://${location.host}/ws`,
    token,
    replica: createIndexedDbReplicaStore(),
    transport: createWebSocketSyncTransport,
  };
}
