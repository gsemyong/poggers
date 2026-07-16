import type { JsonValue } from "#kernel/app";
import { DurabilityError } from "#substrate/durability";
import { addressKey, type ResourceAddress } from "#substrate/journal";

export type ReplicaScope = Readonly<{
  address: ResourceAddress;
  schema: string;
  cursor: number;
  stateHash: string;
  state: JsonValue;
  generation?: string;
  owner?: string;
}>;

export type PendingIntent = Readonly<{
  id: string;
  clientId: string;
  sequence: number;
  address: ResourceAddress;
  inputHash: string;
  value: JsonValue;
  createdAt: number;
}>;

export type ReplicaLoad = Readonly<{
  clientId: string | null;
  nextSequence: number;
  scopes: readonly ReplicaScope[];
  pending: readonly PendingIntent[];
}>;

export type EnqueueIntent = Readonly<{
  address: ResourceAddress;
  inputHash: string;
  value: JsonValue;
  createdAt: number;
}>;

export type ConfirmReplica = Readonly<{
  scope: ReplicaScope;
  intentId?: string;
}>;

/**
 * Durable device-local state. Each method is one storage transaction; an intent is
 * visible to the UI only after `enqueue` resolves.
 */
export interface ReplicaStore {
  load(): Promise<ReplicaLoad>;
  initialize(clientId: string): Promise<string>;
  enqueue(intent: EnqueueIntent): Promise<PendingIntent>;
  confirm(input: ConfirmReplica): Promise<void>;
  reject(intentId: string): Promise<void>;
  forget(address: ResourceAddress): Promise<void>;
  close(): Promise<void>;
}

export function createMemoryReplicaStore(initial?: Partial<ReplicaLoad>): ReplicaStore {
  let closed = false;
  let clientId = initial?.clientId ?? null;
  let nextSequence = initial?.nextSequence ?? 0;
  const scopes = new Map(
    (initial?.scopes ?? []).map((scope) => [addressKey(scope.address), clone(scope)]),
  );
  const pending = new Map((initial?.pending ?? []).map((intent) => [intent.id, clone(intent)]));
  let transaction = Promise.resolve();

  const write = async <Result>(operation: () => Result): Promise<Result> => {
    ensureOpen(closed);
    const previous = transaction;
    const deferred = Promise.withResolvers<void>();
    transaction = previous.then(() => deferred.promise);
    await previous;
    try {
      return operation();
    } finally {
      deferred.resolve();
    }
  };

  return {
    async load() {
      return write(() => ({
        clientId,
        nextSequence,
        scopes: [...scopes.values()].map(clone),
        pending: [...pending.values()].sort(bySequence).map(clone),
      }));
    },
    async initialize(candidate) {
      assertIdentifier(candidate, "Replica client");
      return write(() => {
        clientId ??= candidate;
        return clientId;
      });
    },
    async enqueue(input) {
      assertEnqueueIntent(input);
      return write(() => {
        if (!clientId)
          throw new Error("The Replica must be initialized before enqueueing intents.");
        const sequence = nextSequence + 1;
        const intent: PendingIntent = {
          ...clone(input),
          id: `${clientId}/${sequence}`,
          clientId,
          sequence,
        };
        nextSequence = sequence;
        pending.set(intent.id, intent);
        return clone(intent);
      });
    },
    async confirm(input) {
      assertReplicaScope(input.scope);
      return write(() => {
        const key = addressKey(input.scope.address);
        const current = scopes.get(key);
        if (!current || input.scope.cursor >= current.cursor) {
          scopes.set(key, clone(input.scope));
        }
        if (input.intentId) pending.delete(input.intentId);
      });
    },
    async reject(intentId) {
      assertIdentifier(intentId, "Intent");
      return write(() => {
        pending.delete(intentId);
      });
    },
    async forget(address) {
      return write(() => {
        const key = addressKey(address);
        scopes.delete(key);
        for (const [id, intent] of pending) {
          if (addressKey(intent.address) === key) pending.delete(id);
        }
      });
    },
    async close() {
      await transaction;
      closed = true;
    },
  };
}

export function assertReplicaScope(scope: ReplicaScope): void {
  addressKey(scope.address);
  assertIdentifier(scope.schema, "Replica scope schema");
  assertIdentifier(scope.stateHash, "Replica scope state hash");
  if (!Number.isSafeInteger(scope.cursor) || scope.cursor < 0) {
    throw new TypeError("A Replica scope cursor must be a non-negative integer.");
  }
  if (scope.generation !== undefined) assertIdentifier(scope.generation, "Replica generation");
  if (scope.owner !== undefined) assertIdentifier(scope.owner, "Replica owner");
  assertJson(scope.state, new WeakSet());
}

export function assertEnqueueIntent(input: EnqueueIntent): void {
  addressKey(input.address);
  assertIdentifier(input.inputHash, "Intent input hash");
  assertTimestamp(input.createdAt);
  assertJson(input.value, new WeakSet());
}

function assertIdentifier(value: string, name: string): void {
  if (value.length === 0) throw new TypeError(`${name} cannot be empty.`);
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("An intent timestamp must be a non-negative integer.");
  }
}

function assertJson(value: unknown, seen: WeakSet<object>): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError("Replica numbers must be finite.");
  }
  if (typeof value !== "object") throw new TypeError("Replica values must be JSON values.");
  if (seen.has(value)) throw new TypeError("Replica values cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Replica objects must be plain JSON objects.");
    }
    for (const item of Object.values(value)) assertJson(item, seen);
  }
  seen.delete(value);
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function bySequence(left: PendingIntent, right: PendingIntent): number {
  return left.sequence - right.sequence;
}

function ensureOpen(closed: boolean): void {
  if (closed)
    throw new DurabilityError("closed", "Replica store is closed.", {
      retryable: false,
    });
}
