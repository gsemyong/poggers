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
export type Snapshot = {
  version: number;
  seq: number;
  data: unknown;
  generation?: string;
};
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };
export type ClientMessage =
  | {
      type: "connect";
      token: string;
    }
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
  | {
      type: "event";
      event: CommittedEvent;
      resource: string;
      key: JsonValue;
    }
  | {
      type: "session";
      session: SessionData;
    }
  | {
      type: "sessionLeft";
      sessionId: string;
    }
  | {
      type: "commandAck";
      commandId: string;
      ok: boolean;
      cursor?: number;
      events?: CommittedEvent[];
      error?: string;
      data?: unknown;
    };
export declare function scopeId(resource: string, key: JsonValue): string;
export declare function validateClientMessage(data: unknown): ClientMessage | null;
export declare function validateServerMessage(data: unknown): ServerMessage | null;
