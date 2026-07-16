import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";

import {
  DurabilityError,
  defaultDurabilityProfile,
  parseDurabilityProfile,
} from "#substrate/durability";
import {
  IntentMismatchError,
  JournalCorruptionError,
  SnapshotAnchorError,
  createMemoryJournal,
  emptyJournalHead,
  exportJournal,
  type CommandRecord,
  type Journal,
  type JournalHead,
  type JournalSnapshot,
  type ResourceAddress,
} from "#substrate/journal";
import { createSqliteJournal, restoreSqliteJournalBackup } from "#substrate/journal.sqlite";

type CounterRecord = CommandRecord<
  { command: "add"; amount: number },
  | { ok: true; output: number; events: readonly [{ type: "added"; amount: number }] }
  | { ok: false; error: "forbidden" }
>;

const address: ResourceAddress = { resource: "counter", key: { id: "primary" } };

test("runtime durability profiles describe guarantees without naming an adapter", () => {
  expect(defaultDurabilityProfile).toBe("power-safe");
  expect(parseDurabilityProfile(undefined)).toBe("power-safe");
  expect(parseDurabilityProfile("process-safe")).toBe("process-safe");
  expect(() => parseDurabilityProfile("normal")).toThrow(
    'Durability must be "power-safe" or "process-safe"',
  );
});

function record(id: string, amount: number, inputHash = `hash-${id}`): CounterRecord {
  return {
    schema: "counter-v1",
    intent: { id, inputHash, value: { command: "add", amount } },
    decision: {
      ok: true,
      output: amount,
      events: [{ type: "added", amount }],
    },
  };
}

function head(record: { revision: number; position: number }): JournalHead {
  return { revision: record.revision, position: record.position };
}

function describeJournal(
  name: string,
  create: () => Journal | Promise<Journal>,
  timeout = 5_000,
): void {
  describe(name, () => {
    let journal: Journal;

    beforeAll(async () => {
      journal = await create();
    });

    afterAll(async () => {
      await journal.close();
    });

    test(
      "commits one atomic decision, fences stale heads, and keeps permanent receipts",
      async () => {
        const first = await journal.append({
          address,
          expected: emptyJournalHead,
          record: record("client/1", 2),
        });
        expect(first.status).toBe("committed");
        if (first.status === "conflict") throw new Error("unexpected conflict");

        const stale = await journal.append({
          address,
          expected: emptyJournalHead,
          record: record("client/2", 3),
        });
        expect(stale).toEqual({ status: "conflict", head: head(first.record) });

        const second = await journal.append({
          address,
          expected: head(first.record),
          record: record("client/2", 3),
        });
        expect(second.status).toBe("committed");
        if (second.status === "conflict") throw new Error("unexpected conflict");

        const duplicate = await journal.append({
          address,
          expected: head(second.record),
          record: record("client/1", 999),
        });
        expect(duplicate.status).toBe("duplicate");
        if (duplicate.status === "conflict") throw new Error("unexpected conflict");
        expect(duplicate.record.decision).toEqual(first.record.decision);
        expect(duplicate.record.position).toBe(first.record.position);

        await expect(
          journal.append({
            address,
            expected: head(second.record),
            record: record("client/1", 999, "different-input"),
          }),
        ).rejects.toBeInstanceOf(IntentMismatchError);

        const loaded = await journal.load<CounterRecord>(address);
        expect(loaded.head).toEqual(head(second.record));
        expect(loaded.records.map((entry) => entry.intent.id)).toEqual(["client/1", "client/2"]);
        expect((await journal.receipt(address, "client/1"))?.position).toBe(first.record.position);

        const scanned = [];
        for await (const entry of journal.scan<CounterRecord>(0)) {
          scanned.push(entry.intent.id);
        }
        expect(scanned).toEqual(["client/1", "client/2"]);
      },
      timeout,
    );
  });
}

describeJournal("memory journal", () => createMemoryJournal());

const sqliteDirectory = mkdtempSync(join(tmpdir(), "poggers-sqlite-journal-"));
const sqliteFile = join(sqliteDirectory, "journal.sqlite");
afterAll(() => rmSync(sqliteDirectory, { recursive: true, force: true }));
describeJournal("SQLite journal", () =>
  createSqliteJournal({ file: sqliteFile, durability: "strict" }),
);

describe("journal model conformance", () => {
  test("memory preserves the command model for generated duplicate and conflict schedules", async () => {
    await assertGeneratedSchedules(() => createMemoryJournal(), 100);
  });

  test("SQLite preserves the command model for generated duplicate and conflict schedules", async () => {
    await assertGeneratedSchedules(() => {
      const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-model-"));
      return {
        journal: createSqliteJournal({
          file: join(directory, "journal.sqlite"),
        }),
        cleanup: () => rmSync(directory, { recursive: true, force: true }),
      };
    }, 25);
  });
});

describe("snapshots and ordered subscriptions", () => {
  test("loads a verified snapshot plus only its journal tail", async () => {
    const journal = createMemoryJournal();
    const first = await journal.append({
      address,
      expected: emptyJournalHead,
      record: record("snapshot/1", 1),
    });
    if (first.status === "conflict") throw new Error("unexpected conflict");
    const snapshot: JournalSnapshot<{ count: number }> = {
      address,
      revision: first.record.revision,
      position: first.record.position,
      schema: "counter-v1",
      stateHash: "state-at-one",
      state: { count: 1 },
      storedAt: Date.now(),
    };
    expect(await journal.saveSnapshot(snapshot)).toBe("saved");

    const second = await journal.append({
      address,
      expected: head(first.record),
      record: record("snapshot/2", 2),
    });
    if (second.status === "conflict") throw new Error("unexpected conflict");
    const loaded = await journal.load<CounterRecord, { count: number }>(address);
    expect(loaded.snapshot?.state).toEqual({ count: 1 });
    expect(loaded.records.map((entry) => entry.intent.id)).toEqual(["snapshot/2"]);
    expect(loaded.head).toEqual(head(second.record));
    expect(await journal.saveSnapshot(snapshot)).toBe("stale");

    await expect(
      journal.saveSnapshot({ ...snapshot, revision: 9, position: 99, stateHash: "invalid" }),
    ).rejects.toBeInstanceOf(SnapshotAnchorError);
    await journal.close();
  });

  test("delivers catch-up and live records once in global order", async () => {
    const journal = createMemoryJournal();
    const first = await journal.append({
      address,
      expected: emptyJournalHead,
      record: record("subscription/1", 1),
    });
    if (first.status === "conflict") throw new Error("unexpected conflict");
    const received: string[] = [];
    const subscription = await journal.subscribe<CounterRecord>(0, (entry) => {
      received.push(entry.intent.id);
    });
    await waitFor(() => received.length === 1);
    await journal.append({
      address,
      expected: head(first.record),
      record: record("subscription/2", 2),
    });
    await waitFor(() => received.length === 2);
    expect(received).toEqual(["subscription/1", "subscription/2"]);
    await subscription.stop();
    await journal.close();
  });

  test("pages a large SQLite catch-up without truncating subscription delivery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-subscription-"));
    const journal = createSqliteJournal({
      file: join(directory, "journal.sqlite"),
    });
    await Promise.all(
      Array.from({ length: 700 }, (_, index) =>
        journal.append({
          address: { resource: "counter", key: { id: index } },
          expected: emptyJournalHead,
          record: record(`paged/${index}`, index),
        }),
      ),
    );
    const received: number[] = [];
    const subscription = await journal.subscribe(0, (entry) => {
      received.push(entry.position);
    });
    await waitFor(() => received.length === 700);
    expect(received).toEqual(Array.from({ length: 700 }, (_, index) => index + 1));
    await subscription.stop();
    await journal.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("SQLite recovery", () => {
  test("uses only the indexes required by Journal operations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-indexes-"));
    const file = join(directory, "journal.sqlite");
    const journal = createSqliteJournal({ file });
    await journal.close();
    const database = new Database(file);
    const recordIndexes = database.query("PRAGMA index_list(journal_records)").all() as Array<{
      unique: number;
      origin: string;
    }>;
    const snapshotIndexes = database.query("PRAGMA index_list(journal_snapshots)").all() as Array<{
      unique: number;
      origin: string;
    }>;
    const plans = [
      "SELECT revision, position FROM journal_heads WHERE address = ?",
      "SELECT data, data_hash FROM journal_receipts WHERE address = ? AND intent_id = ?",
      "SELECT data, data_hash FROM journal_records WHERE address = ? AND revision > ? ORDER BY revision",
      "SELECT data, data_hash FROM journal_records WHERE position > ? ORDER BY position LIMIT ?",
      "SELECT revision, data, data_hash FROM journal_snapshots WHERE address = ?",
    ].map((sql) =>
      (database.query(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map(
        ({ detail }) => detail,
      ),
    );
    database.close();

    expect(recordIndexes).toHaveLength(2);
    expect(recordIndexes.every((index) => index.unique === 1 && index.origin === "u")).toBe(true);
    expect(snapshotIndexes).toEqual([expect.objectContaining({ unique: 1, origin: "pk" })]);
    for (const plan of plans) {
      expect(plan.some((detail) => detail.startsWith("SEARCH"))).toBe(true);
      expect(plan.some((detail) => detail.includes("SCAN"))).toBe(false);
    }
    rmSync(directory, { recursive: true, force: true });
  });

  test("fails closed on an obsolete schema without retaining its authority lock", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-obsolete-"));
    const file = join(directory, "journal.sqlite");
    const database = new Database(file, { create: true });
    database.exec("PRAGMA application_id = 1347372871");
    database.exec("PRAGMA user_version = 1");
    database.close();

    expect(() => createSqliteJournal({ file })).toThrow("recreate the journal");
    const repaired = new Database(file);
    repaired.exec("PRAGMA user_version = 3");
    repaired.close();
    const successor = createSqliteJournal({ file });
    await successor.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("normalizes malformed files and unavailable paths", () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-failures-"));
    const malformed = join(directory, "malformed.sqlite");
    writeFileSync(malformed, "this is not sqlite");

    const corrupt = captureError(() => createSqliteJournal({ file: malformed }));
    expect(corrupt).toBeInstanceOf(DurabilityError);
    expect((corrupt as DurabilityError).failure).toBe("corrupt");

    const unavailable = captureError(() =>
      createSqliteJournal({ file: join(directory, "missing", "journal.sqlite") }),
    );
    expect(unavailable).toBeInstanceOf(DurabilityError);
    expect((unavailable as DurabilityError).failure).toBe("unavailable");
    rmSync(directory, { recursive: true, force: true });
  });

  test("holds one exclusive authority lock for a journal file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-owner-"));
    const file = join(directory, "journal.sqlite");
    const owner = createSqliteJournal({ file });
    let locked: unknown;
    try {
      createSqliteJournal({ file });
    } catch (error) {
      locked = error;
    }
    expect(locked).toBeInstanceOf(DurabilityError);
    expect((locked as DurabilityError).failure).toBe("busy");
    expect((locked as DurabilityError).retryable).toBeTrue();
    await owner.close();
    const successor = createSqliteJournal({ file });
    await successor.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("fails a capacity-bound append atomically and preserves the last complete head", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-capacity-"));
    const file = join(directory, "journal.sqlite");
    const journal = createSqliteJournal({
      file,
      commit: "immediate",
      maxBytes: 256 * 1024,
    });
    let expected = emptyJournalHead;
    let committed = 0;
    let failure: unknown;
    for (let index = 0; index < 100; index++) {
      const base = record(`capacity/${index}`, index);
      try {
        const result = await journal.append({
          address,
          expected,
          record: {
            ...base,
            intent: {
              ...base.intent,
              value: { ...base.intent.value, padding: "x".repeat(12 * 1024) },
            },
          },
        });
        if (result.status === "conflict") throw new Error("unexpected conflict");
        expected = head(result.record);
        committed++;
      } catch (error) {
        failure = error;
        break;
      }
    }

    expect(committed).toBeGreaterThan(0);
    expect(failure).toBeInstanceOf(DurabilityError);
    expect((failure as DurabilityError).failure).toBe("capacity");
    expect((failure as DurabilityError).retryable).toBeFalse();
    const loaded = await journal.load(address);
    expect(loaded.head).toEqual(expected);
    expect(loaded.records).toHaveLength(committed);
    journal.verify();
    await journal.close();

    const reopened = createSqliteJournal({ file });
    reopened.verify();
    expect((await reopened.load(address)).head).toEqual(expected);
    await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("normalizes an isolated filesystem write failure without publishing a partial decision", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-io-"));
    const file = join(directory, "journal.sqlite");
    const scriptFile = join(directory, "writer.ts");
    const moduleUrl = new URL("./journal.sqlite.ts", import.meta.url).href;
    const contractUrl = new URL("./journal.ts", import.meta.url).href;
    await Bun.write(
      scriptFile,
      `
        import { createSqliteJournal } from ${JSON.stringify(moduleUrl)};
        import { emptyJournalHead } from ${JSON.stringify(contractUrl)};
        const address = { resource: "io", key: "main" };
        const journal = createSqliteJournal({ file: ${JSON.stringify(file)}, commit: "immediate" });
        let expected = emptyJournalHead;
        try {
          for (let index = 0; index < 100; index++) {
            const result = await journal.append({
              address,
              expected,
              record: {
                schema: "io-v1",
                intent: {
                  id: "io/" + index,
                  inputHash: "io/" + index,
                  value: { padding: "x".repeat(12 * 1024) },
                },
                decision: { ok: true, events: [] },
              },
            });
            if (result.status === "committed") {
              expected = { revision: result.record.revision, position: result.record.position };
            }
          }
        } catch (error) {
          process.stdout.write(JSON.stringify({ failure: error.failure, message: error.message }));
        }
      `,
    );
    const child = Bun.spawn(
      [
        "zsh",
        "-c",
        `ulimit -f 512; exec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptFile)}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(child.stdout).text();
    const errorOutput = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(errorOutput).toBe("");
    expect(JSON.parse(output)).toEqual({
      failure: "unavailable",
      message: expect.stringContaining("disk I/O error"),
    });

    const reopened = createSqliteJournal({ file });
    reopened.verify();
    const loaded = await reopened.load({ resource: "io", key: "main" });
    for (const [index, entry] of loaded.records.entries()) {
      expect(entry.revision).toBe(index + 1);
      expect(entry.position).toBe(index + 1);
    }
    expect(loaded.head.revision).toBe(loaded.records.length);
    await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("group-commits a concurrent burst without changing per-Resource ordering", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-group-"));
    const journal = createSqliteJournal({
      file: join(directory, "journal.sqlite"),
      groupMax: 32,
    });
    const addresses = Array.from(
      { length: 257 },
      (_, index) => ({ resource: "counter", key: { id: index } }) satisfies ResourceAddress,
    );
    const results = await Promise.all(
      addresses.map((current, index) =>
        journal.append({
          address: current,
          expected: emptyJournalHead,
          record: record(`group/${index}`, index),
        }),
      ),
    );
    expect(results.every((result) => result.status === "committed")).toBe(true);
    for (const current of addresses) {
      const loaded = await journal.load<CounterRecord>(current);
      expect(loaded.head.revision).toBe(1);
      expect(loaded.records).toHaveLength(1);
    }
    await journal.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("reopens with the exact head, receipt, snapshot, and tail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-reopen-"));
    const file = join(directory, "journal.sqlite");
    const first = createSqliteJournal({ file });
    const committed = await first.append({
      address,
      expected: emptyJournalHead,
      record: record("restart/1", 4),
    });
    if (committed.status === "conflict") throw new Error("unexpected conflict");
    await first.saveSnapshot({
      address,
      revision: committed.record.revision,
      position: committed.record.position,
      schema: "counter-v1",
      stateHash: "restart-state",
      state: { count: 4 },
      storedAt: Date.now(),
    });
    await first.close();

    const reopened = createSqliteJournal({ file });
    const loaded = await reopened.load<CounterRecord, { count: number }>(address);
    expect(loaded.head).toEqual(head(committed.record));
    expect(loaded.snapshot?.state).toEqual({ count: 4 });
    expect(loaded.records).toEqual([]);
    expect((await reopened.receipt(address, "restart/1"))?.decision).toEqual(
      committed.record.decision,
    );
    await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("reclaims covered replay rows without losing heads, receipts, or monotonic positions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-retention-"));
    const file = join(directory, "journal.sqlite");
    const journal = createSqliteJournal({ file, commit: "immediate" });
    const first = await journal.append({
      address,
      expected: emptyJournalHead,
      record: record("retention/1", 1),
    });
    if (first.status === "conflict") throw new Error("unexpected conflict");
    const second = await journal.append({
      address,
      expected: head(first.record),
      record: record("retention/2", 2),
    });
    if (second.status === "conflict") throw new Error("unexpected conflict");
    await journal.saveSnapshot({
      address,
      revision: second.record.revision,
      position: second.record.position,
      schema: "counter-v1",
      stateHash: "retained-state",
      state: { count: 3 },
      storedAt: Date.now(),
    });
    const third = await journal.append({
      address,
      expected: head(second.record),
      record: record("retention/3", 3),
    });
    if (third.status === "conflict") throw new Error("unexpected conflict");

    journal.retainThrough(second.record.position);
    expect(journal.retainedFloor()).toBe(second.record.position);
    expect(await journal.position()).toBe(third.record.position);
    expect((await journal.receipt(address, "retention/1"))?.decision).toEqual(
      first.record.decision,
    );
    const retained = await journal.load<CounterRecord, { count: number }>(address);
    expect(retained.snapshot?.state).toEqual({ count: 3 });
    expect(retained.records.map((entry) => entry.intent.id)).toEqual(["retention/3"]);
    expect(retained.head).toEqual(head(third.record));
    await expect(exportJournal(journal)).rejects.toThrow("requires complete history");

    const fourth = await journal.append({
      address,
      expected: head(third.record),
      record: record("retention/4", 4),
    });
    if (fourth.status === "conflict") throw new Error("unexpected conflict");
    expect(fourth.record.position).toBe(third.record.position + 1);
    journal.verify();
    await journal.close();

    const reopened = createSqliteJournal({ file });
    expect(reopened.retainedFloor()).toBe(second.record.position);
    expect((await reopened.receipt(address, "retention/1"))?.position).toBe(first.record.position);
    expect((await reopened.load(address)).head).toEqual(head(fourth.record));
    reopened.verify();
    await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("refuses to reclaim Resource history without a covering snapshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-retention-guard-"));
    const journal = createSqliteJournal({ file: join(directory, "journal.sqlite") });
    const committed = await journal.append({
      address,
      expected: emptyJournalHead,
      record: record("retention/guard", 1),
    });
    if (committed.status === "conflict") throw new Error("unexpected conflict");
    expect(() => journal.retainThrough(committed.record.position)).toThrow("covering snapshot");
    expect(journal.retainedFloor()).toBe(0);
    expect((await journal.load(address)).records).toHaveLength(1);
    await journal.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("creates a consistent online backup with the same snapshot and tail", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-backup-"));
    const file = join(directory, "journal.sqlite");
    const backupFile = join(directory, "backup", "journal.sqlite");
    const restoredFile = join(directory, "restored", "journal.sqlite");
    const journal = createSqliteJournal({ file });
    const first = await journal.append({
      address,
      expected: emptyJournalHead,
      record: record("backup/1", 1),
    });
    if (first.status === "conflict") throw new Error("unexpected conflict");
    await journal.saveSnapshot({
      address,
      revision: first.record.revision,
      position: first.record.position,
      schema: "counter-v1",
      stateHash: "backup-state",
      state: { count: 1 },
      storedAt: Date.now(),
    });
    const second = await journal.append({
      address,
      expected: head(first.record),
      record: record("backup/2", 2),
    });
    if (second.status === "conflict") throw new Error("unexpected conflict");
    journal.retainThrough(first.record.position);

    journal.verify();
    const backup = journal.backup(backupFile);
    expect(backup.bytes).toBeGreaterThan(0);
    expect(backup.sha256).toMatch(/^[0-9a-f]{64}$/);

    await restoreSqliteJournalBackup({
      backupFile,
      file: restoredFile,
      sha256: backup.sha256,
    });
    const restored = createSqliteJournal({ file: restoredFile });
    restored.verify();
    const loaded = await restored.load<CounterRecord, { count: number }>(address);
    expect(loaded.snapshot?.state).toEqual({ count: 1 });
    expect(loaded.records.map((entry) => entry.intent.id)).toEqual(["backup/2"]);
    expect(loaded.head).toEqual(head(second.record));
    expect(restored.retainedFloor()).toBe(first.record.position);
    expect((await restored.receipt(address, "backup/1"))?.position).toBe(first.record.position);
    await restored.close();
    await journal.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("does not publish a physical restore until its digest and database pass verification", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-restore-"));
    const sourceFile = join(directory, "source.sqlite");
    const backupFile = join(directory, "backup.sqlite");
    const destination = join(directory, "restored", "journal.sqlite");
    const source = createSqliteJournal({ file: sourceFile });
    await source.append({
      address,
      expected: emptyJournalHead,
      record: record("restore/1", 1),
    });
    source.backup(backupFile);
    await source.close();

    await expect(
      restoreSqliteJournalBackup({
        backupFile,
        file: destination,
        sha256: "0".repeat(64),
      }),
    ).rejects.toBeInstanceOf(JournalCorruptionError);
    expect(existsSync(destination)).toBe(false);

    writeFileSync(backupFile, "not a database");
    const malformedHash = createHash("sha256").update("not a database").digest("hex");
    await expect(
      restoreSqliteJournalBackup({
        backupFile,
        file: destination,
        sha256: malformedHash,
      }),
    ).rejects.toBeInstanceOf(DurabilityError);
    expect(existsSync(destination)).toBe(false);
    rmSync(directory, { recursive: true, force: true });
  });

  test("detects a journal value changed outside the authority", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-corruption-"));
    const file = join(directory, "journal.sqlite");
    const journal = createSqliteJournal({ file });
    await journal.append({
      address,
      expected: emptyJournalHead,
      record: record("corruption/1", 1),
    });
    await journal.close();

    const database = new Database(file);
    database.run("UPDATE journal_records SET data = data || ' '");
    database.close();

    const reopened = createSqliteJournal({ file });
    await expect(reopened.load(address)).rejects.toBeInstanceOf(JournalCorruptionError);
    expect(() => reopened.verify()).toThrow(JournalCorruptionError);
    await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("a killed writer recovers only complete decisions with contiguous revisions", async () => {
    const directory = mkdtempSync(join(tmpdir(), "poggers-sqlite-crash-"));
    const file = join(directory, "journal.sqlite");
    const moduleUrl = new URL("./journal.sqlite.ts", import.meta.url).href;
    const contractUrl = new URL("./journal.ts", import.meta.url).href;
    const script = `
      import { createSqliteJournal } from ${JSON.stringify(moduleUrl)};
      import { emptyJournalHead } from ${JSON.stringify(contractUrl)};
      const address = { resource: "crash-counter", key: { id: "primary" } };
      const journal = createSqliteJournal({ file: ${JSON.stringify(file)} });
      let expected = emptyJournalHead;
      for (let index = 0; index < 10_000; index += 1) {
        const result = await journal.append({
          address,
          expected,
          record: {
            schema: "counter-v1",
            intent: {
              id: \`crash/\${index}\`,
              inputHash: \`hash-crash/\${index}\`,
              value: { command: "add", amount: index },
            },
            decision: { ok: true, output: index, events: [{ type: "added", amount: index }] },
          },
        });
        if (result.status !== "committed") throw new Error("writer conflict");
        expected = { revision: result.record.revision, position: result.record.position };
        process.stdout.write(String(index) + "\\n");
        await Bun.sleep(1);
      }
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    let observed = 0;
    let buffered = "";
    while (observed < 20) {
      const chunk = await reader.read();
      if (chunk.done) {
        const error = await new Response(child.stderr).text();
        throw new Error(`Crash writer exited early: ${error}`);
      }
      buffered += new TextDecoder().decode(chunk.value);
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      observed += lines.filter(Boolean).length;
    }
    child.kill("SIGKILL");
    await child.exited;

    const reopened = createSqliteJournal({ file });
    const loaded = await reopened.load<CounterRecord>({
      resource: "crash-counter",
      key: { id: "primary" },
    });
    expect(loaded.records.length).toBeGreaterThanOrEqual(observed);
    for (const [index, entry] of loaded.records.entries()) {
      expect(entry.revision).toBe(index + 1);
      expect(entry.intent.id).toBe(`crash/${index}`);
      expect(
        await reopened.receipt(
          { resource: "crash-counter", key: { id: "primary" } },
          entry.intent.id,
        ),
      ).toEqual(entry);
    }
    expect(loaded.head).toEqual(head(loaded.records.at(-1)!));
    await reopened.close();
    rmSync(directory, { recursive: true, force: true });
  }, 15_000);
});

function captureError(operation: () => unknown): unknown {
  try {
    operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail.");
}

type JournalFixture = Journal | { journal: Journal; cleanup(): void };

async function assertGeneratedSchedules(
  create: () => JournalFixture | Promise<JournalFixture>,
  runs: number,
): Promise<void> {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ intent: fc.integer({ min: 0, max: 20 }), stale: fc.boolean() }), {
        maxLength: 80,
      }),
      async (schedule) => {
        const fixture = await create();
        const journal = "journal" in fixture ? fixture.journal : fixture;
        const cleanup = "journal" in fixture ? fixture.cleanup : undefined;
        const committed = new Map<number, { revision: number; position: number }>();
        let expected = emptyJournalHead;
        try {
          for (const operation of schedule) {
            const known = committed.get(operation.intent);
            const stale = operation.stale && expected.revision > 0 && !known;
            let result = await journal.append({
              address,
              expected: stale ? emptyJournalHead : expected,
              record: record(`model/${operation.intent}`, operation.intent),
            });
            if (known) {
              expect(result.status).toBe("duplicate");
              if (result.status === "conflict") throw new Error("unexpected conflict");
              expect(head(result.record)).toEqual(known);
              continue;
            }
            if (stale) {
              expect(result).toEqual({ status: "conflict", head: expected });
              result = await journal.append({
                address,
                expected,
                record: record(`model/${operation.intent}`, operation.intent),
              });
            }
            expect(result.status).toBe("committed");
            if (result.status === "conflict") throw new Error("unexpected conflict");
            expected = head(result.record);
            committed.set(operation.intent, expected);
          }

          const loaded = await journal.load<CounterRecord>(address);
          expect(loaded.head).toEqual(expected);
          expect(loaded.records).toHaveLength(committed.size);
          for (const [intent, known] of committed) {
            expect(head((await journal.receipt(address, `model/${intent}`))!)).toEqual(known);
          }
        } finally {
          await journal.close();
          cleanup?.();
        }
      },
    ),
    { numRuns: runs },
  );
}

async function waitFor(predicate: () => boolean, timeout = 2_000): Promise<void> {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error("Timed out waiting for journal delivery.");
    await Bun.sleep(5);
  }
}
