import { Database, SQLiteError } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";

import { DurabilityError, isDurabilityError } from "#substrate/durability";
import {
  IntentMismatchError,
  JournalCorruptionError,
  SnapshotAnchorError,
  addressKey,
  assertCommandRecord,
  assertCommittedAt,
  assertHead,
  assertSnapshot,
  emptyJournalHead,
  encodeJournalValue,
  sameHead,
  type CommandRecord,
  type CommittedCommandRecord,
  type Journal,
  type JournalAppend,
  type JournalAppendResult,
  type JournalHead,
  type JournalSnapshot,
  type ResourceAddress,
} from "#substrate/journal";

const scanBatchSize = 256;

export type SqliteJournalOptions = Readonly<{
  file: string;
  /** `strict` survives OS/power failure; `process` trades that guarantee for throughput. */
  durability?: "strict" | "process";
  /** `group` amortizes fsync across appends issued in the same event-loop turn. */
  commit?: "group" | "immediate";
  groupMax?: number;
  /** Optional physical storage ceiling. Exceeding it fails the complete append. */
  maxBytes?: number;
}>;

type RecordRow = Readonly<{
  data: string;
  data_hash: string;
}>;

type HeadRow = Readonly<{
  revision: number;
  position: number;
}>;

type StoredHeadRow = HeadRow & Readonly<{ address: string }>;

type StoredRecordRow = RecordRow &
  Readonly<{
    address: string;
    position: number;
    revision: number;
  }>;

type SnapshotRow = Readonly<{
  revision: number;
  data: string;
  data_hash: string;
}>;

type StoredSnapshotRow = SnapshotRow & Readonly<{ address: string }>;

type IntegrityRow = Readonly<{ integrity_check: string }>;

type ApplicationIdRow = Readonly<{ application_id: number }>;
type UserVersionRow = Readonly<{ user_version: number }>;

type CountRow = Readonly<{ count: number }>;
type PageSizeRow = Readonly<{ page_size: number }>;

type PositionRow = Readonly<{
  position: number;
}>;

type RetentionRequirementRow = Readonly<{
  address: string;
  revision: number;
}>;

type SqliteSubscription = {
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

type CommitOutcome =
  | Readonly<{ ok: true; result: JournalAppendResult<CommandRecord> }>
  | Readonly<{ ok: false; error: IntentMismatchError }>;

type PendingAppend = {
  input: JournalAppend<CommandRecord>;
  resolve(result: JournalAppendResult<CommandRecord>): void;
  reject(error: unknown): void;
};

export type SqliteJournal = Journal &
  Readonly<{
    checkpoint(): void;
    verify(): void;
    retainedFloor(): number;
    retainThrough(position: number): void;
    backup(file: string): Readonly<{ bytes: number; sha256: string }>;
  }>;

export type RestoreSqliteJournalOptions = Readonly<{
  backupFile: string;
  file: string;
  sha256: string;
  durability?: SqliteJournalOptions["durability"];
}>;

/**
 * The single-authority journal. SQLite owns locking, WAL recovery, atomic head CAS,
 * receipts, records, and snapshots; no separate command-id or event files exist.
 */
export function createSqliteJournal(options: SqliteJournalOptions): SqliteJournal {
  try {
    return openSqliteJournal(options);
  } catch (error) {
    throw normalizeSqliteError(error);
  }
}

/** Restores a closed authority from a verified backup without publishing a partial file. */
export async function restoreSqliteJournalBackup(
  options: RestoreSqliteJournalOptions,
): Promise<void> {
  if (existsSync(options.file)) {
    throw new DurabilityError("unavailable", "Journal restore destination already exists.", {
      retryable: false,
    });
  }
  if (!/^[a-f0-9]{64}$/.test(options.sha256)) {
    throw new JournalCorruptionError("Journal backup has an invalid SHA-256 digest.");
  }
  const contents = withSqliteErrors(() => readFileSync(options.backupFile));
  const actualHash = createHash("sha256").update(contents).digest("hex");
  if (actualHash !== options.sha256) {
    throw new JournalCorruptionError("Journal backup failed its SHA-256 digest.");
  }

  mkdirSync(dirname(options.file), { recursive: true });
  const temporary = `${options.file}.restore-${randomUUID()}`;
  try {
    withSqliteErrors(() => copyFileSync(options.backupFile, temporary, constants.COPYFILE_EXCL));
    const restored = createSqliteJournal({
      file: temporary,
      durability: options.durability,
      commit: "immediate",
    });
    try {
      restored.verify();
    } finally {
      await restored.close();
    }
    withSqliteErrors(() => linkSync(temporary, options.file));
  } finally {
    rmSync(temporary, { force: true });
    rmSync(`${temporary}-wal`, { force: true });
    rmSync(`${temporary}-shm`, { force: true });
  }
}

function openSqliteJournal(options: SqliteJournalOptions): SqliteJournal {
  const commitMode = options.commit ?? "group";
  const groupMax = options.groupMax ?? 256;
  if (!Number.isSafeInteger(groupMax) || groupMax <= 0) {
    throw new RangeError("groupMax must be a positive integer.");
  }
  const database = new Database(options.file, { create: true, strict: true });
  try {
    return initializeSqliteJournal(database, options, commitMode, groupMax);
  } catch (error) {
    database.close();
    throw error;
  }
}

function initializeSqliteJournal(
  database: Database,
  options: SqliteJournalOptions,
  commitMode: "immediate" | "group",
  groupMax: number,
): SqliteJournal {
  database.exec("PRAGMA locking_mode = EXCLUSIVE");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec(`PRAGMA synchronous = ${options.durability === "process" ? "NORMAL" : "FULL"}`);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA wal_autocheckpoint = 1000");
  claimDatabase(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS journal_records (
      position INTEGER PRIMARY KEY,
      address TEXT NOT NULL,
      revision INTEGER NOT NULL,
      intent_id TEXT NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      UNIQUE (address, revision),
      UNIQUE (address, intent_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS journal_snapshots (
      address TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS journal_heads (
      address TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      position INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS journal_commits (
      address TEXT NOT NULL,
      revision INTEGER NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (address, revision),
      UNIQUE (position)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS journal_receipts (
      address TEXT NOT NULL,
      intent_id TEXT NOT NULL,
      data TEXT NOT NULL,
      data_hash TEXT NOT NULL,
      PRIMARY KEY (address, intent_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS journal_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      high_water INTEGER NOT NULL,
      retained_floor INTEGER NOT NULL
    ) STRICT;

    INSERT OR IGNORE INTO journal_heads (address, revision, position)
    SELECT records.address, records.revision, records.position
    FROM journal_records records
    JOIN (
      SELECT address, max(revision) AS revision FROM journal_records GROUP BY address
    ) latest ON latest.address = records.address AND latest.revision = records.revision;

    INSERT OR IGNORE INTO journal_commits (address, revision, position)
    SELECT address, revision, position FROM journal_records;

    INSERT OR IGNORE INTO journal_receipts (address, intent_id, data, data_hash)
    SELECT address, intent_id, data, data_hash FROM journal_records;

    INSERT OR IGNORE INTO journal_meta (singleton, high_water, retained_floor)
    SELECT 1, coalesce(max(position), 0), 0 FROM journal_records;
  `);
  database.exec("PRAGMA application_id = 1347372871");
  database.exec("PRAGMA user_version = 3");
  if (options.maxBytes !== undefined) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive integer.");
    }
    const pageSize = (database.query("PRAGMA page_size").get() as PageSizeRow).page_size;
    const maxPages = Math.floor(options.maxBytes / pageSize);
    if (maxPages === 0) throw new RangeError("maxBytes must hold at least one SQLite page.");
    database.exec(`PRAGMA max_page_count = ${maxPages}`);
  }

  const selectHead = database.query(
    "SELECT revision, position FROM journal_heads WHERE address = ?",
  );
  const selectReceipt = database.query(
    "SELECT data, data_hash FROM journal_receipts WHERE address = ? AND intent_id = ?",
  );
  const selectRecords = database.query(
    `SELECT data, data_hash FROM journal_records
     WHERE address = ? AND revision > ? ORDER BY revision`,
  );
  const selectGlobal = database.query(
    `SELECT data, data_hash FROM journal_records
     WHERE position > ? ORDER BY position LIMIT ?`,
  );
  const selectPosition = database.query(
    "SELECT high_water AS position FROM journal_meta WHERE singleton = 1",
  );
  const selectRetainedFloor = database.query(
    "SELECT retained_floor AS position FROM journal_meta WHERE singleton = 1",
  );
  const insertRecord = database.query(
    `INSERT INTO journal_records
       (position, address, revision, intent_id, data, data_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertReceipt = database.query(
    `INSERT INTO journal_receipts (address, intent_id, data, data_hash)
     VALUES (?, ?, ?, ?)`,
  );
  const insertCommit = database.query(
    "INSERT INTO journal_commits (address, revision, position) VALUES (?, ?, ?)",
  );
  const upsertHead = database.query(
    `INSERT INTO journal_heads (address, revision, position) VALUES (?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET revision = excluded.revision, position = excluded.position`,
  );
  const updateHighWater = database.query(
    "UPDATE journal_meta SET high_water = ? WHERE singleton = 1",
  );
  const selectSnapshot = database.query(
    "SELECT revision, data, data_hash FROM journal_snapshots WHERE address = ?",
  );
  const selectAnchor = database.query(
    `SELECT revision, position FROM journal_commits
     WHERE address = ? AND revision = ? AND position = ?`,
  );
  const upsertSnapshot = database.query(
    `INSERT INTO journal_snapshots
       (address, revision, data, data_hash)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(address) DO UPDATE SET
       revision = excluded.revision,
       data = excluded.data,
       data_hash = excluded.data_hash`,
  );
  const selectAllRecords = database.query(
    `SELECT address, position, revision, data, data_hash
     FROM journal_records ORDER BY position`,
  );
  const selectAllSnapshots = database.query(
    "SELECT address, revision, data, data_hash FROM journal_snapshots ORDER BY address",
  );
  const selectAllHeads = database.query(
    "SELECT address, revision, position FROM journal_heads ORDER BY address",
  );
  const selectRetentionRequirements = database.query(
    `SELECT address, max(revision) AS revision
     FROM journal_records WHERE position <= ? GROUP BY address`,
  );
  const deleteRetainedRecords = database.query("DELETE FROM journal_records WHERE position <= ?");
  const updateRetainedFloor = database.query(
    "UPDATE journal_meta SET retained_floor = ? WHERE singleton = 1",
  );
  const selectIntegrity = database.query("PRAGMA integrity_check");
  const vacuumInto = database.query("VACUUM INTO ?");
  const statements = [
    selectHead,
    selectReceipt,
    selectRecords,
    selectGlobal,
    selectPosition,
    selectRetainedFloor,
    insertRecord,
    insertReceipt,
    insertCommit,
    upsertHead,
    updateHighWater,
    selectSnapshot,
    selectAnchor,
    upsertSnapshot,
    selectAllRecords,
    selectAllSnapshots,
    selectAllHeads,
    selectRetentionRequirements,
    deleteRetainedRecords,
    updateRetainedFloor,
    selectIntegrity,
    vacuumInto,
  ] as const;

  const subscriptions = new Set<SqliteSubscription>();
  const pending: PendingAppend[] = [];
  let flushScheduled = false;
  let closing = false;
  let closed = false;

  const getHead = (key: string): JournalHead => {
    const row = selectHead.get(key) as HeadRow | null;
    return row ? { revision: row.revision, position: row.position } : emptyJournalHead;
  };

  const readResource = <Record extends CommandRecord, State>(address: ResourceAddress) => {
    const key = addressKey(address);
    const row = selectSnapshot.get(key) as SnapshotRow | null;
    const snapshot = row ? decodeSnapshot<State>(row) : null;
    if (snapshot && addressKey(snapshot.address) !== key) {
      throw new JournalCorruptionError(`Snapshot address does not match ${key}.`);
    }
    const rows = selectRecords.all(key, snapshot?.revision ?? 0) as RecordRow[];
    const records = rows.map((record) => decodeRecord<Record>(record));
    const head = getHead(key);
    assertResourceHistory(key, snapshot, records, head);
    return { snapshot, records, head };
  };

  const applyAppend = (input: JournalAppend<CommandRecord>): CommitOutcome => {
    const key = addressKey(input.address);
    const receipt = selectReceipt.get(key, input.record.intent.id) as RecordRow | null;
    if (receipt) {
      const existing = decodeRecord(receipt);
      if (existing.intent.inputHash !== input.record.intent.inputHash) {
        return { ok: false, error: new IntentMismatchError(input.record.intent.id) };
      }
      return { ok: true, result: { status: "duplicate", record: existing } };
    }

    const head = getHead(key);
    if (!sameHead(head, input.expected)) {
      return { ok: true, result: { status: "conflict", head } };
    }

    const currentPosition = (selectPosition.get() as PositionRow).position;
    const position = currentPosition + 1;
    const committed: CommittedCommandRecord<CommandRecord> = {
      ...input.record,
      address: input.address,
      revision: head.revision + 1,
      position,
      committedAt: input.committedAt ?? Date.now(),
    };
    const encoded = encodeJournalValue(committed);
    insertRecord.run(
      position,
      key,
      committed.revision,
      input.record.intent.id,
      encoded,
      hashEncoded(encoded),
    );
    const hash = hashEncoded(encoded);
    insertReceipt.run(key, input.record.intent.id, encoded, hash);
    insertCommit.run(key, committed.revision, position);
    upsertHead.run(key, committed.revision, position);
    updateHighWater.run(position);
    return { ok: true, result: { status: "committed", record: committed } };
  };

  const commit = database.transaction((inputs: readonly JournalAppend<CommandRecord>[]) =>
    inputs.map(applyAppend),
  );

  const notifyCommitted = (outcomes: readonly CommitOutcome[]): void => {
    for (const outcome of outcomes) {
      if (!outcome.ok || outcome.result.status !== "committed") continue;
      for (const subscription of subscriptions) {
        if (outcome.result.record.position > subscription.after) wake(subscription);
      }
    }
  };

  const commitNow = (inputs: readonly JournalAppend<CommandRecord>[]): CommitOutcome[] => {
    const outcomes = commit.immediate(inputs);
    notifyCommitted(outcomes);
    return outcomes;
  };

  const flushOnce = (): void => {
    flushScheduled = false;
    if (pending.length === 0) return;
    const batch = pending.splice(0, groupMax);
    try {
      const outcomes = commitNow(batch.map((entry) => entry.input));
      for (const [index, outcome] of outcomes.entries()) {
        const entry = batch[index]!;
        if (outcome.ok) entry.resolve(outcome.result);
        else entry.reject(outcome.error);
      }
    } catch (error) {
      for (const entry of batch) entry.reject(normalizeSqliteError(error));
    }
    if (pending.length > 0) scheduleFlush();
  };

  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flushOnce);
  }

  const flushPending = (): void => {
    while (pending.length > 0) flushOnce();
  };

  const save = database.transaction(<State>(snapshot: JournalSnapshot<State>) => {
    const key = addressKey(snapshot.address);
    const current = selectSnapshot.get(key) as SnapshotRow | null;
    if (current && current.revision >= snapshot.revision) return "stale" as const;
    const anchor =
      snapshot.revision === 0
        ? null
        : (selectAnchor.get(key, snapshot.revision, snapshot.position) as HeadRow | null);
    const anchored =
      snapshot.revision === 0
        ? snapshot.position === 0
        : anchor !== null && anchor.revision === snapshot.revision;
    if (!anchored) throw new SnapshotAnchorError();
    const encoded = encodeJournalValue(snapshot);
    upsertSnapshot.run(key, snapshot.revision, encoded, hashEncoded(encoded));
    return "saved" as const;
  });

  const retain = database.transaction((position: number) => {
    const floor = (selectRetainedFloor.get() as PositionRow).position;
    const highWater = (selectPosition.get() as PositionRow).position;
    if (!Number.isSafeInteger(position) || position < floor || position > highWater) {
      throw new RangeError("Retention position must be between the retained floor and high water.");
    }
    for (const requirement of selectRetentionRequirements.all(
      position,
    ) as RetentionRequirementRow[]) {
      const snapshot = selectSnapshot.get(requirement.address) as SnapshotRow | null;
      if (!snapshot || snapshot.revision < requirement.revision) {
        throw new Error(
          `Cannot retain through ${position}; Resource ${requirement.address} has no covering snapshot.`,
        );
      }
    }
    deleteRetainedRecords.run(position);
    updateRetainedFloor.run(position);
  });

  const journal: SqliteJournal = {
    async position() {
      ensureOpen();
      flushPending();
      return withSqliteErrors(() => (selectPosition.get() as PositionRow).position);
    },
    async load<Record extends CommandRecord, State>(address: ResourceAddress) {
      ensureOpen();
      return withSqliteErrors(() => readResource<Record, State>(address));
    },
    async append<Record extends CommandRecord>(input: JournalAppend<Record>) {
      ensureOpen();
      assertHead(input.expected);
      assertCommandRecord(input.record);
      assertCommittedAt(input.committedAt);
      if (commitMode === "immediate") {
        const outcome = withSqliteErrors(() => commitNow([input])[0]!);
        if (!outcome.ok) throw outcome.error;
        return outcome.result as JournalAppendResult<Record>;
      }
      return new Promise<JournalAppendResult<Record>>((resolve, reject) => {
        pending.push({
          input: input as JournalAppend<CommandRecord>,
          resolve: resolve as (result: JournalAppendResult<CommandRecord>) => void,
          reject,
        });
        scheduleFlush();
      });
    },
    async receipt<Record extends CommandRecord>(address: ResourceAddress, intentId: string) {
      ensureOpen();
      const row = withSqliteErrors(
        () => selectReceipt.get(addressKey(address), intentId) as RecordRow | null,
      );
      return row ? decodeRecord<Record>(row) : null;
    },
    async *addresses() {
      ensureOpen();
      const seen = new Set<string>();
      for (const row of withSqliteErrors(() => selectAllRecords.all() as StoredRecordRow[])) {
        const address = decodeRecord(row).address;
        const key = addressKey(address);
        if (seen.has(key)) continue;
        seen.add(key);
        yield address;
      }
      for (const row of withSqliteErrors(() => selectAllSnapshots.all() as StoredSnapshotRow[])) {
        const address = decodeSnapshot(row).address;
        const key = addressKey(address);
        if (seen.has(key)) continue;
        seen.add(key);
        yield address;
      }
    },
    async *scan<Record extends CommandRecord>(after: number) {
      ensureOpen();
      let cursor = after;
      for (;;) {
        const rows = withSqliteErrors(() => selectGlobal.all(cursor, scanBatchSize) as RecordRow[]);
        if (rows.length === 0) return;
        for (const row of rows) {
          const record = decodeRecord<Record>(row);
          cursor = record.position;
          yield record;
        }
      }
    },
    async subscribe<Record extends CommandRecord>(
      after: number,
      receive: (record: CommittedCommandRecord<Record>) => void | Promise<void>,
    ) {
      ensureOpen();
      const deferred = Promise.withResolvers<void>();
      const subscription: SqliteSubscription = {
        after,
        receive: receive as (record: CommittedCommandRecord) => void | Promise<void>,
        read: () =>
          withSqliteErrors(() =>
            (selectGlobal.all(subscription.after, scanBatchSize) as RecordRow[]).map((row) =>
              decodeRecord(row),
            ),
          ),
        dispose: () => subscriptions.delete(subscription),
        notified: false,
        running: false,
        stopped: false,
        resolve: deferred.resolve,
        reject: deferred.reject,
      };
      subscriptions.add(subscription);
      wake(subscription);
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
      ensureOpen();
      assertSnapshot(snapshot);
      return withSqliteErrors(() => save.immediate(snapshot));
    },
    checkpoint() {
      ensureOpen();
      flushPending();
      withSqliteErrors(() => database.exec("PRAGMA wal_checkpoint(PASSIVE)"));
    },
    retainedFloor() {
      ensureOpen();
      flushPending();
      return withSqliteErrors(() => (selectRetainedFloor.get() as PositionRow).position);
    },
    retainThrough(position) {
      ensureOpen();
      flushPending();
      withSqliteErrors(() => retain.immediate(position));
    },
    verify() {
      ensureOpen();
      flushPending();
      const integrity = withSqliteErrors(() => selectIntegrity.all() as IntegrityRow[]);
      if (integrity.length === 0 || integrity.some((row) => row.integrity_check !== "ok")) {
        throw new JournalCorruptionError(
          `SQLite integrity check failed: ${integrity.map((row) => row.integrity_check).join("; ")}`,
        );
      }

      const addresses = new Set<string>();
      const floor = (selectRetainedFloor.get() as PositionRow).position;
      const highWater = (selectPosition.get() as PositionRow).position;
      let position = floor;
      const storedRecords = selectAllRecords.all() as StoredRecordRow[];
      const storedSnapshots = selectAllSnapshots.all() as StoredSnapshotRow[];
      const storedHeads = selectAllHeads.all() as StoredHeadRow[];
      const firstRecordByAddress = new Map<string, StoredRecordRow>();
      const snapshotByAddress = new Map<string, StoredSnapshotRow>();
      for (const row of storedRecords) {
        const record = decodeRecord(row);
        if (
          addressKey(record.address) !== row.address ||
          record.position !== row.position ||
          record.revision !== row.revision
        ) {
          throw new JournalCorruptionError("A journal record disagrees with its index columns.");
        }
        if (row.position !== position + 1) {
          throw new JournalCorruptionError(
            `Journal is not contiguous at position ${row.position}.`,
          );
        }
        position = row.position;
        addresses.add(row.address);
        if (!firstRecordByAddress.has(row.address)) firstRecordByAddress.set(row.address, row);
      }
      if (position !== highWater) {
        throw new JournalCorruptionError("Journal high water does not match retained history.");
      }

      for (const row of storedSnapshots) {
        const snapshot = decodeSnapshot(row);
        if (addressKey(snapshot.address) !== row.address || snapshot.revision !== row.revision) {
          throw new JournalCorruptionError("A snapshot disagrees with its index columns.");
        }
        addresses.add(row.address);
        snapshotByAddress.set(row.address, row);
      }

      for (const row of storedHeads) addresses.add(row.address);

      for (const key of addresses) {
        const recordRow = firstRecordByAddress.get(key);
        const snapshotRow = snapshotByAddress.get(key);
        const encodedAddress = snapshotRow
          ? decodeSnapshot(snapshotRow).address
          : recordRow
            ? decodeRecord(recordRow).address
            : null;
        if (!encodedAddress) {
          throw new JournalCorruptionError(`Resource ${key} has incomplete journal indexes.`);
        }
        readResource(encodedAddress);
      }
    },
    backup(file: string) {
      ensureOpen();
      flushPending();
      if (existsSync(file)) {
        throw new DurabilityError("unavailable", "Journal backup destination already exists.", {
          retryable: false,
        });
      }
      mkdirSync(dirname(file), { recursive: true });
      const temporary = `${file}.backup-${randomUUID()}`;
      try {
        const contents = withSqliteErrors(() => {
          vacuumInto.run(temporary);
          const verification = new Database(temporary, { readonly: true, strict: true });
          try {
            const statement = verification.prepare("PRAGMA integrity_check");
            const integrity = statement.all() as IntegrityRow[];
            statement.finalize();
            if (integrity.length === 0 || integrity.some((row) => row.integrity_check !== "ok")) {
              throw new JournalCorruptionError("SQLite rejected the physical backup.");
            }
          } finally {
            verification.close();
          }
          return readFileSync(temporary);
        });
        withSqliteErrors(() => linkSync(temporary, file));
        return {
          bytes: contents.byteLength,
          sha256: createHash("sha256").update(contents).digest("hex"),
        };
      } finally {
        rmSync(temporary, { force: true });
        rmSync(`${temporary}-wal`, { force: true });
        rmSync(`${temporary}-shm`, { force: true });
      }
    },
    async close() {
      if (closed || closing) return;
      closing = true;
      flushPending();
      for (const subscription of subscriptions) {
        subscription.stopped = true;
        subscription.resolve();
      }
      subscriptions.clear();
      withSqliteErrors(() => {
        for (const statement of statements) statement.finalize();
        database.exec("PRAGMA locking_mode = NORMAL");
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        database.close();
      });
      closed = true;
      closing = false;
    },
  };
  return journal;

  function ensureOpen(): void {
    if (closed || closing) {
      throw new DurabilityError("closed", "Journal is closed.", { retryable: false });
    }
  }
}

function wake(subscription: SqliteSubscription): void {
  if (subscription.stopped) return;
  subscription.notified = true;
  if (subscription.running) return;
  subscription.running = true;
  void (async () => {
    try {
      while (!subscription.stopped && subscription.notified) {
        subscription.notified = false;
        let advanced = false;
        for (const record of subscription.read()) {
          if (subscription.stopped || record.position <= subscription.after) continue;
          await subscription.receive(record);
          subscription.after = record.position;
          advanced = true;
        }
        if (advanced) subscription.notified = true;
      }
    } catch (error) {
      subscription.stopped = true;
      subscription.dispose();
      subscription.reject(normalizeSqliteError(error));
    } finally {
      subscription.running = false;
    }
  })();
}

function withSqliteErrors<Result>(operation: () => Result): Result {
  try {
    return operation();
  } catch (error) {
    throw normalizeSqliteError(error);
  }
}

function normalizeSqliteError(error: unknown): Error {
  if (
    isDurabilityError(error) ||
    error instanceof IntentMismatchError ||
    error instanceof SnapshotAnchorError ||
    error instanceof TypeError ||
    error instanceof RangeError
  ) {
    return error;
  }
  if (error instanceof SQLiteError) {
    const code = error.errno & 0xff;
    if (code === 5 || code === 6) {
      return new DurabilityError("busy", `Journal storage is busy: ${error.message}`, {
        cause: error,
      });
    }
    if (code === 13) {
      return new DurabilityError("capacity", `Journal storage is full: ${error.message}`, {
        cause: error,
        retryable: false,
      });
    }
    if (code === 11 || code === 26) {
      return new JournalCorruptionError(`Journal storage is corrupt: ${error.message}`);
    }
    return new DurabilityError("unavailable", `Journal storage failed: ${error.message}`, {
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DurabilityError("unavailable", `Journal storage failed: ${message}`, { cause: error });
}

function decodeRecord<Record extends CommandRecord>(
  row: RecordRow,
): CommittedCommandRecord<Record> {
  assertEncoded(row);
  try {
    const value = JSON.parse(row.data) as CommittedCommandRecord<Record>;
    assertDecodedRecord(value);
    return value;
  } catch (error) {
    if (error instanceof JournalCorruptionError) throw error;
    throw new JournalCorruptionError(`Invalid journal record: ${errorMessage(error)}`);
  }
}

function decodeSnapshot<State>(row: RecordRow): JournalSnapshot<State> {
  assertEncoded(row);
  try {
    const value = JSON.parse(row.data) as JournalSnapshot<State>;
    assertSnapshot(value);
    return value;
  } catch (error) {
    if (error instanceof JournalCorruptionError) throw error;
    throw new JournalCorruptionError(`Invalid journal snapshot: ${errorMessage(error)}`);
  }
}

function assertDecodedRecord(value: CommittedCommandRecord): void {
  assertCommandRecord(value);
  assertHead({ revision: value.revision, position: value.position });
  if (!Number.isSafeInteger(value.committedAt) || value.committedAt < 0) {
    throw new Error("Corrupt journal record timestamp.");
  }
  addressKey(value.address);
}

function hashEncoded(encoded: string): string {
  return createHash("sha256").update(encoded).digest("hex");
}

function assertEncoded(row: RecordRow): void {
  if (hashEncoded(row.data) !== row.data_hash) {
    throw new JournalCorruptionError("A journal value failed its checksum.");
  }
}

function assertResourceHistory(
  key: string,
  snapshot: JournalSnapshot | null,
  records: readonly CommittedCommandRecord[],
  head: JournalHead,
): void {
  let revision = snapshot?.revision ?? 0;
  let position = snapshot?.position ?? 0;
  for (const record of records) {
    if (
      addressKey(record.address) !== key ||
      record.revision !== revision + 1 ||
      record.position <= position
    ) {
      throw new JournalCorruptionError(`Resource ${key} has a discontinuous journal history.`);
    }
    revision = record.revision;
    position = record.position;
  }
  if (revision !== head.revision || position !== head.position) {
    throw new JournalCorruptionError(`Resource ${key} head does not match its history.`);
  }
}

function claimDatabase(database: Database): void {
  const applicationId = (database.query("PRAGMA application_id").get() as ApplicationIdRow)
    .application_id;
  if (applicationId !== 0 && applicationId !== 1_347_372_871) {
    throw new JournalCorruptionError("SQLite file belongs to another application.");
  }
  const userVersion = (database.query("PRAGMA user_version").get() as UserVersionRow).user_version;
  if (applicationId === 1_347_372_871 && userVersion !== 3) {
    throw new JournalCorruptionError(
      `Unsupported Poggers journal schema ${userVersion}; restore a current logical export or recreate the journal.`,
    );
  }
  const tableCount = (
    database
      .query(
        "SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get() as CountRow
  ).count;
  if (applicationId === 0 && tableCount !== 0) {
    throw new JournalCorruptionError("SQLite file is not an empty Poggers journal.");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
