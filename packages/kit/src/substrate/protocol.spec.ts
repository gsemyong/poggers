import { describe, it, expect } from "bun:test";

import fc from "fast-check";

import type { JsonValue } from "#kernel/app";
import {
  maxProtocolBatch,
  protocolVersion,
  scopeId,
  validateClientMessage,
  validateServerMessage,
} from "#substrate/protocol";

function jsonObjectKey(): fc.Arbitrary<unknown> {
  return fc.oneof(
    fc.string({ maxLength: 10 }),
    fc.integer({ min: -100, max: 100 }),
    fc.boolean(),
    fc.constant(null),
    fc.array(fc.string({ maxLength: 5 }), { minLength: 0, maxLength: 3 }),
    fc.dictionary(
      fc.string({ maxLength: 3 }).filter((key) => key.length > 0),
      fc.string({ maxLength: 5 }),
      { minKeys: 0, maxKeys: 3 },
    ),
  );
}

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
          return scopeId("r", key as JsonValue) === scopeId("r", key as JsonValue);
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
            return scopeId(r1, key as JsonValue) !== scopeId(r2, key as JsonValue);
          },
        ),
        { numRuns: 200 },
      );
    });

    it("prefix: scope ID always starts with resource@", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 20 }), jsonObjectKey(), (r, key) => {
          const id = scopeId(r, key as JsonValue);
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
          return scopeId("r", k1 as JsonValue) !== scopeId("r", k2 as JsonValue);
        }),
        { numRuns: 500 },
      );
    });
  });

  describe("scopeId input validation", () => {
    it("throws on NaN", () => {
      expect(() => scopeId("r", NaN as unknown as JsonValue)).toThrow();
    });

    it("throws on Infinity", () => {
      expect(() => scopeId("r", Infinity as unknown as JsonValue)).toThrow();
    });

    it("throws on negative Infinity", () => {
      expect(() => scopeId("r", -Infinity as unknown as JsonValue)).toThrow();
    });
  });

  describe("validateClientMessage", () => {
    it("accepts bounded operation batches and rejects ambiguous or unbounded batches", () => {
      const operation = {
        type: "receipt",
        commandId: "device/1",
        resource: "counter",
        key: { id: "main" },
      } as const;
      expect(validateClientMessage({ type: "batch", operations: [operation] })).toBeTruthy();
      expect(validateClientMessage({ type: "batch", operations: [] })).toBeNull();
      expect(
        validateClientMessage({
          type: "batch",
          operations: Array.from({ length: maxProtocolBatch + 1 }, () => operation),
        }),
      ).toBeNull();
      expect(
        validateClientMessage({
          type: "batch",
          operations: [{ type: "batch", operations: [operation] }],
        }),
      ).toBeNull();
    });

    it("accepts valid connect", () => {
      expect(
        validateClientMessage({ type: "connect", version: protocolVersion, token: "abc" }),
      ).toBeTruthy();
      expect(validateClientMessage({ type: "connect", version: 1, token: "abc" })).toBeNull();
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
          at: 1,
        }),
      ).toBeTruthy();
    });

    it("rejects command without resource", () => {
      expect(validateClientMessage({ type: "command", name: "x", args: [], key: "k" })).toBeNull();
    });

    it("rejects connect with non-string token", () => {
      expect(
        validateClientMessage({ type: "connect", version: protocolVersion, token: 123 }),
      ).toBeNull();
    });

    it("accepts a receipt lookup", () => {
      expect(
        validateClientMessage({
          type: "receipt",
          commandId: "device/1",
          resource: "counter",
          key: { id: "main" },
        }),
      ).toBeTruthy();
    });

    it("accepts a scoped presence replacement", () => {
      expect(
        validateClientMessage({
          type: "presence",
          resource: "document",
          key: { id: "one" },
          value: { cursor: { line: 1, column: 2 } },
        }),
      ).toBeTruthy();
    });

    it("rejects non-JSON presence", () => {
      expect(
        validateClientMessage({
          type: "presence",
          resource: "document",
          key: { id: "one" },
          value: { cursor: undefined },
        }),
      ).toBeNull();
    });
  });

  describe("validateServerMessage", () => {
    it("accepts bounded event batches and rejects a batch containing an invalid operation", () => {
      const operation = {
        type: "event",
        resource: "counter",
        key: { id: "main" },
        event: { id: "e1", seq: 1, at: 1, name: "incremented", payload: { amount: 1 } },
      } as const;
      expect(validateServerMessage({ type: "batch", operations: [operation] })).toBeTruthy();
      expect(
        validateServerMessage({ type: "batch", operations: [operation, { type: "unknown" }] }),
      ).toBeNull();
    });

    it("accepts valid init", () => {
      expect(
        validateServerMessage({
          type: "init",
          version: protocolVersion,
          session: { id: "s1", actor: { id: "a1" }, presence: {} },
        }),
      ).toBeTruthy();
      expect(
        validateServerMessage({
          type: "init",
          version: 1,
          session: { id: "s1", actor: { id: "a1" }, presence: {} },
        }),
      ).toBeNull();
    });

    it("accepts valid synced with events", () => {
      expect(
        validateServerMessage({
          type: "synced",
          resource: "chat",
          key: "k",
          cursor: 5,
          events: [{ id: "e1", seq: 5, at: 1000, name: "test", payload: {} }],
          sessions: [],
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

    it("accepts valid scoped presence", () => {
      expect(
        validateServerMessage({
          type: "presence",
          resource: "document",
          key: { id: "one" },
          session: { id: "s1", actor: { id: "a1" }, presence: {} },
        }),
      ).toBeTruthy();
    });

    it("rejects presence without actor.id", () => {
      expect(
        validateServerMessage({
          type: "presence",
          resource: "document",
          key: { id: "one" },
          session: { id: "s1", actor: {} },
        }),
      ).toBeNull();
      expect(
        validateServerMessage({
          type: "presence",
          resource: "document",
          key: { id: "one" },
          session: { id: "s1" },
        }),
      ).toBeNull();
    });

    it("rejects presence without session id", () => {
      expect(
        validateServerMessage({
          type: "presence",
          resource: "document",
          key: { id: "one" },
          session: { actor: { id: "a1" } },
        }),
      ).toBeNull();
    });

    it("accepts valid scoped presenceLeft", () => {
      expect(
        validateServerMessage({
          type: "presenceLeft",
          resource: "document",
          key: { id: "one" },
          sessionId: "s1",
        }),
      ).toBeTruthy();
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

    it("rejects init with invalid session", () => {
      expect(
        validateServerMessage({
          type: "init",
          version: protocolVersion,
          session: { id: "s1" },
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
          sessions: [],
        }),
      ).toBeTruthy();
    });

    it("accepts finite event schema versions", () => {
      expect(
        validateServerMessage({
          type: "event",
          resource: "note",
          key: { noteId: "a" },
          event: {
            id: "e1",
            seq: 1,
            at: 100,
            version: 2,
            actor: { id: "u" },
            name: "renamed",
            payload: { title: "hello" },
          },
        }),
      ).not.toBeNull();
      expect(
        validateServerMessage({
          type: "event",
          resource: "note",
          key: { noteId: "a" },
          event: {
            id: "e1",
            seq: 1,
            at: 100,
            version: Number.NaN,
            actor: { id: "u" },
            name: "renamed",
            payload: { title: "hello" },
          },
        }),
      ).toBeNull();
    });
  });
});
