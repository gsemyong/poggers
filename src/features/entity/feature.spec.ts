import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { defineEntityFeature, type EntityEvent } from "@/features/entity/feature";
import {
  createEntityFixture,
  createIdentity,
  createMemoryEventStore,
} from "@/features/entity/testing";

type Note = Readonly<{ id: string; ownerId: string; text: string; archived: boolean }>;
type Notes = Readonly<{
  Name: "notes";
  Credentials: Readonly<{ user: string }>;
  Principal: Readonly<{ id: string }>;
  Entity: Note;
  Create: Readonly<{ text: string }>;
  Update: Readonly<{ text?: string; archived?: boolean }>;
  Query: Readonly<{ archived?: boolean }>;
}>;

const notes = defineEntityFeature<Notes>({
  name: "notes",
  create: ({ id, principal, value }) => ({
    id,
    ownerId: principal.id,
    text: value.text,
    archived: false,
  }),
  update: ({ previous, value }) => ({ ...previous, ...value }),
  authorize: ({ principal, entity }) => principal.id === entity.ownerId,
  matches: ({ entity, query }) =>
    query.archived === undefined || query.archived === entity.archived,
});

describe("event-sourced entity Feature", () => {
  test("authenticates, authorizes, filters, and streams committed revisions", async () => {
    await using fixture = createFixture();
    const alice = { user: "alice" };
    const bob = { user: "bob" };
    const changes = fixture.service.changes({ credentials: alice })[Symbol.asyncIterator]();

    expect((await changes.next()).value).toEqual({ revision: 0, entities: [] });
    const note = await fixture.service.create({ credentials: alice, value: { text: "First" } });
    expect((await changes.next()).value).toEqual({ revision: 1, entities: [note] });
    expect((await fixture.service.list({ credentials: bob })).entities).toEqual([]);
    await expect(
      fixture.service.update({ credentials: bob, id: note.id, value: { archived: true } }),
    ).rejects.toMatchObject({ code: "not-found" });
    await fixture.service.update({ credentials: alice, id: note.id, value: { archived: true } });
    expect(
      (await fixture.service.list({ credentials: alice, query: { archived: true } })).entities,
    ).toHaveLength(1);
    await changes.return?.();
    await fixture.service.create({ credentials: alice, value: { text: "After close" } });
    expect(await changes.next()).toEqual({ done: true, value: undefined });
  });

  test("rejects unauthenticated and structurally invalid domain decisions", async () => {
    await using unauthenticated = createEntityFixture(notes, {
      identity: createIdentity((_credentials: { user: string }) => undefined),
    });
    await expect(
      unauthenticated.service.list({ credentials: { user: "missing" } }),
    ).rejects.toMatchObject({ code: "unauthenticated" });

    const invalid = defineEntityFeature<Notes>({
      name: "notes",
      create: ({ id, principal, value }) => ({
        id,
        ownerId: principal.id,
        text: value.text,
        archived: false,
      }),
      update: ({ previous, value }) => ({ ...previous, ...value, id: "changed" }),
      authorize: ({ principal, entity }) => principal.id === entity.ownerId,
    });
    await using fixture = createEntityFixture(invalid, {
      identity: createIdentity(({ user }: { user: string }) => ({ id: user })),
    });
    const credentials = { user: "alice" };
    const created = await fixture.service.create({ credentials, value: { text: "One" } });
    await expect(
      fixture.service.update({ credentials, id: created.id, value: { text: "Two" } }),
    ).rejects.toThrow("cannot change an entity id");
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
          await using fixture = createFixture();
          const credentials = { user: "alice" };
          const model: Note[] = [];
          for (const command of commands) {
            if (command.type === "create") {
              model.push(
                await fixture.service.create({
                  credentials,
                  value: { text: command.text },
                }),
              );
              continue;
            }
            if (!model.length) continue;
            const index = command.index % model.length;
            const note = model[index]!;
            if (command.type === "toggle") {
              model[index] = await fixture.service.update({
                credentials,
                id: note.id,
                value: { archived: !note.archived },
              });
            } else {
              await fixture.service.remove({ credentials, id: note.id });
              model.splice(index, 1);
            }
          }
          expect((await fixture.service.list({ credentials })).entities).toEqual(model);
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
});

function createFixture() {
  return createEntityFixture(notes, {
    identity: createIdentity(({ user }: { user: string }) => ({ id: user })),
  });
}
