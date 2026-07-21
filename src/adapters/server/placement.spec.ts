import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { placeShard } from "@/adapters/server/placement";

describe("server shard placement", () => {
  it("is stable, order-independent, distinct, and bounded when a node is added", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1 }),
        (key, source, candidate) => {
          const nodes = source.includes(candidate) ? source : [...source, candidate];
          const replicas = Math.min(3, source.length);
          const placed = placeShard({ key, nodes: source, replicas });
          expect(placeShard({ key, nodes: [...source].reverse(), replicas })).toEqual(placed);
          expect(new Set(placed).size).toBe(replicas);
          expect(placeShard({ key, nodes: source, replicas })).toEqual(placed);
          if (nodes.length === source.length || replicas !== 1) return;
          const next = placeShard({ key, nodes, replicas: 1 });
          expect(next[0] === candidate || next[0] === placed[0]).toBe(true);
        },
      ),
    );
  });

  it("rejects ambiguous topology", () => {
    expect(() => placeShard({ key: "a", nodes: ["one", "one"] })).toThrow("unique");
    expect(() => placeShard({ key: "a", nodes: ["one"], replicas: 2 })).toThrow("between one");
  });
});
