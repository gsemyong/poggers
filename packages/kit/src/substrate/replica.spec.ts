import { describe, expect, test } from "bun:test";

import { IDBFactory } from "fake-indexeddb";

import { createMemoryReplicaStore, type ReplicaScope, type ReplicaStore } from "#substrate/replica";
import { createIndexedDbReplicaStore } from "#substrate/replica.indexeddb";

const address = { resource: "counter", key: { id: "main" } } as const;

function scope(cursor: number, value: number): ReplicaScope {
  return {
    address,
    schema: "counter-v1",
    cursor,
    stateHash: `counter-${cursor}`,
    state: { value },
  };
}

function describeReplicaStore(name: string, create: () => ReplicaStore): void {
  describe(name, () => {
    test("atomically establishes identity, allocates sequences, and persists pending intents", async () => {
      const store = create();
      expect(await store.initialize("device-a")).toBe("device-a");
      expect(await store.initialize("ignored-after-initialization")).toBe("device-a");

      const [first, second] = await Promise.all([
        store.enqueue({ address, inputHash: "one", value: { amount: 1 }, createdAt: 1 }),
        store.enqueue({ address, inputHash: "two", value: { amount: 2 }, createdAt: 2 }),
      ]);
      expect([first.sequence, second.sequence]).toEqual([1, 2]);
      expect((await store.load()).pending.map((intent) => intent.id)).toEqual([
        "device-a/1",
        "device-a/2",
      ]);
      await store.close();
    });

    test("confirms state and resolves its intent in one transaction", async () => {
      const store = create();
      await store.initialize("device-a");
      const intent = await store.enqueue({
        address,
        inputHash: "one",
        value: { amount: 1 },
        createdAt: 1,
      });
      await store.confirm({ scope: scope(1, 1), intentId: intent.id });

      const loaded = await store.load();
      expect(loaded.scopes).toEqual([scope(1, 1)]);
      expect(loaded.pending).toEqual([]);
      await store.close();
    });

    test("ignores stale confirmation without resurrecting old state", async () => {
      const store = create();
      await store.confirm({ scope: scope(2, 3) });
      await store.confirm({ scope: scope(1, 1) });
      expect((await store.load()).scopes).toEqual([scope(2, 3)]);
      await store.close();
    });

    test("rejects only the named intent and forgets one Resource atomically", async () => {
      const other = { resource: "counter", key: { id: "other" } } as const;
      const store = create();
      await store.initialize("device-a");
      const rejected = await store.enqueue({
        address,
        inputHash: "one",
        value: { amount: -1 },
        createdAt: 1,
      });
      const retained = await store.enqueue({
        address: other,
        inputHash: "two",
        value: { amount: 2 },
        createdAt: 2,
      });
      await store.confirm({ scope: scope(1, 1) });
      await store.reject(rejected.id);
      await store.forget(address);

      const loaded = await store.load();
      expect(loaded.scopes).toEqual([]);
      expect(loaded.pending.map((intent) => intent.id)).toEqual([retained.id]);
      await store.close();
    });

    test("returns detached values and rejects operations after close", async () => {
      const store = create();
      await store.confirm({ scope: scope(1, 1) });
      const loaded = await store.load();
      (loaded.scopes[0]!.state as { value: number }).value = 99;
      expect((await store.load()).scopes).toEqual([scope(1, 1)]);
      await store.close();
      await expect(store.load()).rejects.toThrow("closed");
    });
  });
}

describeReplicaStore("memory Replica store", createMemoryReplicaStore);
describeReplicaStore("IndexedDB Replica store conformance", () =>
  createIndexedDbReplicaStore({
    name: crypto.randomUUID(),
    indexedDB: new IDBFactory(),
  }),
);
