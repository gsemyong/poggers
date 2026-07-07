import { describe, it, expect } from "bun:test";
import fc from "fast-check";
import { scopeId, validateClientMessage, validateServerMessage } from "./protocol";
import { jsonObjectKey } from "tests/helpers/json-arbitraries";

describe("protocol", () => {
  describe("scopeId collision resistance", () => {
    it("distinguishes string 1 from number 1", () => {
      expect(scopeId("r", "1")).not.toBe(scopeId("r", 1));
    });

    it("distinguishes string true from boolean true", () => {
      expect(scopeId("r", "true")).not.toBe(scopeId("r", true));
    });

    it("distinguishes string false from boolean false", () => {
      expect(scopeId("r", "false")).not.toBe(scopeId("r", false));
    });

    it("distinguishes string null from null", () => {
      expect(scopeId("r", "null")).not.toBe(scopeId("r", null));
    });

    it("distinguishes array-like string from actual array", () => {
      expect(scopeId("r", "[a,b]")).not.toBe(scopeId("r", ["a", "b"]));
    });

    it("distinguishes object-like string from actual object", () => {
      expect(scopeId("r", '{"a":1}')).not.toBe(scopeId("r", { a: 1 }));
    });

    it("distinguishes string with @ from resource separator", () => {
      const id1 = scopeId("chat", "room@1");
      const id2 = scopeId("chat@room", "1");
      expect(id1).not.toBe(id2);
    });

    it("distinguishes array with nested array from similar string", () => {
      expect(scopeId("r", ["a,b"])).not.toBe(scopeId("r", "a,b"));
    });

    it("different numbers produce different IDs", () => {
      expect(scopeId("r", 1)).not.toBe(scopeId("r", 2));
      expect(scopeId("r", -1)).not.toBe(scopeId("r", 1));
      expect(scopeId("r", 0)).not.toBe(scopeId("r", 1));
    });

    it("object keys with special characters are safe", () => {
      const k = { "a:b": 1, "c,d": 2 };
      expect(scopeId("r", k)).toBe(scopeId("r", k));
      expect(scopeId("r", k)).not.toBe(scopeId("r", { a: "b:1" }));
    });

    it("different objects with same serialized string are distinct", () => {
      expect(scopeId("r", { a: 1, b: 2 })).not.toBe(scopeId("r", { "a:1": 0, "b:2": 0 }));
    });

    it("empty array and empty object are distinct", () => {
      expect(scopeId("r", [])).not.toBe(scopeId("r", {}));
    });
  });

  describe("object key ordering", () => {
    it("different insertion orders produce same ID", () => {
      const k1: Record<string, number> = {};
      k1.a = 1;
      k1.b = 2;
      const k2: Record<string, number> = {};
      k2.b = 2;
      k2.a = 1;
      expect(scopeId("r", k1)).toBe(scopeId("r", k2));
    });

    it("nested objects with different key orders produce same ID", () => {
      const k1 = { a: { x: 1, y: 2 } };
      const k2 = { a: { y: 2, x: 1 } };
      expect(scopeId("r", k1)).toBe(scopeId("r", k2));
    });
  });

  describe("resource separation", () => {
    it("different resources with same key produce different IDs", () => {
      expect(scopeId("chat", "room1")).not.toBe(scopeId("doc", "room1"));
    });
  });

  describe("nested structures", () => {
    it("nested objects with different values produce different IDs", () => {
      expect(scopeId("r", { a: { b: 1 } })).not.toBe(scopeId("r", { a: { b: 2 } }));
    });

    it("deeply nested structure is stable", () => {
      const key = { a: { b: { c: { d: 1 } } } };
      expect(scopeId("r", key)).toBe(scopeId("r", key));
    });
  });

  describe("property tests", () => {
    it("determinism: same key always produces same ID", () => {
      fc.assert(
        fc.property(jsonObjectKey(), (key) => {
          return scopeId("r", key as any) === scopeId("r", key as any);
        }),
        { numRuns: 500 },
      );
    });

    it("identity: different resources with same key are different", () => {
      fc.assert(
        fc.property(
          jsonObjectKey(),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          (key, r1, r2) => {
            fc.pre(r1 !== r2);
            return scopeId(r1, key as any) !== scopeId(r2, key as any);
          },
        ),
        { numRuns: 200 },
      );
    });

    it("prefix: scope ID always starts with resource@", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 20 }), jsonObjectKey(), (r, key) => {
          const id = scopeId(r, key as any);
          return id.startsWith(r + "@");
        }),
        { numRuns: 200 },
      );
    });

    it("key ordering: shuffled object insertion produces same ID", () => {
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.string({ minLength: 1, maxLength: 5 }),
            fc.string({ minLength: 1, maxLength: 5 }),
            { minKeys: 1, maxKeys: 6 },
          ),
          (obj) => {
            const keys = Object.keys(obj);
            const shuffled = fc.sample(fc.shuffledSubarray(keys), 1)[0] ?? keys;
            if (shuffled.length !== keys.length) return true;
            const reordered: Record<string, string> = {};
            for (const k of shuffled) reordered[k] = obj[k]!;
            return scopeId("r", obj) === scopeId("r", reordered);
          },
        ),
        { numRuns: 200 },
      );
    });

    it("type distinction: string and number with same representation differ", () => {
      fc.assert(
        fc.property(fc.integer({ min: -1000, max: 1000 }), (n) => {
          return scopeId("r", String(n)) !== scopeId("r", n);
        }),
        { numRuns: 200 },
      );
    });

    it("type distinction: string and boolean true differ", () => {
      fc.assert(
        fc.property(fc.constant("true"), (s) => {
          return scopeId("r", s) !== scopeId("r", true);
        }),
        { numRuns: 10 },
      );
    });

    it("collision freedom: different generated keys have different IDs", () => {
      fc.assert(
        fc.property(jsonObjectKey(), jsonObjectKey(), (k1, k2) => {
          const j1 = JSON.stringify(k1);
          const j2 = JSON.stringify(k2);
          fc.pre(j1 !== j2);
          return scopeId("r", k1 as any) !== scopeId("r", k2 as any);
        }),
        { numRuns: 500 },
      );
    });
  });

  describe("scopeId input validation", () => {
    it("throws on NaN", () => {
      expect(() => scopeId("r", NaN as any)).toThrow();
    });

    it("throws on Infinity", () => {
      expect(() => scopeId("r", Infinity as any)).toThrow();
    });

    it("throws on negative Infinity", () => {
      expect(() => scopeId("r", -Infinity as any)).toThrow();
    });
  });

  describe("validateClientMessage", () => {
    it("accepts valid connect", () => {
      expect(validateClientMessage({ type: "connect", token: "abc" })).toBeTruthy();
    });

    it("accepts valid subscribe", () => {
      expect(
        validateClientMessage({
          type: "subscribe",
          resource: "chat",
          key: { id: "1" },
          cursor: 0,
        }),
      ).toBeTruthy();
    });

    it("rejects subscribe with invalid cursor", () => {
      expect(
        validateClientMessage({ type: "subscribe", resource: "r", key: "k", cursor: -1 }),
      ).toBeNull();
      expect(
        validateClientMessage({ type: "subscribe", resource: "r", key: "k", cursor: NaN }),
      ).toBeNull();
    });

    it("rejects subscribe with missing resource", () => {
      expect(validateClientMessage({ type: "subscribe", key: "k", cursor: 0 })).toBeNull();
    });

    it("rejects unknown message type", () => {
      expect(validateClientMessage({ type: "unknown" })).toBeNull();
    });

    it("rejects non-object input", () => {
      expect(validateClientMessage(null)).toBeNull();
      expect(validateClientMessage("string")).toBeNull();
      expect(validateClientMessage(42)).toBeNull();
    });

    it("accepts valid command", () => {
      expect(
        validateClientMessage({
          type: "command",
          commandId: "cmd-1",
          resource: "counter",
          name: "increment",
          args: [1],
          key: { counterId: "c1" },
        }),
      ).toBeTruthy();
    });

    it("rejects command without resource", () => {
      expect(validateClientMessage({ type: "command", name: "x", args: [], key: "k" })).toBeNull();
    });

    it("rejects connect with non-string token", () => {
      expect(validateClientMessage({ type: "connect", token: 123 })).toBeNull();
    });
  });

  describe("validateServerMessage", () => {
    it("accepts valid init", () => {
      expect(validateServerMessage({ type: "init", sessions: [], selfId: "s1" })).toBeTruthy();
    });

    it("accepts valid synced with events", () => {
      expect(
        validateServerMessage({
          type: "synced",
          resource: "chat",
          key: "k",
          cursor: 5,
          events: [{ id: "e1", seq: 5, at: 1000, name: "test", payload: {} }],
        }),
      ).toBeTruthy();
    });

    it("rejects synced with invalid cursor", () => {
      expect(
        validateServerMessage({ type: "synced", resource: "r", key: "k", cursor: NaN }),
      ).toBeNull();
    });

    it("rejects event with missing fields", () => {
      expect(
        validateServerMessage({ type: "event", resource: "r", key: "k", event: {} }),
      ).toBeNull();
    });

    it("rejects event with invalid seq", () => {
      expect(
        validateServerMessage({
          type: "event",
          resource: "r",
          key: "k",
          event: { id: "e1", seq: NaN, at: 1, name: "x", payload: {} },
        }),
      ).toBeNull();
    });

    it("accepts valid session", () => {
      expect(
        validateServerMessage({
          type: "session",
          session: { id: "s1", actor: { id: "a1" } },
        }),
      ).toBeTruthy();
    });

    it("rejects session without actor.id", () => {
      expect(
        validateServerMessage({
          type: "session",
          session: { id: "s1", actor: {} },
        }),
      ).toBeNull();
      expect(
        validateServerMessage({
          type: "session",
          session: { id: "s1" },
        }),
      ).toBeNull();
    });

    it("rejects session without id", () => {
      expect(
        validateServerMessage({
          type: "session",
          session: { actor: { id: "a1" } },
        }),
      ).toBeNull();
    });

    it("accepts valid sessionLeft", () => {
      expect(validateServerMessage({ type: "sessionLeft", sessionId: "s1" })).toBeTruthy();
    });

    it("rejects unknown type", () => {
      expect(validateServerMessage({ type: "unknown" })).toBeNull();
    });

    it("rejects synced with invalid snapshot", () => {
      expect(
        validateServerMessage({
          type: "synced",
          resource: "r",
          key: "k",
          cursor: 0,
          snapshot: {},
        }),
      ).toBeNull();
      expect(
        validateServerMessage({
          type: "synced",
          resource: "r",
          key: "k",
          cursor: 0,
          snapshot: { version: "not-number", seq: 0 },
        }),
      ).toBeNull();
    });

    it("rejects synced with invalid event in events array", () => {
      expect(
        validateServerMessage({
          type: "synced",
          resource: "r",
          key: "k",
          cursor: 0,
          events: [{ id: "e1", seq: 1, at: 1000, name: "x" }, {}],
        }),
      ).toBeNull();
    });

    it("rejects init with invalid session in array", () => {
      expect(
        validateServerMessage({
          type: "init",
          sessions: [{ id: "s1", actor: { id: "a1" } }, { id: "s2" }],
          selfId: "self",
        }),
      ).toBeNull();
    });

    it("rejects command with undefined in args", () => {
      expect(
        validateClientMessage({
          type: "command",
          commandId: "c1",
          resource: "r",
          name: "x",
          args: [undefined],
          key: "k",
        }),
      ).toBeNull();
    });

    it("accepts valid synced with snapshot", () => {
      expect(
        validateServerMessage({
          type: "synced",
          resource: "r",
          key: "k",
          cursor: 0,
          snapshot: { version: 1, seq: 5, data: { count: 0 } },
        }),
      ).toBeTruthy();
    });
  });
});
