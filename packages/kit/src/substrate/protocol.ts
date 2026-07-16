import type { JsonValue, SessionData } from "#kernel/app";

export type CommittedEvent = {
  id: string;
  seq: number;
  at: number;
  version?: number;
  hash?: string;
  actor: unknown;
  name: string;
  payload: unknown;
  commandId?: string;
};

export type Snapshot = {
  version: number;
  seq: number;
  data: unknown;
  generation?: string;
  hash?: string;
};

export const protocolVersion = 2 as const;
export const maxProtocolBatch = 128;

export type ClientOperation =
  | { type: "connect"; version: typeof protocolVersion; token: string }
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
      at: number;
    }
  | {
      type: "receipt";
      commandId: string;
      resource: string;
      key: JsonValue;
    }
  | {
      type: "presence";
      resource: string;
      key: JsonValue;
      value: JsonValue;
    };

export type ClientMessage =
  | ClientOperation
  | { type: "batch"; operations: readonly ClientOperation[] };

export type ServerOperation =
  | {
      type: "init";
      version: typeof protocolVersion;
      session: SessionData;
    }
  | {
      type: "synced";
      resource: string;
      key: JsonValue;
      snapshot?: Snapshot;
      events?: unknown[];
      sessions: SessionData[];
      cursor: number;
      generation?: string;
    }
  | { type: "event"; event: CommittedEvent; resource: string; key: JsonValue }
  | { type: "forbidden"; resource: string; key: JsonValue }
  | {
      type: "presence";
      resource: string;
      key: JsonValue;
      session: SessionData;
    }
  | { type: "presenceLeft"; resource: string; key: JsonValue; sessionId: string }
  | {
      type: "commandAck";
      commandId: string;
      /** False means the authority has no receipt and the client may submit the intent. */
      known?: boolean;
      ok: boolean;
      cursor?: number;
      events?: CommittedEvent[];
      error?: string;
      data?: unknown;
    };

export type ServerMessage =
  | ServerOperation
  | { type: "batch"; operations: readonly ServerOperation[] };

function stableKey(v: JsonValue): string {
  return canonicalJSON(v);
}

function canonicalJSON(v: JsonValue): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalJSON).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(v[k]!)).join(",") + "}";
}

export function scopeId(resource: string, key: JsonValue): string {
  if (typeof key === "number" && !Number.isFinite(key)) {
    throw new Error(`scopeId called with non-finite number: ${key}`);
  }
  return resource + "@" + stableKey(key);
}

export function validateClientMessage(data: unknown): ClientMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "batch") {
    if (!isValidBatch(m.operations)) return null;
    const operations = m.operations.map(validateClientOperation);
    return operations.every((operation) => operation !== null)
      ? { type: "batch", operations: operations as ClientOperation[] }
      : null;
  }
  return validateClientOperation(data);
}

function validateClientOperation(data: unknown): ClientOperation | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "connect") {
    return m.version === protocolVersion && typeof m.token === "string"
      ? { type: "connect", version: protocolVersion, token: m.token }
      : null;
  }
  if (m.type === "subscribe") {
    if (typeof m.resource !== "string") return null;
    if (!isValidJsonValue(m.key)) return null;
    if (typeof m.cursor !== "number" || !Number.isFinite(m.cursor) || m.cursor < 0) return null;
    return { type: "subscribe", resource: m.resource, key: m.key, cursor: m.cursor };
  }
  if (m.type === "command") {
    if (typeof m.resource !== "string") return null;
    if (typeof m.name !== "string") return null;
    if (typeof m.commandId !== "string" || m.commandId.length === 0) return null;
    if (typeof m.at !== "number" || !Number.isFinite(m.at)) return null;
    if (!Array.isArray(m.args)) return null;
    if (!m.args.every((a: unknown) => isValidJsonValue(a))) return null;
    if (!isValidJsonValue(m.key)) return null;
    return {
      type: "command",
      resource: m.resource,
      name: m.name,
      commandId: m.commandId,
      at: m.at,
      args: m.args,
      key: m.key,
    };
  }
  if (m.type === "receipt") {
    if (typeof m.commandId !== "string" || m.commandId.length === 0) return null;
    if (typeof m.resource !== "string" || m.resource.length === 0) return null;
    if (!isValidJsonValue(m.key)) return null;
    return {
      type: "receipt",
      commandId: m.commandId,
      resource: m.resource,
      key: m.key,
    };
  }
  if (m.type === "presence") {
    if (typeof m.resource !== "string" || m.resource.length === 0) return null;
    if (!isValidJsonValue(m.key) || !isValidJsonValue(m.value)) return null;
    return { type: "presence", resource: m.resource, key: m.key, value: m.value };
  }
  return null;
}

export function validateServerMessage(data: unknown): ServerMessage | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "batch") {
    if (!isValidBatch(m.operations)) return null;
    const operations = m.operations.map(validateServerOperation);
    return operations.every((operation) => operation !== null)
      ? { type: "batch", operations: operations as ServerOperation[] }
      : null;
  }
  return validateServerOperation(data);
}

function validateServerOperation(data: unknown): ServerOperation | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "init") {
    if (m.version !== protocolVersion) return null;
    if (!isValidSession(m.session)) return null;
    return m as unknown as ServerOperation;
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
    if (!Array.isArray(m.sessions) || !m.sessions.every(isValidSession)) return null;
    return m as unknown as ServerOperation;
  }
  if (m.type === "event") {
    if (typeof m.resource !== "string") return null;
    if (!isValidJsonValue(m.key)) return null;
    const event = m.event as Record<string, unknown> | undefined;
    if (!event) return null;
    if (typeof event.id !== "string") return null;
    if (typeof event.seq !== "number" || !Number.isFinite(event.seq) || event.seq < 0) return null;
    if (typeof event.at !== "number" || !Number.isFinite(event.at)) return null;
    if (
      event.version !== undefined &&
      (typeof event.version !== "number" || !Number.isFinite(event.version) || event.version < 0)
    )
      return null;
    if (event.hash !== undefined && typeof event.hash !== "string") return null;
    if (event.commandId !== undefined && typeof event.commandId !== "string") return null;
    if (typeof event.name !== "string") return null;
    return m as unknown as ServerOperation;
  }
  if (m.type === "forbidden") {
    if (typeof m.resource !== "string" || !isValidJsonValue(m.key)) return null;
    return { type: "forbidden", resource: m.resource, key: m.key };
  }
  if (m.type === "presence") {
    if (typeof m.resource !== "string" || !isValidJsonValue(m.key)) return null;
    if (!isValidSession(m.session)) return null;
    return m as unknown as ServerOperation;
  }
  if (m.type === "presenceLeft") {
    if (typeof m.resource !== "string" || !isValidJsonValue(m.key)) return null;
    if (typeof m.sessionId !== "string") return null;
    return m as unknown as ServerOperation;
  }
  if (m.type === "commandAck") {
    if (typeof m.commandId !== "string") return null;
    if (typeof m.ok !== "boolean") return null;
    if (m.known !== undefined && typeof m.known !== "boolean") return null;
    if (m.cursor !== undefined && typeof m.cursor !== "number") return null;
    if (m.events !== undefined) {
      if (!Array.isArray(m.events)) return null;
      if (!m.events.every((e: unknown) => isValidEvent(e))) return null;
    }
    if (m.error !== undefined && typeof m.error !== "string") return null;
    return m as unknown as ServerOperation;
  }
  return null;
}

function isValidBatch(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.length <= maxProtocolBatch;
}

function isValidJsonValue(v: unknown): v is JsonValue {
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isValidJsonValue);
  if (typeof v === "object") {
    return Object.values(v).every(isValidJsonValue);
  }
  return false;
}

function isValidSnapshot(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const snap = s as Record<string, unknown>;
  if (typeof snap.version !== "number" || !Number.isFinite(snap.version) || snap.version < 0)
    return false;
  if (typeof snap.seq !== "number" || !Number.isFinite(snap.seq) || snap.seq < 0) return false;
  if (snap.hash !== undefined && typeof snap.hash !== "string") return false;
  return true;
}

function isValidEvent(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const ev = e as Record<string, unknown>;
  if (typeof ev.id !== "string") return false;
  if (typeof ev.seq !== "number" || !Number.isFinite(ev.seq) || ev.seq < 0) return false;
  if (typeof ev.at !== "number" || !Number.isFinite(ev.at)) return false;
  if (
    ev.version !== undefined &&
    (typeof ev.version !== "number" || !Number.isFinite(ev.version) || ev.version < 0)
  )
    return false;
  if (ev.hash !== undefined && typeof ev.hash !== "string") return false;
  if (ev.commandId !== undefined && typeof ev.commandId !== "string") return false;
  if (typeof ev.name !== "string") return false;
  return true;
}

function isValidSession(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const sess = s as Record<string, unknown>;
  if (typeof sess.id !== "string") return false;
  if (!sess.actor || typeof sess.actor !== "object") return false;
  if (typeof (sess.actor as Record<string, unknown>).id !== "string") return false;
  return isValidJsonValue(sess.presence);
}
