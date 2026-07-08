import type { ClientStore } from "@poggers/kit/storage";
import type { Store } from "@poggers/kit/storage";

export function createMemoryClientStore(): ClientStore & { _snapshot: unknown } {
  let snapshot: unknown = undefined;
  const storage: ClientStore & { _snapshot: unknown } = {
    _snapshot: undefined,
    loadSnapshot() {
      return snapshot;
    },
    saveSnapshot(s: unknown) {
      snapshot = s;
      (storage as any)._snapshot = s;
    },
  };
  return storage;
}

export function createFailingClientStore(failures?: {
  loadSnapshot?: Error | "throw";
  saveSnapshot?: Error | "throw";
}): ClientStore {
  let snapshot: unknown = undefined;
  return {
    loadSnapshot() {
      if (failures?.loadSnapshot) {
        throw failures.loadSnapshot === "throw"
          ? new Error("loadSnapshot failed")
          : failures.loadSnapshot;
      }
      return snapshot;
    },
    saveSnapshot(s: unknown) {
      if (failures?.saveSnapshot) {
        throw failures.saveSnapshot === "throw"
          ? new Error("saveSnapshot failed")
          : failures.saveSnapshot;
      }
      snapshot = s;
    },
  };
}

export function createMemoryStore(): Store {
  const snapshots = new Map<string, { version: number; seq: number; data: unknown }>();
  const events = new Map<string, unknown[]>();
  const commandIds = new Map<string, Set<string>>();

  return {
    loadSnapshot(key: string) {
      return snapshots.get(key) ?? null;
    },
    saveSnapshot(key: string, snapshot: { version: number; seq: number; data: unknown }) {
      snapshots.set(key, snapshot);
    },
    appendEvents(key: string, evts: unknown[], _commandId?: string) {
      const existing = events.get(key) ?? [];
      events.set(key, [...existing, ...evts]);
    },
    getEvents(key: string) {
      return events.get(key) ?? [];
    },
    compactEvents(key: string, throughSeq: number) {
      const existing = events.get(key) ?? [];
      events.set(
        key,
        existing.filter((event) => {
          const seq = (event as any)?.seq;
          return typeof seq === "number" && seq > throughSeq;
        }),
      );
    },
    saveCommandId(scopeId: string, commandId: string) {
      let set = commandIds.get(scopeId);
      if (!set) {
        set = new Set();
        commandIds.set(scopeId, set);
      }
      set.add(commandId);
    },
    getCommandIds(scopeId: string) {
      return commandIds.get(scopeId) ?? new Set();
    },
    clearCommandIds(scopeId: string) {
      commandIds.delete(scopeId);
    },
  };
}

export function createFailingMemoryStore(failures?: {
  saveSnapshot?: Error | "throw";
  appendEvents?: Error | "throw";
  compactEvents?: Error | "throw";
}): Store {
  const inner = createMemoryStore();

  return {
    loadSnapshot(key) {
      return inner.loadSnapshot(key);
    },
    saveSnapshot(key, snapshot) {
      if (failures?.saveSnapshot) {
        throw failures.saveSnapshot === "throw"
          ? new Error("saveSnapshot failed")
          : failures.saveSnapshot;
      }
      return inner.saveSnapshot(key, snapshot);
    },
    appendEvents(key, events, commandId?) {
      if (failures?.appendEvents) {
        throw failures.appendEvents === "throw"
          ? new Error("appendEvents failed")
          : failures.appendEvents;
      }
      return inner.appendEvents(key, events, commandId);
    },
    getEvents(key) {
      return inner.getEvents(key);
    },
    compactEvents(key, throughSeq) {
      if (failures?.compactEvents) {
        throw failures.compactEvents === "throw"
          ? new Error("compactEvents failed")
          : failures.compactEvents;
      }
      return inner.compactEvents(key, throughSeq);
    },
    saveCommandId(scopeId, commandId) {
      return inner.saveCommandId(scopeId, commandId);
    },
    getCommandIds(scopeId) {
      return inner.getCommandIds(scopeId);
    },
    clearCommandIds(scopeId) {
      return inner.clearCommandIds(scopeId);
    },
  };
}
