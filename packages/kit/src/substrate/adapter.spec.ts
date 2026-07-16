import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";

import {
  allocateProgramTopology,
  assertSourceTopology,
  programKeyGroup,
  SourceHistoryUnavailableError,
  sourceCursor,
  sourceSplit,
  type ProgramAssignment,
  type ProgramRegistration,
} from "#substrate/adapter";
import { createMemorySubstrate, type MemorySubstrate } from "#substrate/adapter.memory";
import { createSqliteSubstrate } from "#substrate/adapter.sqlite";
import { emptyJournalHead, type CommandRecord, type ResourceAddress } from "#substrate/journal";
import { createSubstrateContractCases, type SubstrateContractOptions } from "#testing/substrate";

type CounterRecord = CommandRecord<
  { command: "add"; amount: number },
  { ok: true; output: number; events: readonly [{ name: "added"; payload: number }] }
>;

const address: ResourceAddress = { resource: "counter", key: "primary" };
const registration: ProgramRegistration = {
  id: "application/server/project-counter",
  source: {
    events: ["counter.added"],
    replay: "all",
    key: "resource",
    version: 1,
  },
};

function record(id: string, amount: number): CounterRecord {
  return {
    schema: "counter:1",
    intent: { id, inputHash: `hash/${id}`, value: { command: "add", amount } },
    decision: { ok: true, output: amount, events: [{ name: "added", payload: amount }] },
  };
}

type AdapterFactory = (options?: SubstrateContractOptions) => MemorySubstrate;

function describeAdapter(name: string, create: AdapterFactory): void {
  describe(name, () => {
    for (const contract of createSubstrateContractCases((options) => {
      const adapter = create(options);
      return {
        adapter,
        retainAfter: (cursor) => adapter.testing.retainAfter(cursor),
      };
    })) {
      test(contract.name, contract.run);
    }
  });
}

describeAdapter("memory substrate adapter", createMemorySubstrate);

describe("Program topology model", () => {
  test("assigns every stable key group exactly once independent of input order", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 8,
        }),
        fc.integer({ min: 1, max: 64 }),
        (rawOwners, keyGroups) => {
          const owners = rawOwners.map((owner, index) => `${index}/${owner}`);
          const splits = [sourceSplit("source/b"), sourceSplit("source/a")];
          const forward = allocateProgramTopology({
            program: "projection",
            splits,
            keyGroups,
            owners,
          });
          const reverse = allocateProgramTopology({
            program: "projection",
            splits: [...splits].reverse(),
            keyGroups,
            owners: [...owners].reverse(),
          });
          expect(reverse).toEqual(forward);
          expect(new Set(forward.map(({ assignment }) => JSON.stringify(assignment))).size).toBe(
            splits.length * keyGroups,
          );
        },
      ),
      { numRuns: 250 },
    );
  });

  test("rendezvous reassignment moves work only to an added owner or from a removed owner", () => {
    const splits = [sourceSplit("source/0"), sourceSplit("source/1")];
    const before = allocateProgramTopology({
      program: "projection",
      splits,
      keyGroups: 256,
      owners: ["a", "b"],
    });
    const added = allocateProgramTopology({
      program: "projection",
      splits,
      keyGroups: 256,
      owners: ["a", "b", "c"],
    });
    for (let index = 0; index < before.length; index += 1) {
      if (before[index]!.owner !== added[index]!.owner) expect(added[index]!.owner).toBe("c");
    }
    const removed = allocateProgramTopology({
      program: "projection",
      splits,
      keyGroups: 256,
      owners: ["a"],
    });
    for (let index = 0; index < before.length; index += 1) {
      if (before[index]!.owner !== removed[index]!.owner) expect(before[index]!.owner).toBe("b");
    }
  });

  test("maps a semantic key to one stable bounded group and validates split lineage", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 4_096 }), (key, groups) => {
        const first = programKeyGroup(key, groups);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(first).toBeLessThan(groups);
        expect(programKeyGroup(key, groups)).toBe(first);
      }),
      { numRuns: 1_000 },
    );
    const first = {
      version: "1",
      splits: [{ id: sourceSplit("old"), predecessors: [] }],
    } as const;
    const second = {
      version: "2",
      splits: [
        { id: sourceSplit("left"), predecessors: [sourceSplit("old")] },
        { id: sourceSplit("right"), predecessors: [sourceSplit("old")] },
      ],
    } as const;
    expect(() => assertSourceTopology(first)).not.toThrow();
    expect(() => assertSourceTopology(second, first)).not.toThrow();
    expect(() =>
      assertSourceTopology(
        {
          version: "2",
          splits: [{ id: sourceSplit("replacement"), predecessors: [] }],
        },
        first,
      ),
    ).toThrow("no successor lineage");
    expect(() =>
      assertSourceTopology(
        {
          version: "2",
          splits: [{ id: sourceSplit("left"), predecessors: [sourceSplit("lost")] }],
        },
        first,
      ),
    ).toThrow("Unknown predecessor");
  });
});

const sqliteDirectories: string[] = [];
afterAll(() => {
  for (const directory of sqliteDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});
describeAdapter("SQLite substrate adapter", (options) => {
  const directory = mkdtempSync(join(tmpdir(), "poggers-substrate-"));
  sqliteDirectories.push(directory);
  return createSqliteSubstrate({ file: join(directory, "substrate.sqlite"), ...options });
});

test("SQLite preserves Program progress and interrupted attempts across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poggers-substrate-restart-"));
  sqliteDirectories.push(directory);
  const file = join(directory, "substrate.sqlite");
  const assignment: ProgramAssignment = {
    program: registration.id,
    split: sourceSplit("commits/0"),
    keyGroup: 0,
  };
  const sibling: ProgramAssignment = { ...assignment, keyGroup: 1 };
  const delivery = {
    id: "counter/primary/1/0",
    cursor: sourceCursor(assignment.split, "1"),
    index: 0,
    key: "counter/primary",
  };

  const first = createSqliteSubstrate({ file });
  await first.programs.register(registration);
  const firstLease = await first.coordination.acquire(assignment, "worker/1", 100);
  if (!firstLease) throw new Error("missing first lease");
  const interrupted = await first.programs.claim({ lease: firstLease, delivery });
  expect(interrupted).toMatchObject({ status: "claimed", invocation: { attempt: 1, epoch: 1 } });
  const siblingLease = await first.coordination.acquire(sibling, "worker/1", 100);
  if (!siblingLease) throw new Error("missing sibling lease");
  expect(
    await first.programs.advance({ lease: siblingLease, cursor: sourceCursor(sibling.split, "4") }),
  ).toBe("advanced");
  await first.close();

  const second = createSqliteSubstrate({ file });
  expect(await second.programs.register(registration)).toBe("existing");
  expect(await second.programs.registration(registration.id)).toEqual(registration);
  expect(await second.programs.checkpoint(sibling)).toEqual(sourceCursor(sibling.split, "4"));
  const secondLease = await second.coordination.acquire(assignment, "worker/2", 100);
  if (!secondLease) throw new Error("missing replacement lease");
  const retried = await second.programs.claim({ lease: secondLease, delivery });
  expect(retried).toMatchObject({
    status: "claimed",
    invocation: { attempt: 2, epoch: 2, uncertainAttempts: [1] },
  });
  if (retried.status !== "claimed") throw new Error("delivery was not reclaimed");
  expect(
    await second.programs.complete({ lease: secondLease, invocation: retried.invocation }),
  ).toBe("completed");
  expect(await second.programs.advance({ lease: secondLease, cursor: delivery.cursor })).toBe(
    "advanced",
  );
  await second.close();

  const third = createSqliteSubstrate({ file });
  expect(await third.programs.checkpoint(assignment)).toEqual(delivery.cursor);
  await third.close();
});

test("SQLite does not deliver its durable Program metadata as application events", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poggers-substrate-metadata-"));
  sqliteDirectories.push(directory);
  const adapter = createSqliteSubstrate({ file: join(directory, "substrate.sqlite") });
  await adapter.programs.register(registration);
  const committed = await adapter.authority.commit({
    address,
    expected: emptyJournalHead,
    record: record("intent/product", 1),
  });
  expect(committed.status).toBe("committed");
  const [split] = (await adapter.events.topology()).splits.map(({ id }) => id);
  if (!split) throw new Error("missing split");
  const read = await adapter.events.read({
    split,
    after: sourceCursor(split, "0"),
    maxRecords: 10,
    maxBytes: 64 * 1024,
  });
  expect(read.status).toBe("read");
  if (read.status !== "read") throw new Error("unexpected expired cursor");
  expect(read.records.map(({ record: item }) => item.intent.id)).toEqual(["intent/product"]);
  expect(read.caughtUp).toBe(true);
  await adapter.close();
});

test("SQLite persists retained source bounds and rejects an impossible origin replay", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poggers-substrate-retention-"));
  sqliteDirectories.push(directory);
  const file = join(directory, "substrate.sqlite");
  const first = createSqliteSubstrate({ file });
  let head = emptyJournalHead;
  for (let index = 1; index <= 2; index += 1) {
    const committed = await first.authority.commit({
      address,
      expected: head,
      record: record(`retained/${index}`, index),
    });
    if (committed.status === "conflict") throw new Error("unexpected conflict");
    head = { revision: committed.record.revision, position: committed.record.position };
  }
  await first.authority.saveSnapshot({
    address,
    revision: head.revision,
    position: head.position,
    schema: "counter:1",
    stateHash: "retained-counter",
    state: { count: 3 },
    storedAt: Date.now(),
  });
  const [split] = (await first.events.topology()).splits.map(({ id }) => id);
  if (!split) throw new Error("missing source split");
  await first.administration.retainThrough(sourceCursor(split, String(head.position)));
  await first.close();

  const second = createSqliteSubstrate({ file });
  expect((await second.events.bounds(split)).floor).toEqual(
    sourceCursor(split, String(head.position)),
  );
  const expired = await second.events.read({
    split,
    after: sourceCursor(split, "0"),
    maxRecords: 10,
    maxBytes: 64 * 1024,
  });
  expect(expired).toMatchObject({
    status: "cursor-expired",
    floor: sourceCursor(split, String(head.position)),
  });
  expect((await second.authority.receipt(address, "retained/1"))?.position).toBe(1);
  await expect(second.programs.register(registration)).rejects.toBeInstanceOf(
    SourceHistoryUnavailableError,
  );
  await second.close();
});

test("SQLite retention cannot cross a durable Program checkpoint", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poggers-substrate-low-water-"));
  sqliteDirectories.push(directory);
  const adapter = createSqliteSubstrate({ file: join(directory, "substrate.sqlite") });
  const committed = await adapter.authority.commit({
    address,
    expected: emptyJournalHead,
    record: record("protected/1", 1),
  });
  if (committed.status === "conflict") throw new Error("unexpected conflict");
  await adapter.authority.saveSnapshot({
    address,
    revision: committed.record.revision,
    position: committed.record.position,
    schema: "counter:1",
    stateHash: "protected-counter",
    state: { count: 1 },
    storedAt: Date.now(),
  });
  await adapter.programs.register(registration);
  const [split] = (await adapter.events.topology()).splits.map(({ id }) => id);
  if (!split) throw new Error("missing source split");
  await expect(
    adapter.administration.retainThrough(sourceCursor(split, String(committed.record.position))),
  ).rejects.toThrow("protects source history");
  expect((await adapter.events.bounds(split)).floor).toEqual(sourceCursor(split, "0"));

  expect(await adapter.administration.programs()).toEqual([registration]);
  await adapter.administration.removeProgram(registration.id);
  expect(await adapter.administration.programs()).toEqual([]);
  await adapter.administration.retainThrough(
    sourceCursor(split, String(committed.record.position)),
  );
  expect((await adapter.events.bounds(split)).floor).toEqual(
    sourceCursor(split, String(committed.record.position)),
  );
  await adapter.close();
});

test("SQLite administers Program identity and replay position explicitly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poggers-substrate-administration-"));
  sqliteDirectories.push(directory);
  const adapter = createSqliteSubstrate({ file: join(directory, "substrate.sqlite") });
  await adapter.programs.register(registration);
  const split = (await adapter.events.topology()).splits[0]!.id;
  const assignment = { program: registration.id, split, keyGroup: 3 };
  const lease = await adapter.coordination.acquire(assignment, "administrator", 100);
  if (!lease) throw new Error("missing administrative assignment lease");
  await adapter.programs.advance({ lease, cursor: sourceCursor(split, "2") });
  const renamed = `${registration.id}/v2`;
  await adapter.administration.renameProgram(registration.id, renamed);
  expect(await adapter.programs.registration(registration.id)).toBeNull();
  expect(await adapter.programs.registration(renamed)).toEqual({ ...registration, id: renamed });
  expect(await adapter.programs.checkpoint({ ...assignment, program: renamed })).toEqual(
    sourceCursor(split, "2"),
  );
  await adapter.administration.resetProgram(renamed, "all");
  expect(await adapter.programs.checkpoint({ ...assignment, program: renamed })).toEqual(
    sourceCursor(split, "0"),
  );
  await adapter.administration.removeProgram(renamed);
  expect(await adapter.administration.programs()).toEqual([]);
  await adapter.close();
});
