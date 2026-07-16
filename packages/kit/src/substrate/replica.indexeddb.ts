import { DurabilityError, isDurabilityError } from "#substrate/durability";
import { addressKey } from "#substrate/journal";
import {
  assertEnqueueIntent,
  assertReplicaScope,
  type PendingIntent,
  type ReplicaScope,
  type ReplicaStore,
} from "#substrate/replica";

export type IndexedDbReplicaOptions = Readonly<{
  name?: string;
  indexedDB?: IDBFactory;
}>;

type Metadata = Readonly<{
  key: "replica";
  clientId: string | null;
  nextSequence: number;
}>;

type StoredPending = PendingIntent & Readonly<{ scope: string }>;

const metadataStore = "metadata";
const scopeStore = "scopes";
const pendingStore = "pending";

export function createIndexedDbReplicaStore(options: IndexedDbReplicaOptions = {}): ReplicaStore {
  const factory = options.indexedDB ?? globalThis.indexedDB;
  if (!factory) {
    throw new DurabilityError("unavailable", "IndexedDB is unavailable in this environment.", {
      retryable: false,
    });
  }
  const database = openDatabase(factory, options.name ?? "poggers-replica");
  let closed = false;

  const use = async <Result>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    operation: (transaction: IDBTransaction) => Promise<Result>,
  ): Promise<Result> => {
    ensureOpen(closed);
    let transaction: IDBTransaction | undefined;
    let completed: Promise<void> | undefined;
    try {
      const current = await database;
      transaction = current.transaction(stores, mode, { durability: "strict" });
      completed = transactionDone(transaction);
      const result = await operation(transaction);
      await completed;
      return result;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {}
      await completed?.catch(() => undefined);
      throw normalizeIndexedDbError(error);
    }
  };

  return {
    async load() {
      return use([metadataStore, scopeStore, pendingStore], "readonly", async (transaction) => {
        const metadata = await request<Metadata | undefined>(
          transaction.objectStore(metadataStore).get("replica"),
        );
        const scopes = await request<ReplicaScope[]>(transaction.objectStore(scopeStore).getAll());
        const stored = await request<StoredPending[]>(
          transaction.objectStore(pendingStore).getAll(),
        );
        return {
          clientId: metadata?.clientId ?? null,
          nextSequence: metadata?.nextSequence ?? 0,
          scopes,
          pending: stored
            .map(({ scope: _scope, ...intent }) => intent)
            .sort((left, right) => left.sequence - right.sequence),
        };
      });
    },
    async initialize(candidate) {
      assertIdentifier(candidate, "Replica client");
      return use([metadataStore], "readwrite", async (transaction) => {
        const store = transaction.objectStore(metadataStore);
        const current = await request<Metadata | undefined>(store.get("replica"));
        const clientId = current?.clientId ?? candidate;
        await request(
          store.put({
            key: "replica",
            clientId,
            nextSequence: current?.nextSequence ?? 0,
          } satisfies Metadata),
        );
        return clientId;
      });
    },
    async enqueue(input) {
      assertEnqueueIntent(input);
      return use([metadataStore, pendingStore], "readwrite", async (transaction) => {
        const metadata = transaction.objectStore(metadataStore);
        const current = await request<Metadata | undefined>(metadata.get("replica"));
        if (!current?.clientId) {
          throw new Error("The Replica must be initialized before enqueueing intents.");
        }
        const sequence = current.nextSequence + 1;
        const intent: PendingIntent = {
          ...structuredClone(input),
          id: `${current.clientId}/${sequence}`,
          clientId: current.clientId,
          sequence,
        };
        await request(metadata.put({ ...current, nextSequence: sequence } satisfies Metadata));
        await request(
          transaction
            .objectStore(pendingStore)
            .put({ ...intent, scope: addressKey(intent.address) } satisfies StoredPending),
        );
        return intent;
      });
    },
    async confirm(input) {
      assertReplicaScope(input.scope);
      return use([scopeStore, pendingStore], "readwrite", async (transaction) => {
        const scopes = transaction.objectStore(scopeStore);
        const key = addressKey(input.scope.address);
        const current = await request<ReplicaScope | undefined>(scopes.get(key));
        if (!current || input.scope.cursor >= current.cursor) {
          await request(scopes.put(structuredClone(input.scope), key));
        }
        if (input.intentId)
          await request(transaction.objectStore(pendingStore).delete(input.intentId));
      });
    },
    async reject(intentId) {
      assertIdentifier(intentId, "Intent");
      return use([pendingStore], "readwrite", async (transaction) => {
        await request(transaction.objectStore(pendingStore).delete(intentId));
      });
    },
    async forget(address) {
      const key = addressKey(address);
      return use([scopeStore, pendingStore], "readwrite", async (transaction) => {
        await request(transaction.objectStore(scopeStore).delete(key));
        const index = transaction.objectStore(pendingStore).index("scope");
        const keys = await request<IDBValidKey[]>(index.getAllKeys(key));
        for (const intent of keys)
          await request(transaction.objectStore(pendingStore).delete(intent));
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        (await database).close();
      } catch (error) {
        throw normalizeIndexedDbError(error);
      }
    },
  };
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(name, 1);
    let settled = false;
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains(metadataStore)) {
        database.createObjectStore(metadataStore, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(scopeStore)) database.createObjectStore(scopeStore);
      if (!database.objectStoreNames.contains(pendingStore)) {
        const pending = database.createObjectStore(pendingStore, { keyPath: "id" });
        pending.createIndex("scope", "scope");
      }
    };
    opening.onsuccess = () => {
      if (settled) {
        opening.result.close();
        return;
      }
      settled = true;
      opening.result.onversionchange = () => opening.result.close();
      resolve(opening.result);
    };
    opening.onerror = () => {
      if (settled) return;
      settled = true;
      reject(
        normalizeIndexedDbError(opening.error ?? new Error("Failed to open the Replica database.")),
      );
    };
    opening.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(
        new DurabilityError("busy", "Replica database upgrade is blocked by another context."),
      );
    };
  });
}

function request<Result>(value: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () =>
      reject(
        normalizeIndexedDbError(value.error ?? new Error("Replica transaction request failed.")),
      );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        normalizeIndexedDbError(transaction.error ?? new Error("Replica transaction aborted.")),
      );
    transaction.onerror = () =>
      reject(
        normalizeIndexedDbError(transaction.error ?? new Error("Replica transaction failed.")),
      );
  });
}

function assertIdentifier(value: string, name: string): void {
  if (value.length === 0) throw new TypeError(`${name} cannot be empty.`);
}

function ensureOpen(closed: boolean): void {
  if (closed) throw new DurabilityError("closed", "Replica store is closed.", { retryable: false });
}

function normalizeIndexedDbError(error: unknown): Error {
  if (isDurabilityError(error) || error instanceof TypeError || error instanceof RangeError) {
    return error;
  }
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "QuotaExceededError") {
    return new DurabilityError("capacity", `Replica storage is full: ${message}`, {
      cause: error,
      retryable: false,
    });
  }
  if (name === "InvalidStateError" || name === "VersionError") {
    return new DurabilityError("busy", `Replica storage must be reopened: ${message}`, {
      cause: error,
    });
  }
  if (name === "DataError" || name === "ConstraintError") {
    return new DurabilityError("corrupt", `Replica storage rejected persisted data: ${message}`, {
      cause: error,
      retryable: false,
    });
  }
  return new DurabilityError("unavailable", `Replica storage failed: ${message}`, { cause: error });
}
