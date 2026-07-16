import type {
  ActorOf,
  App,
  AppSpec,
  Client,
  JsonValue,
  SessionData,
  Submission,
  SubmissionOutcome,
  SyncMeta,
} from "#kernel/app";
import {
  maxProtocolBatch,
  protocolVersion,
  scopeId,
  validateServerMessage,
  type ClientMessage,
  type ClientOperation,
  type CommittedEvent,
  type ServerMessage,
  type ServerOperation,
  type Snapshot,
} from "#substrate/protocol";
import type { ReplicaLoad, ReplicaScope, ReplicaStore } from "#substrate/replica";
import { createSubmission, type SubmissionController } from "#substrate/submission";
import type { SyncTransport, SyncTransportFactory } from "#substrate/sync";

const RECONNECT_MS = 2000;
const MAX_RECONNECT_MS = 30000;
const MAX_MESSAGE_BYTES = 1_048_576;
const MAX_INBOUND_BYTES = 4_194_304;
const MAX_OUTBOUND_BYTES = 1_048_576;
const REMOTE_CHECKPOINT_EVENTS = 128;
const REMOTE_CHECKPOINT_DELAY_MS = 1_000;
const COMMAND_UNCERTAINTY_MS = 30_000;
const AUTHENTICATION_CHANGED_EVENT = "poggers:authentication-changed";

export type ClientLimits = Readonly<{
  resources: number;
  pendingIntents: number;
  subscriptions: number;
  queuedMessages: number;
  bufferedEventsPerResource: number;
}>;

const DEFAULT_CLIENT_LIMITS: ClientLimits = {
  resources: 50_000,
  pendingIntents: 10_000,
  subscriptions: 50_000,
  queuedMessages: 256,
  bufferedEventsPerResource: maxProtocolBatch,
};

class ClientLimitError extends Error {}

export function notifyAuthenticationChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTHENTICATION_CHANGED_EVENT));
}

type OptimisticCommand = {
  readonly scope: string;
  readonly resource: string;
  readonly events: readonly CommittedEvent[];
};

type ResourceSubscription = {
  readonly run: () => void;
  readonly changed: () => boolean;
};

type InboundChunk = {
  readonly type: "poggers:chunk";
  readonly id: string;
  readonly index: number;
  readonly total: number;
  readonly data: string;
};

function parseInboundChunk(value: unknown): InboundChunk | null {
  if (!value || typeof value !== "object") return null;
  const chunk = value as Record<string, unknown>;
  return chunk.type === "poggers:chunk" &&
    typeof chunk.id === "string" &&
    chunk.id.length <= 256 &&
    Number.isSafeInteger(chunk.index) &&
    Number.isSafeInteger(chunk.total) &&
    typeof chunk.data === "string" &&
    (chunk.total as number) > 0 &&
    (chunk.total as number) <= 1_024 &&
    (chunk.index as number) >= 0 &&
    (chunk.index as number) < (chunk.total as number)
    ? (chunk as InboundChunk)
    : null;
}

function decodeChunkedUtf8(parts: readonly string[]): string {
  const binary = atob(parts.join(""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function semanticEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => semanticEqual(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => key in rightRecord && semanticEqual(leftRecord[key], rightRecord[key]))
  );
}

function snapshotValue(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export type ConnectOpts = {
  wsUrl: string;
  token: string;
  replica: ReplicaStore;
  transport: SyncTransportFactory;
  reconnectMs?: number;
  messageBytes?: number;
  inboundBytes?: number;
  outboundBytes?: number;
  commandUncertaintyMs?: number;
  limits?: Partial<ClientLimits>;
};

export async function connect<Spec extends AppSpec>(
  app: App<Spec>,
  opts: ConnectOpts,
): Promise<Client<Spec>> {
  const saved = await opts.replica.load();
  await opts.replica.initialize(crypto.randomUUID());
  return wire(app, saved, opts);
}

function wire<Spec extends AppSpec>(
  app: App<Spec>,
  saved: ReplicaLoad,
  opts: ConnectOpts,
): Client<Spec> {
  const reconnectMs = opts.reconnectMs ?? RECONNECT_MS;
  const messageBytes = positiveLimit(opts.messageBytes ?? MAX_MESSAGE_BYTES, "messageBytes");
  const inboundBytes = positiveLimit(opts.inboundBytes ?? MAX_INBOUND_BYTES, "inboundBytes");
  const outboundBytes = positiveLimit(opts.outboundBytes ?? MAX_OUTBOUND_BYTES, "outboundBytes");
  const commandUncertaintyMs = positiveLimit(
    opts.commandUncertaintyMs ?? COMMAND_UNCERTAINTY_MS,
    "commandUncertaintyMs",
  );
  const limits = { ...DEFAULT_CLIENT_LIMITS, ...opts.limits };
  assertClientLimits(limits);
  let ws: SyncTransport | undefined;
  const transportLifetime = new AbortController();
  let connected = false;
  let disposed = false;
  let reconnectAttempts = 0;
  const { wsUrl, token, replica, transport } = opts;
  const initialActor = app.def.identify({ token });

  const policyFor = (resource: string) => app.def.resources[resource]?.policy ?? "sync";

  let selfSession: SessionData<ActorOf<Spec>> | null = null;
  const scopeSessions = new Map<string, Map<string, SessionData<ActorOf<Spec>>>>();
  const desiredPresence = new Map<
    string,
    { readonly resource: string; readonly key: JsonValue; value: JsonValue }
  >();
  const subscriptions = new Map<string, Set<ResourceSubscription>>();
  const pendingCommands = new Map<string, ClientMessage>();
  const optimisticCommands = new Map<string, OptimisticCommand>();
  const optimisticScopes = new Map<string, string[]>();
  const confirmedStates = new Map<string, unknown>();
  const commandSubmissions = new Map<
    string,
    {
      readonly controller: SubmissionController<string>;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();

  const states = new Map<string, unknown>();
  const cursors = new Map<string, number>();
  const bufferedEvents = new Map<string, CommittedEvent[]>();
  const checkpointEvents = new Map<string, number>();
  const checkpointTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const syncMeta = new Map<string, SyncMeta>();
  const activeScopes = new Map<string, { resource: string; key: JsonValue }>();
  const scopeGenerations = new Map<string, string>();
  let subscribedScopes = new Set<string>();

  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let restartForAuthentication = false;
  const messageEvents: Array<{ data: string; bytes: number }> = [];
  const inboundChunks = new Map<
    string,
    { readonly total: number; readonly parts: Array<string | undefined>; bytes: number }
  >();
  let pendingMessageBytes = 0;
  let pendingChunkBytes = 0;
  let processingMessages = false;
  let subscriptionCount = 0;
  const retryOperations: ClientOperation[] = [];
  let retryFlushQueued = false;
  const subscriptionOperations = new Map<
    string,
    Extract<ClientOperation, { readonly type: "subscribe" }>
  >();
  let subscriptionFlushQueued = false;
  const presenceOperations = new Map<
    string,
    Extract<ClientOperation, { readonly type: "presence" }>
  >();
  let presenceFlushQueued = false;

  for (const scope of saved.scopes) {
    try {
      const storedVersion = /^version:(\d+)$/.exec(scope.schema)?.[1];
      if (storedVersion && Number(storedVersion) > app.def.version) continue;
      const policy = policyFor(scope.address.resource);
      if (policy === "memory") continue;
      if (policy === "device" && scope.owner !== initialActor?.id) continue;
      const id = scopeId(scope.address.resource, scope.address.key);
      states.set(id, app.restore(scope.address.resource, scope.state as Snapshot));
      cursors.set(id, scope.cursor);
      if (scope.generation) scopeGenerations.set(id, scope.generation);
    } catch {}
  }
  for (const intent of saved.pending) {
    const value = intent.value as Record<string, unknown>;
    if (
      value.type !== "command" ||
      typeof value.resource !== "string" ||
      typeof value.name !== "string" ||
      !Array.isArray(value.args) ||
      !Number.isSafeInteger(value.at)
    ) {
      continue;
    }
    pendingCommands.set(intent.id, {
      ...(value as Omit<Extract<ClientMessage, { type: "command" }>, "commandId">),
      commandId: intent.id,
    });
  }

  function getSyncMeta(id: string): SyncMeta {
    let m = syncMeta.get(id);
    if (!m) {
      m = { cursor: cursors.get(id) ?? 0, syncing: false, stale: false, error: null };
      syncMeta.set(id, m);
    }
    return m;
  }

  function getState(id: string, resource: string): unknown {
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
      if (buffered.length >= limits.bufferedEventsPerResource) {
        getSyncMeta(id).error = "overloaded";
        ws?.close(1013, "client Resource replay buffer is full");
        return;
      }
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
    targetState: unknown,
    resource: string,
    id: string,
  ): boolean {
    const authoritativeState = confirmedStates.get(id) ?? states.get(id) ?? targetState;
    app.applyEvent(
      resource,
      authoritativeState as never,
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
    if (ev.commandId) removeOptimisticCommand(ev.commandId);
    if (confirmedStates.has(id)) rebuildOptimisticState(id);
    return true;
  }

  function drainBufferedEvents(targetState: unknown, resource: string, id: string) {
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

  async function persistConfirmed(id: string, intentId?: string): Promise<void> {
    checkpointEvents.delete(id);
    const timer = checkpointTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    checkpointTimers.delete(id);
    const target = activeScopes.get(id);
    if (!target) {
      if (intentId) await replica.reject(intentId);
      return;
    }
    if (policyFor(target.resource) === "memory") {
      if (intentId) await replica.reject(intentId);
      return;
    }
    const state = confirmedStates.get(id) ?? states.get(id);
    if (state === undefined || state === null) {
      if (intentId) await replica.reject(intentId);
      return;
    }
    const snapshot = app.snapshot(state, cursors.get(id) ?? 0);
    const scope: ReplicaScope = {
      address: { resource: target.resource, key: target.key },
      schema: app.def.migrationHash ?? `version:${app.def.version}`,
      cursor: cursors.get(id) ?? 0,
      stateHash: await hashJson(snapshot),
      state: snapshot as JsonValue,
      ...(scopeGenerations.get(id) ? { generation: scopeGenerations.get(id) } : {}),
      ...(policyFor(target.resource) === "device"
        ? { owner: selfSession?.actor.id ?? initialActor?.id }
        : {}),
    };
    await replica.confirm({ scope, intentId });
  }

  async function checkpointRemoteState(id: string, events: number): Promise<void> {
    const count = (checkpointEvents.get(id) ?? 0) + events;
    checkpointEvents.set(id, count);
    if (count >= REMOTE_CHECKPOINT_EVENTS) {
      await persistConfirmed(id);
      return;
    }
    if (checkpointTimers.has(id)) return;
    checkpointTimers.set(
      id,
      setTimeout(() => {
        checkpointTimers.delete(id);
        if (disposed) return;
        void persistConfirmed(id).catch((error) => {
          console.error("client replica checkpoint error", error);
        });
      }, REMOTE_CHECKPOINT_DELAY_MS),
    );
  }

  function notify(id?: string) {
    const targets = id ? [subscriptions.get(id)] : subscriptions.values();
    for (const entries of targets) {
      if (!entries) continue;
      for (const subscription of entries) {
        if (subscription.changed()) subscription.run();
      }
    }
  }

  function removeOptimisticCommand(commandId: string): string | undefined {
    const command = optimisticCommands.get(commandId);
    if (!command) return undefined;
    optimisticCommands.delete(commandId);
    const commands = optimisticScopes.get(command.scope)?.filter((id) => id !== commandId) ?? [];
    if (commands.length === 0) optimisticScopes.delete(command.scope);
    else optimisticScopes.set(command.scope, commands);
    return command.scope;
  }

  function rebuildOptimisticState(id: string): void {
    const confirmed = confirmedStates.get(id);
    if (confirmed === undefined) return;
    const commandIds = optimisticScopes.get(id) ?? [];
    if (commandIds.length === 0) {
      states.set(id, confirmed);
      confirmedStates.delete(id);
      return;
    }
    const state = structuredClone(confirmed);
    let sequence = cursors.get(id) ?? 0;
    for (const commandId of commandIds) {
      const command = optimisticCommands.get(commandId);
      if (!command) continue;
      for (const event of command.events) {
        sequence += 1;
        app.applyEvent(command.resource, state as never, {
          ...event,
          seq: sequence,
          actor: event.actor as ActorOf<Spec>,
        });
      }
    }
    states.set(id, state);
  }

  function applyOptimisticCommand(
    commandId: string,
    message: Extract<ClientMessage, { type: "command" }>,
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly error: string; readonly data?: unknown } {
    if (optimisticCommands.has(commandId)) return { ok: true };
    const actor = selfSession?.actor ?? initialActor;
    if (!actor) return { ok: false, error: "unauthorized" };
    const id = scopeId(message.resource, message.key);
    const state = getState(id, message.resource);
    const events: CommittedEvent[] = [];
    let commandError: { error: string; data?: unknown } | undefined;
    try {
      app.runCommand(
        message.resource,
        state,
        actor,
        message.key,
        message.name,
        message.args,
        (event) => events.push({ ...event, commandId }),
        (error, data) => {
          commandError = { error, data };
        },
        { id: commandId, at: message.at },
      );
    } catch {
      return { ok: false, error: "internal_error" };
    }
    if (commandError) return { ok: false, ...commandError };
    if (!confirmedStates.has(id)) confirmedStates.set(id, structuredClone(state));
    optimisticCommands.set(commandId, { scope: id, resource: message.resource, events });
    const commands = optimisticScopes.get(id) ?? [];
    commands.push(commandId);
    optimisticScopes.set(id, commands);
    rebuildOptimisticState(id);
    return { ok: true };
  }

  function send(msg: ClientMessage) {
    if (ws?.state === "open") {
      try {
        const data = JSON.stringify(msg);
        const bytes = new TextEncoder().encode(data).byteLength;
        if (bytes > messageBytes) {
          ws.close(1009, "client message is too large");
          return;
        }
        if (ws.bufferedBytes + bytes > outboundBytes) {
          ws.close(1013, "client is sending too quickly");
          return;
        }
        ws.send(data);
      } catch {
        connected = false;
        for (const m of syncMeta.values()) m.stale = true;
        notify();
      }
    }
  }

  function settleSubmission(commandId: string, outcome: SubmissionOutcome<string>): void {
    const active = commandSubmissions.get(commandId);
    if (!active) return;
    clearTimeout(active.timer);
    active.controller.settle(outcome);
    commandSubmissions.delete(commandId);
  }

  function markSubmission(commandId: string, phase: "submitted" | "uncertain"): void {
    commandSubmissions.get(commandId)?.controller.setPhase(phase);
  }

  function sendBatch(operations: readonly ClientOperation[]): void {
    if (operations.length === 0) return;
    for (let offset = 0; offset < operations.length; offset += maxProtocolBatch) {
      const batch = operations.slice(offset, offset + maxProtocolBatch);
      send(batch.length === 1 ? batch[0]! : { type: "batch", operations: batch });
    }
  }

  function queueSubscription(id: string, resource: string, key: JsonValue, cursor: number): void {
    subscriptionOperations.set(id, { type: "subscribe", resource, key, cursor });
    if (subscriptionFlushQueued) return;
    subscriptionFlushQueued = true;
    queueMicrotask(() => {
      subscriptionFlushQueued = false;
      if (!connected || ws?.state !== "open") {
        subscriptionOperations.clear();
        return;
      }
      sendBatch([...subscriptionOperations.values()]);
      subscriptionOperations.clear();
    });
  }

  function queuePresence(id: string, resource: string, key: JsonValue, value: JsonValue): void {
    presenceOperations.set(id, { type: "presence", resource, key, value });
    if (presenceFlushQueued) return;
    presenceFlushQueued = true;
    queueMicrotask(() => {
      presenceFlushQueued = false;
      if (!connected || ws?.state !== "open") {
        presenceOperations.clear();
        return;
      }
      sendBatch([...presenceOperations.values()]);
      presenceOperations.clear();
    });
  }

  function replaceScopeSessions(id: string, values: readonly SessionData<ActorOf<Spec>>[]): void {
    scopeSessions.set(id, new Map(values.map((session) => [session.id, session])));
  }

  function setScopeSession(id: string, session: SessionData<ActorOf<Spec>>): void {
    let values = scopeSessions.get(id);
    if (!values) {
      values = new Map();
      scopeSessions.set(id, values);
    }
    values.set(session.id, session);
  }

  function retryPending(message: Extract<ClientOperation, { type: "command" }>): void {
    markSubmission(message.commandId, "submitted");
    retryOperations.push(message);
    if (retryFlushQueued) return;
    retryFlushQueued = true;
    queueMicrotask(() => {
      retryFlushQueued = false;
      sendBatch(retryOperations.splice(0));
    });
  }

  function applyEventToState(
    ev: CommittedEvent,
    targetState: unknown,
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
        if (connected && scope && ws?.state === "open") {
          meta.syncing = true;
          queueSubscription(id, scope.resource, scope.key, cursor);
        }
      }
      return false;
    }
    const applied = applySequentialEvent(ev, targetState, resource, id);
    drainBufferedEvents(targetState, resource, id);
    return applied;
  }

  function recoverPending() {
    if (ws?.state !== "open") return;
    const operations: ClientOperation[] = [];
    for (const [commandId, msg] of pendingCommands) {
      if (msg.type !== "command") continue;
      markSubmission(commandId, "submitted");
      operations.push({
        type: "receipt",
        commandId,
        resource: msg.resource,
        key: msg.key,
      });
    }
    sendBatch(operations);
  }

  async function applyServerEventBatch(
    operations: readonly Extract<ServerOperation, { type: "event" }>[],
  ): Promise<void> {
    const changed = new Map<string, { commandId?: string; events: number }>();
    for (const operation of operations) {
      const event = operation.event;
      const id = scopeId(operation.resource, operation.key);
      const state = getState(id, operation.resource);
      if (applyEventToState(event, state, operation.resource, id, true)) {
        const current = changed.get(id) ?? { events: 0 };
        current.events += 1;
        if (event.commandId && pendingCommands.has(event.commandId)) {
          current.commandId = event.commandId;
        }
        changed.set(id, current);
      }
    }
    for (const [id, { commandId, events }] of changed) {
      if (commandId) await persistConfirmed(id, commandId);
      else await checkpointRemoteState(id, events);
      if (commandId) {
        pendingCommands.delete(commandId);
        settleSubmission(commandId, { ok: true, cursor: cursors.get(id) ?? 0 });
      }
    }
    for (const id of changed.keys()) notify(id);
  }

  function clearReconnectTimer() {
    if (reconnectTimer === undefined) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    const delay = Math.min(reconnectMs * Math.pow(2, reconnectAttempts), MAX_RECONNECT_MS);
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, delay);
  }

  function handleOpen(): void {
    clearReconnectTimer();
    connected = true;
    reconnectAttempts = 0;
    for (const m of syncMeta.values()) m.stale = false;
    send({ type: "connect", version: protocolVersion, token });
    subscribedScopes = new Set();
    const subscriptions: ClientOperation[] = [];
    for (const [id, { resource, key }] of activeScopes) {
      if (policyFor(resource) !== "sync") continue;
      subscribedScopes.add(id);
      subscriptions.push({ type: "subscribe", resource, key, cursor: cursors.get(id) ?? 0 });
      const desired = desiredPresence.get(id);
      if (desired) {
        subscriptions.push({
          type: "presence",
          resource: desired.resource,
          key: desired.key,
          value: desired.value,
        });
      }
    }
    sendBatch(subscriptions);
    recoverPending();
  }

  function handleClose(): void {
    connected = false;
    for (const commandId of commandSubmissions.keys()) {
      markSubmission(commandId, "uncertain");
    }
    selfSession = null;
    scopeSessions.clear();
    for (const m of syncMeta.values()) m.stale = true;
    subscriptionOperations.clear();
    presenceOperations.clear();
    inboundChunks.clear();
    pendingChunkBytes = 0;
    notify();
    if (disposed) return;
    if (restartForAuthentication) {
      restartForAuthentication = false;
      reconnectAttempts = 0;
      open();
      return;
    }
    scheduleReconnect();
  }

  function receiveFrame(e: { data: string }): void | Promise<void> {
    const bytes = new TextEncoder().encode(e.data).byteLength;
    if (bytes > messageBytes) {
      ws?.close(1009, "server message is too large");
      return;
    }
    if (
      messageEvents.length >= limits.queuedMessages ||
      pendingMessageBytes + bytes > inboundBytes
    ) {
      ws?.close(1013, "client is falling behind");
      return;
    }
    messageEvents.push({ data: e.data, bytes });
    pendingMessageBytes += bytes;
    if (processingMessages) return;
    processingMessages = true;
    const processing = (async () => {
      while (messageEvents.length > 0) {
        const e = messageEvents.shift()!;
        try {
          await (async () => {
            let msg: ServerMessage;
            try {
              let parsed: unknown = JSON.parse(e.data);
              const chunk = parseInboundChunk(parsed);
              if (chunk) {
                let pending = inboundChunks.get(chunk.id);
                if (!pending) {
                  pending = { total: chunk.total, parts: Array(chunk.total), bytes: 0 };
                  inboundChunks.set(chunk.id, pending);
                }
                if (pending.total !== chunk.total) {
                  ws?.close(1008, "invalid server chunk sequence");
                  return;
                }
                const prior = pending.parts[chunk.index];
                if (prior !== undefined && prior !== chunk.data) {
                  ws?.close(1008, "conflicting server chunk");
                  return;
                }
                if (prior === undefined) {
                  const padding = chunk.data.endsWith("==") ? 2 : chunk.data.endsWith("=") ? 1 : 0;
                  const bytes = Math.floor((chunk.data.length * 3) / 4) - padding;
                  if (pendingChunkBytes + bytes > inboundBytes) {
                    ws?.close(1009, "server message is too large");
                    return;
                  }
                  pending.parts[chunk.index] = chunk.data;
                  pending.bytes += bytes;
                  pendingChunkBytes += bytes;
                }
                if (pending.parts.includes(undefined)) return;
                inboundChunks.delete(chunk.id);
                pendingChunkBytes -= pending.bytes;
                parsed = JSON.parse(decodeChunkedUtf8(pending.parts as string[]));
              } else if (
                parsed &&
                typeof parsed === "object" &&
                (parsed as { readonly type?: unknown }).type === "poggers:chunk"
              ) {
                ws?.close(1008, "invalid server chunk");
                return;
              }
              msg = validateServerMessage(parsed) as ServerMessage;
              if (!msg) return;
            } catch (err) {
              console.error("client parse error", err);
              return;
            }

            if (msg.type === "batch") {
              if (msg.operations.every((operation) => operation.type === "event")) {
                await applyServerEventBatch(
                  msg.operations as readonly Extract<ServerOperation, { type: "event" }>[],
                );
                return;
              }
              for (let index = msg.operations.length - 1; index >= 0; index--) {
                messageEvents.unshift({ data: JSON.stringify(msg.operations[index]), bytes: 0 });
              }
              return;
            }

            if (msg.type === "init") {
              selfSession = msg.session as SessionData<ActorOf<Spec>>;

              notify();
              return;
            }

            if (msg.type === "synced") {
              const id = scopeId(msg.resource, msg.key);
              const meta = getSyncMeta(id);
              replaceScopeSessions(id, msg.sessions as SessionData<ActorOf<Spec>>[]);

              if (msg.snapshot) {
                const generationChanged =
                  msg.generation &&
                  scopeGenerations.has(id) &&
                  scopeGenerations.get(id) !== msg.generation;

                if (generationChanged && msg.generation) {
                  states.delete(id);
                  confirmedStates.delete(id);
                  cursors.delete(id);
                  bufferedEvents.delete(id);
                  for (const commandId of optimisticScopes.get(id) ?? []) {
                    optimisticCommands.delete(commandId);
                  }
                  optimisticScopes.delete(id);
                  scopeGenerations.set(id, msg.generation);
                  for (const [cmdId, cmdMsg] of pendingCommands) {
                    if (cmdMsg.type === "command" && scopeId(cmdMsg.resource, cmdMsg.key) === id) {
                      await replica.reject(cmdId);
                      settleSubmission(cmdId, { ok: false, error: "internal" });
                      pendingCommands.delete(cmdId);
                    }
                  }
                }

                const currentCursor = cursors.get(id) ?? 0;
                if (msg.snapshot.seq >= currentCursor) {
                  const restored = app.restore(msg.resource, msg.snapshot);
                  if (optimisticScopes.has(id)) {
                    confirmedStates.set(id, restored);
                    rebuildOptimisticState(id);
                  } else {
                    states.set(id, restored);
                  }
                  cursors.set(id, msg.snapshot.seq);
                  dropBufferedThrough(id, msg.snapshot.seq);
                }
              }

              if (msg.generation && !scopeGenerations.has(id)) {
                scopeGenerations.set(id, msg.generation);
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
                if (connected && scope && ws?.state === "open") {
                  meta.syncing = true;
                  queueSubscription(id, scope.resource, scope.key, lastApplied);
                }
              }

              await persistConfirmed(id);
              notify(id);
              return;
            }

            if (msg.type === "event") {
              const ev = msg.event;
              const id = scopeId(msg.resource, msg.key);
              const targetState = getState(id, msg.resource);
              const applied = applyEventToState(ev, targetState, msg.resource, id, true);
              if (applied) {
                const localCommand = ev.commandId && pendingCommands.has(ev.commandId);
                if (localCommand) {
                  await persistConfirmed(id, ev.commandId);
                  pendingCommands.delete(ev.commandId!);
                  settleSubmission(ev.commandId!, { ok: true, cursor: ev.seq });
                } else {
                  await checkpointRemoteState(id, 1);
                }
              }
              notify(id);
              return;
            }

            if (msg.type === "forbidden") {
              const id = scopeId(msg.resource, msg.key);
              await replica.forget({ resource: msg.resource, key: msg.key });
              states.delete(id);
              confirmedStates.delete(id);
              cursors.delete(id);
              bufferedEvents.delete(id);
              scopeGenerations.delete(id);
              scopeSessions.delete(id);
              desiredPresence.delete(id);
              const pending = optimisticScopes.get(id) ?? [];
              for (const commandId of pending) {
                pendingCommands.delete(commandId);
                optimisticCommands.delete(commandId);
                settleSubmission(commandId, { ok: false, error: "forbidden" });
              }
              optimisticScopes.delete(id);
              const meta = getSyncMeta(id);
              meta.cursor = 0;
              meta.syncing = false;
              meta.stale = true;
              meta.error = "forbidden";
              notify(id);
              return;
            }

            if (msg.type === "presence") {
              const id = scopeId(msg.resource, msg.key);
              const session = msg.session as SessionData<ActorOf<Spec>>;
              setScopeSession(id, session);
              if (selfSession?.id === session.id) selfSession = session;
              notify(id);
              return;
            }

            if (msg.type === "presenceLeft") {
              const id = scopeId(msg.resource, msg.key);
              const values = scopeSessions.get(id);
              if (!values?.delete(msg.sessionId)) return;
              if (values.size === 0) scopeSessions.delete(id);
              notify(id);
              return;
            }

            if (msg.type === "commandAck") {
              const cmdMsg = pendingCommands.get(msg.commandId);
              if (msg.known === false) {
                if (cmdMsg?.type === "command") retryPending(cmdMsg);
                return;
              }
              const id =
                cmdMsg?.type === "command" ? scopeId(cmdMsg.resource, cmdMsg.key) : undefined;

              if (msg.ok && msg.events && cmdMsg && cmdMsg.type === "command") {
                const targetState = getState(id!, cmdMsg.resource);
                for (const ev of msg.events as CommittedEvent[]) {
                  applyEventToState(ev, targetState, cmdMsg.resource, id!);
                }
              }

              if (cmdMsg && cmdMsg.type === "command") {
                if (msg.ok) await persistConfirmed(id!, msg.commandId);
                else await replica.reject(msg.commandId);
                pendingCommands.delete(msg.commandId);
                const scope = removeOptimisticCommand(msg.commandId);
                if (scope) rebuildOptimisticState(scope);
                notify(scope ?? id);
              }

              settleSubmission(
                msg.commandId,
                msg.ok
                  ? { ok: true, cursor: msg.cursor }
                  : { ok: false, error: msg.error ?? "internal", data: msg.data },
              );
              return;
            }
          })();
        } catch (error) {
          console.error("client message error", error);
        } finally {
          pendingMessageBytes -= e.bytes;
        }
      }
      processingMessages = false;
    })();
    void processing;
    return processing;
  }

  function open(): void {
    if (disposed) return;
    if (ws?.state === "connecting" || ws?.state === "open") return;
    ws = transport(
      wsUrl,
      {
        open: handleOpen,
        close: handleClose,
        frame: (data) => receiveFrame({ data }),
        error() {},
      },
      transportLifetime.signal,
    );
  }

  const restartConnection = () => {
    if (disposed) return;
    clearReconnectTimer();
    reconnectAttempts = 0;
    if (!ws || ws.state === "closed") {
      open();
      return;
    }
    restartForAuthentication = true;
    try {
      ws.close();
    } catch {
      restartForAuthentication = false;
      open();
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener(AUTHENTICATION_CHANGED_EVENT, restartConnection);
  }

  open();

  type RuntimeResourceDefinition = Readonly<{
    presence?: JsonValue;
    views?: Readonly<
      Record<
        string,
        (context: {
          state: unknown;
          actor: ActorOf<Spec> | null;
          sessions: readonly SessionData<ActorOf<Spec>>[];
          key: JsonValue;
        }) => unknown
      >
    >;
    commands?: Readonly<Record<string, unknown>>;
  }>;
  const clients = new Map<string, unknown>();

  function getClient(resource: string, key: JsonValue): unknown {
    const id = scopeId(resource, key);
    const resDef = app.def.resources[resource] as RuntimeResourceDefinition | undefined;
    if (!resDef) return undefined;
    if (!activeScopes.has(id)) {
      if (activeScopes.size >= limits.resources) {
        throw new ClientLimitError(`Client Resource limit ${limits.resources} was reached.`);
      }
      activeScopes.set(id, { resource, key });
    }

    for (const [commandId, message] of pendingCommands) {
      if (
        message.type === "command" &&
        message.resource === resource &&
        scopeId(message.resource, message.key) === id
      ) {
        applyOptimisticCommand(commandId, message);
      }
    }

    let cached = clients.get(id);
    if (cached) return cached;

    const policy = policyFor(resource);

    const meta = getSyncMeta(id);

    if (policy === "sync") {
      if (connected && !subscribedScopes.has(id)) {
        subscribedScopes.add(id);
        meta.syncing = true;
        queueSubscription(id, resource, key, cursors.get(id) ?? 0);
      } else if (!connected) {
        meta.syncing = true;
        meta.stale = true;
      }
    }

    const views: Record<string, () => unknown> = {};
    if (resDef.views) {
      for (const vk of Object.keys(resDef.views)) {
        const view = resDef.views[vk];
        if (!view) continue;
        views[vk] = () =>
          view({
            state: getState(id, resource),
            actor: selfSession?.actor ?? null,
            sessions: [...(scopeSessions.get(id)?.values() ?? [])],
            key,
          });
      }
    }

    const setPresence = Object.prototype.hasOwnProperty.call(resDef, "presence")
      ? (value: JsonValue): void => {
          canonicalJson(value, new WeakSet());
          const next = structuredClone(value);
          desiredPresence.set(id, { resource, key, value: next });
          const session =
            selfSession ??
            (initialActor
              ? ({ id: `local:${initialActor.id}`, actor: initialActor, presence: next } as const)
              : null);
          if (session) {
            const local = { ...session, presence: next };
            setScopeSession(id, local);
            if (selfSession) selfSession = local;
            notify(id);
          }
          if (policy === "sync" && connected) queuePresence(id, resource, key, next);
        }
      : undefined;

    const cmds: Record<string, (...args: unknown[]) => Submission<string>> = {};
    if (resDef.commands) {
      for (const ck of Object.keys(resDef.commands)) {
        cmds[ck] = (...args: unknown[]) => {
          const controller = createSubmission<string>();
          void (async () => {
            if (policy !== "sync") {
              const actor = selfSession?.actor ?? initialActor;
              if (!actor) {
                controller.settle({ ok: false, error: "internal" });
                return;
              }
              const events: Array<{ name: string; payload: unknown }> = [];
              const commandId = crypto.randomUUID();
              controller.setId(commandId);
              let commandError: { error: string; data?: unknown } | undefined;
              const at = Date.now();
              app.runCommand(
                resource,
                getState(id, resource),
                actor,
                key,
                ck,
                args,
                (event) => events.push(event),
                (error, data) => {
                  commandError = { error, data };
                },
                { id: commandId, at },
              );
              if (commandError) {
                controller.settle({ ok: false, ...commandError });
                return;
              }
              const state = getState(id, resource);
              for (const event of events) {
                const sequence = (cursors.get(id) ?? 0) + 1;
                app.applyEvent(resource, state as never, {
                  id: `${commandId}:event:${sequence}`,
                  seq: sequence,
                  at,
                  actor,
                  name: event.name,
                  payload: event.payload,
                });
                updateCursor(id, sequence);
              }
              if (policy === "device") await persistConfirmed(id);
              notify(id);
              controller.settle({ ok: true, cursor: cursors.get(id) ?? 0 });
              return;
            }
            if (pendingCommands.size >= limits.pendingIntents) {
              controller.settle({ ok: false, error: "overloaded" });
              return;
            }
            const at = Date.now();
            const body = { type: "command", name: ck, args, resource, key, at } as const;
            const pending = await replica.enqueue({
              address: { resource, key },
              inputHash: await hashJson(body),
              value: body as JsonValue,
              createdAt: at,
            });
            controller.setId(pending.id);
            if (pendingCommands.size >= limits.pendingIntents) {
              await replica.reject(pending.id);
              controller.settle({ ok: false, error: "overloaded" });
              return;
            }
            const msg: Extract<ClientMessage, { type: "command" }> = {
              ...body,
              commandId: pending.id,
            };
            const optimistic = applyOptimisticCommand(pending.id, msg);
            if (!optimistic.ok) {
              await replica.reject(pending.id);
              controller.settle(optimistic);
              return;
            }
            pendingCommands.set(pending.id, msg);
            controller.setPhase("queued");
            notify(id);
            const timer = setTimeout(() => {
              markSubmission(pending.id, "uncertain");
            }, commandUncertaintyMs);
            (timer as unknown as { unref?: () => void }).unref?.();
            commandSubmissions.set(pending.id, { controller, timer });
            if (connected && ws?.state === "open") {
              controller.setPhase("submitted");
              send(msg);
            }
          })().catch(() => controller.settle({ ok: false, error: "internal" }));
          return controller.submission;
        };
      }
    }

    type TrackedSubscription = ResourceSubscription & {
      readonly reads: Set<string>;
      readonly values: Map<string, unknown>;
    };
    let tracking: TrackedSubscription | undefined;
    let proxy: Record<string, unknown>;
    const valueFor = (property: string): unknown => {
      if (property === "sync") return { ...meta };
      return views[property]?.();
    };
    const track = (property: string, value: unknown): void => {
      if (!tracking) return;
      tracking.reads.add(property);
      tracking.values.set(property, snapshotValue(value));
    };
    const scope = new Proxy(Object.create(null) as Record<string, unknown>, {
      get(_target, property: string) {
        return proxy[property];
      },
      ownKeys: () => Object.keys(views),
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
    });
    const target = {
      get sync() {
        const value = valueFor("sync");
        track("sync", value);
        return value;
      },
      subscribe: (fn: (scope: Record<string, unknown>) => void) => {
        if (subscriptionCount >= limits.subscriptions) {
          throw new ClientLimitError(
            `Client subscription limit ${limits.subscriptions} was reached.`,
          );
        }
        const entry: TrackedSubscription = {
          reads: new Set(),
          values: new Map(),
          run() {
            entry.reads.clear();
            entry.values.clear();
            const previous = tracking;
            tracking = entry;
            try {
              fn(scope);
            } finally {
              tracking = previous;
            }
          },
          changed() {
            if (entry.reads.size === 0) return true;
            for (const property of entry.reads) {
              if (!semanticEqual(valueFor(property), entry.values.get(property))) return true;
            }
            return false;
          },
        };
        let entries = subscriptions.get(id);
        if (!entries) {
          entries = new Set();
          subscriptions.set(id, entries);
        }
        entries.add(entry);
        subscriptionCount++;
        try {
          entry.run();
        } catch (error) {
          entries.delete(entry);
          subscriptionCount--;
          if (entries.size === 0) subscriptions.delete(id);
          throw error;
        }
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          entries?.delete(entry);
          subscriptionCount--;
          if (entries?.size === 0) subscriptions.delete(id);
        };
      },
    };
    proxy = new Proxy(target, {
      get(target, prop: string) {
        if (prop in target) return Reflect.get(target, prop);
        if (prop === "setPresence") return setPresence;
        const cmd = cmds[prop];
        if (cmd) return cmd;
        const view = views[prop];
        if (view) {
          const value = view();
          track(prop, value);
          return value;
        }
        return undefined;
      },
    });

    clients.set(id, proxy);
    return proxy;
  }

  const accessors: Record<string, (key: JsonValue) => unknown> = {};
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
        transportLifetime.abort();
        clearReconnectTimer();
        for (const timer of checkpointTimers.values()) clearTimeout(timer);
        checkpointTimers.clear();
        if (typeof window !== "undefined") {
          window.removeEventListener(AUTHENTICATION_CHANGED_EVENT, restartConnection);
        }
        for (const { controller, timer } of commandSubmissions.values()) {
          clearTimeout(timer);
          controller.setPhase("uncertain");
        }
        commandSubmissions.clear();
        subscriptions.clear();
        scopeSessions.clear();
        desiredPresence.clear();
        presenceOperations.clear();
        if (ws && ws.state !== "closed") {
          try {
            ws.close();
          } catch {}
        }
      },
    },
    {
      get(target, prop: string) {
        if (prop in target) return Reflect.get(target, prop);
        const fn = accessors[prop];
        if (fn) return fn;
        return undefined;
      },
    },
  ) as Client<Spec>;
}

async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value, new WeakSet()));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function positiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

function assertClientLimits(limits: ClientLimits): void {
  for (const [name, value] of Object.entries(limits)) positiveLimit(value, `limits.${name}`);
}

function canonicalJson(value: unknown, seen: WeakSet<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new TypeError("Replica values must be JSON values.");
  if (seen.has(value)) throw new TypeError("Replica values cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Replica objects must be plain JSON objects.");
  }
  const result = `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, seen)}`)
    .join(",")}}`;
  seen.delete(value);
  return result;
}
