import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMemoryJournal,
  emptyJournalHead,
  exportJournal,
  importJournal,
  type CommandRecord,
  type Journal,
  type ResourceAddress,
} from "#substrate/journal";
import { createSqliteJournal } from "#substrate/journal.sqlite";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("portable Journal export and import", () => {
  test("reproduces records, receipts, heads, positions, and snapshots across adapters", async () => {
    const source = createMemoryJournal();
    const one = { resource: "counter", key: { id: "one" } } satisfies ResourceAddress;
    const two = { resource: "counter", key: { id: "two" } } satisfies ResourceAddress;
    const first = await append(source, one, emptyJournalHead, "one/1", 1);
    const second = await append(source, two, emptyJournalHead, "two/1", 2);
    const third = await append(
      source,
      one,
      { revision: first.revision, position: first.position },
      "one/2",
      3,
    );
    await source.saveSnapshot({
      address: one,
      revision: third.revision,
      position: third.position,
      schema: "counter-v1",
      stateHash: "value-4",
      state: { value: 4 },
      storedAt: 10,
    });

    const exported = await exportJournal(source);
    const directory = temporaryDirectory();
    const sqlite = createSqliteJournal({
      file: join(directory, "journal.sqlite"),
    });
    expect(await importJournal(sqlite, exported)).toEqual({ records: 3, snapshots: 1 });

    const restored = await exportJournal(sqlite);
    expect(restored).toEqual(exported);
    expect((await sqlite.receipt(one, "one/1"))?.decision).toEqual(first.decision);
    expect((await sqlite.load(one)).head).toEqual({
      revision: third.revision,
      position: third.position,
    });
    expect((await sqlite.load(two)).head).toEqual({
      revision: second.revision,
      position: second.position,
    });
    await sqlite.close();
    await source.close();
  });

  test("fails closed for a non-empty target", async () => {
    const source = createMemoryJournal();
    const address = { resource: "counter", key: "main" } satisfies ResourceAddress;
    await append(source, address, emptyJournalHead, "one", 1);
    const exported = await exportJournal(source);

    const occupied = createMemoryJournal();
    await append(occupied, address, emptyJournalHead, "existing", 1);
    await expect(importJournal(occupied, exported)).rejects.toThrow("requires an empty Journal");
    await Promise.all([source.close(), occupied.close()]);
  });

  test("verifies the complete archive before writing any destination record", async () => {
    const source = createMemoryJournal();
    const address = { resource: "counter", key: "main" } satisfies ResourceAddress;
    await append(source, address, emptyJournalHead, "one", 1);
    const exported = await exportJournal(source);
    const first = exported.records[0]!;
    const decision = first.decision as {
      ok: true;
      events: readonly [{ type: string; amount: number }];
    };
    const changed = {
      ...exported,
      records: [
        {
          ...first,
          decision: {
            ...decision,
            events: [{ ...decision.events[0], amount: 99 }],
          },
        },
      ],
    };

    const target = createMemoryJournal();
    await expect(importJournal(target, changed)).rejects.toThrow("SHA-256");
    expect(await collectAddresses(target)).toEqual([]);
    await Promise.all([source.close(), target.close()]);
  });
});

async function append(
  journal: Journal,
  address: ResourceAddress,
  expected: { revision: number; position: number },
  id: string,
  amount: number,
) {
  const result = await journal.append({
    address,
    expected,
    record: {
      schema: "counter-v1",
      intent: { id, inputHash: `hash-${id}`, value: { amount } },
      decision: { ok: true, events: [{ type: "added", amount }] },
    } satisfies CommandRecord,
  });
  if (result.status === "conflict") throw new Error("unexpected conflict");
  return result.record;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "poggers-portable-journal-"));
  directories.push(directory);
  return directory;
}

async function collectAddresses(journal: Journal): Promise<ResourceAddress[]> {
  const addresses: ResourceAddress[] = [];
  for await (const address of journal.addresses()) addresses.push(address);
  return addresses;
}
