import type { JsonValue } from "#kernel/app";
import { DurabilityError } from "#substrate/durability";
import { scopeId } from "#substrate/protocol";

export type ResourceAddress = Readonly<{
  resource: string;
  key: JsonValue;
}>;

export type JournalHead = Readonly<{
  revision: number;
  position: number;
}>;

export const emptyJournalHead: JournalHead = Object.freeze({ revision: 0, position: 0 });

export type CommandIntent<Value = unknown> = Readonly<{
  id: string;
  inputHash: string;
  value: Value;
}>;

/** The one value an authority commits for a command, including accepted zero-event decisions. */
export type CommandRecord<Intent = unknown, Decision = unknown> = Readonly<{
  schema: string;
  intent: CommandIntent<Intent>;
  decision: Decision;
}>;

export type CommittedCommandRecord<Record extends CommandRecord = CommandRecord> = Record &
  Readonly<{
    address: ResourceAddress;
    revision: number;
    position: number;
    committedAt: number;
  }>;

export type JournalSnapshot<State = unknown> = Readonly<{
  address: ResourceAddress;
  revision: number;
  position: number;
  schema: string;
  stateHash: string;
  state: State;
  storedAt: number;
}>;

export type JournalLoad<Record extends CommandRecord = CommandRecord, State = unknown> = Readonly<{
  snapshot: JournalSnapshot<State> | null;
  records: readonly CommittedCommandRecord<Record>[];
  head: JournalHead;
}>;

export type JournalAppend<Record extends CommandRecord = CommandRecord> = Readonly<{
  address: ResourceAddress;
  expected: JournalHead;
  record: Record;
  /** Present only when restoring a verified logical export. */
  committedAt?: number;
}>;

export type JournalAppendResult<Record extends CommandRecord = CommandRecord> =
  | Readonly<{
      status: "committed" | "duplicate";
      record: CommittedCommandRecord<Record>;
    }>
  | Readonly<{
      status: "conflict";
      head: JournalHead;
    }>;

export type SnapshotSaveResult = "saved" | "stale";

export type JournalSubscription = Readonly<{
  closed: Promise<void>;
  stop(): Promise<void>;
}>;

/**
 * The vendor-free authority log. Positions are globally monotonic; revisions are
 * monotonic within one Resource address.
 */
export interface Journal {
  position(): Promise<number>;

  load<Record extends CommandRecord = CommandRecord, State = unknown>(
    address: ResourceAddress,
  ): Promise<JournalLoad<Record, State>>;

  append<Record extends CommandRecord>(
    input: JournalAppend<Record>,
  ): Promise<JournalAppendResult<Record>>;

  receipt<Record extends CommandRecord = CommandRecord>(
    address: ResourceAddress,
    intentId: string,
  ): Promise<CommittedCommandRecord<Record> | null>;

  addresses(): AsyncIterable<ResourceAddress>;

  scan<Record extends CommandRecord = CommandRecord>(
    after: number,
  ): AsyncIterable<CommittedCommandRecord<Record>>;

  subscribe<Record extends CommandRecord = CommandRecord>(
    after: number,
    receive: (record: CommittedCommandRecord<Record>) => void | Promise<void>,
  ): Promise<JournalSubscription>;

  saveSnapshot<State>(snapshot: JournalSnapshot<State>): Promise<SnapshotSaveResult>;
  close(): Promise<void>;
}

export type LogicalJournalExport<Record extends CommandRecord = CommandRecord> = Readonly<{
  format: 3;
  records: readonly CommittedCommandRecord<Record>[];
  snapshots: readonly JournalSnapshot[];
  sha256: string;
}>;

export async function exportJournal<Record extends CommandRecord = CommandRecord>(
  journal: Journal,
): Promise<LogicalJournalExport<Record>> {
  const retainedFloor = (journal as Journal & { retainedFloor?: () => number }).retainedFloor?.();
  if (retainedFloor !== undefined && retainedFloor > 0) {
    throw new Error(
      "A logical Journal export requires complete history; use the adapter's physical backup after retention.",
    );
  }
  const records: CommittedCommandRecord<Record>[] = [];
  for await (const record of journal.scan<Record>(0)) records.push(record);
  const snapshots: JournalSnapshot[] = [];
  for await (const address of journal.addresses()) {
    const snapshot = (await journal.load<Record>(address)).snapshot;
    if (snapshot) snapshots.push(snapshot);
  }
  records.sort((left, right) => left.position - right.position);
  snapshots.sort((left, right) =>
    addressKey(left.address).localeCompare(addressKey(right.address)),
  );
  const payload = { format: 3 as const, records, snapshots };
  return { ...payload, sha256: await hashLogicalExport(payload) };
}

export async function importJournal(
  journal: Journal,
  source: LogicalJournalExport,
): Promise<Readonly<{ records: number; snapshots: number }>> {
  await verifyLogicalJournalExport(source);
  for await (const address of journal.addresses()) {
    throw new Error(`Logical import requires an empty Journal; found ${addressKey(address)}.`);
  }

  const heads = new Map<string, JournalHead>();
  const records = [...source.records].sort((left, right) => left.position - right.position);
  for (const exported of records) {
    const { address, revision, position, committedAt, ...record } = exported;
    const key = addressKey(address);
    const expected = heads.get(key) ?? emptyJournalHead;
    const result = await journal.append({ address, expected, record, committedAt });
    if (
      result.status !== "committed" ||
      result.record.revision !== revision ||
      result.record.position !== position
    ) {
      throw new Error(`Logical import could not reproduce record ${position}.`);
    }
    heads.set(key, { revision, position });
  }
  for (const snapshot of source.snapshots) {
    const result = await journal.saveSnapshot(snapshot);
    if (result !== "saved") {
      throw new Error(`Logical import could not restore snapshot ${addressKey(snapshot.address)}.`);
    }
  }
  return { records: records.length, snapshots: source.snapshots.length };
}

/** Verifies an archive completely before a destination Journal is touched. */
export async function verifyLogicalJournalExport(source: LogicalJournalExport): Promise<void> {
  if (source.format !== 3) throw new Error(`Unsupported logical journal format ${source.format}.`);
  if (!/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new JournalCorruptionError("Logical journal export has an invalid SHA-256 digest.");
  }
  const actualHash = await hashLogicalExport({
    format: source.format,
    records: source.records,
    snapshots: source.snapshots,
  });
  if (actualHash !== source.sha256) {
    throw new JournalCorruptionError("Logical journal export failed its SHA-256 digest.");
  }

  const heads = new Map<string, JournalHead>();
  const intents = new Set<string>();
  const anchors = new Set<string>();
  let previousPosition = 0;
  for (const record of source.records) {
    assertHead({ revision: record.revision, position: record.position });
    assertCommittedAt(record.committedAt);
    assertCommandRecord(record);
    const key = addressKey(record.address);
    if (record.position <= previousPosition) {
      throw new JournalCorruptionError("Logical journal records are not in canonical order.");
    }
    if (record.position !== previousPosition + 1) {
      throw new JournalCorruptionError(`Journal has a gap at position ${record.position}.`);
    }
    previousPosition = record.position;

    const head = heads.get(key) ?? emptyJournalHead;
    if (record.revision !== head.revision + 1 || record.position <= head.position) {
      throw new JournalCorruptionError(`Resource ${key} has a non-contiguous revision history.`);
    }
    heads.set(key, { revision: record.revision, position: record.position });

    const intentKey = `${key}\u0000${record.intent.id}`;
    if (intents.has(intentKey)) {
      throw new JournalCorruptionError(`Resource ${key} contains a duplicate intent receipt.`);
    }
    intents.add(intentKey);
    anchors.add(`${key}\u0000${record.revision}\u0000${record.position}`);
  }

  const snapshotAddresses = new Set<string>();
  let previousSnapshotAddress = "";
  for (const snapshot of source.snapshots) {
    assertSnapshot(snapshot);
    const key = addressKey(snapshot.address);
    if (snapshotAddresses.has(key) || key.localeCompare(previousSnapshotAddress) < 0) {
      throw new JournalCorruptionError("Logical journal snapshots are not uniquely ordered.");
    }
    snapshotAddresses.add(key);
    previousSnapshotAddress = key;
    if (
      snapshot.revision !== 0 &&
      !anchors.has(`${key}\u0000${snapshot.revision}\u0000${snapshot.position}`)
    ) {
      throw new JournalCorruptionError(`Snapshot ${key} has no matching journal anchor.`);
    }
  }
}

export class IntentMismatchError extends Error {
  constructor(intentId: string) {
    super(`Intent ${intentId} was reused with different input.`);
    this.name = "IntentMismatchError";
  }
}

export class SnapshotAnchorError extends Error {
  constructor() {
    super("Snapshot does not describe a committed Resource revision and position.");
    this.name = "SnapshotAnchorError";
  }
}

export class JournalCorruptionError extends DurabilityError {
  constructor(message: string) {
    super("corrupt", message, { retryable: false });
    this.name = "JournalCorruptionError";
  }
}

export function addressKey(address: ResourceAddress): string {
  if (address.resource.length === 0) throw new Error("A Resource name cannot be empty.");
  return scopeId(address.resource, address.key);
}

export function assertHead(head: JournalHead): void {
  if (
    !Number.isSafeInteger(head.revision) ||
    head.revision < 0 ||
    !Number.isSafeInteger(head.position) ||
    head.position < 0 ||
    (head.revision === 0) !== (head.position === 0)
  ) {
    throw new TypeError("A journal head must contain matching non-negative revision and position.");
  }
}

export function assertCommandRecord(record: CommandRecord): void {
  if (record.schema.length === 0) throw new TypeError("A command record requires a schema hash.");
  if (record.intent.id.length === 0) throw new TypeError("A command intent requires an id.");
  if (record.intent.inputHash.length === 0) {
    throw new TypeError("A command intent requires an input hash.");
  }
  assertJson(record);
}

export function assertSnapshot(snapshot: JournalSnapshot): void {
  assertHead({ revision: snapshot.revision, position: snapshot.position });
  if (snapshot.schema.length === 0) throw new TypeError("A snapshot requires a schema hash.");
  if (snapshot.stateHash.length === 0) throw new TypeError("A snapshot requires a state hash.");
  if (!Number.isSafeInteger(snapshot.storedAt) || snapshot.storedAt < 0) {
    throw new TypeError("A snapshot requires a non-negative integer timestamp.");
  }
  assertJson(snapshot);
}

export function sameHead(left: JournalHead, right: JournalHead): boolean {
  return left.revision === right.revision && left.position === right.position;
}

export function encodeJournalValue(value: unknown): string {
  assertJson(value);
  return JSON.stringify(value);
}

export function createMemoryJournal(): Journal {
  const records = new Map<string, CommittedCommandRecord[]>();
  const receipts = new Map<string, Map<string, CommittedCommandRecord>>();
  const snapshots = new Map<string, JournalSnapshot>();
  const committedRecords: CommittedCommandRecord[] = [];
  const addresses = new Map<string, ResourceAddress>();
  const subscriptions = new Set<MemorySubscription>();
  let position = 0;
  let closed = false;

  const currentHead = (key: string): JournalHead => {
    const current = records.get(key)?.at(-1);
    return current ? { revision: current.revision, position: current.position } : emptyJournalHead;
  };

  return {
    async position() {
      ensureOpen(closed);
      return position;
    },
    async load<Record extends CommandRecord, State>(address: ResourceAddress) {
      ensureOpen(closed);
      const key = addressKey(address);
      const snapshot = (snapshots.get(key) as JournalSnapshot<State> | undefined) ?? null;
      const after = snapshot?.position ?? 0;
      return {
        snapshot,
        records: (records.get(key) ?? []).filter(
          (record) => record.position > after,
        ) as CommittedCommandRecord<Record>[],
        head: currentHead(key),
      };
    },
    async append<Record extends CommandRecord>(input: JournalAppend<Record>) {
      ensureOpen(closed);
      assertHead(input.expected);
      assertCommandRecord(input.record);
      assertCommittedAt(input.committedAt);
      const key = addressKey(input.address);
      const existing = receipts.get(key)?.get(input.record.intent.id);
      if (existing) {
        if (existing.intent.inputHash !== input.record.intent.inputHash) {
          throw new IntentMismatchError(input.record.intent.id);
        }
        return { status: "duplicate" as const, record: existing as CommittedCommandRecord<Record> };
      }
      const head = currentHead(key);
      if (!sameHead(head, input.expected)) return { status: "conflict" as const, head };

      position += 1;
      const committed: CommittedCommandRecord<Record> = {
        ...input.record,
        address: input.address,
        revision: head.revision + 1,
        position,
        committedAt: input.committedAt ?? Date.now(),
      };
      const stream = records.get(key) ?? [];
      stream.push(committed);
      records.set(key, stream);
      const streamReceipts = receipts.get(key) ?? new Map();
      streamReceipts.set(committed.intent.id, committed);
      receipts.set(key, streamReceipts);
      addresses.set(key, structuredClone(input.address));
      committedRecords.push(committed);
      for (const subscription of subscriptions) {
        if (position > subscription.after) wakeMemorySubscription(subscription);
      }
      return { status: "committed" as const, record: committed };
    },
    async receipt<Record extends CommandRecord>(address: ResourceAddress, intentId: string) {
      ensureOpen(closed);
      return (
        (receipts.get(addressKey(address))?.get(intentId) as
          | CommittedCommandRecord<Record>
          | undefined) ?? null
      );
    },
    async *addresses() {
      ensureOpen(closed);
      for (const address of addresses.values()) yield structuredClone(address);
    },
    async *scan<Record extends CommandRecord>(after: number) {
      ensureOpen(closed);
      for (const record of committedRecords) {
        if (record.position > after) yield record as CommittedCommandRecord<Record>;
      }
    },
    async subscribe<Record extends CommandRecord>(
      after: number,
      receive: (record: CommittedCommandRecord<Record>) => void | Promise<void>,
    ) {
      ensureOpen(closed);
      const deferred = Promise.withResolvers<void>();
      const subscription: MemorySubscription = {
        after,
        receive: receive as (record: CommittedCommandRecord) => void | Promise<void>,
        read: () => committedRecords,
        dispose: () => subscriptions.delete(subscription),
        notified: false,
        running: false,
        stopped: false,
        resolve: deferred.resolve,
        reject: deferred.reject,
      };
      subscriptions.add(subscription);
      wakeMemorySubscription(subscription);
      return {
        closed: deferred.promise,
        async stop() {
          if (subscription.stopped) return;
          subscription.stopped = true;
          subscription.dispose();
          deferred.resolve();
        },
      };
    },
    async saveSnapshot<State>(snapshot: JournalSnapshot<State>) {
      ensureOpen(closed);
      assertSnapshot(snapshot);
      const key = addressKey(snapshot.address);
      const current = snapshots.get(key);
      if (current && current.revision >= snapshot.revision) return "stale";
      const anchored =
        snapshot.revision === 0
          ? snapshot.position === 0
          : (records.get(key) ?? []).some(
              (record) =>
                record.revision === snapshot.revision && record.position === snapshot.position,
            );
      if (!anchored) throw new SnapshotAnchorError();
      addresses.set(key, structuredClone(snapshot.address));
      snapshots.set(key, snapshot as JournalSnapshot);
      return "saved";
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const subscription of subscriptions) {
        subscription.stopped = true;
        subscription.resolve();
      }
      subscriptions.clear();
    },
  };
}

type MemorySubscription = {
  after: number;
  receive: (record: CommittedCommandRecord) => void | Promise<void>;
  read: () => readonly CommittedCommandRecord[];
  dispose(): void;
  notified: boolean;
  running: boolean;
  stopped: boolean;
  resolve(): void;
  reject(error: unknown): void;
};

function wakeMemorySubscription(subscription: MemorySubscription): void {
  if (subscription.stopped) return;
  subscription.notified = true;
  if (subscription.running) return;
  subscription.running = true;
  void (async () => {
    try {
      while (!subscription.stopped && subscription.notified) {
        subscription.notified = false;
        let advanced = false;
        const records = subscription.read();
        for (let index = subscription.after; index < records.length; index += 1) {
          const record = records[index];
          if (!record || subscription.stopped) break;
          await subscription.receive(record);
          subscription.after = record.position;
          advanced = true;
        }
        if (advanced) subscription.notified = true;
      }
    } catch (error) {
      subscription.stopped = true;
      subscription.dispose();
      subscription.reject(error);
    } finally {
      subscription.running = false;
    }
  })();
}

function assertJson(value: unknown): void {
  assertJsonValue(value, new WeakSet());
}

function assertJsonValue(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError("Journal numbers must be finite.");
  }
  if (typeof value !== "object") throw new TypeError("Journal values must be JSON values.");
  if (seen.has(value)) throw new TypeError("Journal values cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Journal objects must be plain JSON objects.");
    }
    for (const item of Object.values(value)) assertJsonValue(item, seen);
  }
  seen.delete(value);
}

function ensureOpen(closed: boolean): void {
  if (closed) throw new DurabilityError("closed", "Journal is closed.", { retryable: false });
}

export function assertCommittedAt(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new TypeError("A journal commit timestamp must be a non-negative integer.");
  }
}

async function hashLogicalExport(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value, new WeakSet()));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalJson(value: unknown, seen: WeakSet<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new TypeError("Journal values must be JSON values.");
  if (seen.has(value)) throw new TypeError("Journal values cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Journal objects must be plain JSON objects.");
  }
  const result = `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, seen)}`)
    .join(",")}}`;
  seen.delete(value);
  return result;
}
