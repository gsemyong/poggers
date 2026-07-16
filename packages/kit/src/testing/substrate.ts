import assert from "node:assert/strict";

import { programIdentity, type ApplicationManifest } from "#kernel/manifest";
import {
  ProgramDefinitionChangedError,
  sourceCursor,
  sourceSplit,
  type ProgramAssignment,
  type ProgramRegistration,
  type SourceCursor,
  type SubstrateAdapter,
} from "#substrate/adapter";
import { emptyJournalHead, type CommandRecord, type ResourceAddress } from "#substrate/journal";

type CounterRecord = CommandRecord<
  { command: "add"; amount: number },
  { ok: true; output: number; events: readonly [{ name: "added"; payload: number }] }
>;

export type SubstrateContractOptions = Readonly<{
  now?: () => number;
}>;

export type SubstrateContractHarness = Readonly<{
  adapter: SubstrateAdapter;
  retainAfter(cursor: SourceCursor): void | Promise<void>;
}>;

export type SubstrateContractFactory = (
  options?: SubstrateContractOptions,
) => SubstrateContractHarness | Promise<SubstrateContractHarness>;

export type SubstrateContractCase = Readonly<{
  name: string;
  run(): Promise<void>;
}>;

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

export function createSubstrateContractCases(
  create: SubstrateContractFactory,
): readonly SubstrateContractCase[] {
  return [
    contractCase(
      "atomically exposes committed authority records through bounded source reads",
      create,
      async ({ adapter }) => {
        const committed = await adapter.authority.commit({
          address,
          expected: emptyJournalHead,
          record: record("intent/1", 3),
        });
        assert.equal(committed.status, "committed");
        const split = await sourceSplitOf(adapter);
        const bounds = await adapter.events.bounds(split);
        const read = await adapter.events.read({
          split,
          after: bounds.origin,
          maxRecords: 1,
          maxBytes: 64 * 1024,
        });
        assert.equal(read.status, "read");
        if (read.status !== "read") throw new Error("Unexpected expired cursor.");
        assert.deepEqual(
          read.records.map(({ record: entry }) => entry.intent.id),
          ["intent/1"],
        );
        assert.equal(read.caughtUp, true);
      },
    ),
    {
      name: "fences stale ownership while preserving redelivery identity and attempts",
      async run() {
        let time = 1_000;
        const harness = await create({ now: () => time });
        try {
          const { adapter } = harness;
          await adapter.programs.register(registration);
          const split = await sourceSplitOf(adapter);
          const assignment: ProgramAssignment = {
            program: registration.id,
            split,
            keyGroup: 0,
          };
          const first = await adapter.coordination.acquire(assignment, "worker/1", 100);
          assert.ok(first, "Expected the first assignment lease.");
          const delivery = {
            id: "counter/primary/1/0",
            cursor: sourceCursor(split, "1"),
            index: 0,
            key: "counter/primary",
          };
          const claimed = await adapter.programs.claim({ lease: first, delivery });
          assert.equal(claimed.status, "claimed");
          if (claimed.status !== "claimed") throw new Error("Delivery was not claimed.");
          assert.deepEqual(claimed.invocation.delivery, delivery);
          assert.equal(claimed.invocation.attempt, 1);
          assert.equal(claimed.invocation.epoch, 1);
          assert.deepEqual(claimed.invocation.uncertainAttempts, []);

          time += 101;
          const second = await adapter.coordination.acquire(assignment, "worker/2", 100);
          assert.ok(second, "Expected a replacement assignment lease.");
          assert.equal(second.fence, first.fence + 1);
          assert.equal(
            await adapter.programs.complete({ lease: first, invocation: claimed.invocation }),
            "stale",
          );

          const retried = await adapter.programs.claim({ lease: second, delivery });
          assert.equal(retried.status, "claimed");
          if (retried.status !== "claimed") throw new Error("Delivery was not reclaimed.");
          assert.equal(retried.invocation.attempt, 2);
          assert.deepEqual(retried.invocation.uncertainAttempts, [1]);
          assert.equal(
            await adapter.programs.complete({ lease: second, invocation: claimed.invocation }),
            "stale",
          );
          assert.equal(
            await adapter.programs.complete({ lease: second, invocation: retried.invocation }),
            "completed",
          );
        } finally {
          await harness.adapter.close();
        }
      },
    },
    contractCase(
      "does not advance a source checkpoint across unfinished work",
      create,
      async ({ adapter }) => {
        await adapter.programs.register(registration);
        const split = await sourceSplitOf(adapter);
        const assignment: ProgramAssignment = {
          program: registration.id,
          split,
          keyGroup: 0,
        };
        const lease = await adapter.coordination.acquire(assignment, "worker/1", 100);
        assert.ok(lease, "Expected an assignment lease.");
        const delivery = {
          id: "counter/primary/1/0",
          cursor: sourceCursor(split, "1"),
          index: 0,
          key: "counter/primary",
        };
        const claimed = await adapter.programs.claim({ lease, delivery });
        assert.equal(claimed.status, "claimed");
        await assert.rejects(
          adapter.programs.advance({ lease, cursor: delivery.cursor }),
          /unfinished delivery/,
        );
        if (claimed.status !== "claimed") throw new Error("Delivery was not claimed.");
        await adapter.programs.complete({ lease, invocation: claimed.invocation });
        assert.equal(
          await adapter.programs.advance({ lease, cursor: delivery.cursor }),
          "advanced",
        );
        assert.deepEqual(await adapter.programs.checkpoint(assignment), delivery.cursor);
      },
    ),
    contractCase(
      "keeps progress independent for every split and key-group assignment",
      create,
      async ({ adapter }) => {
        await adapter.programs.register(registration);
        const split = await sourceSplitOf(adapter);
        const first: ProgramAssignment = { program: registration.id, split, keyGroup: 0 };
        const second: ProgramAssignment = { program: registration.id, split, keyGroup: 1 };
        const firstLease = await adapter.coordination.acquire(first, "worker/1", 100);
        const secondLease = await adapter.coordination.acquire(second, "worker/1", 100);
        assert.ok(firstLease, "Expected the first assignment lease.");
        assert.ok(secondLease, "Expected the second assignment lease.");
        assert.equal(
          await adapter.programs.advance({ lease: firstLease, cursor: sourceCursor(split, "1") }),
          "advanced",
        );
        assert.equal(
          await adapter.programs.advance({ lease: secondLease, cursor: sourceCursor(split, "2") }),
          "advanced",
        );
        assert.deepEqual(await adapter.programs.checkpoint(first), sourceCursor(split, "1"));
        assert.deepEqual(await adapter.programs.checkpoint(second), sourceCursor(split, "2"));
      },
    ),
    contractCase(
      "reports logical retention gaps instead of skipping to remaining history",
      create,
      async (harness) => {
        const { adapter } = harness;
        let head = emptyJournalHead;
        for (let index = 1; index <= 3; index += 1) {
          const result = await adapter.authority.commit({
            address,
            expected: head,
            record: record(`intent/${index}`, index),
          });
          if (result.status === "conflict") throw new Error("Unexpected authority conflict.");
          head = { revision: result.record.revision, position: result.record.position };
        }
        const split = await sourceSplitOf(adapter);
        await harness.retainAfter(sourceCursor(split, "2"));
        assert.deepEqual(
          await adapter.events.read({
            split,
            after: sourceCursor(split, "0"),
            maxRecords: 10,
            maxBytes: 64 * 1024,
          }),
          {
            status: "cursor-expired",
            floor: sourceCursor(split, "2"),
            highWater: sourceCursor(split, "3"),
          },
        );
        const retained = await adapter.events.read({
          split,
          after: sourceCursor(split, "2"),
          maxRecords: 10,
          maxBytes: 64 * 1024,
        });
        assert.equal(retained.status, "read");
        if (retained.status !== "read") throw new Error("Unexpected expired cursor.");
        assert.deepEqual(
          retained.records.map(({ record: item }) => item.intent.id),
          ["intent/3"],
        );
      },
    ),
    contractCase(
      "rejects definition drift and cursors from another source split",
      create,
      async ({ adapter }) => {
        assert.equal(await adapter.programs.register(registration), "created");
        assert.equal(await adapter.programs.register(registration), "existing");
        await assert.rejects(
          adapter.programs.register({
            ...registration,
            source: { ...registration.source, replay: "new" },
          }),
          ProgramDefinitionChangedError,
        );
        const split = await sourceSplitOf(adapter);
        await assert.rejects(
          adapter.events.read({
            split,
            after: sourceCursor(sourceSplit("other"), "0"),
            maxRecords: 1,
            maxBytes: 1,
          }),
          /another split/,
        );
      },
    ),
    contractCase(
      "validates the static Program manifest and rejects unsupported deployment topology",
      create,
      async ({ adapter }) => {
        await adapter.validate(manifest(), { instances: 1 });
        await assert.rejects(
          adapter.validate(manifest(), { instances: 2 }),
          /exactly one application instance/,
        );
        const id = programIdentity("", "server", "projectCounter");
        await adapter.programs.register({
          id,
          source: { events: ["counter.added"], replay: "all", key: "resource", version: 1 },
        });
        await adapter.validate(manifest(), { instances: 1 });
        await assert.rejects(
          adapter.validate(manifest(2), { instances: 1 }),
          ProgramDefinitionChangedError,
        );
      },
    ),
  ];
}

function contractCase(
  name: string,
  create: SubstrateContractFactory,
  verify: (harness: SubstrateContractHarness) => Promise<void>,
): SubstrateContractCase {
  return {
    name,
    async run() {
      const harness = await create();
      try {
        await verify(harness);
      } finally {
        await harness.adapter.close();
      }
    },
  };
}

async function sourceSplitOf(adapter: SubstrateAdapter) {
  const split = (await adapter.events.topology()).splits[0]?.id;
  if (!split) throw new Error("The adapter exposed no committed-event source split.");
  return split;
}

function record(id: string, amount: number): CounterRecord {
  return {
    schema: "counter:1",
    intent: { id, inputHash: `hash/${id}`, value: { command: "add", amount } },
    decision: { ok: true, output: amount, events: [{ name: "added", payload: amount }] },
  };
}

function manifest(version = 1): ApplicationManifest {
  return {
    format: 1,
    contract: { hash: "contract", nodes: [], resources: {} },
    scopes: [
      {
        path: "",
        resources: [],
        components: [],
        features: [],
        programs: [
          {
            environment: "server",
            name: "projectCounter",
            kind: "events",
            events: ["counter.added"],
            replay: "all",
            version,
            key: "resource",
          },
        ],
        dependencies: [],
        navigation: [],
        endpoints: [],
        api: [],
      },
    ],
    presets: [],
  };
}
