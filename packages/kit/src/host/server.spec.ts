import { afterEach, describe, it, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serve, type ServerHandle } from "#host/server";
import { createWebSocketSyncTransport } from "#host/sync.websocket";
import { defineApp, type FeatureDef } from "#kernel/app";
import {
  createJournalAuthority,
  createMemorySubstrate,
  createSingleNodeSubstrate,
} from "#substrate/adapter.memory";
import { connect } from "#substrate/client";
import { createMemoryJournal, type JournalSnapshot } from "#substrate/journal";
import { maxProtocolBatch, protocolVersion } from "#substrate/protocol";
import { createResourceIntent, executeResourceCommand } from "#substrate/resource";
import { createMemoryClientReplica } from "#testing/replica";
import { createTestApp } from "#testing/test-app";
import { poll } from "#testing/wait";

const app = createTestApp("test-token");
let handle: ServerHandle | null = null;
const temporaryDirs: string[] = [];

afterEach(async () => {
  await handle?.stop();
  handle = null;
  for (const dir of temporaryDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("server admission limits", () => {
  it("rejects limits that cannot fit one atomic protocol decision", async () => {
    const journal = createMemoryJournal();
    expect(() =>
      serve(app, {
        substrate: createSingleNodeSubstrate(journal),
        limits: { eventsPerDecision: maxProtocolBatch + 1 },
      }),
    ).toThrow("eventsPerDecision cannot exceed");
    expect(() =>
      serve(app, {
        substrate: createSingleNodeSubstrate(journal),
        limits: { replayEvents: maxProtocolBatch + 1 },
      }),
    ).toThrow("replayEvents cannot exceed");
    await journal.close();
  });

  it("closes a client before loading more Resources than configured", async () => {
    handle = serve(app, {
      port: 0,
      substrate: createMemorySubstrate(),
      limits: { loadedResources: 1 },
    });
    const socket = new WebSocket(new URL("/ws", handle.url).href.replace("http", "ws"));
    const messages: Array<{ type?: unknown }> = [];
    socket.onmessage = (event) =>
      messages.push(JSON.parse(String(event.data)) as { type?: unknown });
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener("close", resolve));
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    socket.send(JSON.stringify({ type: "connect", version: protocolVersion, token: "test-token" }));
    await poll(() => messages.some((message) => message.type === "init"));
    socket.send(
      JSON.stringify({
        type: "subscribe",
        resource: "counter",
        key: { counterId: "one" },
        cursor: 0,
      }),
    );
    await poll(() => messages.some((message) => message.type === "synced"));
    socket.send(
      JSON.stringify({
        type: "subscribe",
        resource: "counter",
        key: { counterId: "two" },
        cursor: 0,
      }),
    );
    expect((await closed).code).toBe(1013);
  });

  it("closes a client before retaining more subscriptions than configured", async () => {
    handle = serve(app, {
      port: 0,
      substrate: createMemorySubstrate(),
      limits: { subscriptionsPerClient: 1 },
    });
    const socket = new WebSocket(new URL("/ws", handle.url).href.replace("http", "ws"));
    const messages: Array<{ type?: unknown }> = [];
    socket.onmessage = (event) =>
      messages.push(JSON.parse(String(event.data)) as { type?: unknown });
    const closed = new Promise<CloseEvent>((resolve) => socket.addEventListener("close", resolve));
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));
    socket.send(JSON.stringify({ type: "connect", version: protocolVersion, token: "test-token" }));
    await poll(() => messages.some((message) => message.type === "init"));
    for (const counterId of ["one", "two"]) {
      socket.send(
        JSON.stringify({
          type: "subscribe",
          resource: "counter",
          key: { counterId },
          cursor: 0,
        }),
      );
      if (counterId === "one") {
        await poll(() => messages.some((message) => message.type === "synced"));
      }
    }
    expect((await closed).code).toBe(1013);
  });

  it("closes an additional subscriber before Resource fan-out exceeds its bound", async () => {
    handle = serve(app, {
      port: 0,
      substrate: createMemorySubstrate(),
      limits: { subscribersPerResource: 1 },
    });
    const url = new URL("/ws", handle.url).href.replace("http", "ws");
    const first = new WebSocket(url);
    const second = new WebSocket(url);
    const firstMessages: Array<{ type?: unknown }> = [];
    const secondMessages: Array<{ type?: unknown }> = [];
    first.onmessage = (event) =>
      firstMessages.push(JSON.parse(String(event.data)) as { type?: unknown });
    second.onmessage = (event) =>
      secondMessages.push(JSON.parse(String(event.data)) as { type?: unknown });
    const secondClosed = new Promise<CloseEvent>((resolve) =>
      second.addEventListener("close", resolve),
    );
    await Promise.all(
      [first, second].map(
        (socket) =>
          new Promise<void>((resolve) => socket.addEventListener("open", () => resolve())),
      ),
    );
    for (const socket of [first, second]) {
      socket.send(
        JSON.stringify({ type: "connect", version: protocolVersion, token: "test-token" }),
      );
    }
    await poll(
      () =>
        firstMessages.some((message) => message.type === "init") &&
        secondMessages.some((message) => message.type === "init"),
    );
    const subscribe = JSON.stringify({
      type: "subscribe",
      resource: "counter",
      key: { counterId: "shared" },
      cursor: 0,
    });
    first.send(subscribe);
    await poll(() => firstMessages.some((message) => message.type === "synced"));
    second.send(subscribe);
    expect((await secondClosed).code).toBe(1013);
    first.close();
  });
});

describe("Resource snapshots", () => {
  it("synchronizes more scopes than the client message queue through bounded batches", async () => {
    handle = serve(app, { port: 0, substrate: createMemorySubstrate() });
    await handle.ready;
    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 60_000,
    });
    const counters = Array.from({ length: 300 }, (_, index) =>
      client.counter({ counterId: `subscription-burst-${index}` }),
    );

    try {
      await poll(() => counters.every((counter) => !counter.sync.stale), {
        timeoutMs: 15_000,
      });
    } catch {
      const synchronized = counters.filter((counter) => !counter.sync.stale).length;
      throw new Error(
        `Only ${synchronized}/${counters.length} scopes synchronized; connected=${client.connected}.`,
      );
    }
    expect(counters.every((counter) => counter.count === 0)).toBe(true);
    expect(client.connected).toBe(true);
    client.dispose();
  }, 20_000);

  it("retains a newer dirty revision while an earlier snapshot is being stored", async () => {
    const journal = createMemoryJournal();
    const saveSnapshot = journal.saveSnapshot.bind(journal);
    const snapshotStarted = Promise.withResolvers<void>();
    const releaseSnapshot = Promise.withResolvers<void>();
    let delayed = true;
    journal.saveSnapshot = async <State>(snapshot: JournalSnapshot<State>) => {
      if (delayed) {
        delayed = false;
        snapshotStarted.resolve();
        await releaseSnapshot.promise;
      }
      return saveSnapshot(snapshot);
    };

    handle = serve(app, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      snapshotIntervalMs: 60_000,
      snapshotRecords: 1,
    });
    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 60_000,
    });
    const counterKey = { counterId: "snapshot-race" };
    const counter = client.counter(counterKey);
    await poll(() => !counter.sync.stale);

    const first = counter.increment({ amount: 1 });
    await snapshotStarted.promise;
    const second = counter.increment({ amount: 1 });
    await second;
    releaseSnapshot.resolve();
    await first;

    await poll(async () => {
      const loaded = await journal.load({ resource: "counter", key: counterKey });
      return loaded.snapshot?.revision === 2;
    });
    const loaded = await journal.load({ resource: "counter", key: counterKey });
    expect(loaded.snapshot?.revision).toBe(2);
    expect(loaded.records).toEqual([]);

    client.dispose();
    await handle.stop();
    handle = null;
    await journal.close();
  }, 10_000);

  it("streams a snapshot larger than one WebSocket frame to a fresh client", async () => {
    type LargeApp = {
      Actor: { id: string };
      Resources: {
        large: {
          Key: string;
          State: { values: string[] };
          Events: { written: { value: string } };
          Views: { bytes: number };
          Commands: { write: { Input: { value: string }; Event: "written" } };
        };
      };
    };
    const largeApp = defineApp<LargeApp>({
      version: 1,
      identify: ({ token }) => ({ id: token }),
      resources: {
        large: {
          state: { values: [] },
          events: {
            written({ state, payload }) {
              state.values = Array.from({ length: 5 }, () => payload.value);
            },
          },
          views: { bytes: ({ state }) => state.values[0]?.length ?? 0 },
          commands: { write: (context, { value }) => context.event.written({ value }) },
        },
      },
    });
    const journal = createMemoryJournal();
    handle = serve(largeApp, { port: 0, substrate: createSingleNodeSubstrate(journal) });
    const wsUrl = `${handle.url.origin.replace("http", "ws")}/ws`;
    const writer = await connect(largeApp, {
      wsUrl,
      token: "owner",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 60_000,
    });
    const source = writer.large("one");
    await poll(() => !source.sync.stale);
    expect(await source.write({ value: "x".repeat(262_144) })).toMatchObject({ ok: true });
    writer.dispose();

    const reader = await connect(largeApp, {
      wsUrl,
      token: "owner",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 60_000,
    });
    const restored = reader.large("one");
    await poll(() => !restored.sync.stale && restored.bytes === 262_144, { timeoutMs: 5_000 });
    expect(restored.bytes).toBe(262_144);
    reader.dispose();
    await handle.stop();
    handle = null;
    await journal.close();
  }, 10_000);
});

describe("server lifecycle", () => {
  it("stops admission, drains an in-flight authority commit, and snapshots before resolving", async () => {
    const journal = createMemoryJournal();
    const append = journal.append.bind(journal);
    const appendStarted = Promise.withResolvers<void>();
    const releaseAppend = Promise.withResolvers<void>();
    let delayed = true;
    journal.append = async (input) => {
      if (delayed) {
        delayed = false;
        appendStarted.resolve();
        await releaseAppend.promise;
      }
      return append(input);
    };
    handle = serve(app, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      snapshotIntervalMs: 60_000,
      snapshotRecords: 1,
    });
    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 60_000,
    });
    const key = { counterId: "drain" };
    const counter = client.counter(key);
    await poll(() => !counter.sync.stale);
    void counter.increment({ amount: 1 });
    await appendStarted.promise;
    client.dispose();

    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    await Bun.sleep(5);
    expect(stopped).toBeFalse();
    releaseAppend.resolve();
    await stopping;
    handle = null;

    const loaded = await journal.load({ resource: "counter", key });
    expect(loaded.head.revision).toBe(1);
    expect(loaded.snapshot?.revision).toBe(1);
    await journal.close();
  });

  it("keeps an activated Resource hot without replaying its history for each append", async () => {
    const journal = createMemoryJournal();
    const load = journal.load.bind(journal);
    let loads = 0;
    journal.load = async (address) => {
      loads += 1;
      return load(address);
    };
    handle = serve(app, {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      snapshotIntervalMs: 60_000,
      snapshotRecords: 10_000,
    });
    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 60_000,
    });
    const counter = client.counter({ counterId: "hot" });
    await poll(() => !counter.sync.stale && !counter.sync.syncing);
    for (let index = 0; index < 10; index += 1) {
      expect((await counter.increment({ amount: 1 })).ok).toBeTrue();
    }

    expect(counter.count).toBe(10);
    expect(loads).toBe(1);
    client.dispose();
    await handle.stop();
    handle = null;
    await journal.close();
  });
});

describe("Resource read authority", () => {
  it("delivers no snapshot before the Resource authorizes its reader", async () => {
    const secured = defineApp<{
      Actor: { id: string };
      Resources: {
        secret: {
          Key: string;
          State: { value: string };
          Events: { set: { value: string } };
          Views: { value: string };
          Commands: { set: { Input: { value: string }; Event: "set" } };
        };
      };
    }>({
      version: 1,
      identify: ({ token }) => ({ id: token }),
      resources: {
        secret: {
          state: { value: "redacted" },
          authorize: ({ actor, key }) => actor.id === key,
          events: {
            set({ state, payload }) {
              state.value = payload.value;
            },
          },
          views: {
            value: ({ state }) => state.value,
          },
          commands: {
            set(context, { value }) {
              context.event.set({ value });
            },
          },
        },
      },
    });
    const journal = createMemoryJournal();
    await executeResourceCommand(
      secured,
      createJournalAuthority(journal),
      createResourceIntent("owner/1", {
        resource: "secret",
        key: "owner",
        name: "set",
        args: [{ value: "classified" }],
        actor: { id: "owner" },
        at: 1,
      }),
    );
    handle = serve(secured, { port: 0, substrate: createSingleNodeSubstrate(journal) });
    const client = await connect(secured, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "intruder",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 99_999,
    });
    const secret = client.secret("owner");
    secret.subscribe(() => undefined);

    await poll(() => secret.sync.error === "forbidden");
    expect(secret.value).toBe("redacted");
    expect(secret.sync.cursor).toBe(0);
    client.dispose();
  });

  it("terminates a live subscription in the revision that revokes its Actor", async () => {
    const secured = defineApp<{
      Actor: { id: string };
      Resources: {
        vault: {
          Key: string;
          State: { members: string[]; uses: number };
          Presence: { editing: boolean };
          Events: { revoked: { actor: string }; used: {} };
          Views: { uses: number; peers: number };
          Commands: {
            revoke: { Input: { actor: string }; Event: "revoked" };
            use: { Input: {}; Event: "used" };
          };
        };
      };
    }>({
      version: 1,
      identify: ({ token }) => ({ id: token }),
      resources: {
        vault: {
          state: { members: ["device"], uses: 0 },
          presence: { editing: false },
          authorize({ state, actor, operation }) {
            if (actor.id === "owner") return true;
            return (
              state.members.includes(actor.id) &&
              (operation.type === "read" || operation.name === "use")
            );
          },
          events: {
            revoked({ state, payload }) {
              state.members = state.members.filter((actor) => actor !== payload.actor);
            },
            used({ state }) {
              state.uses++;
            },
          },
          views: {
            uses: ({ state }) => state.uses,
            peers: ({ sessions }) => sessions.length,
          },
          commands: {
            revoke(context, { actor }) {
              context.event.revoked({ actor });
            },
            use(context) {
              context.event.used({});
            },
          },
        },
      },
    });
    const journal = createMemoryJournal();
    handle = serve(secured, { port: 0, substrate: createSingleNodeSubstrate(journal) });
    const wsUrl = `${handle.url.origin.replace("http", "ws")}/ws`;
    const device = await connect(secured, {
      wsUrl,
      token: "device",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 99_999,
    });
    const owner = await connect(secured, {
      wsUrl,
      token: "owner",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 99_999,
    });
    const deviceVault = device.vault("primary");
    deviceVault.subscribe(() => undefined);
    await poll(() => !deviceVault.sync.stale);
    expect(deviceVault.sync.error).toBeNull();

    const ownerVault = owner.vault("primary");
    deviceVault.setPresence({ editing: true });
    await poll(() => ownerVault.peers === 2);
    expect(await ownerVault.revoke({ actor: "device" })).toMatchObject({ ok: true });
    await poll(() => deviceVault.sync.error === "forbidden");
    await poll(() => ownerVault.peers === 1);
    expect(deviceVault.sync.cursor).toBe(0);
    expect(await deviceVault.use({})).toMatchObject({ ok: false, error: "forbidden" });
    expect(deviceVault.uses).toBe(0);

    device.dispose();
    owner.dispose();
  });
});

describe("server startup", () => {
  it("fails the ready gate before serving an unknown persisted Resource", async () => {
    const journal = createMemoryJournal();
    await journal.append({
      address: { resource: "removed", key: "main" },
      expected: { revision: 0, position: 0 },
      record: {
        schema: "removed:1",
        intent: { id: "old/1", inputHash: "old", value: { removed: true } },
        decision: { ok: true, events: [] },
      },
    });

    handle = serve(app, { port: 0, substrate: createSingleNodeSubstrate(journal) });
    await expect(handle.ready).rejects.toThrow("unknown Resource");
  });
});

describe("Feature endpoint dispatch", () => {
  it("resolves the exact application actor through a mounted authentication port", async () => {
    type Actor = { id: string; role: "member" | "admin" };
    type Auth = {
      resolve(credential: { readonly headers: Headers }): Promise<{ readonly actor: Actor } | null>;
    };
    type AuthenticatedApp = {
      Actor: Actor;
      Resources: {};
      Endpoints: { account: { Method: "GET" } };
      Authentication: Auth;
    };
    const auth: Auth = {
      async resolve({ headers }) {
        return headers.get("cookie") === "session=valid"
          ? { actor: { id: "ada", role: "admin" } }
          : null;
      },
    };
    const endpointApp = defineApp<AuthenticatedApp>({
      version: 1,
      resources: {},
      authentication: auth,
      endpoints: {
        account: {
          method: "GET",
          path: "/account",
          handle: (_request, { actor }) => Response.json(actor),
        },
      },
    });
    expect(() => serve(endpointApp, { port: 0, substrate: createMemorySubstrate() })).toThrow(
      "Authentication for application is not started",
    );
    handle = serve(endpointApp, {
      port: 0,
      substrate: createMemorySubstrate(),
      dependencyGroups: endpointApp.def.dependencyGroups.server,
    });
    const response = await fetch(new URL("/account", handle.url), {
      headers: { cookie: "session=valid" },
    });
    expect(await response.json()).toEqual({ id: "ada", role: "admin" });
  });

  it("revalidates authenticated sockets and closes a revoked actor deterministically", async () => {
    type Actor = { id: string; role: "member" };
    type Auth = {
      resolve(credential: { readonly headers: Headers }): Promise<{ readonly actor: Actor } | null>;
    };
    type AuthenticatedApp = {
      Actor: Actor;
      Resources: {};
      Authentication: Auth;
    };
    let active = true;
    const auth: Auth = {
      async resolve({ headers }) {
        return active && headers.get("authorization") === "Bearer valid"
          ? { actor: { id: "ada", role: "member" } }
          : null;
      },
    };
    const socketApp = defineApp<AuthenticatedApp>({
      version: 1,
      resources: {},
      authentication: auth,
    });
    handle = serve(socketApp, {
      port: 0,
      substrate: createMemorySubstrate(),
      dependencyGroups: socketApp.def.dependencyGroups.server,
    });
    const url = new URL("/ws", handle.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    const initialized = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("socket did not initialize")), 2_000);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "connect", version: protocolVersion, token: "valid" }));
      });
      socket.addEventListener("message", (event) => {
        if (JSON.parse(String(event.data)).type !== "init") return;
        clearTimeout(timeout);
        resolve();
      });
      socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
    });
    await initialized;
    active = false;
    const closed = new Promise<CloseEvent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("revoked socket stayed open")), 2_000);
      socket.addEventListener(
        "close",
        (event) => {
          clearTimeout(timeout);
          resolve(event);
        },
        { once: true },
      );
    });
    socket.send(JSON.stringify({ type: "subscribe", resource: "missing", key: "key", cursor: 0 }));
    const event = await closed;
    expect(event.code).toBe(4001);
    expect(event.reason).toBe("session changed");
  });

  it("processes connect before an immediate subscription while authentication is pending", async () => {
    type Actor = { id: string; role: "member" };
    type Auth = {
      resolve(credential: { readonly headers: Headers }): Promise<{ readonly actor: Actor } | null>;
    };
    type SequencedApp = {
      Actor: Actor;
      Resources: {
        counter: {
          Key: { id: string };
          State: { count: number };
          Events: {};
          Views: { count: number };
          Commands: {};
        };
      };
      Authentication: Auth;
    };
    const auth: Auth = {
      async resolve({ headers }) {
        await Bun.sleep(25);
        return headers.get("authorization") === "Bearer valid"
          ? { actor: { id: "ada", role: "member" } }
          : null;
      },
    };
    const socketApp = defineApp<SequencedApp>({
      version: 1,
      resources: {
        counter: {
          state: { count: 0 },
          events: {},
          views: { count: ({ state }) => state.count },
          commands: {},
        },
      },
      authentication: auth,
    });
    handle = serve(socketApp, {
      port: 0,
      substrate: createMemorySubstrate(),
      dependencyGroups: socketApp.def.dependencyGroups.server,
    });
    const url = new URL("/ws", handle.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    const messages: string[] = [];
    const synchronized = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("socket did not synchronize")), 2_000);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "connect", version: protocolVersion, token: "valid" }));
        socket.send(
          JSON.stringify({
            type: "subscribe",
            resource: "counter",
            key: { id: "proof" },
            cursor: 0,
          }),
        );
      });
      socket.addEventListener("message", (event) => {
        const type = JSON.parse(String(event.data)).type as string;
        messages.push(type);
        if (type !== "synced") return;
        clearTimeout(timeout);
        resolve();
      });
      socket.addEventListener(
        "close",
        (event) => {
          clearTimeout(timeout);
          reject(new Error(`socket closed before sync: ${event.code} ${event.reason}`));
        },
        { once: true },
      );
    });

    await synchronized;
    expect(messages).toEqual(["init", "synced"]);
    socket.close();
  });

  it("closes an inbound producer before queued frame bytes exceed their bound", async () => {
    type Actor = { id: string };
    type Auth = {
      resolve(credential: { readonly headers: Headers }): Promise<{ readonly actor: Actor } | null>;
    };
    const authenticationStarted = Promise.withResolvers<void>();
    const releaseAuthentication = Promise.withResolvers<void>();
    const auth: Auth = {
      async resolve() {
        authenticationStarted.resolve();
        await releaseAuthentication.promise;
        return { actor: { id: "ada" } };
      },
    };
    const socketApp = defineApp<{
      Actor: Actor;
      Resources: {};
      Authentication: Auth;
    }>({
      version: 1,
      resources: {},
      authentication: auth,
    });
    const connectFrame = JSON.stringify({
      type: "connect",
      version: protocolVersion,
      token: "valid",
    });
    const nextFrame = JSON.stringify({
      type: "subscribe",
      resource: "missing",
      key: "key",
      cursor: 0,
    });
    handle = serve(socketApp, {
      port: 0,
      substrate: createMemorySubstrate(),
      dependencyGroups: socketApp.def.dependencyGroups.server,
      limits: {
        messageBytes: 1_024,
        inboundBytes: Buffer.byteLength(connectFrame) + Buffer.byteLength(nextFrame) - 1,
      },
    });
    const url = new URL("/ws", handle.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    const closed = new Promise<CloseEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        releaseAuthentication.resolve();
        reject(new Error("socket did not enforce its inbound byte bound"));
      }, 2_000);
      socket.addEventListener("open", () => {
        socket.send(connectFrame);
        socket.send(nextFrame);
      });
      socket.addEventListener(
        "close",
        (event) => {
          clearTimeout(timeout);
          releaseAuthentication.resolve();
          resolve(event);
        },
        { once: true },
      );
      socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
    });

    await authenticationStarted.promise;
    const event = await closed;
    expect(event.code).toBe(1013);
    expect(event.reason).toBe("client is sending too quickly");
  });

  it("runs native handlers from the compiled endpoint table with resolved actors", async () => {
    const endpointApp = defineApp<{
      Actor: { id: string };
      Resources: {};
      Endpoints: { health: { Method: "GET" } };
    }>({
      version: 1,
      resources: {},
      identify: ({ token }) => (token === "valid" ? { id: "actor" } : null),
      endpoints: {
        health: {
          method: "GET",
          path: "/health",
          handle: (_request, { actor }) => Response.json({ actor: actor?.id ?? null }),
        },
      },
    });
    handle = serve(endpointApp, { port: 0, substrate: createMemorySubstrate() });

    const response = await fetch(new URL("/health", handle.url), {
      headers: { authorization: "Bearer valid" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actor: "actor" });
  });

  it("projects declared server dependencies into a Feature-owned endpoint", async () => {
    type AuthPort = { exchange(code: string): Promise<string> };
    type OAuthFeature = {
      Resources: {};
      Components: {};
      Dependencies: { server: { auth: AuthPort } };
      Endpoints: { callback: { Method: "POST" } };
      API: {};
    };
    type EndpointApp = {
      Actor: { id: string };
      Resources: {};
      Features: { oauth: OAuthFeature };
    };
    const auth: AuthPort = { exchange: async (code) => `token:${code}` };
    const oauth = {
      resources: {},
      features: {},
      dependencies: { server: { auth } },
      endpoints: {
        callback: {
          method: "POST",
          path: "/oauth/callback",
          async handle(request, { actor, signal, dependencies }) {
            if (!actor) return new Response("unauthorized", { status: 401 });
            const code = await request.text();
            return Response.json({
              actor: actor.id,
              signal: signal.aborted,
              token: await dependencies.auth.exchange(code),
            });
          },
        },
      },
      api: () => ({}),
      components: {},
    } satisfies FeatureDef<EndpointApp, OAuthFeature>;
    const endpointApp = defineApp<EndpointApp>({
      version: 1,
      resources: {},
      features: { oauth },
      identify: ({ token }) => (token === "valid" ? { id: "actor" } : null),
    });

    handle = serve(endpointApp, {
      port: 0,
      substrate: createMemorySubstrate(),
      dependencyGroups: endpointApp.def.dependencyGroups.server,
    });

    const response = await fetch(new URL("/oauth/callback", handle.url), {
      method: "POST",
      headers: { authorization: "Bearer valid" },
      body: "proof",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actor: "actor",
      signal: false,
      token: "token:proof",
    });
  });

  it("propagates request cancellation into endpoint handlers", async () => {
    let observedAbort: (() => void) | undefined;
    const aborted = new Promise<void>((resolve) => {
      observedAbort = resolve;
    });
    const endpointApp = defineApp<{
      Resources: {};
      Endpoints: { wait: { Method: "GET" } };
    }>({
      version: 1,
      resources: {},
      endpoints: {
        wait: {
          method: "GET",
          path: "/wait",
          handle(_request, { signal }) {
            return new Promise<Response>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  observedAbort?.();
                  resolve(new Response(null, { status: 499 }));
                },
                { once: true },
              );
            });
          },
        },
      },
    });
    handle = serve(endpointApp, { port: 0, substrate: createMemorySubstrate() });
    const controller = new AbortController();
    const request = fetch(new URL("/wait", handle.url), { signal: controller.signal });
    await Bun.sleep(10);
    controller.abort();
    await expect(request).rejects.toThrow();
    await Promise.race([
      aborted,
      Bun.sleep(1_000).then(() => {
        throw new Error("endpoint did not observe request cancellation");
      }),
    ]);
  });
});

describe("web app shell", () => {
  it("does not publish a live reload when its rebuild fails", async () => {
    const watchDir = await mkdtemp(join(tmpdir(), "poggers-live-reload-"));
    temporaryDirs.push(watchDir);
    const watchedFile = join(watchDir, "app.ts");
    await writeFile(watchedFile, "export const version = 1;\n");

    let notifyAttempt: (() => void) | undefined;
    const attempted = new Promise<void>((resolveAttempt) => {
      notifyAttempt = resolveAttempt;
    });

    handle = serve(app, {
      port: 0,
      substrate: createMemorySubstrate(),
      web: {
        entrypoint: import.meta.url,
        bundle: "console.log('client');",
        styleBundle: "body { color: green; }",
        liveReload: {
          watchDir,
          onChange() {
            notifyAttempt?.();
            throw new Error("expected rebuild failure");
          },
        },
      },
    });

    await writeFile(watchedFile, "export const version = 2;\n");
    await Promise.race([
      attempted,
      Bun.sleep(2_000).then(() => {
        throw new Error("live reload did not observe the file change");
      }),
    ]);
    await Bun.sleep(20);

    const status = (await fetch(new URL("/__poggers/live-poll?version=0", handle.url)).then(
      (response) => response.json(),
    )) as { changedPath: string; reload: boolean; version: number };
    expect(status).toEqual({
      changedPath: "",
      reload: false,
      version: 0,
    });
  });

  it("publishes only browser generations that compile successfully", async () => {
    const watchDir = await mkdtemp(join(tmpdir(), "poggers-live-reload-"));
    temporaryDirs.push(watchDir);
    const watchedFile = join(watchDir, "app.ts");
    await writeFile(watchedFile, "globalThis.__reloadFixture = 1;\n");

    let markAttempted: (() => void) | undefined;
    const attempted = new Promise<void>((resolveAttempted) => {
      markAttempted = resolveAttempted;
    });

    handle = serve(app, {
      port: 0,
      substrate: createMemorySubstrate(),
      web: {
        entrypoint: watchedFile,
        liveReload: {
          watchDir,
          onChange() {
            markAttempted?.();
          },
        },
      },
    });

    expect((await fetch(new URL("/client.js", handle.url))).status).toBe(200);
    await writeFile(watchedFile, "globalThis.__reloadFixture = ;\n");
    await Promise.race([
      attempted,
      Bun.sleep(2_000).then(() => {
        throw new Error("live reload did not observe the invalid browser generation");
      }),
    ]);
    await Bun.sleep(200);

    const failed = (await fetch(new URL("/__poggers/live-poll?version=0", handle.url)).then(
      (response) => response.json(),
    )) as { changedPath: string; reload: boolean; version: number };
    expect(failed).toEqual({ changedPath: "", reload: false, version: 0 });

    await writeFile(watchedFile, "globalThis.__reloadFixture = 2;\n");
    const deadline = Date.now() + 2_000;
    let complete = failed;
    while (!complete.reload && Date.now() < deadline) {
      await Bun.sleep(20);
      complete = (await fetch(new URL("/__poggers/live-poll?version=0", handle.url)).then(
        (response) => response.json(),
      )) as typeof complete;
    }

    expect(complete).toEqual({ changedPath: "app.ts", reload: true, version: 1 });
    expect(
      await fetch(new URL("/client.js", handle.url)).then((response) => response.text()),
    ).toContain("__reloadFixture = 2");
  });

  it("serializes rebuilds when another save arrives during hot refresh", async () => {
    const watchDir = await mkdtemp(join(tmpdir(), "poggers-live-reload-"));
    temporaryDirs.push(watchDir);
    const watchedFile = join(watchDir, "app.ts");
    await writeFile(watchedFile, "export const version = 1;\n");

    let active = 0;
    let calls = 0;
    let maxActive = 0;
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    let markSecondStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolveStarted) => {
      markFirstStarted = resolveStarted;
    });
    const secondStarted = new Promise<void>((resolveStarted) => {
      markSecondStarted = resolveStarted;
    });
    const firstBlocked = new Promise<void>((resolveBlocked) => {
      releaseFirst = resolveBlocked;
    });
    const secondBlocked = new Promise<void>((resolveBlocked) => {
      releaseSecond = resolveBlocked;
    });

    handle = serve(app, {
      port: 0,
      substrate: createMemorySubstrate(),
      web: {
        entrypoint: import.meta.url,
        bundle: "console.log('client');",
        styleBundle: "body { color: green; }",
        liveReload: {
          watchDir,
          async onChange() {
            calls += 1;
            active += 1;
            maxActive = Math.max(maxActive, active);
            if (calls === 1) {
              markFirstStarted?.();
              await firstBlocked;
            }
            if (calls === 2) {
              markSecondStarted?.();
              await secondBlocked;
            }
            await Bun.sleep(10);
            active -= 1;
          },
        },
      },
    });

    await writeFile(watchedFile, "export const version = 2;\n");
    await firstStarted;
    await writeFile(watchedFile, "export const version = 3;\n");
    await Bun.sleep(150);
    releaseFirst?.();

    await Promise.race([
      secondStarted,
      Bun.sleep(2_000).then(() => {
        throw new Error("live reload did not start the queued rebuild");
      }),
    ]);
    const pending = (await fetch(new URL("/__poggers/live-poll?version=0", handle.url)).then(
      (response) => response.json(),
    )) as { changedPath: string; reload: boolean; version: number };
    expect(pending).toEqual({ changedPath: "", reload: false, version: 0 });
    releaseSecond?.();

    const deadline = Date.now() + 2_000;
    while ((calls < 2 || active > 0) && Date.now() < deadline) await Bun.sleep(20);

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(maxActive).toBe(1);
    const complete = (await fetch(new URL("/__poggers/live-poll?version=0", handle.url)).then(
      (response) => response.json(),
    )) as { changedPath: string; reload: boolean; version: number };
    expect(complete).toEqual({ changedPath: "app.ts", reload: true, version: 1 });
  });

  it("serves PWA metadata, bundled CSS, generated icon, and SPA fallback", async () => {
    const webApp = defineApp<{
      Resources: {
        note: {
          Key: { noteId: string };
          State: { title: string };
          Events: {};
          Views: { title: string };
          Commands: {};
        };
      };
    }>({
      version: 7,
      app: { name: "PWA Test" },
      pwa: {
        name: "PWA Test",
        shortName: "PWA",
        themeColor: "oklch(21.01% 0.0318 264.66)",
        backgroundColor: "oklch(100% 0 89.88)",
        display: "standalone",
      },
      resources: {
        note: {
          state: { title: "hello" },
          events: {},
          views: {
            title({ state }) {
              return state.title;
            },
          },
          commands: {},
        },
      },
    });

    handle = serve(webApp, {
      port: 0,
      substrate: createMemorySubstrate(),
      web: {
        entrypoint: import.meta.url,
        bundle: "console.log('client');",
        styleBundle: "body { color: oklch(21.01% 0.0318 264.66); }",
      },
    });

    const index = await fetch(new URL("/", handle.url)).then((res) => res.text());
    expect(index).toContain("<title>PWA Test</title>");
    expect(index).toContain('href="/manifest.webmanifest"');
    expect(index).toContain('href="/client.css"');
    expect(index).toContain('navigator.serviceWorker.register("/service-worker.js")');

    const fallback = await fetch(new URL("/settings", handle.url), {
      headers: { Accept: "text/html" },
    }).then((res) => res.text());
    expect(fallback).toContain("<title>PWA Test</title>");

    const manifestResponse = await fetch(new URL("/manifest.webmanifest", handle.url));
    expect(manifestResponse.headers.get("Content-Type")).toContain("application/manifest+json");
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe("PWA Test");
    expect(manifest.icons[0].src).toBe("/_poggers/icon.svg");

    const serviceWorker = await fetch(new URL("/service-worker.js", handle.url)).then((res) =>
      res.text(),
    );
    expect(serviceWorker).toContain("poggers-7");
    expect(serviceWorker).toContain("/client.css");

    const cssResponse = await fetch(new URL("/client.css", handle.url));
    expect(cssResponse.headers.get("Content-Type")).toContain("text/css");
    expect(await cssResponse.text()).toContain("oklch(21.01% 0.0318 264.66)");

    const compressed = await fetch(new URL("/client.js", handle.url), {
      headers: { "Accept-Encoding": "br" },
    });
    expect(compressed.headers.get("Content-Encoding")).toBe("br");
    expect(await compressed.text()).toContain("console.log('client')");
    const etag = compressed.headers.get("ETag");
    expect(etag).toBeTruthy();
    const cached = await fetch(new URL("/client.js", handle.url), {
      headers: { "If-None-Match": etag! },
    });
    expect(cached.status).toBe(304);

    const iconResponse = await fetch(new URL("/_poggers/icon.svg", handle.url));
    expect(iconResponse.headers.get("Content-Type")).toContain("image/svg+xml");
  });
});
