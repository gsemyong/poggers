import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Snapshot } from "./protocol";

export type ClientStore = {
  loadSnapshot(): Promise<unknown> | unknown;
  saveSnapshot(snapshot: unknown): Promise<void> | void;
};

export interface Store {
  loadSnapshot(key: string): Snapshot | null;
  saveSnapshot(key: string, snapshot: Snapshot): void;
  appendEvents(key: string, events: unknown[], commandId?: string): void;
  getEvents(key: string): unknown[];
  compactEvents(key: string, throughSeq: number): void;
  saveCommandId(scopeId: string, commandId: string): void;
  getCommandIds(scopeId: string): Set<string>;
  clearCommandIds(scopeId: string): void;
}

function safeFilename(key: string): string {
  return encodeURIComponent(key);
}

function atomicWriteJSON(path: string, data: unknown) {
  const tmp = path + ".tmp";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, path);
}

function readEventLog(path: string): unknown[] {
  try {
    const raw = readFileSync(path, "utf8");
    const results: unknown[] = [];
    for (const line of raw.trim().split("\n")) {
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        if (
          record &&
          typeof record === "object" &&
          record.type === "batch" &&
          Array.isArray(record.events)
        ) {
          for (const ev of record.events) {
            (ev as any).__cid = record.cid;
          }
          results.push(...record.events);
        } else if (
          record &&
          typeof record === "object" &&
          typeof record.id === "string" &&
          typeof record.seq === "number"
        ) {
          results.push(record);
        } else {
          console.warn(`corrupt event log line in ${path}, skipping`);
        }
      } catch {
        console.warn(`corrupt event log line in ${path}, skipping`);
      }
    }
    return results;
  } catch {
    return [];
  }
}

function eventSeq(event: unknown): number {
  return typeof (event as any)?.seq === "number" ? (event as any).seq : Number.NEGATIVE_INFINITY;
}

function stripInternalEventFields(event: unknown): unknown {
  if (!event || typeof event !== "object") return event;
  const { __cid: _cid, ...publicEvent } = event as Record<string, unknown>;
  return publicEvent;
}

function writeEventLog(path: string, events: unknown[]) {
  mkdirSync(dirname(path), { recursive: true });
  const publicEvents = events.map((event) => stripInternalEventFields(event));
  const line =
    publicEvents.length > 0 ? JSON.stringify({ type: "batch", events: publicEvents }) : "";
  writeFileSync(path, line ? `${line}\n` : "", "utf8");
}

function clearFile(path: string) {
  try {
    writeFileSync(path, "", "utf8");
  } catch {}
}

function readJSON(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function createFileClientStore(snapshotPath: string): ClientStore {
  return {
    loadSnapshot() {
      return readJSON(snapshotPath) ?? undefined;
    },
    saveSnapshot(snapshot: unknown) {
      atomicWriteJSON(snapshotPath, snapshot);
    },
  };
}

export function createFileStore(baseDir: string): Store {
  mkdirSync(baseDir, { recursive: true });

  return {
    loadSnapshot(key: string) {
      const safeKey = safeFilename(key);
      const path = join(baseDir, `${safeKey}.snapshot.json`);
      const raw = readJSON(path);
      if (!raw) return null;
      return raw as { version: number; seq: number; data: unknown };
    },

    saveSnapshot(key: string, snapshot: { version: number; seq: number; data: unknown }) {
      const safeKey = safeFilename(key);
      const path = join(baseDir, `${safeKey}.snapshot.json`);
      atomicWriteJSON(path, snapshot);
    },

    appendEvents(key: string, events: unknown[], commandId?: string) {
      const safeKey = safeFilename(key);
      const path = join(baseDir, `${safeKey}.events.jsonl`);
      if (events.length === 0) return;
      const batchRecord = JSON.stringify(
        commandId != null ? { type: "batch", cid: commandId, events } : { type: "batch", events },
      );
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, batchRecord + "\n", "utf8");
    },

    getEvents(key: string) {
      const safeKey = safeFilename(key);
      const path = join(baseDir, `${safeKey}.events.jsonl`);
      return readEventLog(path);
    },

    compactEvents(key: string, throughSeq: number) {
      const safeKey = safeFilename(key);
      const path = join(baseDir, `${safeKey}.events.jsonl`);
      const tail = readEventLog(path).filter((event) => eventSeq(event) > throughSeq);
      writeEventLog(path, tail);
    },

    saveCommandId(scopeId: string, commandId: string) {
      const safeKey = safeFilename(scopeId);
      const path = join(baseDir, `${safeKey}.commands.jsonl`);
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, commandId + "\n", "utf8");
    },

    getCommandIds(scopeId: string) {
      const safeKey = safeFilename(scopeId);
      const path = join(baseDir, `${safeKey}.commands.jsonl`);
      const set = new Set<string>();
      try {
        const raw = readFileSync(path, "utf8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) set.add(trimmed);
        }
      } catch {}
      return set;
    },

    clearCommandIds(scopeId: string) {
      const safeKey = safeFilename(scopeId);
      const path = join(baseDir, `${safeKey}.commands.jsonl`);
      clearFile(path);
    },
  };
}

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
