import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "bun:test";
import { createBrowserStore } from "./idb";
import { runClientStoreContract } from "tests/helpers/storage-contracts";

let dbCounter = 0;

describe("IDB storage", () => {
  afterEach(() => {
    indexedDB.deleteDatabase(`na-client-test-${dbCounter}`);
  });

  runClientStoreContract(
    "indexeddb",
    () => {
      dbCounter++;
      return createBrowserStore({ dbName: `na-client-test-${dbCounter}` });
    },
    {
      afterEach: () => {
        indexedDB.deleteDatabase(`na-client-test-${dbCounter}`);
      },
    },
  );

  describe("idb specifics", () => {
    afterEach(() => {
      indexedDB.deleteDatabase(`na-client-test-${dbCounter}`);
    });

    it("can persist complex nested objects", async () => {
      dbCounter++;
      const storage = createBrowserStore({ dbName: `na-client-test-${dbCounter}` });
      const data = {
        version: 1,
        scopes: [
          {
            resource: "chat",
            key: { sessionId: "abc" },
            snapshot: {
              version: 1,
              seq: 5,
              data: { messages: [{ id: "m1", text: "hello" }] },
            },
          },
        ],
      };
      await storage.saveSnapshot(data);
      const loaded = await storage.loadSnapshot();
      expect(loaded).toEqual(data);
    });

    it("persists data across separate storage instances", async () => {
      dbCounter++;
      const name = `na-client-test-${dbCounter}`;
      const storage1 = createBrowserStore({ dbName: name });
      await storage1.saveSnapshot({ version: 1, data: { hello: "world" } });

      const storage2 = createBrowserStore({ dbName: name });
      const loaded = await storage2.loadSnapshot();
      expect(loaded).toEqual({ version: 1, data: { hello: "world" } });
    });
  });
});
