import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { connect } from "@tursodatabase/database";
import fc from "fast-check";
import { describe, expect, test, vi } from "vitest";

import { createTursoDataStore, type TursoDatabase } from "@/adapters/data/turso";
import { buildServerProgram } from "@/adapters/server/production/compiler";
import { compileSystem } from "@/compiler/source";
import {
  createData,
  type DataModel,
  type DataProjectionQuery,
  type DataStore,
} from "@/features/data";
import {
  createDataBrowserFixture,
  createDataFixture,
  createMemoryDataStore,
} from "@/features/data.testing";

type Note = Readonly<{
  id: string;
  ownerId: string;
  title: string;
  body: string;
  priority: number;
  archived: boolean;
}>;

type Notes = DataModel<{
  Name: "notes";
  Principal: Readonly<{ id: string }>;
  Record: Note;
  Create: Readonly<{ title: string; body: string; priority?: number }>;
  Update: Readonly<{
    title?: string;
    body?: string;
    priority?: number;
    archived?: boolean;
  }>;
}>;

const notes = createData<Notes>({
  name: "notes",
  indexes: ["ownerId", "priority", "archived"],
  search: ["title", "body"],
  create: ({ id, principal, input }) => ({
    id,
    ownerId: principal.id,
    title: input.title,
    body: input.body,
    priority: input.priority ?? 0,
    archived: false,
  }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: ({ principal, operation, record }) =>
    principal.id === record.ownerId && !(operation === "create" && record.title === "Denied"),
});

describe("semantic data Feature", () => {
  test("lowers a specialized factory through the production semantic compiler", async () => {
    const parent = resolve(process.cwd(), ".data");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(resolve(parent, "data-compiler-"));
    try {
      const entry = resolve(directory, "system.ts");
      await writeFile(entry, dataSystemSource());
      const ir = compileSystem(entry);
      const contributions = ir.programs.flatMap(({ contributions }) => contributions);
      expect(
        contributions
          .filter(({ implementation }) => implementation.kind !== "portable")
          .map(({ id, implementation }) => ({ id, implementation })),
      ).toEqual([]);
      expect(contributions).toHaveLength(3);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  test(
    "builds the composed data Feature as a native executable",
    { tags: ["native"], timeout: 240_000 },
    async () => {
      const parent = resolve(process.cwd(), ".data");
      await mkdir(parent, { recursive: true });
      const directory = await mkdtemp(resolve(parent, "data-production-"));
      try {
        const entry = resolve(directory, "system.ts");
        await writeFile(entry, dataSystemSource());
        const ir = compileSystem(entry);
        const program = ir.programs[0];
        if (!program) throw new Error("Data compiler fixture has no server Program.");
        const build = await buildServerProgram({
          system: ir.system.name,
          directory,
          output: resolve(directory, "data-server"),
          profile: process.env.KIT_NATIVE_PROFILE === "release" ? "release" : "debug",
          program,
        });
        await expect(access(build.executable)).resolves.toBeUndefined();
        expect(build.profile).toBe(
          process.env.KIT_NATIVE_PROFILE === "release" ? "release" : "debug",
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  test("packages authorized event-sourced writes, typed queries, and local full-text search", async () => {
    await using store = nativeStore();
    await using fixture = await createDataFixture(notes, {
      principal: { id: "alice" },
      store,
    });
    const low = await fixture.api.create({
      title: "Portable programs",
      body: "A distributed application substrate",
      priority: 1,
    });
    const high = await fixture.api.create({
      title: "Local databases",
      body: "Portable programs query data locally",
      priority: 10,
    });
    await fixture.api.create({
      title: "Archived",
      body: "This record should be filtered",
      priority: 100,
    });
    await fixture.api.update({ id: "record-3", changes: { archived: true } });

    expect(
      await fixture.api.query({
        where: { archived: false, priority: { atLeast: 1 } },
        order: [{ field: "priority", direction: "descending" }],
      }),
    ).toEqual({ revision: 4, records: [high, low] });
    const search = await fixture.api.search({
      text: "portable programs",
      where: { archived: false },
    });
    expect(search.revision).toBe(4);
    expect(search.matches.map(({ record }) => record.id).sort()).toEqual([low.id, high.id].sort());
    expect(search.matches.every(({ score }) => Number.isFinite(score))).toBe(true);

    expect((await fixture.as({ id: "bob" }).query()).records).toEqual([]);
    expect(await fixture.events.read({ stream: "notesSource:alice" })).toHaveLength(4);
  });

  test("does not emit a live query when an unrelated source revision changes", async () => {
    await using fixture = await createDataFixture(notes, { principal: { id: "alice" } });
    const archived = await fixture.api.create({
      title: "Archived",
      body: "Visible",
      priority: 1,
    });
    await fixture.api.update({ id: archived.id, changes: { archived: true } });
    const changes = fixture.api.watch({ where: { archived: true } })[Symbol.asyncIterator]();
    expect((await changes.next()).value?.records).toEqual([{ ...archived, archived: true }]);

    const next = changes.next();
    await fixture.api.create({ title: "Active", body: "Unrelated" });
    expect(await pending(next)).toBe(true);
    await fixture.api.update({ id: archived.id, changes: { title: "Changed" } });
    expect((await next).value?.records).toEqual([
      { ...archived, title: "Changed", archived: true },
    ]);
    await changes.return?.();
  });

  test("queries optimistic browser state before its command is acknowledged", async () => {
    await using store = nativeStore();
    await using fixture = await createDataBrowserFixture(notes, {
      principal: { id: "alice" },
      store,
    });
    await vi.waitFor(() => expect(fixture.state.synchronization).toBe("synchronized"));

    const optimistic = fixture.actions.create({
      title: "Local first",
      body: "Queryable before acknowledgement",
      priority: 7,
    });
    expect(fixture.state.mutations).toHaveLength(1);
    expect(await fixture.api.query({ where: { priority: { atLeast: 5 } } })).toEqual({
      revision: 0,
      records: [optimistic],
    });
    expect(
      (await fixture.api.search({ text: "acknowledgement" })).matches.map(({ record }) => record),
    ).toEqual([optimistic]);

    await vi.waitFor(() => {
      expect(fixture.state.synchronization).toBe("synchronized");
      expect(fixture.state.mutations).toEqual([]);
      expect(fixture.state.revision).toBe(1);
    });
  });

  test("reconciles an optimistic record after authoritative rejection", async () => {
    await using fixture = await createDataBrowserFixture(notes, {
      principal: { id: "alice" },
    });
    await vi.waitFor(() => expect(fixture.state.synchronization).toBe("synchronized"));

    const optimistic = fixture.actions.create({
      title: "Denied",
      body: "Must be removed",
    });
    expect(fixture.state.entities).toContainEqual(optimistic);
    await vi.waitFor(() => {
      expect(fixture.state.entities).toEqual([]);
      expect(fixture.state.mutations).toEqual([
        expect.objectContaining({
          operation: "create",
          status: "rejected",
        }),
      ]);
    });
    expect(await fixture.api.query()).toEqual({ revision: 0, records: [] });
  });
});

describe("Turso data adapter", () => {
  test("matches the reference store over generated filters, ordering, and pagination", async () => {
    await using turso = nativeStore();
    const memory = createMemoryDataStore<Note>();
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
        await Promise.all([memory.replace(replace), turso.replace(replace)]);
        const [expected, actual] = await Promise.all([
          memory.query({ collection: "conformance", query }),
          turso.query({ collection: "conformance", query }),
        ]);
        expect(actual.map(({ record }) => record)).toEqual(expected.map(({ record }) => record));
      }),
      { numRuns: 75 },
    );
  });

  test("uses Turso FTS filtering with deterministic identity tie breaking", async () => {
    await using store = nativeStore();
    await store.replace({
      collection: "search",
      revision: 1,
      indexes: [],
      search: ["title", "body"],
      records: [
        {
          id: "b",
          ownerId: "alice",
          title: "Distributed systems",
          body: "Build portable distributed systems",
          priority: 1,
          archived: false,
        },
        {
          id: "a",
          ownerId: "alice",
          title: "Portable systems",
          body: "Distributed programs",
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
    const first = await store.query({
      collection: "search",
      query: { text: "distributed systems" },
    });
    const second = await store.query({
      collection: "search",
      query: { text: "distributed systems" },
    });
    expect(first.map(({ record }) => Reflect.get(record as object, "id"))).toEqual(["a", "b"]);
    expect(second).toEqual(first);
  });
});

function nativeStore(): DataStore<Note> & AsyncDisposable {
  return createTursoDataStore<Note>(
    connect(":memory:", {
      experimental: ["index_method"],
    }) as unknown as Promise<TursoDatabase>,
  );
}

function recordsArbitrary(): fc.Arbitrary<readonly Note[]> {
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

function queryArbitrary(): fc.Arbitrary<DataProjectionQuery<Note>> {
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

async function pending<Value>(value: PromiseLike<Value>): Promise<boolean> {
  return Promise.race([
    Promise.resolve(value).then(() => false),
    new Promise<true>((resolve) => setTimeout(() => resolve(true), 25)),
  ]);
}

function dataSystemSource(): string {
  return `
import {
  createData,
  createIdentity,
  createSystem,
  type DataModel,
  type IdentityModel,
} from "@/index";

type Users = IdentityModel<{
  Name: "identity";
  Principal: { id: string };
}>;

const identity = createIdentity<Users>({
  name: "identity",
  principal: (user) => ({ id: user.id }),
});

type Notes = DataModel<{
  Name: "notes";
  Principal: { id: string };
  Record: { id: string; owner: string; title: string };
  Create: { title: string };
  Update: { title?: string };
}>;

const notes = createData<Notes>({
  name: "notes",
  search: ["title"],
  create: ({ id, principal, input }) => ({ id, owner: principal.id, title: input.title }),
  update: ({ previous, input }) => ({
    id: previous.id,
    owner: previous.owner,
    title: input.title ?? previous.title,
  }),
  authorize: ({ principal, record }) => principal.id === record.owner,
});

export default createSystem({
  features: { identity: identity.server, notes: notes.server },
});
`;
}
