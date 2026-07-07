import { describe, it, expect } from "bun:test";
import { createSingleNodePubSub } from "infra/store/single-node";

describe("ServerPubSub contract", () => {
  it("delivers to subscriber", () => {
    const pubsub = createSingleNodePubSub();
    const msgs: unknown[] = [];
    pubsub.subscribe("channel", (m) => msgs.push(m));
    pubsub.publish("channel", { x: 1 });
    expect(msgs).toEqual([{ x: 1 }]);
  });

  it("does not deliver after unsubscribe", () => {
    const pubsub = createSingleNodePubSub();
    const msgs: unknown[] = [];
    const unsub = pubsub.subscribe("channel", (m) => msgs.push(m));
    unsub();
    pubsub.publish("channel", { x: 1 });
    expect(msgs).toEqual([]);
  });

  it("delivers to multiple subscribers on same channel", () => {
    const pubsub = createSingleNodePubSub();
    const a: unknown[] = [];
    const b: unknown[] = [];
    pubsub.subscribe("ch", (m) => a.push(m));
    pubsub.subscribe("ch", (m) => b.push(m));
    pubsub.publish("ch", { y: 2 });
    expect(a).toEqual([{ y: 2 }]);
    expect(b).toEqual([{ y: 2 }]);
  });

  it("isolates channels", () => {
    const pubsub = createSingleNodePubSub();
    const a: unknown[] = [];
    const b: unknown[] = [];
    pubsub.subscribe("a", (m) => a.push(m));
    pubsub.subscribe("b", (m) => b.push(m));
    pubsub.publish("a", { t: "a" });
    pubsub.publish("b", { t: "b" });
    expect(a).toEqual([{ t: "a" }]);
    expect(b).toEqual([{ t: "b" }]);
  });

  it("unsubscribe only affects its channel", () => {
    const pubsub = createSingleNodePubSub();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsub = pubsub.subscribe("a", (m) => a.push(m));
    pubsub.subscribe("b", (m) => b.push(m));
    unsub();
    pubsub.publish("a", { t: "a" });
    pubsub.publish("b", { t: "b" });
    expect(a).toEqual([]);
    expect(b).toEqual([{ t: "b" }]);
  });
});
