import { afterEach, describe, it, expect } from "bun:test";
import { computeSync, serve, type ServerHandle } from "../src/server";
import { defineApp } from "../src/app";
import { scopeId } from "../src/protocol";
import { createTestApp } from "./helpers/test-app";
import { createMemoryStore } from "./helpers/memory-storage";
import type { Store } from "../src/storage";
import type { JsonValue } from "../src/protocol";

const app = createTestApp("test-token");
const resource = "counter";
const key: JsonValue = { counterId: "test" };
const bid = scopeId(resource, key);
let handle: ServerHandle | null = null;

afterEach(() => {
  handle?.stop();
  handle = null;
});

describe("computeSync", () => {
  function makeEvent(seq: number, name: string, payload?: any) {
    return {
      id: `ev-${seq}`,
      seq,
      at: 1000 + seq,
      actor: { id: "u", name: "U" },
      name,
      payload: payload ?? {},
    };
  }

  function setup(storage?: Store) {
    const eventBuffers = new Map<string, unknown[]>();
    const states = new Map<string, any>();
    const instanceSeqs = new Map<string, number>();
    const s = storage ?? createMemoryStore();
    return { eventBuffers, states, instanceSeqs, storage: s };
  }

  it("returns cursor 0 when no state or snapshot exists", () => {
    const ctx = setup();
    const result = computeSync(
      resource,
      key,
      0,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.cursor).toBe(0);
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.data).toBeDefined();
    expect(result.events).toBeUndefined();
  });

  it("returns snapshot from storage when cursor is 0", () => {
    const ctx = setup();
    ctx.storage.saveSnapshot(bid, { version: 1, seq: 0, data: { count: 0 } });
    const result = computeSync(
      resource,
      key,
      0,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.seq).toBe(0);
  });

  it("returns snapshot from in-memory state when cursor is 0", () => {
    const ctx = setup();
    const state = app.createState("counter");
    ctx.states.set(bid, state);
    ctx.instanceSeqs.set(bid, 5);
    const result = computeSync(
      resource,
      key,
      0,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
    expect((result.snapshot!.data as any).count).toBe(0);
    expect(result.cursor).toBe(5);
  });

  it("returns snapshot when cursor is before buffer start (stale cursor)", () => {
    const ctx = setup();
    const id = bid;
    ctx.instanceSeqs.set(id, 10);
    ctx.eventBuffers.set(id, [
      makeEvent(5, "incremented", { amount: 1 }),
      makeEvent(6, "incremented", { amount: 2 }),
    ]);
    const state = app.createState("counter");
    ctx.states.set(id, state);
    const result = computeSync(
      resource,
      key,
      2,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
  });

  it("returns delta events when cursor is within buffer", () => {
    const ctx = setup();
    const id = bid;
    ctx.instanceSeqs.set(id, 10);
    ctx.eventBuffers.set(id, [
      makeEvent(5, "incremented", { amount: 1 }),
      makeEvent(6, "incremented", { amount: 2 }),
      makeEvent(7, "incremented", { amount: 3 }),
    ]);
    const result = computeSync(
      resource,
      key,
      5,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeUndefined();
    expect(result.events).toBeDefined();
    expect(result.events!.length).toBe(2);
    expect((result.events![0] as any).seq).toBe(6);
    expect((result.events![1] as any).seq).toBe(7);
    expect(result.cursor).toBe(7);
  });

  it("returns no events when cursor is current", () => {
    const ctx = setup();
    const id = bid;
    ctx.instanceSeqs.set(id, 10);
    ctx.eventBuffers.set(id, [makeEvent(10, "incremented", { amount: 1 })]);
    const result = computeSync(
      resource,
      key,
      10,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.events).toBeUndefined();
    expect(result.cursor).toBe(10);
  });

  it("returns snapshot when buffer is empty and cursor is behind", () => {
    const ctx = setup();
    const id = bid;
    const state = app.createState("counter");
    state.count = 42;
    ctx.states.set(id, state);
    ctx.instanceSeqs.set(id, 10);
    const result = computeSync(
      resource,
      key,
      5,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
    expect((result.snapshot!.data as any).count).toBe(42);
    expect(result.cursor).toBe(10);
  });

  it("returns cursor current when buffer empty and cursor equals current seq", () => {
    const ctx = setup();
    const id = bid;
    ctx.instanceSeqs.set(id, 5);
    const result = computeSync(
      resource,
      key,
      5,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.cursor).toBe(5);
  });

  it("handles cursor larger than current seq", () => {
    const ctx = setup();
    const id = bid;
    ctx.instanceSeqs.set(id, 5);
    const result = computeSync(
      resource,
      key,
      100,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
    expect(result.cursor).toBe(0);
  });

  it("different resources do not leak state between scopes", () => {
    const ctx = setup();
    ctx.storage.saveSnapshot(scopeId("counter", key), { version: 1, seq: 3, data: { count: 99 } });
    ctx.states.set(
      scopeId("counter", key),
      (() => {
        const s = app.createState("counter");
        s.count = 99;
        return s;
      })(),
    );
    ctx.instanceSeqs.set(scopeId("counter", key), 3);

    const result = computeSync(
      "doc",
      { docId: "test" },
      0,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.data as any).toBeDefined();
    expect(result.cursor).toBe(0);
  });

  it("rejects version-mismatched stored snapshot", () => {
    const ctx = setup();
    const id = bid;
    ctx.storage.saveSnapshot(id, { version: 999, seq: 10, data: { count: 100 } });
    const result = computeSync(
      resource,
      key,
      0,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.version).toBe(1);
    expect(result.snapshot!.seq).toBe(10);
    expect(result.cursor).toBe(10);
  });

  it("accepts matching version stored snapshot", () => {
    const ctx = setup();
    const id = bid;
    ctx.storage.saveSnapshot(id, { version: 1, seq: 10, data: { count: 100 } });
    const result = computeSync(
      resource,
      key,
      0,
      ctx.storage,
      ctx.eventBuffers,
      ctx.states,
      ctx.instanceSeqs,
      app,
      "test-gen",
    );
    expect(result.snapshot).toBeDefined();
    expect(result.snapshot!.version).toBe(1);
    expect(result.snapshot!.seq).toBe(10);
    expect(result.cursor).toBe(10);
  });
});

describe("web app shell", () => {
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
        themeColor: "#111827",
        backgroundColor: "#ffffff",
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
      storage: createMemoryStore(),
      web: {
        entrypoint: import.meta.url,
        bundle: "console.log('client');",
        styleBundle: "body { color: rgb(1 2 3); }",
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
    expect(await cssResponse.text()).toContain("rgb(1 2 3)");

    const iconResponse = await fetch(new URL("/_poggers/icon.svg", handle.url));
    expect(iconResponse.headers.get("Content-Type")).toContain("image/svg+xml");
  });
});

describe("buffer trimming", () => {
  const DELTA_THRESHOLD = 200;

  function makeEvent(seq: number) {
    return {
      id: `ev-${seq}`,
      seq,
      at: 1000 + seq,
      actor: { id: "u", name: "U" },
      name: "incremented",
      payload: { amount: 1 },
    };
  }

  it("preserves exactly the last DELTA_THRESHOLD events when buffer exceeds threshold", () => {
    const buf = [];
    for (let i = 0; i < DELTA_THRESHOLD + 1; i++) {
      buf.push(makeEvent(i + 1));
    }
    buf.splice(0, buf.length - DELTA_THRESHOLD);

    expect(buf.length).toBe(DELTA_THRESHOLD);
    expect(buf[0]!.seq).toBe(2);
    expect(buf[buf.length - 1]!.seq).toBe(DELTA_THRESHOLD + 1);
  });

  it("computeSync returns snapshot for cursor below trimmed buffer start", () => {
    const resource = "counter";
    const key = { counterId: "trim-test" };

    const eventBuffers = new Map<string, unknown[]>();
    const states = new Map<string, any>();
    const instanceSeqs = new Map<string, number>();

    const bid = 'counter@{"counterId":"trim-test"}';

    const buf = [];
    for (let i = 0; i < DELTA_THRESHOLD + 50; i++) {
      buf.push(makeEvent(i + 1));
    }

    const trimmed = buf.slice(-DELTA_THRESHOLD);
    eventBuffers.set(bid, trimmed);
    instanceSeqs.set(bid, DELTA_THRESHOLD + 50);

    const state = app.createState("counter");
    state.count = 999;
    states.set(bid, state);

    const result = computeSync(
      resource,
      key,
      trimmed[0]!.seq - 1,
      createMemoryStore(),
      eventBuffers,
      states,
      instanceSeqs,
      app,
      "test-gen",
    );

    expect(result.snapshot).toBeDefined();
    expect(result.cursor).toBe(DELTA_THRESHOLD + 50);
  });

  it("computeSync returns delta events for cursor within trimmed buffer", () => {
    const resource = "counter";
    const key = { counterId: "trim-test2" };

    const eventBuffers = new Map<string, unknown[]>();
    const states = new Map<string, any>();
    const instanceSeqs = new Map<string, number>();

    const bid = 'counter@{"counterId":"trim-test2"}';

    const buf = [];
    for (let i = 0; i < DELTA_THRESHOLD + 10; i++) {
      buf.push(makeEvent(i + 1));
    }

    const trimmed = buf.slice(-DELTA_THRESHOLD);
    eventBuffers.set(bid, trimmed);
    instanceSeqs.set(bid, DELTA_THRESHOLD + 10);

    const result = computeSync(
      resource,
      key,
      trimmed[0]!.seq + 5,
      createMemoryStore(),
      eventBuffers,
      states,
      instanceSeqs,
      app,
      "test-gen",
    );

    expect(result.snapshot).toBeUndefined();
    expect(result.events).toBeDefined();
    expect(result.events!.length).toBeGreaterThan(0);
  });
});
