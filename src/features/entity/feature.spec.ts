import fc from "fast-check";
import { describe, expect, test, vi } from "vitest";

import {
  createEntity,
  createEntityBrowserFixture,
  createEntityFixture,
  type EntityEvent,
  type EntityModel,
} from "@/features/entity";
import { createMemoryEventStore } from "@/testing/event-store";

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
  test("bounds in-memory EventStore reads without changing stream revisions", async () => {
    const events = createMemoryEventStore<{ value: number }>();
    await events.append({
      stream: "bounded",
      expectedRevision: 0,
      events: [{ value: 1 }, { value: 2 }, { value: 3 }],
    });

    await expect(events.read({ stream: "bounded", limit: 2 })).resolves.toEqual([
      { stream: "bounded", revision: 1, event: { value: 1 } },
      { stream: "bounded", revision: 2, event: { value: 2 } },
    ]);
    await expect(events.read({ stream: "bounded", after: 2, limit: 1 })).resolves.toEqual([
      { stream: "bounded", revision: 3, event: { value: 3 } },
    ]);
  });

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
      create: ({ id, principal, input }) => ({
        id,
        ownerId: principal.id,
        text: input.text,
        archived: false,
      }),
      update: ({ previous, input }) => ({ ...previous, ...input, id: "changed" }),
      authorize: ({ principal, entity }) => principal.id === entity.ownerId,
    });
    await using fixture = await createEntityFixture(invalid, {
      principal: { id: "alice" },
    });
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
    await using fixture = await createEntityBrowserFixture(notes, {
      principal: { id: "alice" },
    });
    await vi.waitFor(() => {
      expect(fixture.state.synchronization).toBe("synchronized");
    });

    const note = await fixture.api.create({ text: "Transport-owned" });
    expect(fixture.state.entities).toEqual([note]);
    await vi.waitFor(async () => {
      expect(await fixture.api.list()).toEqual({ revision: 1, entities: [note] });
      expect(fixture.state.mutations).toEqual([]);
    });
    await expect(fixture.api.get({ id: "missing" })).rejects.toMatchObject({ code: "not-found" });
  });

  test("restores pending local intent and commits it exactly once after reconnecting", async () => {
    await using fixture = await createEntityBrowserFixture(notes, {
      principal: { id: "alice" },
    });
    await vi.waitFor(() => expect(fixture.state.synchronization).toBe("synchronized"));
    fixture.dropNextMutationResponse();
    const optimistic = fixture.actions.create({ text: "Survives restart" });
    expect(fixture.state.entities).toEqual([optimistic]);
    await vi.waitFor(() => expect(fixture.state.synchronization).toBe("offline"));

    fixture.disconnect();
    await fixture.restart();
    await vi.waitFor(() => expect(fixture.state.entities).toEqual([optimistic]));
    expect(fixture.state.mutations).toHaveLength(1);

    fixture.reconnect();
    await vi.waitFor(() => {
      expect(fixture.state.synchronization).toBe("synchronized");
      expect(fixture.state.mutations).toEqual([]);
    });
    expect(await fixture.events.read({ stream: "entity:alice" })).toHaveLength(1);
  });
});

function createFixture() {
  return createEntityFixture(notes, { principal: { id: "alice" } });
}
