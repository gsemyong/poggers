import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { connect } from "@tursodatabase/database";
import { describe, expect, test, vi } from "vitest";

import { compileSystem } from "@/compiler/source";
import {
  createDataBrowserFixture,
  createDataFixture,
  createData,
  createMemoryDataStore,
  createTursoDataStore,
  type DataModel,
  type DataStore,
  type TursoDatabase,
} from "@/features/data";
import { dataStoreConformance } from "@/features/data/testing";
import { serverCompilerExtension, serverProgramExecution } from "@/platforms/server/adapter";
import { rustServerDependencyTarget } from "@/platforms/server/adapter/rust/testing";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";

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

dataStoreConformance.test({
  name: "memory TypeScript",
  create: () => ({
    api: createMemoryStore(),
    dispose() {},
  }),
});

dataStoreConformance.test(
  rustServerDependencyTarget({
    name: "Turso Rust",
    provider: {
      name: "data",
      dependency: "dataStore",
      ...notes.providers!.server.dataStore.production,
      crate: {
        ...notes.providers!.server.dataStore.production.crate,
        directory: resolve(import.meta.dirname, "providers/server/rust"),
      },
    },
    async configuration() {
      const directory = await mkdtemp(resolve(tmpdir(), "data-conformance-"));
      return {
        values: { database: resolve(directory, "data.turso") },
        dispose: () => rm(directory, { force: true, recursive: true }),
      };
    },
  }),
);

dataStoreConformance.test({
  name: "Turso TypeScript",
  create: () => {
    const api = tursoStore();
    return {
      api,
      dispose: () => api[Symbol.asyncDispose](),
    };
  },
});

describe("semantic data Feature", () => {
  test("opens a lazy browser database only when Data is first used", async () => {
    let opens = 0;
    let closes = 0;
    const database = (): Promise<TursoDatabase> => {
      opens += 1;
      return Promise.resolve({
        exec: async () => undefined,
        batch: async () => undefined,
        all: async () => [],
        close: async () => {
          closes += 1;
        },
      });
    };
    const store = createTursoDataStore<Note>(database);

    expect(opens).toBe(0);
    await expect(store.query({ collection: "notes", query: {} })).resolves.toEqual([]);
    await expect(store.query({ collection: "notes", query: {} })).resolves.toEqual([]);
    expect(opens).toBe(1);

    await store[Symbol.asyncDispose]();
    expect(closes).toBe(1);

    const unused = createTursoDataStore<Note>(database);
    await unused[Symbol.asyncDispose]();
    expect(opens).toBe(1);
  });

  test("lowers a specialized factory through the production semantic compiler", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "data-compiler-"));
    try {
      const entry = resolve(directory, "system.ts");
      await Promise.all([
        writeFile(entry, dataSystemSource()),
        writeFile(
          resolve(directory, "tsconfig.json"),
          JSON.stringify({
            extends: resolve(import.meta.dirname, "../../../tsconfig.json"),
            include: ["system.ts"],
            exclude: [],
            compilerOptions: {
              paths: { "@/*": [resolve(import.meta.dirname, "../../*")] },
            },
          }),
        ),
      ]);
      const ir = compileSystem(entry, [serverCompilerExtension, webCompilerExtension]);
      const contributions = ir.programs.find(({ name }) => name === "server")!.contributions;
      expect(
        contributions
          .map((contribution) => ({
            id: contribution.id,
            implementation: serverProgramExecution(contribution),
          }))
          .filter(({ implementation }) => implementation.kind !== "portable"),
      ).toEqual([]);
      expect(contributions).toHaveLength(3);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  test("packages authorized event-sourced writes, typed queries, and local full-text search", async () => {
    await using store = tursoStore();
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
    expect(await fixture.events.read({ stream: "dataSource:alice" })).toHaveLength(4);
  });

  test("does not emit a live query when an unrelated source revision changes", async () => {
    await using fixture = await createDataFixture(notes, {
      principal: { id: "alice" },
    });
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
    await using store = tursoStore();
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

function tursoStore(): DataStore<Note> & AsyncDisposable {
  return createTursoDataStore<Note>(
    connect(":memory:", {
      experimental: ["index_method"],
    }) as unknown as Promise<TursoDatabase>,
  );
}

function createMemoryStore(): DataStore<Note> {
  return createMemoryDataStore<Note>();
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
  createSystem,
} from "@/index";
import { createData, type DataModel } from "@/features/data";
import { createIdentity, type IdentityModel } from "@/features/identity";

type Users = IdentityModel<{
  Name: "identity";
  Principal: { id: string };
}>;

const identity = createIdentity<Users>({
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
  features: { identity, notes },
});
`;
}
