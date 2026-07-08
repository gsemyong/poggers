import { describe, it, expect, afterEach } from "bun:test";
import type { ClientStore, Store } from "@poggers/kit/storage";

export function runClientStoreContract(
  name: string,
  factory: () => ClientStore,
  opts?: { afterEach?: () => void },
) {
  describe(`ClientStore: ${name}`, () => {
    if (opts?.afterEach) afterEach(opts.afterEach);

    it("returns undefined when empty", async () => {
      const storage = factory();
      expect(await storage.loadSnapshot()).toBeUndefined();
    });

    it("saves and loads snapshot", async () => {
      const storage = factory();
      const snap = { version: 1, data: { hello: "world" } };
      await storage.saveSnapshot(snap);
      expect(await storage.loadSnapshot()).toEqual(snap);
    });

    it("overwrites snapshot", async () => {
      const storage = factory();
      const snap1 = { version: 1, data: { a: 1 } };
      const snap2 = { version: 2, data: { b: 2 } };
      await storage.saveSnapshot(snap1);
      await storage.saveSnapshot(snap2);
      expect(await storage.loadSnapshot()).toEqual(snap2);
    });
  });
}

export function runStoreContract(
  name: string,
  factory: () => Store,
  opts?: { afterEach?: () => void },
) {
  describe(`Store: ${name}`, () => {
    if (opts?.afterEach) afterEach(opts.afterEach);

    it("returns null snapshot when empty", () => {
      const storage = factory();
      expect(storage.loadSnapshot("scope-1")).toBeNull();
    });

    it("saves and loads snapshot", () => {
      const storage = factory();
      const snap = { version: 1, seq: 5, data: { x: 10 } };
      storage.saveSnapshot("scope-1", snap);
      expect(storage.loadSnapshot("scope-1")).toEqual(snap);
    });

    it("overwrites snapshot", () => {
      const storage = factory();
      const snap1 = { version: 1, seq: 3, data: { a: 1 } };
      const snap2 = { version: 1, seq: 7, data: { a: 2 } };
      storage.saveSnapshot("scope-1", snap1);
      storage.saveSnapshot("scope-1", snap2);
      expect(storage.loadSnapshot("scope-1")).toEqual(snap2);
    });

    it("is empty events when none appended", () => {
      const storage = factory();
      expect(storage.getEvents("scope-1")).toEqual([]);
    });

    it("appends single event", () => {
      const storage = factory();
      storage.appendEvents("scope-1", [{ seq: 1, name: "test" }]);
      expect(storage.getEvents("scope-1")).toEqual([{ seq: 1, name: "test" }]);
    });

    it("preserves append order", () => {
      const storage = factory();
      storage.appendEvents("scope-1", [{ seq: 1 }, { seq: 2 }]);
      storage.appendEvents("scope-1", [{ seq: 3 }]);
      const events = storage.getEvents("scope-1") as Array<{ seq: number }>;
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    });

    it("compacts all events through infinity", () => {
      const storage = factory();
      storage.appendEvents("scope-1", [{ seq: 1 }, { seq: 2 }]);
      storage.compactEvents("scope-1", Number.POSITIVE_INFINITY);
      expect(storage.getEvents("scope-1")).toEqual([]);
    });

    it("compacts events through a sequence", () => {
      const storage = factory();
      storage.appendEvents("scope-1", [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
      storage.compactEvents("scope-1", 2);
      expect(storage.getEvents("scope-1")).toEqual([{ seq: 3 }]);
    });

    it("compaction keeps events newer than the snapshot sequence", () => {
      const storage = factory();
      storage.appendEvents("scope-1", [{ seq: 1 }, { seq: 2 }]);
      storage.saveSnapshot("scope-1", { version: 1, seq: 1, data: { count: 1 } });
      storage.appendEvents("scope-1", [{ seq: 3 }]);
      storage.compactEvents("scope-1", 1);
      expect(storage.getEvents("scope-1")).toEqual([{ seq: 2 }, { seq: 3 }]);
    });

    it("compacting an empty tail is idempotent", () => {
      const storage = factory();
      storage.compactEvents("scope-1", Number.POSITIVE_INFINITY);
      expect(storage.getEvents("scope-1")).toEqual([]);
    });

    it("isolates keys", () => {
      const storage = factory();
      storage.appendEvents("scope-A", [{ seq: 1 }]);
      storage.appendEvents("scope-B", [{ seq: 2 }]);
      storage.saveSnapshot("scope-A", { version: 1, seq: 1, data: { a: 1 } });
      storage.saveSnapshot("scope-B", { version: 1, seq: 2, data: { b: 2 } });

      expect(storage.getEvents("scope-A")).toEqual([{ seq: 1 }]);
      expect(storage.getEvents("scope-B")).toEqual([{ seq: 2 }]);
      expect(storage.loadSnapshot("scope-A")).toEqual({
        version: 1,
        seq: 1,
        data: { a: 1 },
      });
      expect(storage.loadSnapshot("scope-B")).toEqual({
        version: 1,
        seq: 2,
        data: { b: 2 },
      });
    });

    it("compacts only target scope events", () => {
      const storage = factory();
      storage.appendEvents("scope-A", [{ seq: 1 }]);
      storage.appendEvents("scope-B", [{ seq: 2 }]);
      storage.compactEvents("scope-A", Number.POSITIVE_INFINITY);
      expect(storage.getEvents("scope-A")).toEqual([]);
      expect(storage.getEvents("scope-B")).toEqual([{ seq: 2 }]);
    });

    it("handles large number of events", () => {
      const storage = factory();
      const events = [];
      for (let i = 0; i < 100; i++) {
        events.push({ seq: i, name: `event-${i}` });
      }
      storage.appendEvents("scope", events);
      const loaded = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(loaded.length).toBe(100);
      expect(loaded[0]!.seq).toBe(0);
      expect(loaded[99]!.seq).toBe(99);
    });

    it("handles unusual scope keys with special characters", () => {
      const storage = factory();
      const keys = ["a/b", "a@b", "a:b", "a,b", "a{b", "a}b", "a[b", "a]b", "a..b"];
      for (const k of keys) {
        storage.saveSnapshot(k, { version: 1, seq: 0, data: { key: k } });
      }
      for (const k of keys) {
        const loaded = storage.loadSnapshot(k);
        expect(loaded).toEqual({ version: 1, seq: 0, data: { key: k } });
      }
    });

    it("compacting an empty scope is safe", () => {
      const storage = factory();
      storage.compactEvents("never-used", Number.POSITIVE_INFINITY);
      expect(storage.getEvents("never-used")).toEqual([]);
    });

    it("saves and retrieves command IDs", () => {
      const storage = factory();
      storage.saveCommandId("scope-1", "cmd-a");
      storage.saveCommandId("scope-1", "cmd-b");
      expect(storage.getCommandIds("scope-1")).toEqual(new Set(["cmd-a", "cmd-b"]));
    });

    it("returns empty set for unknown scope", () => {
      const storage = factory();
      const ids = storage.getCommandIds("unknown");
      expect(ids).toBeInstanceOf(Set);
      expect(ids.size).toBe(0);
    });

    it("isolates command IDs by scope", () => {
      const storage = factory();
      storage.saveCommandId("scope-A", "cmd-1");
      storage.saveCommandId("scope-B", "cmd-2");
      expect(storage.getCommandIds("scope-A")).toEqual(new Set(["cmd-1"]));
      expect(storage.getCommandIds("scope-B")).toEqual(new Set(["cmd-2"]));
    });

    it("clears command IDs for a scope", () => {
      const storage = factory();
      storage.saveCommandId("scope-1", "cmd-a");
      storage.saveCommandId("scope-1", "cmd-b");
      storage.clearCommandIds("scope-1");
      expect(storage.getCommandIds("scope-1").size).toBe(0);
    });

    it("clearCommandIds only affects targeted scope", () => {
      const storage = factory();
      storage.saveCommandId("scope-A", "cmd-1");
      storage.saveCommandId("scope-B", "cmd-2");
      storage.clearCommandIds("scope-A");
      expect(storage.getCommandIds("scope-A").size).toBe(0);
      expect(storage.getCommandIds("scope-B")).toEqual(new Set(["cmd-2"]));
    });
  });
}
