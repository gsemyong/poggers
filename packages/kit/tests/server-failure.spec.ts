import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { serve } from "../src/server";
import { connect } from "../src/client";
import { createTestApp } from "./helpers/test-app";
import { createMemoryClientStore, createFailingMemoryStore } from "./helpers/memory-storage";
import { createMemoryStore } from "./helpers/memory-storage";
import { poll } from "./helpers/wait";

const app = createTestApp("test-token");

describe("e2e: server storage failures", () => {
  let handle: ReturnType<typeof serve> | null = null;
  let _origError: typeof console.error;

  beforeEach(() => {
    _origError = console.error;
    console.error = () => {};
  });

  afterEach(() => {
    console.error = _origError;
    if (handle) {
      handle.stop();
      handle = null;
    }
  });

  it("server survives saveSnapshot failure and stays operational", async () => {
    const storage = createFailingMemoryStore({ saveSnapshot: "throw" });

    handle = serve(app, {
      port: 0,
      storage,
      snapshotIntervalMs: 50,
    });

    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "fail" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "fail" });
    counter.increment(1);
    await poll(() => counter.count === 1);

    expect(counter.count).toBe(1);
  });

  it("server survives appendEvents failure", async () => {
    const storage = createFailingMemoryStore({ appendEvents: "throw" });

    handle = serve(app, {
      port: 0,
      storage,
      snapshotIntervalMs: 60000,
    });

    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "fail" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "fail" });
    counter.increment(1);

    await new Promise((r) => setTimeout(r, 200));

    handle.stop();
    handle = null;

    const storage2 = createMemoryStore();
    handle = serve(app, {
      port: 0,
      storage: storage2,
      snapshotIntervalMs: 60000,
    });

    const client2 = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected2 = false;
    client2.counter({ counterId: "new" }).subscribe(() => {
      connected2 = true;
    });
    await poll(() => connected2);
    const c2 = client2.counter({ counterId: "new" });
    c2.increment(5);
    await poll(() => c2.count === 5);
    expect(c2.count).toBe(5);
  });

  it("sibling scope state is unaffected when command fails for other scope", async () => {
    let shouldFail = false;
    const base = createMemoryStore();
    const selectiveFailing = {
      loadSnapshot(key: string) {
        return base.loadSnapshot(key);
      },
      saveSnapshot(key: string, s: any) {
        return base.saveSnapshot(key, s);
      },
      getEvents(key: string) {
        return base.getEvents(key);
      },
      compactEvents(key: string, throughSeq: number) {
        return base.compactEvents(key, throughSeq);
      },
      saveCommandId(scopeId: string, commandId: string) {
        return base.saveCommandId(scopeId, commandId);
      },
      getCommandIds(scopeId: string) {
        return base.getCommandIds(scopeId);
      },
      clearCommandIds(scopeId: string) {
        return base.clearCommandIds(scopeId);
      },
      appendEvents(key: string, events: unknown[], _commandId?: string) {
        if (shouldFail && key.includes("scope-A")) {
          throw new Error("append failed");
        }
        return base.appendEvents(key, events);
      },
      setFailForNext(fail: boolean) {
        shouldFail = fail;
      },
    };

    handle = serve(app, {
      port: 0,
      storage: selectiveFailing as any,
      snapshotIntervalMs: 60000,
    });

    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "scope-A" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const ca = client.counter({ counterId: "scope-A" });
    const cb = client.counter({ counterId: "scope-B" });
    cb.increment(50);
    await poll(() => cb.count === 50);

    (selectiveFailing as any).setFailForNext(true);
    (ca as any).increment(100);
    await new Promise((r) => setTimeout(r, 100));

    (selectiveFailing as any).setFailForNext(false);
    (ca as any).increment(1);
    await poll(() => ca.count === 1);

    expect(cb.count).toBe(50);
    expect(ca.count).toBe(1);
  });

  it("multi-event command commits all-or-none on storage failure", async () => {
    const storage = createFailingMemoryStore({ appendEvents: "throw" });

    handle = serve(app, {
      port: 0,
      storage,
      snapshotIntervalMs: 60000,
    });

    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "atomic" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const counter = client.counter({ counterId: "atomic" });
    (counter as any).emitTwoEvents();

    await new Promise((r) => setTimeout(r, 200));

    expect(counter.count).toBe(0);

    handle.stop();
    handle = null;

    const storage2 = createMemoryStore();
    handle = serve(app, {
      port: 0,
      storage: storage2,
      snapshotIntervalMs: 60000,
    });

    const client2 = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected2 = false;
    client2.counter({ counterId: "atomic" }).subscribe(() => {
      connected2 = true;
    });
    await poll(() => connected2);
    const c2 = client2.counter({ counterId: "atomic" });
    expect(c2.count).toBe(0);
  });

  it("failing scope snapshot does not block compaction of other scopes", async () => {
    const base = createMemoryStore();
    const scopeAFailing = "counter@" + JSON.stringify({ counterId: "fail-A" });

    const selectiveFailing = {
      loadSnapshot(key: string) {
        return base.loadSnapshot(key);
      },
      saveSnapshot(key: string, s: any) {
        if (key === scopeAFailing) {
          throw new Error("saveSnapshot failed for scope A");
        }
        return base.saveSnapshot(key, s);
      },
      getEvents(key: string) {
        return base.getEvents(key);
      },
      compactEvents(key: string, throughSeq: number) {
        return base.compactEvents(key, throughSeq);
      },
      saveCommandId(scopeId: string, commandId: string) {
        return base.saveCommandId(scopeId, commandId);
      },
      getCommandIds(scopeId: string) {
        return base.getCommandIds(scopeId);
      },
      clearCommandIds(scopeId: string) {
        return base.clearCommandIds(scopeId);
      },
      appendEvents(key: string, events: unknown[], commandId?: string) {
        return base.appendEvents(key, events, commandId);
      },
    };

    handle = serve(app, {
      port: 0,
      storage: selectiveFailing as any,
      snapshotIntervalMs: 100,
    });

    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "fail-A" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const ca = client.counter({ counterId: "fail-A" });
    const cb = client.counter({ counterId: "ok-B" });
    cb.increment(10);
    await poll(() => cb.count === 10);
    ca.increment(1);
    await poll(() => ca.count === 1);

    await new Promise((r) => setTimeout(r, 500));

    handle.stop();
    handle = null;

    handle = serve(app, {
      port: 0,
      storage: selectiveFailing as any,
      snapshotIntervalMs: 60000,
    });

    const client2 = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected2 = false;
    client2.counter({ counterId: "ok-B" }).subscribe(() => {
      connected2 = true;
    });
    await poll(() => connected2);
    const c2b = client2.counter({ counterId: "ok-B" });
    await poll(() => c2b.count === 10);
    expect(c2b.count).toBe(10);

    const c2a = client2.counter({ counterId: "fail-A" });
    expect(c2a.count).toBe(0);
  });

  it("retries compaction without re-saving snapshot when compactEvents fails transiently", async () => {
    const base = createMemoryStore();
    let compactFailures = 0;
    let saveCalls = 0;
    const scopeCompacting = "counter@" + JSON.stringify({ counterId: "compact" });

    const selectiveFailing = {
      loadSnapshot(key: string) {
        return base.loadSnapshot(key);
      },
      saveSnapshot(key: string, s: any) {
        if (key === scopeCompacting) saveCalls++;
        return base.saveSnapshot(key, s);
      },
      getEvents(key: string) {
        return base.getEvents(key);
      },
      compactEvents(key: string, throughSeq: number) {
        if (key === scopeCompacting && compactFailures < 2) {
          compactFailures++;
          throw new Error("compactEvents failed");
        }
        return base.compactEvents(key, throughSeq);
      },
      saveCommandId(scopeId: string, commandId: string) {
        return base.saveCommandId(scopeId, commandId);
      },
      getCommandIds(scopeId: string) {
        return base.getCommandIds(scopeId);
      },
      clearCommandIds(scopeId: string) {
        return base.clearCommandIds(scopeId);
      },
      appendEvents(key: string, events: unknown[], commandId?: string) {
        return base.appendEvents(key, events, commandId);
      },
    };

    handle = serve(app, {
      port: 0,
      storage: selectiveFailing as any,
      snapshotIntervalMs: 100,
    });

    const client = await connect(app, {
      wsUrl: `${handle.url.origin.replace("http", "ws")}/ws`,
      token: "test-token",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });

    let connected = false;
    client.counter({ counterId: "compact" }).subscribe(() => {
      connected = true;
    });
    await poll(() => connected);

    const cc = client.counter({ counterId: "compact" });
    cc.increment(5);
    await poll(() => cc.count === 5);

    await new Promise((r) => setTimeout(r, 500));

    expect(saveCalls).toBeGreaterThanOrEqual(1);
    expect(compactFailures).toBeGreaterThanOrEqual(2);
    const eventsAfterRetry = base.getEvents(scopeCompacting);
    expect(eventsAfterRetry.length).toBe(0);
  });
});
