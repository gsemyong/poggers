import { describe, it, expect } from "bun:test";
import {
  createSingleNodePubSub,
  createSingleNodeSequencer,
  createSingleNodeAdapter,
} from "./single-node";
import { createMemoryStore } from "tests/helpers/memory-storage";

describe("single-node pubsub", () => {
  it("delivers published message to subscriber", () => {
    const pubsub = createSingleNodePubSub();
    const received: unknown[] = [];
    pubsub.subscribe("scope-a", (msg) => received.push(msg));
    pubsub.publish("scope-a", { type: "test", value: 42 });
    expect(received).toEqual([{ type: "test", value: 42 }]);
  });

  it("does not deliver after unsubscribe", () => {
    const pubsub = createSingleNodePubSub();
    const received: unknown[] = [];
    const unsub = pubsub.subscribe("scope-a", (msg) => received.push(msg));
    unsub();
    pubsub.publish("scope-a", { type: "test" });
    expect(received).toEqual([]);
  });

  it("isolates messages by scope", () => {
    const pubsub = createSingleNodePubSub();
    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    pubsub.subscribe("scope-a", (msg) => receivedA.push(msg));
    pubsub.subscribe("scope-b", (msg) => receivedB.push(msg));
    pubsub.publish("scope-a", { type: "a" });
    pubsub.publish("scope-b", { type: "b" });
    expect(receivedA).toEqual([{ type: "a" }]);
    expect(receivedB).toEqual([{ type: "b" }]);
  });

  it("delivers to multiple subscribers of the same scope", () => {
    const pubsub = createSingleNodePubSub();
    const r1: unknown[] = [];
    const r2: unknown[] = [];
    pubsub.subscribe("scope-a", (msg) => r1.push(msg));
    pubsub.subscribe("scope-a", (msg) => r2.push(msg));
    pubsub.publish("scope-a", { type: "x" });
    expect(r1).toEqual([{ type: "x" }]);
    expect(r2).toEqual([{ type: "x" }]);
  });
});

describe("single-node sequencer", () => {
  it("allocates sequential numbers", () => {
    const seq = createSingleNodeSequencer();
    expect(seq.next("scope-a")).toBe(1);
    expect(seq.next("scope-a")).toBe(2);
    expect(seq.next("scope-a")).toBe(3);
  });

  it("isolates sequences by scope", () => {
    const seq = createSingleNodeSequencer();
    expect(seq.next("scope-a")).toBe(1);
    expect(seq.next("scope-b")).toBe(1);
    expect(seq.next("scope-a")).toBe(2);
    expect(seq.next("scope-b")).toBe(2);
  });

  it("starts at 1 for unknown scopes", () => {
    const seq = createSingleNodeSequencer();
    expect(seq.next("new-scope")).toBe(1);
  });
});

describe("single-node adapter", () => {
  it("wraps storage, pubsub, and sequencer", () => {
    const storage = createMemoryStore();
    const adapter = createSingleNodeAdapter(storage);
    expect(adapter.storage).toBe(storage);
    expect(adapter.pubsub).toBeDefined();
    expect(adapter.sequencer).toBeDefined();
  });

  it("pubsub works through adapter", () => {
    const storage = createMemoryStore();
    const adapter = createSingleNodeAdapter(storage);
    const received: unknown[] = [];
    adapter.pubsub.subscribe("s", (msg) => received.push(msg));
    adapter.pubsub.publish("s", { x: 1 });
    expect(received).toEqual([{ x: 1 }]);
  });

  it("sequencer works through adapter", () => {
    const storage = createMemoryStore();
    const adapter = createSingleNodeAdapter(storage);
    expect(adapter.sequencer.next("s")).toBe(1);
    expect(adapter.sequencer.next("s")).toBe(2);
  });
});
