import type { Store } from "./types";

const SNAPSHOT_PREFIX = "s/";
const EVENT_PREFIX = "e/";
const COMMAND_PREFIX = "c/";

function snapshotKey(instanceKey: string): string {
  return `${SNAPSHOT_PREFIX}${instanceKey}`;
}

function eventsPrefix(instanceKey: string): string {
  return `${EVENT_PREFIX}${instanceKey}/`;
}

function eventKey(instanceKey: string, seq: string): string {
  return `${eventsPrefix(instanceKey)}${seq.padStart(12, "0")}`;
}

function padSeq(seq: number): string {
  return seq.toString().padStart(12, "0");
}

function commandIdKey(instanceKey: string, commandId: string): string {
  return `${COMMAND_PREFIX}${instanceKey}/${commandId}`;
}

function commandPrefix(instanceKey: string): string {
  return `${COMMAND_PREFIX}${instanceKey}/`;
}

function eventSeq(event: unknown): number {
  return typeof (event as any)?.seq === "number" ? (event as any).seq : Number.NEGATIVE_INFINITY;
}

interface LMDB {
  putSync(key: string, value: unknown): void;
  get(key: string): unknown | undefined;
  removeSync(key: string): void;
  getKeys(opts: { start: string; end: string }): Iterable<string>;
  getRange(opts: { start: string; end: string }): Iterable<{ key: string; value: unknown }>;
  close(): void;
}

export function createLocalStore(path: string): Store {
  let db: LMDB | null = null;

  function ensureDB(): LMDB {
    if (!db) {
      const { open } = require("lmdb");
      db = open({ path, encoding: "json" }) as LMDB;
    }
    return db;
  }

  return {
    loadSnapshot(instanceKey: string) {
      const d = ensureDB();
      const snap = d.get(snapshotKey(instanceKey));
      if (!snap) return null;
      return snap as { version: number; seq: number; data: unknown };
    },

    saveSnapshot(instanceKey: string, snapshot: { version: number; seq: number; data: unknown }) {
      const d = ensureDB();
      d.putSync(snapshotKey(instanceKey), snapshot);
    },

    appendEvents(instanceKey: string, events: unknown[], commandId?: string) {
      const d = ensureDB();
      if (events.length === 0) return;
      const firstSeq = (events[0]! as { seq: number }).seq;
      if (commandId != null) {
        d.putSync(eventKey(instanceKey, padSeq(firstSeq)), { cid: commandId, e: events });
      } else {
        d.putSync(eventKey(instanceKey, padSeq(firstSeq)), events);
      }
    },

    getEvents(instanceKey: string) {
      const d = ensureDB();
      const start = eventsPrefix(instanceKey);
      const end = `${start}\xff`;
      const events: unknown[] = [];
      for (const { value } of d.getRange({ start, end })) {
        if (
          value &&
          typeof value === "object" &&
          (value as any).e != null &&
          Array.isArray((value as any).e)
        ) {
          const cid = (value as any).cid;
          for (const ev of (value as any).e) {
            if (cid != null) (ev as any).__cid = cid;
            events.push(ev);
          }
        } else if (Array.isArray(value)) {
          events.push(...(value as unknown[]));
        } else {
          events.push(value);
        }
      }
      return events;
    },

    compactEvents(instanceKey: string, throughSeq: number) {
      const d = ensureDB();
      const start = eventsPrefix(instanceKey);
      const end = `${start}\xff`;
      const entries = [...d.getRange({ start, end })];
      for (const { key, value } of entries) {
        d.removeSync(key);
        const storedEvents =
          value &&
          typeof value === "object" &&
          (value as any).e != null &&
          Array.isArray((value as any).e)
            ? ((value as any).e as unknown[])
            : Array.isArray(value)
              ? (value as unknown[])
              : [value];
        const tail = storedEvents.filter((event) => eventSeq(event) > throughSeq);
        if (tail.length === 0) continue;
        const firstSeq = eventSeq(tail[0]);
        const cid =
          value && typeof value === "object" && "cid" in (value as any)
            ? (value as any).cid
            : undefined;
        d.putSync(eventKey(instanceKey, padSeq(firstSeq)), cid != null ? { cid, e: tail } : tail);
      }
    },

    saveCommandId(instanceKey: string, commandId: string) {
      const d = ensureDB();
      d.putSync(commandIdKey(instanceKey, commandId), true);
    },

    getCommandIds(instanceKey: string) {
      const d = ensureDB();
      const start = commandPrefix(instanceKey);
      const end = `${start}\xff`;
      const set = new Set<string>();
      for (const { key } of d.getRange({ start, end })) {
        const parts = key.split("/");
        const cid = parts[parts.length - 1];
        if (cid) set.add(cid);
      }
      return set;
    },

    clearCommandIds(instanceKey: string) {
      const d = ensureDB();
      const start = commandPrefix(instanceKey);
      const end = `${start}\xff`;
      const keys = [...d.getKeys({ start, end })];
      for (const key of keys) {
        d.removeSync(key);
      }
    },
  };
}
