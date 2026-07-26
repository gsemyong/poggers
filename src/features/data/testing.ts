import fc from "fast-check";
import { expect } from "vitest";

import { createMemoryDataStore, type DataProjectionQuery, type DataStore } from "@/features/data";
import { defineDependencyConformance } from "@/testing/dependency";

export type DataStoreConformanceRecord = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  body: string;
  priority: number;
  archived: boolean;
}>;

/** The semantic suite every DataStore provider must pass. */
export const dataStoreConformance = defineDependencyConformance<
  DataStore<DataStoreConformanceRecord>
>({
  name: "DataStore",
  scenarios: [
    {
      name: "matches reference filtering, ordering, and pagination",
      async verify({ api }) {
        const reference = createMemoryDataStore<DataStoreConformanceRecord>();
        let revision = 0;
        await fc.assert(
          fc.asyncProperty(recordsArbitrary(), queryArbitrary(), async (records, query) => {
            revision += 1;
            const replace = {
              collection: "conformance",
              revision,
              records,
              indexes: ["priority", "archived"],
              search: ["title", "body"],
            };
            await Promise.all([reference.replace(replace), api.replace(replace)]);
            const [expected, actual] = await Promise.all([
              reference.query({ collection: "conformance", query }),
              api.query({ collection: "conformance", query }),
            ]);
            expect(actual.map(({ record }) => record)).toEqual(
              expected.map(({ record }) => record),
            );
          }),
          { numRuns: 75 },
        );
      },
    },
    {
      name: "searches deterministically with identity tie breaking",
      async verify({ api }) {
        await api.replace({
          collection: "search",
          revision: 1,
          indexes: [],
          search: ["title", "body"],
          records: [
            {
              id: "b",
              ownerId: "alice",
              title: "Distributed systems",
              body: "Portable programs",
              priority: 1,
              archived: false,
            },
            {
              id: "a",
              ownerId: "alice",
              title: "Distributed systems",
              body: "Portable programs",
              priority: 2,
              archived: false,
            },
            {
              id: "c",
              ownerId: "alice",
              title: "Unrelated",
              body: "Nothing to match",
              priority: 3,
              archived: false,
            },
          ],
        });
        const query = { collection: "search", query: { text: "distributed systems" } };
        const first = await api.query(query);
        const second = await api.query(query);
        expect(first.map(({ record }) => record.id)).toEqual(["a", "b"]);
        expect(second).toEqual(first);
      },
    },
  ],
});

function recordsArbitrary(): fc.Arbitrary<readonly DataStoreConformanceRecord[]> {
  return fc.uniqueArray(
    fc.record({
      id: fc.uuid(),
      ownerId: fc.constant("alice"),
      title: fc.string({ maxLength: 24 }),
      body: fc.string({ maxLength: 48 }),
      priority: fc.integer({ min: -20, max: 20 }),
      archived: fc.boolean(),
    }),
    { maxLength: 30, selector: ({ id }) => id },
  );
}

function queryArbitrary(): fc.Arbitrary<DataProjectionQuery<DataStoreConformanceRecord>> {
  return fc
    .record({
      archived: fc.option(fc.boolean(), { nil: undefined }),
      minimum: fc.option(fc.integer({ min: -20, max: 20 }), { nil: undefined }),
      maximum: fc.option(fc.integer({ min: -20, max: 20 }), { nil: undefined }),
      order: fc.constantFrom<"id" | "priority">("id", "priority"),
      direction: fc.constantFrom<"ascending" | "descending">("ascending", "descending"),
      offset: fc.integer({ min: 0, max: 10 }),
      limit: fc.integer({ min: 0, max: 20 }),
    })
    .map(({ archived, minimum, maximum, order, direction, offset, limit }) => ({
      where: {
        ...(archived === undefined ? {} : { archived }),
        ...(minimum === undefined && maximum === undefined
          ? {}
          : {
              priority: {
                ...(minimum === undefined ? {} : { atLeast: minimum }),
                ...(maximum === undefined ? {} : { atMost: maximum }),
              },
            }),
      },
      order: [{ field: order, direction }],
      offset,
      limit,
    }));
}
