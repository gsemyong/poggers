import { expect } from "vitest";

import type { ProjectionStore } from "@/features/projection";
import { defineDependencyConformance } from "@/testing/dependency";

const projection = "conformance";
const version = 1;
const changes = [
  {
    row: "documents",
    id: "document-1",
    after: {
      id: "document-1",
      tenant: "allowed",
      title: "Durable local data",
      embedding: [1, 0, 0],
      value: 7,
    },
  },
  {
    row: "documents",
    id: "document-2",
    after: {
      id: "document-2",
      tenant: "blocked",
      title: "Private material",
      embedding: [0, 1, 0],
      value: 11,
    },
  },
  {
    row: "edges",
    id: "edge-1",
    after: { id: "edge-1", tenant: "allowed", from: "a", to: "b" },
  },
  {
    row: "edges",
    id: "edge-2",
    after: { id: "edge-2", tenant: "allowed", from: "b", to: "c" },
  },
  {
    row: "places",
    id: "place-1",
    after: {
      id: "place-1",
      tenant: "allowed",
      location: { latitude: 48.1486, longitude: 17.1077 },
    },
  },
  {
    row: "documents",
    id: "document-3",
    after: {
      id: "document-3",
      tenant: "allowed",
      title: "Background reference",
      embedding: [0, 0, 1],
      value: 3,
    },
  },
] as const;

/** The semantic corpus every ProjectionStore realization must pass. */
export const projectionStoreConformance = defineDependencyConformance<ProjectionStore>({
  name: "ProjectionStore",
  scenarios: [
    {
      name: "commits rows and cursors atomically with compare-and-swap revisions",
      async verify({ api }) {
        await expect(
          api.load({ projection, version, rows: ["documents", "edges", "places"] }),
        ).resolves.toEqual({
          revision: 0,
          cursors: {},
          rows: { documents: [], edges: [], places: [] },
        });

        const committed = await api.commit({
          projection,
          version,
          expectedRevision: 0,
          cursors: { source: "cursor-1" },
          invocations: ["invocation-1"],
          changes,
        });
        expect(committed).toEqual({
          revision: 1,
          cursors: { source: "cursor-1" },
        });
        await expect(
          api.read({
            projection,
            version,
            keys: {
              documents: ["document-2"],
              edges: ["missing", "edge-1"],
            },
          }),
        ).resolves.toEqual({
          documents: [changes[1]!.after],
          edges: [changes[2]!.after],
        });

        await expect(
          api.commit({
            projection,
            version,
            expectedRevision: 0,
            cursors: { source: "stale" },
            invocations: [],
            changes: [],
          }),
        ).resolves.toBeUndefined();
        await expect(
          api.load({ projection, version, rows: ["documents", "edges", "places"] }),
        ).resolves.toMatchObject({
          revision: 1,
          cursors: { source: "cursor-1" },
        });
        await expect(api.changes({ projection, version, after: 0, limit: 10 })).resolves.toEqual([
          {
            revision: 1,
            cursors: { source: "cursor-1" },
            invocations: ["invocation-1"],
            changes,
          },
        ]);
      },
    },
    {
      name: "executes every semantic query family after authority filtering",
      async verify({ api }) {
        await api.commit({
          projection,
          version,
          expectedRevision: 0,
          cursors: { source: "cursor-1" },
          invocations: ["invocation-1"],
          changes,
        });
        const scope = { where: { tenant: { equal: "allowed" } } };

        await expect(
          api.query({
            projection,
            version,
            row: "documents",
            scope,
            query: {
              find: {
                where: { value: { atLeast: 3, not: 5 } },
                order: [{ field: "value", direction: "descending" }],
                limit: 1,
              },
            },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [{ row: { id: "document-1", value: 7 } }],
        });
        await expect(
          api.query({
            projection,
            version,
            row: "documents",
            scope,
            query: { text: { value: "local", fields: ["title"] } },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [{ row: { id: "document-1" }, score: 1 }],
        });
        await expect(
          api.query({
            projection,
            version,
            row: "documents",
            scope,
            query: { vector: { field: "embedding", value: [1, 0, 0], limit: 1 } },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [{ row: { id: "document-1" }, score: 1 }],
        });
        await expect(
          api.query({
            projection,
            version,
            row: "edges",
            scope,
            query: { graph: { from: "from", to: "to", start: "a", depth: 2 } },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [
            { row: { id: "edge-1" }, distance: 1 },
            { row: { id: "edge-2" }, distance: 2 },
          ],
        });
        await expect(
          api.query({
            projection,
            version,
            row: "places",
            scope,
            query: {
              geo: {
                field: "location",
                origin: { latitude: 48.1486, longitude: 17.1077 },
                within: 1,
              },
            },
          }),
        ).resolves.toMatchObject({
          kind: "rows",
          matches: [{ row: { id: "place-1" }, distance: 0 }],
        });
        await expect(
          api.query({
            projection,
            version,
            row: "documents",
            scope,
            query: {
              analytics: {
                groupBy: ["tenant"],
                measures: { count: { count: true }, value: { sum: "value" } },
              },
            },
          }),
        ).resolves.toEqual({
          kind: "analytics",
          revision: 1,
          cursor: "1",
          observations: { source: "cursor-1" },
          groups: [{ key: { tenant: "allowed" }, measures: { count: 2, value: 10 } }],
        });
      },
    },
  ],
});
