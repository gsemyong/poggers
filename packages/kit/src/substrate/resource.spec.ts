import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { defineApp } from "#kernel/app";
import { createJournalAuthority, createSingleNodeSubstrate } from "#substrate/adapter.memory";
import {
  IntentMismatchError,
  JournalCorruptionError,
  createMemoryJournal,
  exportJournal,
  importJournal,
} from "#substrate/journal";
import {
  authorizeResource,
  createResourceIntent,
  executeResourceCommand,
  loadResourceAuthority,
  verifyResources,
} from "#substrate/resource";

type Counter = {
  Key: string;
  State: { value: number };
  Presence: {};
  Events: { Added: { amount: number } };
  Views: {};
  Commands: {
    add: { Input: { amount: number }; Event: "Added" };
    reject: { Input: {}; Error: ["rejected", { reason: string }] };
    noop: { Input: {} };
  };
};

type TestApp = {
  Actor: { id: string };
  Resources: { Counter: Counter };
};

const app = defineApp<TestApp>({
  version: 1,
  identify: ({ token }) => ({ id: token }),
  resources: {
    Counter: {
      state: { value: 0 },
      authorize({ actor }) {
        return actor.id === "owner";
      },
      events: {
        Added({ state, payload }) {
          state.value += payload.amount;
        },
      },
      views: {},
      commands: {
        add(context, { amount }) {
          context.event.Added({ amount });
        },
        reject(context, _input) {
          context.error("rejected", { reason: "no" });
        },
        noop(_context, _input) {},
      },
    },
  },
});

function intent(
  id: string,
  name: "add" | "reject" | "noop",
  input: Readonly<Record<string, unknown>> = {},
) {
  return createResourceIntent(id, {
    resource: "Counter",
    key: "main",
    name,
    args: [input],
    actor: { id: "owner" },
    at: 10,
  });
}

describe("Journal-backed Resource authority", () => {
  test("commits deterministic events and returns a permanent duplicate receipt", async () => {
    const journal = createMemoryJournal();
    const first = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/1", "add", { amount: 2 }),
    );
    const duplicate = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/1", "add", { amount: 2 }),
    );

    expect(first.status).toBe("committed");
    expect(first.record.decision.events[0]).toMatchObject({
      id: "device/1:event:0",
      seq: 1,
      at: 10,
      commandId: "device/1",
    });
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.record).toEqual(first.record);
    expect(
      (await loadResourceAuthority(app, createJournalAuthority(journal), first.record.address))
        .state,
    ).toEqual({
      value: 2,
    });
    await journal.close();
  });

  test("persists rejected and accepted zero-event decisions", async () => {
    const journal = createMemoryJournal();
    const rejected = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/1", "reject"),
    );
    const noop = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/2", "noop"),
    );
    expect(rejected.record.decision).toEqual({
      ok: false,
      error: "rejected",
      data: { reason: "no" },
      events: [],
    });
    expect(noop.record.decision).toEqual({ ok: true, events: [] });
    expect((await journal.load(rejected.record.address)).head.revision).toBe(2);
    await journal.close();
  });

  test("turns oversized command output into one durable terminal decision", async () => {
    const journal = createMemoryJournal();
    const limited = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/limited", "add", { amount: 2 }),
      { decisionBytes: 1_024, eventsPerDecision: 0 },
    );
    const duplicate = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/limited", "add", { amount: 2 }),
      { decisionBytes: 1_024, eventsPerDecision: 0 },
    );

    expect(limited.record.decision).toEqual({
      ok: false,
      error: "decision_limit",
      events: [],
    });
    expect(duplicate.status).toBe("duplicate");
    expect(
      (await loadResourceAuthority(app, createJournalAuthority(journal), limited.record.address))
        .state,
    ).toEqual({
      value: 0,
    });
    await journal.close();
  });

  test("evaluates command authority against the same Resource revision", async () => {
    const journal = createMemoryJournal();
    const forbidden = createResourceIntent("intruder/1", {
      resource: "Counter",
      key: "main",
      name: "add",
      args: [{ amount: 5 }],
      actor: { id: "intruder" },
      at: 10,
    });
    const result = await executeResourceCommand(app, createJournalAuthority(journal), forbidden);

    expect(result.record.decision).toEqual({ ok: false, error: "forbidden", events: [] });
    expect(
      (await loadResourceAuthority(app, createJournalAuthority(journal), result.record.address))
        .state,
    ).toEqual({
      value: 0,
    });
    expect(
      (await executeResourceCommand(app, createJournalAuthority(journal), forbidden)).status,
    ).toBe("duplicate");
    await journal.close();
  });

  test("rejects intent ID reuse with different input", async () => {
    const journal = createMemoryJournal();
    await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/1", "add", { amount: 1 }),
    );
    await expect(
      executeResourceCommand(
        app,
        createJournalAuthority(journal),
        intent("device/1", "add", { amount: 2 }),
      ),
    ).rejects.toBeInstanceOf(IntentMismatchError);
    await journal.close();
  });

  test("reevaluates a stale concurrent command after Resource-head conflict", async () => {
    const journal = createMemoryJournal();
    const [first, second] = await Promise.all([
      executeResourceCommand(
        app,
        createJournalAuthority(journal),
        intent("device/1", "add", { amount: 2 }),
      ),
      executeResourceCommand(
        app,
        createJournalAuthority(journal),
        intent("device/2", "add", { amount: 3 }),
      ),
    ]);
    expect(first.status).toBe("committed");
    expect(second.status).toBe("committed");
    expect(
      (await loadResourceAuthority(app, createJournalAuthority(journal), first.record.address))
        .state,
    ).toEqual({
      value: 5,
    });
    await journal.close();
  });

  test("fails closed when a snapshot state checksum is not authoritative", async () => {
    const journal = createMemoryJournal();
    const first = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/1", "add", { amount: 2 }),
    );
    const snapshot = app.snapshot({ value: 2 }, 1);
    await journal.saveSnapshot({
      address: first.record.address,
      revision: first.record.revision,
      position: first.record.position,
      schema: "version:1",
      stateHash: "not-the-state-hash",
      state: snapshot,
      storedAt: 1,
    });
    await expect(
      loadResourceAuthority(app, createJournalAuthority(journal), first.record.address),
    ).rejects.toBeInstanceOf(JournalCorruptionError);
    await journal.close();
  });

  test("rejects a self-consistent snapshot that disagrees with retained history", async () => {
    const journal = createMemoryJournal();
    const first = await executeResourceCommand(
      app,
      createJournalAuthority(journal),
      intent("device/1", "add", { amount: 2 }),
    );
    const state = app.snapshot({ value: 999 }, 1);
    await journal.saveSnapshot({
      address: first.record.address,
      revision: first.record.revision,
      position: first.record.position,
      schema: "version:1",
      stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
      state,
      storedAt: 1,
    });

    await expect(verifyResources(app, createSingleNodeSubstrate(journal))).rejects.toThrow(
      "Snapshot and retained history disagree",
    );
    await journal.close();
  });

  test("restores snapshot plus tail into a fresh adapter with identical Resource semantics", async () => {
    const source = createMemoryJournal();
    const first = await executeResourceCommand(
      app,
      createJournalAuthority(source),
      intent("device/1", "add", { amount: 2 }),
    );
    const snapshotState = app.snapshot({ value: 2 }, 1);
    await source.saveSnapshot({
      address: first.record.address,
      revision: first.record.revision,
      position: first.record.position,
      schema: "version:1",
      stateHash: createHash("sha256").update(JSON.stringify(snapshotState)).digest("hex"),
      state: snapshotState,
      storedAt: 1,
    });
    await executeResourceCommand(
      app,
      createJournalAuthority(source),
      intent("device/2", "add", { amount: 3 }),
    );
    await executeResourceCommand(app, createJournalAuthority(source), intent("device/3", "reject"));

    const archive = await exportJournal(source);
    const restored = createMemoryJournal();
    await importJournal(restored, archive);
    await verifyResources(app, createSingleNodeSubstrate(restored));

    const sourceState = await loadResourceAuthority(
      app,
      createJournalAuthority(source),
      first.record.address,
    );
    const restoredState = await loadResourceAuthority(
      app,
      createJournalAuthority(restored),
      first.record.address,
    );
    expect(restoredState).toEqual(sourceState);
    expect((await restored.receipt(first.record.address, "device/3"))?.decision).toEqual({
      ok: false,
      error: "rejected",
      data: { reason: "no" },
      events: [],
    });
    await Promise.all([source.close(), restored.close()]);
  });

  test("fails semantic startup verification before serving an unknown Resource", async () => {
    const journal = createMemoryJournal();
    await journal.append({
      address: { resource: "Removed", key: "main" },
      expected: { revision: 0, position: 0 },
      record: {
        schema: "removed:1",
        intent: { id: "old/1", inputHash: "old", value: { removed: true } },
        decision: { ok: true, events: [] },
      },
    });

    await expect(verifyResources(app, createSingleNodeSubstrate(journal))).rejects.toThrow(
      "unknown Resource",
    );
    await journal.close();
  });
});

test("grant/use, revoke/use, expiry, and device recovery serialize through Resource state", async () => {
  type VaultApp = {
    Actor: { id: string };
    Resources: {
      Vault: {
        Key: string;
        State: { members: string[]; uses: string[] };
        Events: {
          granted: { actor: string };
          revoked: { actor: string };
          expired: { actor: string };
          used: { actor: string };
        };
        Views: { uses: readonly string[] };
        Commands: {
          grant: { Input: { actor: string }; Event: "granted" };
          revoke: { Input: { actor: string }; Event: "revoked" };
          expire: { Input: { actor: string }; Event: "expired" };
          use: { Input: {}; Event: "used" };
        };
      };
    };
  };
  const vault = defineApp<VaultApp>({
    version: 1,
    resources: {
      Vault: {
        state: { members: [], uses: [] },
        authorize({ state, actor, operation }) {
          if (actor.id === "owner") return true;
          return (
            state.members.includes(actor.id) &&
            (operation.type === "read" || operation.name === "use")
          );
        },
        events: {
          granted({ state, payload }) {
            if (!state.members.includes(payload.actor)) state.members.push(payload.actor);
          },
          revoked({ state, payload }) {
            state.members = state.members.filter((actor) => actor !== payload.actor);
          },
          expired({ state, payload }) {
            state.members = state.members.filter((actor) => actor !== payload.actor);
          },
          used({ state, payload }) {
            state.uses.push(payload.actor);
          },
        },
        views: { uses: ({ state }) => state.uses },
        commands: {
          grant(context, { actor }) {
            context.event.granted({ actor });
          },
          revoke(context, { actor }) {
            context.event.revoked({ actor });
          },
          expire(context, { actor }) {
            context.event.expired({ actor });
          },
          use(context) {
            context.event.used({ actor: context.actor.id });
          },
        },
      },
    },
  });
  const journal = createMemoryJournal();
  const command = (
    id: string,
    actor: string,
    name: "grant" | "revoke" | "expire" | "use",
    input: { readonly actor: string } | {},
  ) =>
    executeResourceCommand(
      vault,
      createJournalAuthority(journal),
      createResourceIntent(id, {
        resource: "Vault",
        key: "primary",
        name,
        args: [input],
        actor: { id: actor },
        at: 1,
      }),
    );

  await command("owner/grant", "owner", "grant", { actor: "device" });
  const [revoked, used] = await Promise.all([
    command("owner/revoke", "owner", "revoke", { actor: "device" }),
    command("device/use", "device", "use", {}),
  ]);
  const useDecision = used.record.decision;
  if (used.record.position < revoked.record.position) {
    expect(useDecision.ok).toBe(true);
  } else {
    expect(useDecision).toEqual({ ok: false, error: "forbidden", events: [] });
  }

  const authority = await loadResourceAuthority(vault, createJournalAuthority(journal), {
    resource: "Vault",
    key: "primary",
  });
  expect(authority.state).toEqual({
    members: [],
    uses: useDecision.ok ? ["device"] : [],
  });
  expect(
    authorizeResource(vault, "Vault", authority.state, { id: "device" }, "primary", {
      type: "read",
    }),
  ).toBe(false);
  expect((await command("device/future", "device", "use", {})).record.decision).toEqual({
    ok: false,
    error: "forbidden",
    events: [],
  });

  await command("owner/grant-expiring", "owner", "grant", { actor: "expiring-device" });
  expect((await command("expiring/use", "expiring-device", "use", {})).record.decision.ok).toBe(
    true,
  );
  await command("owner/expire", "owner", "expire", { actor: "expiring-device" });
  const expired = await loadResourceAuthority(vault, createJournalAuthority(journal), {
    resource: "Vault",
    key: "primary",
  });
  expect(expired.state).toEqual({
    members: [],
    uses: [...(useDecision.ok ? ["device"] : []), "expiring-device"],
  });
  expect(
    authorizeResource(vault, "Vault", expired.state, { id: "expiring-device" }, "primary", {
      type: "read",
    }),
  ).toBe(false);
  expect((await command("expiring/future", "expiring-device", "use", {})).record.decision).toEqual({
    ok: false,
    error: "forbidden",
    events: [],
  });
  await journal.close();
});

test("lets authorization distinguish client and Program reads and commands", async () => {
  const app = defineApp<{
    Resources: {
      workflow: {
        Key: string;
        State: { completed: boolean };
        Events: { completed: {} };
        Views: { completed: boolean };
        Commands: { complete: { Input: {}; Event: "completed"; Error: never } };
      };
    };
  }>({
    version: 1,
    resources: {
      workflow: {
        state: { completed: false },
        authorize({ operation }) {
          return operation.origin === "program";
        },
        events: {
          completed({ state }) {
            state.completed = true;
          },
        },
        views: { completed: ({ state }) => state.completed },
        commands: {
          complete(ctx) {
            ctx.event.completed({});
          },
        },
      },
    },
  });
  const journal = createMemoryJournal();
  const execute = (id: string, origin?: "client" | "program") =>
    executeResourceCommand(
      app,
      createJournalAuthority(journal),
      createResourceIntent(id, {
        resource: "workflow",
        key: "one",
        name: "complete",
        args: [{}],
        actor: { id: "owner" },
        at: 1,
        ...(origin ? { origin } : {}),
      }),
    );

  expect(
    authorizeResource(app, "workflow", { completed: false }, { id: "owner" }, "one", {
      type: "read",
    }),
  ).toBe(false);
  expect(
    authorizeResource(app, "workflow", { completed: false }, { id: "owner" }, "one", {
      type: "read",
      origin: "program",
    }),
  ).toBe(true);
  expect((await execute("client")).record.decision).toEqual({
    ok: false,
    error: "forbidden",
    events: [],
  });
  expect((await execute("program", "program")).record.decision.ok).toBe(true);
  await journal.close();
});
