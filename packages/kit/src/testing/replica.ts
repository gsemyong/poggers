import type { JsonValue } from "#kernel/app";
import { createMemoryReplicaStore, type ReplicaLoad, type ReplicaStore } from "#substrate/replica";

type SeedableReplica = ReplicaStore & {
  saveSnapshot(snapshot: unknown): Promise<void>;
};

export function createMemoryClientReplica(): SeedableReplica {
  let store = createMemoryReplicaStore();
  return {
    load: () => store.load(),
    initialize: (clientId) => store.initialize(clientId),
    enqueue: (intent) => store.enqueue(intent),
    confirm: (input) => store.confirm(input),
    reject: (intentId) => store.reject(intentId),
    forget: (address) => store.forget(address),
    close: () => store.close(),
    async saveSnapshot(snapshot) {
      store = createMemoryReplicaStore(seedReplica(snapshot));
    },
  };
}

export function createFailingClientReplica(failures?: {
  loadSnapshot?: Error | "throw";
  saveSnapshot?: Error | "throw";
}): ReplicaStore {
  const store = createMemoryReplicaStore();
  const failLoad = () => {
    if (!failures?.loadSnapshot) return;
    throw failures.loadSnapshot === "throw"
      ? new Error("Replica load failed")
      : failures.loadSnapshot;
  };
  const failWrite = () => {
    if (!failures?.saveSnapshot) return;
    throw failures.saveSnapshot === "throw"
      ? new Error("Replica write failed")
      : failures.saveSnapshot;
  };
  return {
    async load() {
      failLoad();
      return store.load();
    },
    initialize: (clientId) => store.initialize(clientId),
    async enqueue(intent) {
      failWrite();
      return store.enqueue(intent);
    },
    async confirm(input) {
      failWrite();
      await store.confirm(input);
    },
    async reject(intentId) {
      failWrite();
      await store.reject(intentId);
    },
    async forget(address) {
      failWrite();
      await store.forget(address);
    },
    close: () => store.close(),
  };
}

function seedReplica(value: unknown): Partial<ReplicaLoad> {
  const snapshot = value as Readonly<{
    version?: number;
    generation?: string;
    scopeGenerations?: Record<string, string>;
    scopes?: ReadonlyArray<{
      resource: string;
      key: JsonValue;
      snapshot: { version: number; seq: number; data: JsonValue };
      owner?: string;
    }>;
    pending?: ReadonlyArray<{
      commandId: string;
      message: { resource: string; key: JsonValue; at?: number } & Record<string, JsonValue>;
    }>;
  }>;
  const pending = (snapshot.pending ?? []).map(({ commandId, message }, index) => ({
    id: commandId,
    clientId: "seed",
    sequence: index + 1,
    address: { resource: message.resource, key: message.key },
    inputHash: `seed-${index + 1}`,
    value: (({ commandId: _commandId, ...body }) => body)(message),
    createdAt: message.at ?? 0,
  }));
  return {
    clientId: pending.length > 0 ? "seed" : null,
    nextSequence: pending.length,
    scopes: (snapshot.scopes ?? []).map((entry) => {
      const id = `${entry.resource}:${JSON.stringify(entry.key)}`;
      return {
        address: { resource: entry.resource, key: entry.key },
        schema: `version:${snapshot.version ?? entry.snapshot.version}`,
        cursor: entry.snapshot.seq,
        stateHash: `seed-${entry.resource}-${entry.snapshot.seq}`,
        state: entry.snapshot,
        generation: snapshot.scopeGenerations?.[id] ?? snapshot.generation,
        owner: entry.owner,
      };
    }),
    pending,
  };
}
