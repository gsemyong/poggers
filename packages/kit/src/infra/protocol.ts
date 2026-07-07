export type CommittedEvent = {
  id: string;
  seq: number;
  at: number;
  version?: number;
  actor: unknown;
  name: string;
  payload: unknown;
};

export type SessionData<A = unknown, P = unknown> = {
  id: string;
  actor: A;
  presence: P;
};

export type Snapshot = { version: number; seq: number; data: unknown; generation?: string };

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ClientMessage =
  | { type: "connect"; token: string }
  | {
      type: "subscribe";
      resource: string;
      key: JsonValue;
      cursor: number;
    }
  | {
      type: "command";
      commandId: string;
      name: string;
      args: unknown[];
      resource: string;
      key: JsonValue;
    };

export type ServerMessage =
  | {
      type: "init";
      sessions: SessionData[];
      selfId: string;
    }
  | {
      type: "synced";
      resource: string;
      key: JsonValue;
      snapshot?: Snapshot;
      events?: unknown[];
      cursor: number;
      generation?: string;
    }
  | { type: "event"; event: CommittedEvent; resource: string; key: JsonValue }
  | { type: "session"; session: SessionData }
  | { type: "sessionLeft"; sessionId: string }
  | {
      type: "commandAck";
      commandId: string;
      ok: boolean;
      cursor?: number;
      events?: CommittedEvent[];
      error?: string;
      data?: unknown;
    };

function stableKey(v: JsonValue): string {
  return canonicalJSON(v);
}

function canonicalJSON(v: JsonValue): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJSON).join(",") + "]";
  const keys = Object.keys(v).sort();
  return (
    "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON((v as any)[k])).join(",") + "}"
  );
}

export function scopeId(resource: string, key: JsonValue): string {
  if (typeof key === "number" && !Number.isFinite(key)) {
    throw new Error(`scopeId called with non-finite number: ${key}`);
  }
  return resource + "@" + stableKey(key);
}

export function validateClientMessage(data: unknown): ClientMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as any;
  if (m.type === "connect") return typeof m.token === "string" ? m : null;
  if (m.type === "subscribe") {
    if (typeof m.resource !== "string") return null;
    if (!isValidJsonValue(m.key)) return null;
    if (typeof m.cursor !== "number" || !Number.isFinite(m.cursor) || m.cursor < 0) return null;
    return m;
  }
  if (m.type === "command") {
    if (typeof m.resource !== "string") return null;
    if (typeof m.name !== "string") return null;
    if (typeof m.commandId !== "string" || m.commandId.length === 0) return null;
    if (!Array.isArray(m.args)) return null;
    if (!m.args.every((a: unknown) => isValidJsonValue(a))) return null;
    if (!isValidJsonValue(m.key)) return null;
    return m;
  }
  return null;
}

export function validateServerMessage(data: unknown): ServerMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as any;
  if (m.type === "init") {
    if (!Array.isArray(m.sessions)) return null;
    if (!m.sessions.every((s: unknown) => isValidSession(s))) return null;
    if (typeof m.selfId !== "string") return null;
    return m;
  }
  if (m.type === "synced") {
    if (typeof m.resource !== "string") return null;
    if (!isValidJsonValue(m.key)) return null;
    if (typeof m.cursor !== "number" || !Number.isFinite(m.cursor) || m.cursor < 0) return null;
    if (m.snapshot !== undefined && m.snapshot !== null) {
      if (!isValidSnapshot(m.snapshot)) return null;
    }
    if (m.events !== undefined && m.events !== null) {
      if (!Array.isArray(m.events)) return null;
      if (!m.events.every((e: unknown) => isValidEvent(e))) return null;
    }
    return m;
  }
  if (m.type === "event") {
    if (typeof m.resource !== "string") return null;
    if (!isValidJsonValue(m.key)) return null;
    if (!m.event || typeof m.event !== "object") return null;
    if (typeof m.event.id !== "string") return null;
    if (typeof m.event.seq !== "number" || !Number.isFinite(m.event.seq) || m.event.seq < 0)
      return null;
    if (typeof m.event.at !== "number" || !Number.isFinite(m.event.at)) return null;
    if (
      m.event.version !== undefined &&
      (typeof m.event.version !== "number" ||
        !Number.isFinite(m.event.version) ||
        m.event.version < 0)
    )
      return null;
    if (typeof m.event.name !== "string") return null;
    return m;
  }
  if (m.type === "session") {
    if (!isValidSession(m.session)) return null;
    return m;
  }
  if (m.type === "sessionLeft") {
    if (typeof m.sessionId !== "string") return null;
    return m;
  }
  if (m.type === "commandAck") {
    if (typeof m.commandId !== "string") return null;
    if (typeof m.ok !== "boolean") return null;
    if (m.cursor !== undefined && typeof m.cursor !== "number") return null;
    if (m.events !== undefined) {
      if (!Array.isArray(m.events)) return null;
      if (!m.events.every((e: unknown) => isValidEvent(e))) return null;
    }
    if (m.error !== undefined && typeof m.error !== "string") return null;
    return m;
  }
  return null;
}

function isValidJsonValue(v: unknown): v is JsonValue {
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isValidJsonValue);
  if (typeof v === "object") {
    return Object.values(v as object).every(isValidJsonValue);
  }
  return false;
}

function isValidSnapshot(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const snap = s as any;
  if (typeof snap.version !== "number" || !Number.isFinite(snap.version) || snap.version < 0)
    return false;
  if (typeof snap.seq !== "number" || !Number.isFinite(snap.seq) || snap.seq < 0) return false;
  return true;
}

function isValidEvent(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const ev = e as any;
  if (typeof ev.id !== "string") return false;
  if (typeof ev.seq !== "number" || !Number.isFinite(ev.seq) || ev.seq < 0) return false;
  if (typeof ev.at !== "number" || !Number.isFinite(ev.at)) return false;
  if (
    ev.version !== undefined &&
    (typeof ev.version !== "number" || !Number.isFinite(ev.version) || ev.version < 0)
  )
    return false;
  if (typeof ev.name !== "string") return false;
  return true;
}

function isValidSession(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const sess = s as any;
  if (typeof sess.id !== "string") return false;
  if (!sess.actor || typeof sess.actor !== "object") return false;
  if (typeof sess.actor.id !== "string") return false;
  return true;
}
