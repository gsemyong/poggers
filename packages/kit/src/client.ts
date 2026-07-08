import type { ActorOf, App, AppSpec, Client, SyncMeta } from "./app";
import type {
  ClientMessage,
  CommittedEvent,
  JsonValue,
  ServerMessage,
  SessionData,
  Snapshot,
} from "./protocol";
import { scopeId, validateServerMessage } from "./protocol";
import type { ClientStore } from "./storage";

const RECONNECT_MS = 2000;
const MAX_RECONNECT_MS = 30000;

type ScopeEntry = {
  resource: string;
  key: JsonValue;
  snapshot: Snapshot;
};

type ClientSnapshot = {
  version: number;
  generation?: string;
  scopeGenerations?: Record<string, string>;
  scopes: ScopeEntry[];
  pending?: Array<{ commandId: string; message: ClientMessage }>;
};

export type ConnectOpts = {
  wsUrl: string;
  token: string;
  storage: ClientStore;
  WebSocket?: typeof WebSocket;
  reconnectMs?: number;
  persistIntervalMs?: number;
};

export async function connect<Spec extends AppSpec>(
  app: App<Spec>,
  opts: ConnectOpts,
): Promise<Client<Spec>> {
  let saved: ClientSnapshot | undefined;
  try {
    const raw = await opts.storage.loadSnapshot();
    saved = raw as ClientSnapshot | undefined;
  } catch {
    // load failed, start fresh
  }
  return wire(app, saved, opts);
}

function wire<Spec extends AppSpec>(
  app: App<Spec>,
  saved: ClientSnapshot | undefined,
  opts: ConnectOpts,
): Client<Spec> {
  const _WebSocket = opts.WebSocket ?? WebSocket;
  const reconnectMs = opts.reconnectMs ?? RECONNECT_MS;
  const persistIntervalMs = opts.persistIntervalMs ?? 5000;
  let ws: any;
  let dirty = false;
  let connected = false;
  let disposed = false;
  let reconnectAttempts = 0;
  const { wsUrl, token, storage } = opts;

  const sessions: SessionData<ActorOf<Spec>>[] = [];
  let selfSession: SessionData<ActorOf<Spec>> | null = null;
  const subs = new Set<() => void>();
  const pendingCommands = new Map<string, ClientMessage>();
  const commandReceipts = new Map<
    string,
    { resolve: (v: { ok: boolean; cursor?: number; error?: string; data?: unknown }) => void }
  >();

  const states = new Map<string, any>();
  const cursors = new Map<string, number>();
  const bufferedEvents = new Map<string, CommittedEvent[]>();
  const syncMeta = new Map<string, SyncMeta>();
  const activeScopes = new Map<string, { resource: string; key: JsonValue }>();
  const scopeGenerations = new Map<string, string>();
  let savedGeneration: string | undefined;
  let subscribedScopes = new Set<string>();

  const intervals: ReturnType<typeof setInterval>[] = [];
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  if (saved && saved.version <= app.def.version && Array.isArray(saved.scopes)) {
    savedGeneration = saved.generation;
    if (saved.scopeGenerations) {
      for (const [id, gen] of Object.entries(saved.scopeGenerations)) {
        scopeGenerations.set(id, gen);
      }
    }
    for (const entry of saved.scopes) {
      try {
        const id = scopeId(entry.resource, entry.key);
        states.set(id, app.restore(entry.resource, entry.snapshot));
        cursors.set(id, entry.snapshot.seq);
      } catch {}
    }
    if (saved.pending && Array.isArray(saved.pending)) {
      for (const p of saved.pending) {
        pendingCommands.set(p.commandId, p.message);
      }
    }
  }

  function getSyncMeta(id: string): SyncMeta {
    let m = syncMeta.get(id);
    if (!m) {
      m = { cursor: cursors.get(id) ?? 0, syncing: false, stale: false, error: null };
      syncMeta.set(id, m);
    }
    return m;
  }

  function getState(id: string, resource: string): any {
    if (!states.has(id)) {
      const s = app.createState(resource);
      states.set(id, s);
      return s;
    }
    return states.get(id);
  }

  function updateCursor(id: string, seq: number) {
    const prev = cursors.get(id) ?? 0;
    if (seq > prev) cursors.set(id, seq);
    const meta = getSyncMeta(id);
    meta.cursor = cursors.get(id) ?? 0;
    meta.syncing = false;
    meta.stale = false;
    meta.error = null;
  }

  function bufferFutureEvent(id: string, ev: CommittedEvent) {
    let buffered = bufferedEvents.get(id);
    if (!buffered) {
      buffered = [];
      bufferedEvents.set(id, buffered);
    }
    if (!buffered.some((existing) => existing.seq === ev.seq && existing.id === ev.id)) {
      buffered.push(ev);
      buffered.sort((a, b) => a.seq - b.seq);
    }
  }

  function dropBufferedThrough(id: string, cursor: number) {
    const buffered = bufferedEvents.get(id);
    if (!buffered) return;
    const remaining = buffered.filter((ev) => ev.seq > cursor);
    if (remaining.length === 0) {
      bufferedEvents.delete(id);
    } else {
      bufferedEvents.set(id, remaining);
    }
  }

  function applySequentialEvent(
    ev: CommittedEvent,
    targetState: any,
    resource: string,
    id: string,
  ): boolean {
    app.applyEvent(
      resource,
      targetState,
      {
        id: ev.id,
        seq: ev.seq,
        at: ev.at,
        actor: ev.actor as ActorOf<Spec>,
        name: ev.name,
        payload: ev.payload,
        hash: ev.hash,
      },
      ev.version,
      ev.hash,
    );
    updateCursor(id, ev.seq);
    dirty = true;
    return true;
  }

  function drainBufferedEvents(targetState: any, resource: string, id: string) {
    const buffered = bufferedEvents.get(id);
    if (!buffered) return;

    let cursor = cursors.get(id) ?? 0;
    const remaining: CommittedEvent[] = [];

    for (const ev of buffered) {
      if (ev.seq <= cursor) continue;
      if (ev.seq === cursor + 1) {
        applySequentialEvent(ev, targetState, resource, id);
        cursor = cursors.get(id) ?? cursor;
      } else {
        remaining.push(ev);
      }
    }

    if (remaining.length === 0) {
      bufferedEvents.delete(id);
    } else {
      bufferedEvents.set(id, remaining);
    }
  }

  function buildSnapshot(): ClientSnapshot {
    const scopes: ScopeEntry[] = [];
    for (const [id, { resource, key }] of activeScopes) {
      const state = states.get(id);
      if (state === undefined || state === null) continue;
      const seq = cursors.get(id) ?? 0;
      scopes.push({ resource, key, snapshot: app.snapshot(state, seq) });
    }
    const pending: Array<{ commandId: string; message: ClientMessage }> = [];
    for (const [commandId, message] of pendingCommands) {
      pending.push({ commandId, message });
    }
    const scopeGens: Record<string, string> = {};
    for (const [id, gen] of scopeGenerations) {
      scopeGens[id] = gen;
    }
    return {
      version: app.def.version,
      generation: savedGeneration,
      scopeGenerations: Object.keys(scopeGens).length > 0 ? scopeGens : undefined,
      scopes,
      pending: pending.length > 0 ? pending : undefined,
    };
  }

  let persistInFlight = false;

  function persist() {
    if (persistInFlight) return;

    const snap = buildSnapshot();
    try {
      const result = storage.saveSnapshot(snap);
      if (result instanceof Promise) {
        persistInFlight = true;
        result
          .then(() => {
            persistInFlight = false;
            if (dirty) {
              dirty = false;
              persist();
            }
          })
          .catch((e) => {
            console.error("client persist failed", e);
            persistInFlight = false;
            dirty = true;
          });
      } else {
        dirty = false;
      }
    } catch (e) {
      console.error("client persist failed", e);
    }
  }

  function notify() {
    for (const fn of subs) fn();
  }

  function send(msg: ClientMessage) {
    if (ws.readyState === _WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch {
        connected = false;
        for (const m of syncMeta.values()) m.stale = true;
        notify();
      }
    }
  }

  function applyEventToState(
    ev: CommittedEvent,
    targetState: any,
    resource: string,
    id: string,
    strictGap: boolean = false,
  ): boolean {
    const cursor = cursors.get(id) ?? 0;
    if (ev.seq <= cursor) return false;
    if (ev.seq > cursor + 1) {
      if (strictGap) {
        bufferFutureEvent(id, ev);
        const meta = getSyncMeta(id);
        meta.stale = true;
        const scope = activeScopes.get(id);
        if (connected && scope && ws.readyState === _WebSocket.OPEN) {
          meta.syncing = true;
          send({ type: "subscribe", resource: scope.resource, key: scope.key, cursor });
        }
      }
      return false;
    }
    const applied = applySequentialEvent(ev, targetState, resource, id);
    drainBufferedEvents(targetState, resource, id);
    return applied;
  }

  function flushPending() {
    if (ws.readyState !== _WebSocket.OPEN) return;
    for (const [, msg] of pendingCommands) {
      ws.send(JSON.stringify(msg));
    }
  }

  function open() {
    ws = new _WebSocket(wsUrl);

    ws.onopen = () => {
      connected = true;
      reconnectAttempts = 0;
      for (const m of syncMeta.values()) m.stale = false;
      send({ type: "connect", token });
      subscribedScopes = new Set();
      for (const [id, { resource, key }] of activeScopes) {
        subscribedScopes.add(id);
        send({ type: "subscribe", resource, key, cursor: cursors.get(id) ?? 0 });
      }
      flushPending();
    };

    ws.onclose = () => {
      connected = false;
      selfSession = null;
      sessions.length = 0;
      for (const m of syncMeta.values()) m.stale = true;
      notify();
      if (!disposed) {
        const delay = Math.min(reconnectMs * Math.pow(2, reconnectAttempts), MAX_RECONNECT_MS);
        reconnectAttempts++;
        timeouts.push(setTimeout(open, delay));
      }
    };

    ws.onmessage = (e: { data: string }) => {
      let msg: ServerMessage;
      try {
        const parsed = JSON.parse(e.data);
        msg = validateServerMessage(parsed) as ServerMessage;
        if (!msg) return;
      } catch (err) {
        console.error("client parse error", err);
        return;
      }

      if (msg.type === "init") {
        sessions.length = 0;
        sessions.push(...(msg.sessions as SessionData<ActorOf<Spec>>[]));

        const self = sessions.find((s) => s.id === msg.selfId) ?? null;
        selfSession = self;

        persist();
        notify();
        return;
      }

      if (msg.type === "synced") {
        const id = scopeId(msg.resource, msg.key);
        const meta = getSyncMeta(id);

        if (msg.snapshot) {
          const generationChanged =
            msg.generation &&
            scopeGenerations.has(id) &&
            scopeGenerations.get(id) !== msg.generation;

          const localCursor = cursors.get(id) ?? 0;
          if (msg.snapshot.seq < localCursor) {
            console.warn("scope cursor regression", {
              resource: msg.resource,
              key: msg.key,
              localCursor,
              serverSeq: msg.snapshot.seq,
            });
          }

          if (generationChanged && msg.generation) {
            states.delete(id);
            cursors.delete(id);
            bufferedEvents.delete(id);
            scopeGenerations.set(id, msg.generation);
            savedGeneration = msg.generation;
            for (const [cmdId, cmdMsg] of pendingCommands) {
              if (cmdMsg.type === "command" && scopeId(cmdMsg.resource, cmdMsg.key) === id) {
                const receipt = commandReceipts.get(cmdId);
                if (receipt) {
                  receipt.resolve({ ok: false, error: "server_reset" });
                  commandReceipts.delete(cmdId);
                }
                pendingCommands.delete(cmdId);
              }
            }
          }

          const restored = app.restore(msg.resource, msg.snapshot);
          states.set(id, restored);
          cursors.set(id, msg.snapshot.seq);
          dropBufferedThrough(id, msg.snapshot.seq);
        }

        if (msg.generation && !scopeGenerations.has(id)) {
          scopeGenerations.set(id, msg.generation);
          savedGeneration = msg.generation;
        }

        let hadGap = false;
        let lastApplied = cursors.get(id) ?? 0;

        if (msg.events) {
          const targetState = getState(id, msg.resource);
          let prevSeq = lastApplied;
          for (const ev of msg.events as CommittedEvent[]) {
            if (ev.seq > prevSeq + 1) {
              hadGap = true;
              break;
            }
            applyEventToState(ev, targetState, msg.resource, id);
            prevSeq = ev.seq;
          }
          lastApplied = prevSeq;
        }

        if (!hadGap) {
          if (msg.cursor > meta.cursor) {
            meta.cursor = msg.cursor;
            cursors.set(id, msg.cursor);
          }
          meta.syncing = false;
          meta.stale = false;
          meta.error = null;
        } else {
          cursors.set(id, lastApplied);
          meta.cursor = lastApplied;
          meta.stale = true;
          const scope = activeScopes.get(id);
          if (connected && scope && ws.readyState === _WebSocket.OPEN) {
            meta.syncing = true;
            send({
              type: "subscribe",
              resource: scope.resource,
              key: scope.key,
              cursor: lastApplied,
            });
          }
        }

        persist();
        notify();
        return;
      }

      if (msg.type === "event") {
        const ev = msg.event;
        const id = scopeId(msg.resource, msg.key);
        const targetState = getState(id, msg.resource);
        applyEventToState(ev, targetState, msg.resource, id, true);
        notify();
        return;
      }

      if (msg.type === "session") {
        const s = msg.session as SessionData<ActorOf<Spec>>;
        const idx = sessions.findIndex((x) => x.id === s.id);
        if (idx >= 0) {
          sessions[idx] = s;
        } else {
          sessions.push(s);
        }
        if (selfSession && s.id === selfSession.id) {
          selfSession = s;
        }
        notify();
        return;
      }

      if (msg.type === "sessionLeft") {
        const idx = sessions.findIndex((s) => s.id === msg.sessionId);
        if (idx >= 0) {
          sessions.splice(idx, 1);
          if (selfSession && msg.sessionId === selfSession.id) {
            selfSession = null;
          }
          notify();
        }
        return;
      }

      if (msg.type === "commandAck") {
        const cmdMsg = pendingCommands.get(msg.commandId);
        pendingCommands.delete(msg.commandId);

        if (msg.ok && msg.events && cmdMsg && cmdMsg.type === "command") {
          const id = scopeId(cmdMsg.resource, cmdMsg.key);
          const targetState = getState(id, cmdMsg.resource);
          for (const ev of msg.events as CommittedEvent[]) {
            applyEventToState(ev, targetState, cmdMsg.resource, id);
          }
          persist();
          notify();
        }

        const receipt = commandReceipts.get(msg.commandId);
        if (receipt) {
          receipt.resolve({ ok: msg.ok, cursor: msg.cursor, error: msg.error, data: msg.data });
          commandReceipts.delete(msg.commandId);
        }
        dirty = true;
        return;
      }
    };
  }

  intervals.push(
    setInterval(() => {
      if (dirty) persist();
    }, persistIntervalMs),
  );

  open();

  const clients = new Map<string, any>();

  function getClient(resource: string, key: JsonValue): any {
    const id = scopeId(resource, key);
    activeScopes.set(id, { resource, key });

    let cached = clients.get(id);
    if (cached) return cached;

    const resDef = (app.def.resources as any)?.[resource];
    if (!resDef) return undefined;

    const meta = getSyncMeta(id);

    if (connected && !subscribedScopes.has(id)) {
      subscribedScopes.add(id);
      meta.syncing = true;
      send({ type: "subscribe", resource, key, cursor: cursors.get(id) ?? 0 });
    } else if (!connected) {
      meta.syncing = true;
      meta.stale = true;
    }

    const views: Record<string, () => any> = {};
    if (resDef.views) {
      for (const vk of Object.keys(resDef.views)) {
        views[vk] = () =>
          (resDef.views as any)[vk]({
            state: getState(id, resource),
            actor: selfSession?.actor ?? null,
            sessions,
            key,
          });
      }
    }

    const cmds: Record<string, (...args: any[]) => any> = {};
    if (resDef.commands) {
      for (const ck of Object.keys(resDef.commands)) {
        cmds[ck] = (...args: any[]) => {
          const commandId = crypto.randomUUID();
          const msg: ClientMessage = {
            type: "command",
            commandId,
            name: ck,
            args,
            resource,
            key,
          };
          pendingCommands.set(commandId, msg);
          dirty = true;
          persist();
          if (connected && ws.readyState === _WebSocket.OPEN) {
            send(msg);
          }
          return new Promise<{ ok: boolean; cursor?: number; error?: string; data?: unknown }>(
            (resolve) => {
              const timer = setTimeout(() => {
                commandReceipts.delete(commandId);
                pendingCommands.delete(commandId);
                resolve({ ok: false, error: "timeout" });
              }, 30000);
              commandReceipts.set(commandId, {
                resolve: (v) => {
                  clearTimeout(timer);
                  resolve(v);
                },
              });
            },
          );
        };
      }
    }

    const proxy = new Proxy(
      {
        get sync() {
          return { ...meta };
        },
        subscribe: (fn: (scope: Record<string, any>) => void) => {
          const listener = () => {
            const scope: Record<string, any> = {};
            for (const vk of Object.keys(views)) {
              scope[vk] = views[vk]!();
            }
            fn(scope);
          };
          subs.add(listener);
          listener();
          return () => subs.delete(listener);
        },
      },
      {
        get(target, prop: string) {
          if (prop in target) return (target as any)[prop];
          const cmd = cmds[prop];
          if (cmd) return cmd;
          const view = views[prop];
          if (view) return view();
          return undefined;
        },
      },
    );

    clients.set(id, proxy);
    return proxy;
  }

  const accessors: Record<string, (key: JsonValue) => any> = {};
  for (const resource of Object.keys(app.def.resources)) {
    accessors[resource] = (key: JsonValue) => getClient(resource, key);
  }

  return new Proxy(
    {
      get connected() {
        return connected;
      },
      dispose: () => {
        disposed = true;
        for (const t of timeouts) clearTimeout(t);
        for (const i of intervals) clearInterval(i);
        timeouts.length = 0;
        intervals.length = 0;
        for (const [, receipt] of commandReceipts) {
          receipt.resolve({ ok: false, error: "disposed" });
        }
        commandReceipts.clear();
        if (ws && ws.readyState !== _WebSocket.CLOSED) {
          try {
            ws.close();
          } catch {}
        }
      },
    },
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        const fn = accessors[prop];
        if (fn) return fn;
        return undefined;
      },
    },
  ) as Client<Spec>;
}
