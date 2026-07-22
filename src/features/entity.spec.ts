import fc from "fast-check";
import { describe, expect, test, vi } from "vitest";

import type { HttpRequest, HttpResponse } from "@/adapters/server/platform";
import { createProgramContributionInstance } from "@/core/process";
import {
  createEntity,
  type EntityApi,
  type EntityEvent,
  type EntityModel,
} from "@/features/entity";
import { createEntityFixture, createMemoryEventStore } from "@/features/entity.testing";

type Note = Readonly<{ id: string; ownerId: string; text: string; archived: boolean }>;
type Notes = EntityModel<{
  Name: "notes";
  Principal: Readonly<{ id: string }>;
  Value: Note;
  Create: Readonly<{ text: string }>;
  Update: Readonly<{ text?: string; archived?: boolean }>;
  Filter: Readonly<{ archived?: boolean }>;
}>;

const notes = createEntity<Notes>({
  name: "notes",
  create: ({ id, principal, input }) => ({
    id,
    ownerId: principal.id,
    text: input.text,
    archived: false,
  }),
  update: ({ previous, input }) => ({ ...previous, ...input }),
  authorize: ({ principal, entity }) => principal.id === entity.ownerId,
  matches: ({ entity, filter }) =>
    filter.archived === undefined || filter.archived === entity.archived,
});

describe("semantic entity Feature", () => {
  test("authorizes, filters, and streams committed revisions", async () => {
    await using fixture = await createFixture();
    const alice = fixture.api;
    const bob = fixture.as({ id: "bob" });
    const changes = alice.changes()[Symbol.asyncIterator]();

    expect((await changes.next()).value).toEqual({ revision: 0, entities: [] });
    const note = await alice.create({ text: "First" });
    expect((await changes.next()).value).toEqual({ revision: 1, entities: [note] });
    expect((await bob.list()).entities).toEqual([]);
    await expect(bob.update({ id: note.id, changes: { archived: true } })).rejects.toMatchObject({
      code: "not-found",
    });
    await alice.update({ id: note.id, changes: { archived: true } });
    expect((await alice.list({ archived: true })).entities).toHaveLength(1);
    await changes.return?.();
    await alice.create({ text: "After close" });
    expect(await changes.next()).toEqual({ done: true, value: undefined });
  });

  test("rejects structurally invalid domain decisions", async () => {
    const invalid = createEntity<Notes>({
      name: "notes",
      create: ({ id, principal, input }) => ({
        id,
        ownerId: principal.id,
        text: input.text,
        archived: false,
      }),
      update: ({ previous, input }) => ({ ...previous, ...input, id: "changed" }),
      authorize: ({ principal, entity }) => principal.id === entity.ownerId,
    });
    await using fixture = await createEntityFixture(invalid, { principal: { id: "alice" } });
    const created = await fixture.api.create({ text: "One" });
    await expect(fixture.api.update({ id: created.id, changes: { text: "Two" } })).rejects.toThrow(
      "cannot change an entity id",
    );
  });

  test("matches a reference model for generated command sequences", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({ type: fc.constant("create" as const), text: fc.string() }),
            fc.record({ type: fc.constant("toggle" as const), index: fc.nat({ max: 40 }) }),
            fc.record({ type: fc.constant("remove" as const), index: fc.nat({ max: 40 }) }),
          ),
          { maxLength: 80 },
        ),
        async (commands) => {
          await using fixture = await createFixture();
          const model: Note[] = [];
          for (const command of commands) {
            if (command.type === "create") {
              model.push(await fixture.api.create({ text: command.text }));
              continue;
            }
            if (!model.length) continue;
            const index = command.index % model.length;
            const note = model[index]!;
            if (command.type === "toggle") {
              model[index] = await fixture.api.update({
                id: note.id,
                changes: { archived: !note.archived },
              });
            } else {
              await fixture.api.remove({ id: note.id });
              model.splice(index, 1);
            }
          }
          expect((await fixture.api.list()).entities).toEqual(model);
          const stored = await fixture.events.read({ stream: "notes:alice" });
          expect(stored.map(({ revision }) => revision)).toEqual(
            stored.map((_event, index) => index + 1),
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  test("commits atomically at the expected stream revision", async () => {
    const events = createMemoryEventStore<EntityEvent<Note>>();
    const created: EntityEvent<Note> = {
      type: "entity.created",
      entity: { id: "1", ownerId: "alice", text: "One", archived: false },
      at: 1,
    };
    expect(
      await events.append({ stream: "notes:alice", expectedRevision: 0, events: [created] }),
    ).toHaveLength(1);
    expect(
      await events.append({ stream: "notes:alice", expectedRevision: 0, events: [created] }),
    ).toBeUndefined();
    expect(await events.read({ stream: "notes:alice" })).toHaveLength(1);
  });

  test("derives authenticated server and browser APIs from the same model", async () => {
    const events = createMemoryEventStore<EntityEvent<Note>>();
    let handler: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;
    const server = createProgramContributionInstance(notes.programs.server as never, {
      address: { program: "server", feature: "notes" },
      provides: ["notes"],
      capabilities: {
        identity: {
          authenticate: async () => ({ id: "alice" }),
        },
        events,
        identifiers: { create: () => "note-1" },
        clock: { now: () => 1 },
        http: {
          route(input: { handle(request: HttpRequest): Promise<HttpResponse> }) {
            handler = input.handle;
            return { [Symbol.dispose]: () => undefined };
          },
        },
      },
    });
    await server.start();
    const browser = createProgramContributionInstance(notes.programs.browser as never, {
      address: { program: "browser", feature: "notes" },
      provides: ["notes"],
      capabilities: {
        identity: {
          session: async () => ({ user: { id: "alice" } }),
          signIn: async () => ({ user: { id: "alice" } }),
          signUp: async () => ({ user: { id: "alice" } }),
          signOut: async () => undefined,
          subscribe: () => ({ [Symbol.dispose]: () => undefined }),
        },
        http: {
          request(input: {
            path: string;
            method?: string;
            headers?: Readonly<Record<string, string>>;
            body?: string;
            signal?: AbortSignal;
          }) {
            if (!handler) throw new Error("Entity route was not mounted.");
            return responseFromHttp(handler(requestFromWeb(input)));
          },
        },
        storage: createMemoryStore(),
        identifiers: sequenceIdentifiers(),
        scheduler: { after: () => ({ [Symbol.dispose]: () => undefined }) },
      },
    });
    const client = (await browser.start()).notes as EntityApi<Notes>;
    await vi.waitFor(() => {
      expect(browser.ui?.api.synchronization).toBe("synchronized");
    });

    const note = await client.create({ text: "Transport-owned" });
    expect(browser.ui?.api.entities).toEqual([note]);
    await vi.waitFor(async () => {
      expect(await client.list()).toEqual({ revision: 1, entities: [note] });
      expect(browser.ui?.api.mutations).toEqual([]);
    });
    await expect(client.get({ id: "missing" })).rejects.toMatchObject({ code: "not-found" });
    await browser.dispose();
    await server.dispose();
  });

  test("restores pending local intent and commits it exactly once after reconnecting", async () => {
    const events = createMemoryEventStore<EntityEvent<Note>>();
    const storage = createMemoryStore();
    let handler: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;
    let online = true;
    let loseNextResponse = false;
    const server = createProgramContributionInstance(notes.programs.server as never, {
      address: { program: "server", feature: "notes" },
      provides: ["notes"],
      capabilities: {
        identity: { authenticate: async () => ({ id: "alice" }) },
        events,
        identifiers: sequenceIdentifiers("server"),
        clock: { now: () => 1 },
        http: {
          route(input: { handle(request: HttpRequest): Promise<HttpResponse> }) {
            handler = input.handle;
            return { [Symbol.dispose]: () => undefined };
          },
        },
      },
    });
    await server.start();

    const createBrowser = () =>
      createProgramContributionInstance(notes.programs.browser as never, {
        address: { program: "browser", feature: "notes" },
        provides: ["notes"],
        capabilities: {
          identity: {
            session: async () => ({ user: { id: "alice" } }),
            signIn: async () => ({ user: { id: "alice" } }),
            signUp: async () => ({ user: { id: "alice" } }),
            signOut: async () => undefined,
            subscribe: () => ({ [Symbol.dispose]: () => undefined }),
          },
          http: {
            async request(input: {
              path: string;
              method?: string;
              headers?: Readonly<Record<string, string>>;
              body?: string;
              signal?: AbortSignal;
            }) {
              if (!online || !handler) throw new TypeError("offline");
              const response = await responseFromHttp(handler(requestFromWeb(input)));
              if (loseNextResponse && input.method === "POST") {
                loseNextResponse = false;
                throw new TypeError("response lost");
              }
              return response;
            },
          },
          storage,
          identifiers: sequenceIdentifiers("client"),
          scheduler: { after: () => ({ [Symbol.dispose]: () => undefined }) },
        },
      });

    const first = createBrowser();
    await first.start();
    await vi.waitFor(() => expect(first.ui?.api.synchronization).toBe("synchronized"));
    loseNextResponse = true;
    const optimistic = first.ui?.actions.create?.({ text: "Survives restart" }) as Note;
    expect(first.ui?.api.entities).toEqual([optimistic]);
    await vi.waitFor(() => expect(first.ui?.api.synchronization).toBe("offline"));
    await first.dispose();

    online = false;
    const second = createBrowser();
    await second.start();
    await vi.waitFor(() => expect(second.ui?.api.entities).toEqual([optimistic]));
    expect(second.ui?.api.mutations).toHaveLength(1);

    online = true;
    second.ui?.actions.synchronize?.();
    await vi.waitFor(() => {
      expect(second.ui?.api.synchronization).toBe("synchronized");
      expect(second.ui?.api.mutations).toEqual([]);
    });
    expect(await events.read({ stream: "notes:alice" })).toHaveLength(1);
    await second.dispose();
    await server.dispose();
  });
});

function createFixture() {
  return createEntityFixture(notes, { principal: { id: "alice" } });
}

function createMemoryStore() {
  const values = new Map<string, unknown>();
  return {
    async read<Value>(key: string): Promise<Value | undefined> {
      return structuredClone(values.get(key)) as Value | undefined;
    },
    async write<Value>(key: string, value: Value): Promise<void> {
      values.set(key, structuredClone(value));
    },
    async remove(key: string): Promise<void> {
      values.delete(key);
    },
  };
}

function sequenceIdentifiers(prefix = "entity") {
  let next = 0;
  return { create: () => `${prefix}-${++next}` };
}

function requestFromWeb(input: {
  path: string;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}): HttpRequest {
  const url = new URL(input.path, "http://test.local");
  return {
    method: input.method ?? "GET",
    path: url.pathname,
    query: [...url.searchParams].map(([name, value]) => ({ name, value })),
    headers: Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value })),
    body: input.body ?? "",
  };
}

async function responseFromHttp(value: Promise<HttpResponse>): Promise<Response> {
  const response = await value;
  const headers = new Headers();
  for (const { name, value } of response.headers) headers.append(name, value);
  if (response.body !== undefined) {
    return new Response(response.body, { status: response.status, headers });
  }
  const iterator = response.stream?.[Symbol.asyncIterator]();
  const body = iterator
    ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(new TextEncoder().encode(next.value));
        },
        async cancel() {
          await iterator.return?.();
        },
      })
    : null;
  return new Response(body, { status: response.status, headers });
}
