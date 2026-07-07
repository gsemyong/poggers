import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { createFileClientStore, createFileStore } from "./fs";
import { runClientStoreContract, runStoreContract } from "tests/helpers/storage-contracts";
import { createTempDir } from "tests/helpers/temp-dir";
import { join } from "node:path";
import { writeFileSync, existsSync } from "node:fs";

describe("FS storage", () => {
  describe("ClientStore contract", () => {
    let tempDir: ReturnType<typeof createTempDir>;

    runClientStoreContract(
      "filesystem",
      () => {
        tempDir = createTempDir();
        return createFileClientStore(join(tempDir.path, "snapshot.json"));
      },
      { afterEach: () => tempDir?.cleanup() },
    );
  });

  describe("Store contract", () => {
    let tempDir: ReturnType<typeof createTempDir>;

    runStoreContract(
      "filesystem",
      () => {
        tempDir = createTempDir();
        return createFileStore(tempDir.path);
      },
      { afterEach: () => tempDir?.cleanup() },
    );
  });

  describe("server storage specifics", () => {
    let tempDir: ReturnType<typeof createTempDir>;

    afterEach(() => tempDir?.cleanup());

    it("creates base directory if missing", () => {
      tempDir = createTempDir();
      const baseDir = join(tempDir.path, "nested", "data");
      const storage = createFileStore(baseDir);
      storage.saveSnapshot("test", { version: 1, seq: 0, data: {} });
      const loaded = storage.loadSnapshot("test");
      expect(loaded).toEqual({ version: 1, seq: 0, data: {} });
    });

    it("returns null for missing snapshot file", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      expect(storage.loadSnapshot("nonexistent")).toBeNull();
    });
  });

  describe("client storage specifics", () => {
    let tempDir: ReturnType<typeof createTempDir>;

    afterEach(() => tempDir?.cleanup());

    it("returns undefined for missing snapshot file", () => {
      tempDir = createTempDir();
      const storage = createFileClientStore(join(tempDir.path, "snap.json"));
      const result = storage.loadSnapshot();
      expect(result).toBeUndefined();
    });

    it("handles nested directory creation", () => {
      tempDir = createTempDir();
      const nestedPath = join(tempDir.path, "deep", "nested", "snap.json");
      const storage = createFileClientStore(nestedPath);
      storage.saveSnapshot({ version: 1, data: { x: 1 } });
      const loaded = storage.loadSnapshot();
      expect(loaded).toEqual({ version: 1, data: { x: 1 } });
    });
  });

  describe("corruption handling", () => {
    let tempDir: ReturnType<typeof createTempDir>;
    let origWarn: typeof console.warn;

    beforeEach(() => {
      origWarn = console.warn;
      console.warn = () => {};
    });

    afterEach(() => {
      tempDir?.cleanup();
      console.warn = origWarn;
    });

    it("returns undefined for corrupt client snapshot JSON", () => {
      tempDir = createTempDir();
      const path = join(tempDir.path, "bad.json");
      writeFileSync(path, "not valid json", "utf8");
      const storage = createFileClientStore(path);
      expect(storage.loadSnapshot()).toBeUndefined();
    });

    it("returns null for corrupt server snapshot JSON", () => {
      tempDir = createTempDir();
      const path = join(tempDir.path, "bad.snapshot.json");
      writeFileSync(path, "not valid json", "utf8");
      const storage = createFileStore(tempDir.path);
      expect(storage.loadSnapshot("bad")).toBeNull();
    });

    it("returns empty array for corrupt event log", () => {
      tempDir = createTempDir();
      const path = join(tempDir.path, "scope.events.jsonl");
      writeFileSync(path, "not valid json\n", "utf8");
      const storage = createFileStore(tempDir.path);
      expect(storage.getEvents("scope")).toEqual([]);
    });

    it("recovers valid lines from partially corrupt event log", () => {
      tempDir = createTempDir();
      const path = join(tempDir.path, "scope.events.jsonl");
      writeFileSync(path, '{"id":"a","seq":1}\nbad line\n{"id":"c","seq":3}\n', "utf8");
      const storage = createFileStore(tempDir.path);
      const events = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(events.map((e) => e.seq)).toEqual([1, 3]);
    });
  });

  describe("batch format", () => {
    let tempDir: ReturnType<typeof createTempDir>;

    afterEach(() => tempDir?.cleanup());

    it("writes and reads multi-event batch", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      storage.appendEvents("scope", [
        { id: "a", seq: 1, at: 1000, name: "incremented", payload: { amount: 1 } },
        { id: "b", seq: 2, at: 1001, name: "incremented", payload: { amount: 2 } },
      ]);
      const events = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(events.map((e) => e.seq)).toEqual([1, 2]);
    });

    it("reads legacy individual-event format", () => {
      tempDir = createTempDir();
      const path = join(tempDir.path, "scope.events.jsonl");
      writeFileSync(
        path,
        JSON.stringify({ id: "a", seq: 1, at: 1, actor: {}, name: "x", payload: {} }) +
          "\n" +
          JSON.stringify({ id: "b", seq: 2, at: 2, actor: {}, name: "y", payload: {} }) +
          "\n",
        "utf8",
      );
      const storage = createFileStore(tempDir.path);
      const events = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(events.map((e) => e.seq)).toEqual([1, 2]);
    });

    it("reads mixed batch and legacy format", () => {
      tempDir = createTempDir();
      const path = join(tempDir.path, "scope.events.jsonl");
      writeFileSync(
        path,
        JSON.stringify({ id: "a", seq: 1, at: 1, actor: {}, name: "x", payload: {} }) +
          "\n" +
          JSON.stringify({ type: "batch", events: [{ id: "b", seq: 2 }] }) +
          "\n",
        "utf8",
      );
      const storage = createFileStore(tempDir.path);
      const events = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(events.map((e) => e.seq)).toEqual([1, 2]);
    });
  });

  describe("event log edge cases", () => {
    let tempDir: ReturnType<typeof createTempDir>;

    afterEach(() => tempDir?.cleanup());

    it("empty event log returns empty array", () => {
      tempDir = createTempDir();
      const path = join(tempDir.path, "scope.events.jsonl");
      writeFileSync(path, "", "utf8");
      const storage = createFileStore(tempDir.path);
      expect(storage.getEvents("scope")).toEqual([]);
    });

    it("appending empty events list does not corrupt log", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      storage.appendEvents("scope", [{ seq: 1 }]);
      storage.appendEvents("scope", []);
      storage.appendEvents("scope", [{ seq: 2 }]);
      const events = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(events.map((e) => e.seq)).toEqual([1, 2]);
    });

    it("compaction on non-existent event log is safe", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      storage.compactEvents("nonexistent", Number.POSITIVE_INFINITY);
      expect(storage.getEvents("nonexistent")).toEqual([]);
    });
  });

  describe("path safety", () => {
    let tempDir: ReturnType<typeof createTempDir>;

    afterEach(() => tempDir?.cleanup());

    it("key with forward slash does not escape base dir", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      const maliciousKey = "../outside";
      storage.saveSnapshot(maliciousKey, { version: 1, seq: 0, data: {} });
      const siblingPath = join(tempDir.path, "..", "outside.snapshot.json");
      expect(existsSync(siblingPath)).toBe(false);
    });

    it("key with backslash is safe", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      storage.saveSnapshot("key\\path", { version: 1, seq: 0, data: {} });
      const loaded = storage.loadSnapshot("key\\path");
      expect(loaded).toEqual({ version: 1, seq: 0, data: {} });
    });

    it("key with multiple slashes is stored inside base dir", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      storage.saveSnapshot("a/b/c", { version: 1, seq: 5, data: { x: 1 } });
      expect(storage.loadSnapshot("a/b/c")).toEqual({ version: 1, seq: 5, data: { x: 1 } });
      expect(storage.loadSnapshot("a")).toBeNull();
    });

    it("key with dots does not corrupt path", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      storage.saveSnapshot("..hidden", { version: 1, seq: 0, data: { ok: true } });
      expect(storage.loadSnapshot("..hidden")).toEqual({
        version: 1,
        seq: 0,
        data: { ok: true },
      });
    });

    it("event log with key containing slashes is stored safely inside base dir", () => {
      tempDir = createTempDir();
      const storage = createFileStore(tempDir.path);
      storage.appendEvents("a/b/c", [{ seq: 1 }]);
      const loaded = storage.getEvents("a/b/c") as Array<{ seq: number }>;
      expect(loaded.length).toBe(1);
      expect(loaded[0]!.seq).toBe(1);

      storage.compactEvents("a/b/c", Number.POSITIVE_INFINITY);
      expect(storage.getEvents("a/b/c")).toEqual([]);
    });
  });
});
