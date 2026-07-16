import { describe, expect, test } from "bun:test";

import type { JsonValue } from "#kernel/app";
import { maxProtocolBatch, scopeId, type CommittedEvent } from "#substrate/protocol";
import { computeSync } from "#substrate/sync";
import { createTestApp } from "#testing/test-app";

const app = createTestApp("test-token");
const resource = "counter";

function createEvent(seq: number, payload: JsonValue = {}): CommittedEvent {
  return {
    id: `event-${seq}`,
    seq,
    at: 1_000 + seq,
    actor: { id: "user", name: "User" },
    name: "incremented",
    payload,
  };
}

function createSyncState() {
  return {
    eventBuffers: new Map<string, unknown[]>(),
    states: new Map<string, unknown>(),
    instanceSeqs: new Map<string, number>(),
  };
}

describe("synchronization planning", () => {
  test("creates the initial snapshot for a fresh Resource", () => {
    const state = createSyncState();
    const result = computeSync(
      resource,
      { counterId: "fresh" },
      0,
      state.eventBuffers,
      state.states,
      state.instanceSeqs,
      app,
      "generation",
    );

    expect(result).toMatchObject({ cursor: 0, snapshot: { generation: "generation" } });
    expect(result.events).toBeUndefined();
  });

  test("uses loaded state when a client needs a snapshot", () => {
    const key = { counterId: "loaded" };
    const id = scopeId(resource, key);
    const state = createSyncState();
    state.states.set(id, app.createState(resource));
    state.instanceSeqs.set(id, 5);

    const result = computeSync(
      resource,
      key,
      0,
      state.eventBuffers,
      state.states,
      state.instanceSeqs,
      app,
      "generation",
    );

    expect(result).toMatchObject({ cursor: 5, snapshot: { data: { count: 0 } } });
  });

  test("falls back to a snapshot before the retained event window", () => {
    const key = { counterId: "trimmed" };
    const id = scopeId(resource, key);
    const state = createSyncState();
    const retained = Array.from({ length: maxProtocolBatch }, (_, index) =>
      createEvent(index + 51, { amount: 1 }),
    );
    state.eventBuffers.set(id, retained);
    state.states.set(id, app.createState(resource));
    state.instanceSeqs.set(id, maxProtocolBatch + 50);

    const result = computeSync(
      resource,
      key,
      retained[0]!.seq - 1,
      state.eventBuffers,
      state.states,
      state.instanceSeqs,
      app,
      "generation",
    );

    expect(result.snapshot).toBeDefined();
    expect(result.cursor).toBe(maxProtocolBatch + 50);
  });

  test("returns only contiguous events after a cursor in the retained window", () => {
    const key = { counterId: "delta" };
    const id = scopeId(resource, key);
    const state = createSyncState();
    state.instanceSeqs.set(id, 7);
    state.eventBuffers.set(id, [createEvent(5), createEvent(6), createEvent(7)]);

    const result = computeSync(
      resource,
      key,
      5,
      state.eventBuffers,
      state.states,
      state.instanceSeqs,
      app,
      "generation",
    );

    expect(result.snapshot).toBeUndefined();
    expect(result.events).toEqual([createEvent(6), createEvent(7)]);
    expect(result.cursor).toBe(7);
  });

  test("returns no events for a current cursor", () => {
    const key = { counterId: "current" };
    const id = scopeId(resource, key);
    const state = createSyncState();
    state.instanceSeqs.set(id, 10);
    state.eventBuffers.set(id, [createEvent(10)]);

    const result = computeSync(
      resource,
      key,
      10,
      state.eventBuffers,
      state.states,
      state.instanceSeqs,
      app,
      "generation",
    );

    expect(result).toEqual({ cursor: 10 });
  });
});
