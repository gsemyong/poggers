import { expect } from "vitest";

import type {
  Replication,
  ReplicationCommandResult,
  ReplicationEnvelope,
} from "@/features/replica";
import { defineDependencyConformance } from "@/testing/dependency";

const initial: ReplicationEnvelope = {
  version: 1,
  sequence: 10,
  observations: { tasks: "10" },
  invocations: [],
  cursor: "10",
  snapshot: { tasks: [] },
  changes: [],
};

const changed: ReplicationEnvelope = {
  version: 1,
  sequence: 11,
  observations: { tasks: "11" },
  invocations: [],
  cursor: "11",
  changes: [
    {
      row: "tasks",
      upsert: { id: "task-1", title: "Replicated" } as Readonly<{ id: string }>,
    },
  ],
};

const admitted: ReplicationCommandResult = {
  result: {},
  pull: {
    version: 1,
    sequence: 12,
    observations: { tasks: "12" },
    invocations: ["idempotency:conformance-command"],
    cursor: "12",
    changes: [
      {
        row: "tasks",
        upsert: { id: "task-1", title: "Completed" } as Readonly<{ id: string }>,
      },
    ],
  },
};

/** Deterministic records used by transport targets in the shared corpus. */
export const replicationConformanceRecords = Object.freeze({
  initial,
  changed,
  admitted,
});

/**
 * The semantic corpus every Replication realization must preserve. Authority
 * idempotency is tested by Replica/Aggregate; this corpus verifies that a
 * transport neither loses nor reinterprets its identities and cursors.
 */
export const replicationConformance = defineDependencyConformance<Replication>({
  name: "Replication",
  scenarios: [
    {
      name: "preserves snapshot and incremental cursor semantics",
      async verify({ api }) {
        await expect(api.pull({ replica: "tasks" })).resolves.toEqual(initial);
        await expect(api.pull({ replica: "tasks", after: 10 })).resolves.toEqual(changed);
      },
    },
    {
      name: "preserves one stable invocation identity across command retries",
      async verify({ api }) {
        const input = {
          replica: "tasks",
          command: "complete",
          value: { id: "task-1" },
          idempotencyKey: "conformance-command",
          after: 11,
        } as const;
        await expect(api.command(input)).resolves.toEqual(admitted);
        await expect(api.command(input)).resolves.toEqual(admitted);
      },
    },
    {
      name: "streams ordered resumable progress without an implicit snapshot",
      async verify({ api }) {
        const stream = await api.changes({
          replica: "tasks",
          observations: { tasks: "10" },
          sequence: 10,
        });
        const received: ReplicationEnvelope[] = [];
        for await (const envelope of stream) received.push(envelope);
        expect(received).toEqual([changed, admitted.pull]);
        expect(received.every(({ snapshot }) => snapshot === undefined)).toBe(true);
      },
    },
  ],
});
