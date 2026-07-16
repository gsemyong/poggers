import { describe, expect, test } from "bun:test";

import { IDBFactory } from "fake-indexeddb";

import { DurabilityError } from "#substrate/durability";
import { createIndexedDbReplicaStore } from "#substrate/replica.indexeddb";

const address = { resource: "counter", key: { id: "main" } } as const;
describe("IndexedDB Replica store", () => {
  test("persists identity, sequence, scope, and pending intent across reopen", async () => {
    const factory = createFactory();
    const first = createIndexedDbReplicaStore({ name: "reopen", indexedDB: factory });
    await first.initialize("device-a");
    const intent = await first.enqueue({
      address,
      inputHash: "one",
      value: { amount: 1 },
      createdAt: 1,
    });
    await first.close();

    const second = createIndexedDbReplicaStore({ name: "reopen", indexedDB: factory });
    expect(await second.load()).toEqual({
      clientId: "device-a",
      nextSequence: 1,
      scopes: [],
      pending: [intent],
    });
    await second.confirm({
      intentId: intent.id,
      scope: {
        address,
        schema: "counter-v1",
        cursor: 1,
        stateHash: "counter-1",
        state: { value: 1 },
      },
    });
    await second.close();

    const third = createIndexedDbReplicaStore({ name: "reopen", indexedDB: factory });
    const loaded = await third.load();
    expect(loaded.pending).toEqual([]);
    expect(loaded.scopes[0]?.state).toEqual({ value: 1 });
    await third.close();
  });

  test("serializes concurrent sequence allocation without duplicate IDs", async () => {
    const factory = createFactory();
    const store = createIndexedDbReplicaStore({ name: "concurrent", indexedDB: factory });
    await store.initialize("device-a");
    const intents = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        store.enqueue({
          address,
          inputHash: `input-${index}`,
          value: { amount: index },
          createdAt: index,
        }),
      ),
    );
    expect(new Set(intents.map((intent) => intent.id)).size).toBe(100);
    expect((await store.load()).nextSequence).toBe(100);
    await store.close();
  });

  test("shares one identity and monotonic sequence across concurrent tabs", async () => {
    const factory = createFactory();
    const first = createIndexedDbReplicaStore({ name: "tabs", indexedDB: factory });
    const second = createIndexedDbReplicaStore({ name: "tabs", indexedDB: factory });
    const [firstId, secondId] = await Promise.all([
      first.initialize("device-a"),
      second.initialize("device-b"),
    ]);
    expect(firstId).toBe(secondId);

    const intents = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        (index % 2 === 0 ? first : second).enqueue({
          address,
          inputHash: `tab-input-${index}`,
          value: { amount: index },
          createdAt: index,
        }),
      ),
    );
    expect(new Set(intents.map((intent) => intent.id)).size).toBe(100);
    expect((await first.load()).nextSequence).toBe(100);
    expect((await second.load()).pending).toHaveLength(100);
    await Promise.all([first.close(), second.close()]);
  });

  test("stale confirmation resolves its intent without replacing newer state", async () => {
    const factory = createFactory();
    const store = createIndexedDbReplicaStore({ name: "stale", indexedDB: factory });
    await store.initialize("device-a");
    const intent = await store.enqueue({
      address,
      inputHash: "one",
      value: { amount: 1 },
      createdAt: 1,
    });
    await store.confirm({
      scope: {
        address,
        schema: "counter-v1",
        cursor: 2,
        stateHash: "newer",
        state: { value: 2 },
      },
    });
    await store.confirm({
      intentId: intent.id,
      scope: {
        address,
        schema: "counter-v1",
        cursor: 1,
        stateHash: "older",
        state: { value: 1 },
      },
    });
    const loaded = await store.load();
    expect(loaded.pending).toEqual([]);
    expect(loaded.scopes[0]?.stateHash).toBe("newer");
    await store.close();
  });

  test("normalizes lifecycle and version-change failures", async () => {
    const factory = createFactory();
    const store = createIndexedDbReplicaStore({ name: "version-change", indexedDB: factory });
    await store.load();

    await upgrade(factory, "version-change", 2);
    const invalidated = await store.load().catch((error: unknown) => error);
    expect(invalidated).toBeInstanceOf(DurabilityError);
    expect((invalidated as DurabilityError).failure).toBe("busy");
    expect((invalidated as DurabilityError).retryable).toBeTrue();

    await store.close();
    const closed = await store.load().catch((error: unknown) => error);
    expect(closed).toBeInstanceOf(DurabilityError);
    expect((closed as DurabilityError).failure).toBe("closed");
    expect((closed as DurabilityError).retryable).toBeFalse();
  });

  test("detects database deletion and lets a fresh Replica start from an explicit empty state", async () => {
    const factory = createFactory();
    const store = createIndexedDbReplicaStore({ name: "deleted", indexedDB: factory });
    await store.initialize("device-a");
    await store.enqueue({ address, inputHash: "one", value: { amount: 1 }, createdAt: 1 });

    await deleteDatabase(factory, "deleted");
    const invalidated = await store.load().catch((error: unknown) => error);
    expect(invalidated).toBeInstanceOf(DurabilityError);
    expect((invalidated as DurabilityError).failure).toBe("busy");

    const replacement = createIndexedDbReplicaStore({ name: "deleted", indexedDB: factory });
    expect(await replacement.load()).toEqual({
      clientId: null,
      nextSequence: 0,
      scopes: [],
      pending: [],
    });
    await Promise.all([store.close(), replacement.close()]);
  });

  test("normalizes private-mode denial and quota exhaustion", async () => {
    const denied = createIndexedDbReplicaStore({
      name: "denied",
      indexedDB: throwingFactory(new DOMException("private storage denied", "SecurityError")),
    });
    const unavailable = await denied.load().catch((error: unknown) => error);
    expect(unavailable).toBeInstanceOf(DurabilityError);
    expect((unavailable as DurabilityError).failure).toBe("unavailable");

    const full = createIndexedDbReplicaStore({
      name: "full",
      indexedDB: throwingFactory(new DOMException("quota exhausted", "QuotaExceededError")),
    });
    const capacity = await full.load().catch((error: unknown) => error);
    expect(capacity).toBeInstanceOf(DurabilityError);
    expect((capacity as DurabilityError).failure).toBe("capacity");
    expect((capacity as DurabilityError).retryable).toBeFalse();
  });
});

function createFactory(): IDBFactory {
  return new IDBFactory();
}

function throwingFactory(error: DOMException): IDBFactory {
  return {
    open() {
      throw error;
    },
  } as unknown as IDBFactory;
}

function upgrade(factory: IDBFactory, name: string, version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
  });
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
