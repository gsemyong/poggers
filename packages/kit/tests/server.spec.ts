import { afterEach, describe, it, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
const temporaryDirs: string[] = [];

afterEach(async () => {
  handle?.stop();
  handle = null;
  for (const dir of temporaryDirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
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
  it("does not publish a live reload when its rebuild fails", async () => {
    const watchDir = await mkdtemp(resolve(".poggers-live-reload-"));
    temporaryDirs.push(watchDir);
    const watchedFile = join(watchDir, "app.ts");
    await writeFile(watchedFile, "export const version = 1;\n");

    let notifyAttempt: (() => void) | undefined;
    const attempted = new Promise<void>((resolveAttempt) => {
      notifyAttempt = resolveAttempt;
    });

    handle = serve(app, {
      port: 0,
      storage: createMemoryStore(),
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
    const watchDir = await mkdtemp(resolve(".poggers-live-reload-"));
    temporaryDirs.push(watchDir);
    const watchedFile = join(watchDir, "app.ts");
    await writeFile(watchedFile, "globalThis.__reloadFixture = 1;\n");

    let markAttempted: (() => void) | undefined;
    const attempted = new Promise<void>((resolveAttempted) => {
      markAttempted = resolveAttempted;
    });

    handle = serve(app, {
      port: 0,
      storage: createMemoryStore(),
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
    const watchDir = await mkdtemp(resolve(".poggers-live-reload-"));
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
      storage: createMemoryStore(),
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
      storage: createMemoryStore(),
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
