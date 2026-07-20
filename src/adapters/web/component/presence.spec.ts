import { describe, expect, it } from "vitest";

import { PresenceGraph } from "./presence";

describe("web Component presence identity", () => {
  it("reclaims a keyed outgoing node without duplicating structural ownership", () => {
    const graph = new PresenceGraph<object>();
    const firstTarget = {};
    const first = graph.register({
      owner: "List",
      element: "Row",
      key: "one",
      target: firstTarget,
    });
    graph.setPresence(first, "exiting");

    const replacementTarget = {};
    const replacement = graph.register({
      owner: "List",
      element: "Row",
      key: "one",
      target: replacementTarget,
    });

    expect(replacement).toBe(first);
    expect(replacement.target).toBe(replacementTarget);
    expect(replacement.presence).toBe("present");
    expect(graph.size).toBe(1);
    expect(graph.roots).toEqual([replacement]);
  });

  it("preserves hierarchy and releases every node exactly once", () => {
    const graph = new PresenceGraph<object>();
    const parent = graph.register({ owner: "Panel", element: "Root", target: {} });
    const first = graph.register({
      owner: "Panel",
      element: "Item",
      key: "first",
      target: {},
      parent,
    });
    const second = graph.register({
      owner: "Panel",
      element: "Item",
      key: "second",
      target: {},
      parent,
    });

    graph.reparent(second, parent, 0);
    expect(parent.children).toEqual([second, first]);

    graph.detach(parent);
    expect(graph.size).toBe(0);
    expect(graph.roots).toEqual([]);
    expect(parent.presence).toBe("detached");
    expect(first.presence).toBe("detached");
    expect(second.presence).toBe("detached");

    graph.dispose();
    expect(graph.size).toBe(0);
  });
});
