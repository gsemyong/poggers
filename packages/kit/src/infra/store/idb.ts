import type { ClientStore } from "./types";

export function createBrowserStore(opts?: { dbName?: string }): ClientStore {
  const DB_NAME = opts?.dbName ?? "poggers-client";
  const DB_VERSION = 5;
  const STORE = "snapshot";

  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbGet(db: IDBDatabase, key: IDBValidKey): Promise<any> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbPut(db: IDBDatabase, value: any, key: IDBValidKey): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  const dbPromise = openDB();

  return {
    async loadSnapshot() {
      try {
        const db = await dbPromise;
        return (await dbGet(db, "latest")) ?? undefined;
      } catch {
        return undefined;
      }
    },
    async saveSnapshot(snapshot: unknown) {
      try {
        const db = await dbPromise;
        await dbPut(db, snapshot, "latest");
      } catch {}
    },
  };
}
