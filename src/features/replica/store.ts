import { cloneData } from "@/core/data";
import type { Dependency, DependencyImplementation } from "@/core/dependency";
import {
  evaluateIndexedProjectionRows,
  type ProjectionResult,
  type ProjectionRow,
} from "@/features/projection";
import { createTursoReplicaQueryEngine } from "@/features/replica/providers/browser/turso";
import type { WebDependencyProvider } from "@/platforms/web";

export type ReplicaStoreCommand = Readonly<{
  id: string;
  command: string;
  input: object;
}>;

export type ReplicaStoreRejection = Readonly<{
  pending: ReplicaStoreCommand;
  message: string;
}>;

export type ReplicaStoreDelta<Value> = Readonly<{
  upsert: readonly Value[];
  remove: readonly string[];
}>;

export type ReplicaStoreState = Readonly<{
  version: number;
  authorization: number;
  schema?: string;
  principal: object;
  cursor?: string;
  sequence: number;
  observations: Readonly<Record<string, string>>;
  committed?: Readonly<Record<string, readonly Readonly<{ id: string }>[]>>;
  pending: readonly ReplicaStoreCommand[];
  rejected: readonly ReplicaStoreRejection[];
}>;

export type ReplicaStoreChange =
  | Readonly<{
      row: string;
      upsert: Readonly<{ id: string }>;
    }>
  | Readonly<{
      row: string;
      remove: Readonly<{ id: string }>;
    }>;

type ReplicaStoreStoredMetadata = Omit<ReplicaStoreState, "committed" | "pending" | "rejected">;

type ReplicaStoreMetadata = Omit<
  ReplicaStoreState,
  "authorization" | "committed" | "pending" | "rejected"
>;

/**
 * Durable local Replica state. The contract preserves semantic transactions
 * while each provider owns its physical rows, indexes, and worker strategy.
 */
export type ReplicaStore = Dependency<{
  Operations: {
    load(input: {
      replica: string;
      principal: string;
      authorization: number;
      rows: readonly string[];
    }): Promise<ReplicaStoreState | undefined>;
    commit(input: {
      replica: string;
      principal: string;
      authorization: number;
      metadata: ReplicaStoreMetadata;
      replace?: Readonly<Record<string, readonly Readonly<{ id: string }>[]>>;
      changes: readonly ReplicaStoreChange[];
      pending: ReplicaStoreDelta<ReplicaStoreCommand>;
      rejected: ReplicaStoreDelta<ReplicaStoreRejection>;
    }): Promise<void>;
    query(input: {
      replica: string;
      principal: string;
      authorization: number;
      row: string;
      rows: readonly ProjectionRow[];
      query: object;
    }): Promise<ProjectionResult<ProjectionRow>>;
    remove(input: { replica: string; principal: string; authorization: number }): Promise<void>;
  };
}>;

/** Cross-context ownership and notification for one durable browser Replica. */
export type ReplicaCoordination = Dependency<{
  Operations: {
    exclusive(input: { scope: string; task(): Promise<void> }): Promise<void>;
    publish(input: { scope: string }): void;
    subscribe(input: { scope: string; receive(): void }): Disposable;
  };
}>;

type ReplicaStoreCommit = Parameters<ReplicaStore["commit"]>[0];

type ReplicaCoordinationState = {
  readonly locks: Map<string, Promise<void>>;
  readonly listeners: Map<string, Set<Readonly<{ owner: number; receive(): void }>>>;
  owner: number;
};

const memoryReplicaCoordination = new WeakMap<object, ReplicaCoordinationState>();

/**
 * Deterministic same-process realization used by contract tests. Passing the
 * same owner object models tabs that share one browser storage partition.
 */
export function createMemoryReplicaCoordination(
  owner: object,
): DependencyImplementation<ReplicaCoordination> {
  let state = memoryReplicaCoordination.get(owner);
  if (!state) {
    state = { locks: new Map(), listeners: new Map(), owner: 0 };
    memoryReplicaCoordination.set(owner, state);
  }
  const identity = ++state.owner;
  return createReplicaCoordination(state, identity);
}

/** Deterministic reference provider used by Replica contract tests. */
export function createMemoryReplicaStore(
  storage = new Map<string, unknown>(),
  beforeWrite?: () => void | PromiseLike<void>,
): DependencyImplementation<ReplicaStore> {
  return Object.freeze({
    async load({
      input,
    }: Readonly<{
      input: Parameters<ReplicaStore["load"]>[0];
    }>) {
      const stored = storage.get(
        replicaStoreKey(input.replica, input.principal, input.authorization),
      );
      return stored === undefined ? undefined : cloneData(stored as ReplicaStoreState);
    },
    async commit({ input }: Readonly<{ input: ReplicaStoreCommit }>) {
      await beforeWrite?.();
      const key = replicaStoreKey(input.replica, input.principal, input.authorization);
      const previous = storage.get(key) as ReplicaStoreState | undefined;
      const authorityAdvanced =
        previous === undefined || input.metadata.sequence >= previous.sequence;
      let committed = cloneData(previous?.committed ?? {});
      let metadata = previous;
      if (authorityAdvanced) {
        committed = input.replace === undefined ? committed : cloneData(input.replace);
        if (input.changes.length) {
          committed = applyReplicaStoreChanges(committed, input.changes);
        }
        metadata = {
          authorization: input.authorization,
          ...input.metadata,
          committed,
          pending: [],
          rejected: [],
        };
      }
      storage.set(
        key,
        cloneData({
          ...(metadata ?? {
            authorization: input.authorization,
            ...input.metadata,
          }),
          committed,
          pending: applyReplicaStoreValues(previous?.pending ?? [], input.pending, ({ id }) => id),
          rejected: applyReplicaStoreValues(
            previous?.rejected ?? [],
            input.rejected,
            ({ pending }) => pending.id,
          ),
        } satisfies ReplicaStoreState),
      );
    },
    async query({ input }: Readonly<{ input: Parameters<ReplicaStore["query"]>[0] }>) {
      return evaluateIndexedProjectionRows(input.rows, input.query);
    },
    async remove({
      input,
    }: Readonly<{
      input: Parameters<ReplicaStore["remove"]>[0];
    }>) {
      storage.delete(replicaStoreKey(input.replica, input.principal, input.authorization));
    },
  });
}

export const browserReplicaStoreProvider: WebDependencyProvider<ReplicaStore> = {
  requirements: { crossOriginIsolation: true },
  development() {
    return retainBrowserReplicaStore();
  },
};

export const browserReplicaCoordinationProvider: WebDependencyProvider<ReplicaCoordination> = {
  requirements: {},
  development() {
    return retainBrowserReplicaCoordination();
  },
};

type SharedBrowserResource<Value extends Disposable> = {
  value: Value;
  references: number;
};

let sharedBrowserReplicaStore:
  | SharedBrowserResource<DependencyImplementation<ReplicaStore> & Disposable>
  | undefined;
let sharedBrowserReplicaCoordination:
  | SharedBrowserResource<DependencyImplementation<ReplicaCoordination> & Disposable>
  | undefined;

function retainBrowserReplicaStore(): DependencyImplementation<ReplicaStore> & Disposable {
  const shared =
    sharedBrowserReplicaStore ??
    (sharedBrowserReplicaStore = { value: createIndexedDbReplicaStore(), references: 0 });
  shared.references += 1;
  let released = false;
  return Object.freeze({
    load: (request: Parameters<DependencyImplementation<ReplicaStore>["load"]>[0]) =>
      shared.value.load(request),
    commit: (request: Parameters<DependencyImplementation<ReplicaStore>["commit"]>[0]) =>
      shared.value.commit(request),
    query: (request: Parameters<DependencyImplementation<ReplicaStore>["query"]>[0]) =>
      shared.value.query(request),
    remove: (request: Parameters<DependencyImplementation<ReplicaStore>["remove"]>[0]) =>
      shared.value.remove(request),
    [Symbol.dispose]() {
      if (released) return;
      released = true;
      shared.references -= 1;
      if (shared.references > 0 || sharedBrowserReplicaStore !== shared) return;
      sharedBrowserReplicaStore = undefined;
      shared.value[Symbol.dispose]();
    },
  });
}

function retainBrowserReplicaCoordination(): DependencyImplementation<ReplicaCoordination> &
  Disposable {
  const shared =
    sharedBrowserReplicaCoordination ??
    (sharedBrowserReplicaCoordination = {
      value: createBrowserReplicaCoordination(),
      references: 0,
    });
  shared.references += 1;
  let released = false;
  return Object.freeze({
    exclusive: (
      request: Parameters<DependencyImplementation<ReplicaCoordination>["exclusive"]>[0],
    ) => shared.value.exclusive(request),
    publish: (request: Parameters<DependencyImplementation<ReplicaCoordination>["publish"]>[0]) =>
      shared.value.publish(request),
    subscribe: (
      request: Parameters<DependencyImplementation<ReplicaCoordination>["subscribe"]>[0],
    ) => shared.value.subscribe(request),
    [Symbol.dispose]() {
      if (released) return;
      released = true;
      shared.references -= 1;
      if (shared.references > 0 || sharedBrowserReplicaCoordination !== shared) return;
      sharedBrowserReplicaCoordination = undefined;
      shared.value[Symbol.dispose]();
    },
  });
}

function createBrowserReplicaCoordination(): DependencyImplementation<ReplicaCoordination> &
  Disposable {
  const channel =
    typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel("kit-replica-coordination");
  const listeners = new Map<string, Set<() => void>>();
  const fallback: ReplicaCoordinationState = {
    locks: new Map(),
    listeners: new Map(),
    owner: 0,
  };
  channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
    const value = event.data as Readonly<{ scope?: unknown }>;
    if (typeof value?.scope !== "string") return;
    for (const receive of listeners.get(value.scope) ?? []) receive();
  });
  return Object.freeze({
    async exclusive({
      input,
    }: Readonly<{
      input: Parameters<ReplicaCoordination["exclusive"]>[0];
    }>) {
      if (typeof navigator !== "undefined" && navigator.locks) {
        await navigator.locks.request(`kit:${input.scope}`, input.task);
        return;
      }
      await runReplicaExclusive(fallback, input.scope, input.task);
    },
    publish({
      input,
    }: Readonly<{
      input: Parameters<ReplicaCoordination["publish"]>[0];
    }>) {
      channel?.postMessage({ scope: input.scope });
    },
    subscribe({
      input,
    }: Readonly<{
      input: Parameters<ReplicaCoordination["subscribe"]>[0];
    }>) {
      let scoped = listeners.get(input.scope);
      if (!scoped) {
        scoped = new Set();
        listeners.set(input.scope, scoped);
      }
      scoped.add(input.receive);
      return {
        [Symbol.dispose]() {
          scoped?.delete(input.receive);
          if (scoped?.size === 0) listeners.delete(input.scope);
        },
      };
    },
    [Symbol.dispose]() {
      channel?.close();
      listeners.clear();
    },
  });
}

function createReplicaCoordination(
  state: ReplicaCoordinationState,
  owner: number,
): DependencyImplementation<ReplicaCoordination> {
  return Object.freeze({
    async exclusive({
      input,
    }: Readonly<{
      input: Parameters<ReplicaCoordination["exclusive"]>[0];
    }>) {
      await runReplicaExclusive(state, input.scope, input.task);
    },
    publish({
      input,
    }: Readonly<{
      input: Parameters<ReplicaCoordination["publish"]>[0];
    }>) {
      for (const listener of state.listeners.get(input.scope) ?? []) {
        if (listener.owner !== owner) listener.receive();
      }
    },
    subscribe({
      input,
    }: Readonly<{
      input: Parameters<ReplicaCoordination["subscribe"]>[0];
    }>) {
      let scoped = state.listeners.get(input.scope);
      if (!scoped) {
        scoped = new Set();
        state.listeners.set(input.scope, scoped);
      }
      const listener = { owner, receive: input.receive };
      scoped.add(listener);
      return {
        [Symbol.dispose]() {
          scoped?.delete(listener);
          if (scoped?.size === 0) state.listeners.delete(input.scope);
        },
      };
    },
  });
}

async function runReplicaExclusive(
  state: ReplicaCoordinationState,
  scope: string,
  task: () => Promise<void>,
): Promise<void> {
  const previous = state.locks.get(scope) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  state.locks.set(scope, current);
  try {
    await current;
  } finally {
    if (state.locks.get(scope) === current) state.locks.delete(scope);
  }
}

function createIndexedDbReplicaStore(): DependencyImplementation<ReplicaStore> & Disposable {
  const database = openReplicaDatabase();
  const queries = createTursoReplicaQueryEngine();
  let disposed = false;

  return Object.freeze({
    async load({
      input,
    }: Readonly<{
      input: Parameters<ReplicaStore["load"]>[0];
    }>) {
      if (disposed) throw new Error("The Replica store is disposed.");
      const connection = await database;
      const transaction = connection.transaction(
        ["metadata", "rows", "pending", "rejected"],
        "readonly",
      );
      const completed = transactionDone(transaction);
      const scope = replicaStoreKey(input.replica, input.principal, input.authorization);
      const [metadata, storedRows, pending, rejected] = await Promise.all([
        requestResult<ReplicaStoreStoredMetadata | undefined>(
          transaction.objectStore("metadata").get(scope),
        ),
        requestResult<IndexedReplicaRow[]>(
          transaction.objectStore("rows").index("scope").getAll(IDBKeyRange.only(scope)),
        ),
        requestResult<IndexedReplicaValue<ReplicaStoreCommand>[]>(
          transaction.objectStore("pending").index("scope").getAll(IDBKeyRange.only(scope)),
        ),
        requestResult<IndexedReplicaValue<ReplicaStoreRejection>[]>(
          transaction.objectStore("rejected").index("scope").getAll(IDBKeyRange.only(scope)),
        ),
      ]);
      await completed;
      if (metadata === undefined) return undefined;
      const committed: Record<string, Readonly<{ id: string }>[]> = {};
      for (const row of input.rows) committed[row] = [];
      for (const stored of storedRows) {
        (committed[stored.row] ??= []).push(stored.value);
      }
      return {
        ...metadata,
        committed,
        pending: [...pending]
          .sort((left, right) => left.order - right.order)
          .map(({ value }) => value),
        rejected: [...rejected]
          .sort((left, right) => left.order - right.order)
          .map(({ value }) => value),
      } satisfies ReplicaStoreState;
    },
    async commit({ input }: Readonly<{ input: ReplicaStoreCommit }>) {
      if (disposed) throw new Error("The Replica store is disposed.");
      const durable: ReplicaStoreCommit = {
        replica: input.replica,
        principal: input.principal,
        authorization: input.authorization,
        metadata: cloneData(input.metadata, "Replica metadata"),
        ...(input.replace === undefined
          ? {}
          : { replace: cloneData(input.replace, "Replica replacement") }),
        changes: cloneData(input.changes, "Replica changes"),
        pending: cloneData(input.pending, "Replica pending commands"),
        rejected: cloneData(input.rejected, "Replica rejected commands"),
      };
      const connection = await database;
      const transaction = connection.transaction(
        ["metadata", "rows", "pending", "rejected"],
        "readwrite",
      );
      const completed = transactionDone(transaction);
      const scope = replicaStoreKey(durable.replica, durable.principal, durable.authorization);
      const metadata = transaction.objectStore("metadata");
      const rows = transaction.objectStore("rows");
      const pending = transaction.objectStore("pending");
      const rejected = transaction.objectStore("rejected");
      const [previousMetadata, storedPending, storedRejected] = await Promise.all([
        requestResult<ReplicaStoreStoredMetadata | undefined>(metadata.get(scope)),
        requestResult<IndexedReplicaValue<ReplicaStoreCommand>[]>(
          pending.index("scope").getAll(IDBKeyRange.only(scope)),
        ),
        requestResult<IndexedReplicaValue<ReplicaStoreRejection>[]>(
          rejected.index("scope").getAll(IDBKeyRange.only(scope)),
        ),
      ]);
      const authorityAdvanced =
        previousMetadata === undefined || durable.metadata.sequence >= previousMetadata.sequence;
      if (authorityAdvanced) {
        metadata.put(
          {
            authorization: durable.authorization,
            ...durable.metadata,
          } satisfies ReplicaStoreStoredMetadata,
          scope,
        );
      }

      if (authorityAdvanced && durable.replace !== undefined) {
        await clearReplicaScope(rows, scope);
        for (const [row, values] of Object.entries(durable.replace)) {
          for (const value of values) {
            rows.put({ scope, row, id: value.id, value } satisfies IndexedReplicaRow);
          }
        }
      }
      if (authorityAdvanced) {
        for (const change of durable.changes) {
          if ("upsert" in change) {
            rows.put({
              scope,
              row: change.row,
              id: change.upsert.id,
              value: change.upsert,
            } satisfies IndexedReplicaRow);
          } else {
            rows.delete([scope, change.row, change.remove.id]);
          }
        }
      }

      for (const id of durable.pending.remove) pending.delete([scope, id]);
      for (const id of durable.rejected.remove) rejected.delete([scope, id]);
      let pendingOrder = maximumReplicaOrder(storedPending);
      const pendingOrders = new Map(storedPending.map((value) => [value.id, value.order]));
      for (const value of durable.pending.upsert) {
        const order = pendingOrders.get(value.id) ?? ++pendingOrder;
        pending.put({ scope, id: value.id, order, value } satisfies IndexedReplicaValue<object>);
      }
      let rejectedOrder = maximumReplicaOrder(storedRejected);
      const rejectedOrders = new Map(storedRejected.map((value) => [value.id, value.order]));
      for (const value of durable.rejected.upsert) {
        const order = rejectedOrders.get(value.pending.id) ?? ++rejectedOrder;
        rejected.put({
          scope,
          id: value.pending.id,
          order,
          value,
        } satisfies IndexedReplicaValue<object>);
      }
      await completed;
    },
    async query({ input }: Readonly<{ input: Parameters<ReplicaStore["query"]>[0] }>) {
      if (disposed) throw new Error("The Replica store is disposed.");
      return await queries.query({
        scope: replicaStoreKey(input.replica, input.principal, input.authorization),
        row: input.row,
        rows: input.rows,
        query: input.query,
      });
    },
    async remove({
      input,
    }: Readonly<{
      input: Parameters<ReplicaStore["remove"]>[0];
    }>) {
      if (disposed) throw new Error("The Replica store is disposed.");
      const connection = await database;
      const transaction = connection.transaction(
        ["metadata", "rows", "pending", "rejected"],
        "readwrite",
      );
      const completed = transactionDone(transaction);
      const scope = replicaStoreKey(input.replica, input.principal, input.authorization);
      transaction.objectStore("metadata").delete(scope);
      await Promise.all([
        clearReplicaScope(transaction.objectStore("rows"), scope),
        clearReplicaScope(transaction.objectStore("pending"), scope),
        clearReplicaScope(transaction.objectStore("rejected"), scope),
      ]);
      await completed;
      await queries.remove(scope);
    },
    [Symbol.dispose]() {
      disposed = true;
      queries[Symbol.dispose]();
      void database.then((connection) => connection.close());
    },
  });
}

type IndexedReplicaRow = Readonly<{
  scope: string;
  row: string;
  id: string;
  value: Readonly<{ id: string }>;
}>;

type IndexedReplicaValue<Value> = Readonly<{
  scope: string;
  id: string;
  order: number;
  value: Value;
}>;

function replicaStoreKey(replica: string, principal: string, authorization: number): string {
  return `replica:${replica}:${principal}:${authorization}`;
}

function applyReplicaStoreChanges(
  current: Readonly<Record<string, readonly Readonly<{ id: string }>[]>>,
  changes: readonly ReplicaStoreChange[],
): Readonly<Record<string, readonly Readonly<{ id: string }>[]>> {
  const result = cloneData(current) as Record<string, Readonly<{ id: string }>[]>;
  for (const change of changes) {
    const id = "upsert" in change ? change.upsert.id : change.remove.id;
    const values = result[change.row] ?? [];
    const next = values.filter((value) => value.id !== id);
    if ("upsert" in change) next.push(change.upsert);
    result[change.row] = next;
  }
  return result;
}

function applyReplicaStoreValues<Value>(
  current: readonly Value[],
  delta: ReplicaStoreDelta<Value>,
  identity: (value: Value) => string,
): readonly Value[] {
  const removed = new Set(delta.remove);
  const upserted = new Map(delta.upsert.map((value) => [identity(value), value]));
  const result: Value[] = [];
  for (const value of current) {
    const id = identity(value);
    if (removed.has(id)) continue;
    result.push(upserted.get(id) ?? value);
    upserted.delete(id);
  }
  for (const value of upserted.values()) result.push(value);
  return result;
}

function maximumReplicaOrder(values: readonly IndexedReplicaValue<unknown>[]): number {
  let maximum = -1;
  for (const value of values) {
    if (value.order > maximum) maximum = value.order;
  }
  return maximum;
}

function openReplicaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("kit-replicas", 1);
    request.onupgradeneeded = () => {
      createReplicaObjectStore(request.result, "metadata");
      createReplicaObjectStore(request.result, "rows", ["scope", "row", "id"]);
      createReplicaObjectStore(request.result, "pending", ["scope", "id"]);
      createReplicaObjectStore(request.result, "rejected", ["scope", "id"]);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open Replica storage."));
  });
}

function createReplicaObjectStore(
  database: IDBDatabase,
  name: string,
  keyPath?: string | string[],
): void {
  if (database.objectStoreNames.contains(name)) return;
  const store = database.createObjectStore(name, keyPath === undefined ? undefined : { keyPath });
  if (name !== "metadata") store.createIndex("scope", "scope");
}

async function clearReplicaScope(store: IDBObjectStore, scope: string): Promise<void> {
  const keys = await requestResult<IDBValidKey[]>(
    store.index("scope").getAllKeys(IDBKeyRange.only(scope)),
  );
  for (const key of keys) store.delete(key);
}

function requestResult<Value>(request: IDBRequest<Value>): Promise<Value> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Replica storage request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Replica storage transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Replica storage transaction failed."));
  });
}
