import { describe, it, expect, afterEach } from "bun:test";
import { createLocalStore } from "./lmdb";
import { runStoreContract } from "tests/helpers/storage-contracts";
import { createTempDir } from "tests/helpers/temp-dir";

function hasLmdb(): boolean {
  try {
    require("lmdb");
    return true;
  } catch {
    return false;
  }
}

const describeIfLmdb = hasLmdb() ? describe : describe.skip;

describeIfLmdb("LMDB storage", () => {
  let tempDir: ReturnType<typeof createTempDir>;

  runStoreContract(
    "lmdb",
    () => {
      tempDir = createTempDir();
      return createLocalStore(tempDir.path);
    },
    { afterEach: () => tempDir?.cleanup() },
  );

  describe("lmdb specifics", () => {
    afterEach(() => tempDir?.cleanup());

    it("preserves event ordering near sequence padding boundary", () => {
      tempDir = createTempDir();
      const storage = createLocalStore(tempDir.path);
      storage.appendEvents("scope", [
        { seq: 9 },
        { seq: 10 },
        { seq: 11 },
        { seq: 99 },
        { seq: 100 },
        { seq: 101 },
      ]);
      const loaded = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(loaded.map((e) => e.seq)).toEqual([9, 10, 11, 99, 100, 101]);
    });

    it("handles wide sequence gap ordering", () => {
      tempDir = createTempDir();
      const storage = createLocalStore(tempDir.path);
      storage.appendEvents("scope", [
        { seq: 99_999_998 },
        { seq: 99_999_999 },
        { seq: 100_000_000 },
        { seq: 100_000_001 },
      ]);
      const loaded = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(loaded[0]!.seq).toBe(99_999_998);
      expect(loaded[3]!.seq).toBe(100_000_001);
    });

    it("persists data across separate storage instances", () => {
      tempDir = createTempDir();
      const storage1 = createLocalStore(tempDir.path);
      storage1.saveSnapshot("key", { version: 1, seq: 10, data: { a: 1 } });
      storage1.appendEvents("key", [{ seq: 1 }, { seq: 2 }]);

      const storage2 = createLocalStore(tempDir.path);
      expect(storage2.loadSnapshot("key")).toEqual({
        version: 1,
        seq: 10,
        data: { a: 1 },
      });
      expect(storage2.getEvents("key")).toEqual([{ seq: 1 }, { seq: 2 }]);
    });

    it("multi-event batch stored and read as single record", () => {
      tempDir = createTempDir();
      const storage = createLocalStore(tempDir.path);
      storage.appendEvents("scope", [
        { seq: 10, name: "a" },
        { seq: 20, name: "b" },
        { seq: 30, name: "c" },
      ]);
      storage.appendEvents("scope", [{ seq: 40, name: "d" }]);

      const loaded = storage.getEvents("scope") as Array<{ seq: number }>;
      expect(loaded.map((e) => e.seq)).toEqual([10, 20, 30, 40]);
    });
  });
});
