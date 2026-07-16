import { createHash } from "node:crypto";

import {
  assertResourceCommand,
  assertResourceKey,
  type ActorOf,
  type App,
  type AppSpec,
  type JsonValue,
} from "#kernel/app";
import type { ResourceAuthority, SubstrateAdapter } from "#substrate/adapter";
import {
  IntentMismatchError,
  JournalCorruptionError,
  addressKey,
  type CommandIntent,
  type CommandRecord,
  type CommittedCommandRecord,
  type JournalHead,
  type ResourceAddress,
} from "#substrate/journal";
import type { CommittedEvent, Snapshot } from "#substrate/protocol";

export type ResourceCommand<Actor = unknown> = Readonly<{
  resource: string;
  key: JsonValue;
  name: string;
  args: readonly unknown[];
  actor: Actor;
  at: number;
  origin?: "client" | "program";
}>;

export type ResourceDecision =
  | Readonly<{
      ok: true;
      events: readonly CommittedEvent[];
    }>
  | Readonly<{
      ok: false;
      error: string;
      data?: unknown;
      events: readonly [];
    }>;

export type ResourceCommandRecord<Actor = unknown> = CommandRecord<
  ResourceCommand<Actor>,
  ResourceDecision
>;

export type ResourceAuthorityState = Readonly<{
  state: unknown;
  eventCursor: number;
  head: JournalHead;
  snapshotHead: JournalHead;
  events: readonly CommittedEvent[];
}>;

export type ResourceCommandResult<Actor = unknown> = Readonly<{
  status: "committed" | "duplicate";
  record: CommittedCommandRecord<ResourceCommandRecord<Actor>>;
}>;

export type ResourceExecutionLimits = Readonly<{
  decisionBytes: number;
  eventsPerDecision: number;
}>;

export function createResourceIntent<Actor>(
  id: string,
  command: ResourceCommand<Actor>,
): CommandIntent<ResourceCommand<Actor>> {
  return {
    id,
    inputHash: createHash("sha256").update(stableJson(command, new WeakSet())).digest("hex"),
    value: command,
  };
}

export async function loadResourceAuthority<Spec extends AppSpec>(
  app: App<Spec>,
  authority: ResourceAuthority,
  address: ResourceAddress,
): Promise<ResourceAuthorityState> {
  const loaded = await authority.load<ResourceCommandRecord<ActorOf<Spec>>, Snapshot>(address);
  if (loaded.snapshot) {
    const actualHash = createHash("sha256")
      .update(JSON.stringify(loaded.snapshot.state))
      .digest("hex");
    if (actualHash !== loaded.snapshot.stateHash) {
      throw new JournalCorruptionError(
        `Snapshot ${address.resource} failed its semantic state checksum.`,
      );
    }
  }
  let state = loaded.snapshot
    ? app.restore(address.resource, loaded.snapshot.state)
    : app.createState(address.resource);
  let eventCursor = loaded.snapshot?.state.seq ?? 0;
  const events: CommittedEvent[] = [];

  for (const record of loaded.records) {
    for (const event of record.decision.events) {
      events.push(event);
      app.applyEvent(
        address.resource,
        state,
        {
          id: event.id,
          seq: event.seq,
          at: event.at,
          actor: event.actor as ActorOf<Spec>,
          name: event.name,
          payload: event.payload,
          hash: event.hash,
        },
        event.version,
        event.hash,
      );
      eventCursor = event.seq;
    }
  }
  return {
    state,
    eventCursor,
    head: loaded.head,
    snapshotHead: loaded.snapshot
      ? { revision: loaded.snapshot.revision, position: loaded.snapshot.position }
      : { revision: 0, position: 0 },
    events,
  };
}

/** Verifies every retained application Resource before a host begins accepting traffic. */
export async function verifyResources<Spec extends AppSpec>(
  app: App<Spec>,
  substrate: SubstrateAdapter,
): Promise<void> {
  const histories = new Map<
    string,
    {
      address: ResourceAddress;
      records: CommittedCommandRecord<ResourceCommandRecord<ActorOf<Spec>>>[];
    }
  >();
  let completeHistory = true;
  for (const { id: split } of (await substrate.events.topology()).splits) {
    const bounds = await substrate.events.bounds(split);
    if (substrate.events.compare(bounds.floor, bounds.origin) !== 0) {
      completeHistory = false;
      continue;
    }
    let cursor = bounds.origin;
    for (;;) {
      const read = await substrate.events.read<ResourceCommandRecord<ActorOf<Spec>>>({
        split,
        after: cursor,
        maxRecords: 256,
        maxBytes: 4 * 1024 * 1024,
      });
      if (read.status === "cursor-expired") {
        completeHistory = false;
        break;
      }
      for (const { record } of read.records) {
        const key = addressKey(record.address);
        const history = histories.get(key) ?? { address: record.address, records: [] };
        history.records.push(record);
        histories.set(key, history);
      }
      cursor = read.next;
      if (read.caughtUp) break;
    }
  }

  for await (const address of substrate.authority.addresses()) {
    if (address.resource.startsWith("$poggers.")) continue;
    if (!(address.resource in app.def.resources)) {
      throw new JournalCorruptionError(
        `Journal contains unknown Resource ${JSON.stringify(address.resource)}.`,
      );
    }
    const key = addressKey(address);
    const accelerated = await loadResourceAuthority(app, substrate.authority, address);
    if (!completeHistory) continue;
    const history = histories.get(key) ?? { address, records: [] };
    history.records.sort((left, right) => left.revision - right.revision);
    const folded = foldResourceHistory(app, history.address, history.records);
    const foldedHash = hashState(app.snapshot(folded.state, folded.eventCursor));
    const acceleratedHash = hashState(app.snapshot(accelerated.state, accelerated.eventCursor));
    if (
      foldedHash !== acceleratedHash ||
      folded.head.revision !== accelerated.head.revision ||
      folded.head.position !== accelerated.head.position
    ) {
      throw new JournalCorruptionError(
        `Snapshot and retained history disagree for Resource ${JSON.stringify(key)}.`,
      );
    }
  }
}

function foldResourceHistory<Spec extends AppSpec>(
  app: App<Spec>,
  address: ResourceAddress,
  records: readonly CommittedCommandRecord<ResourceCommandRecord<ActorOf<Spec>>>[],
): ResourceAuthorityState {
  let state = app.createState(address.resource);
  let eventCursor = 0;
  let head: JournalHead = { revision: 0, position: 0 };
  const events: CommittedEvent[] = [];

  for (const record of records) {
    const command = record.intent.value;
    if (
      command.resource !== address.resource ||
      addressKey({ resource: command.resource, key: command.key }) !== addressKey(address)
    ) {
      throw new JournalCorruptionError("A Resource record contains a command for another address.");
    }
    if (createResourceIntent(record.intent.id, command).inputHash !== record.intent.inputHash) {
      throw new JournalCorruptionError(
        `Intent ${JSON.stringify(record.intent.id)} has an invalid input hash.`,
      );
    }
    for (const event of record.decision.events) {
      if (event.seq !== eventCursor + 1 || event.commandId !== record.intent.id) {
        throw new JournalCorruptionError(
          `Resource ${JSON.stringify(addressKey(address))} has a discontinuous event history.`,
        );
      }
      app.applyEvent(
        address.resource,
        state,
        {
          id: event.id,
          seq: event.seq,
          at: event.at,
          actor: event.actor as ActorOf<Spec>,
          name: event.name,
          payload: event.payload,
          hash: event.hash,
        },
        event.version,
        event.hash,
      );
      events.push(event);
      eventCursor = event.seq;
    }
    head = { revision: record.revision, position: record.position };
  }
  return { state, eventCursor, head, snapshotHead: { revision: 0, position: 0 }, events };
}

function hashState(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function authorizeResource<Spec extends AppSpec>(
  app: App<Spec>,
  resource: string,
  state: unknown,
  actor: ActorOf<Spec>,
  key: JsonValue,
  operation:
    | Readonly<{ type: "read"; origin?: "client" | "program" }>
    | Readonly<{ type: "command"; name: string; origin?: "client" | "program" }>,
): boolean {
  const definition = app.def.resources[resource] as
    | {
        authorize?: (args: {
          state: unknown;
          actor: ActorOf<Spec>;
          key: JsonValue;
          operation:
            | Readonly<{ type: "read"; origin: "client" | "program" }>
            | Readonly<{ type: "command"; name: string; origin: "client" | "program" }>;
        }) => boolean;
      }
    | undefined;
  const normalized = { ...operation, origin: operation.origin ?? ("client" as const) };
  return definition?.authorize?.({ state, actor, key, operation: normalized }) ?? true;
}

export async function executeResourceCommand<Spec extends AppSpec>(
  app: App<Spec>,
  authority: ResourceAuthority,
  intent: CommandIntent<ResourceCommand<ActorOf<Spec>>>,
  limits?: ResourceExecutionLimits,
): Promise<ResourceCommandResult<ActorOf<Spec>>> {
  return executeResourceCommandWithState(app, authority, intent, undefined, limits);
}

/** Executes from an activated Resource and reloads only after a CAS conflict. */
export async function executeResourceCommandFromState<Spec extends AppSpec>(
  app: App<Spec>,
  authority: ResourceAuthority,
  intent: CommandIntent<ResourceCommand<ActorOf<Spec>>>,
  activated: ResourceAuthorityState,
  limits?: ResourceExecutionLimits,
): Promise<ResourceCommandResult<ActorOf<Spec>>> {
  return executeResourceCommandWithState(app, authority, intent, activated, limits);
}

async function executeResourceCommandWithState<Spec extends AppSpec>(
  app: App<Spec>,
  authority: ResourceAuthority,
  intent: CommandIntent<ResourceCommand<ActorOf<Spec>>>,
  activated: ResourceAuthorityState | undefined,
  limits?: ResourceExecutionLimits,
): Promise<ResourceCommandResult<ActorOf<Spec>>> {
  const command = intent.value;
  const address: ResourceAddress = { resource: command.resource, key: command.key };
  assertCommand(app, command);

  const previous = await authority.receipt<ResourceCommandRecord<ActorOf<Spec>>>(
    address,
    intent.id,
  );
  if (previous) {
    if (previous.intent.inputHash !== intent.inputHash) throw new IntentMismatchError(intent.id);
    return { status: "duplicate", record: previous };
  }

  let current = activated ?? (await loadResourceAuthority(app, authority, address));
  for (;;) {
    const decision = enforceDecisionLimits(evaluateResourceCommand(app, current, intent), limits);
    const result = await authority.commit({
      address,
      expected: current.head,
      record: {
        schema: app.def.migrationHash ?? `version:${app.def.version}`,
        intent,
        decision,
      },
    });
    if (result.status === "conflict") {
      current = await loadResourceAuthority(app, authority, address);
      continue;
    }
    return { status: result.status, record: result.record };
  }
}

function enforceDecisionLimits(
  decision: ResourceDecision,
  limits: ResourceExecutionLimits | undefined,
): ResourceDecision {
  if (!limits) return decision;
  if (!Number.isSafeInteger(limits.decisionBytes) || limits.decisionBytes <= 0) {
    throw new RangeError("decisionBytes must be a positive integer.");
  }
  if (!Number.isSafeInteger(limits.eventsPerDecision) || limits.eventsPerDecision < 0) {
    throw new RangeError("eventsPerDecision must be a non-negative integer.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(decision)).byteLength;
  if (decision.events.length <= limits.eventsPerDecision && bytes <= limits.decisionBytes) {
    return decision;
  }
  return { ok: false, error: "decision_limit", events: [] };
}

function evaluateResourceCommand<Spec extends AppSpec>(
  app: App<Spec>,
  current: ResourceAuthorityState,
  intent: CommandIntent<ResourceCommand<ActorOf<Spec>>>,
): ResourceDecision {
  const command = intent.value;
  const events: CommittedEvent[] = [];
  let error: Readonly<{ code: string; data?: unknown }> | null = null;

  if (
    !authorizeResource(app, command.resource, current.state, command.actor, command.key, {
      type: "command",
      name: command.name,
      origin: command.origin,
    })
  ) {
    return { ok: false, error: "forbidden", events: [] };
  }

  try {
    app.runCommand(
      command.resource,
      current.state,
      command.actor,
      command.key,
      command.name,
      [...command.args],
      (event) => {
        events.push({
          ...event,
          seq: current.eventCursor + events.length + 1,
          version: app.def.version,
          ...(app.def.migrationHash ? { hash: app.def.migrationHash } : {}),
          commandId: intent.id,
        });
      },
      (code, data) => {
        error = data === undefined ? { code } : { code, data };
      },
      { id: intent.id, at: command.at },
    );
  } catch {
    return { ok: false, error: "internal", events: [] };
  }

  const failure = error as Readonly<{ code: string; data?: unknown }> | null;
  if (failure) {
    return {
      ok: false,
      error: failure.code,
      ...(failure.data === undefined ? {} : { data: failure.data }),
      events: [],
    };
  }
  return { ok: true, events };
}

function assertCommand<Spec extends AppSpec>(app: App<Spec>, command: ResourceCommand): void {
  const resource = app.def.resources[command.resource];
  if (!resource) throw new Error(`Unknown Resource ${command.resource}.`);
  if (!resource.commands?.[command.name]) {
    throw new Error(`Unknown command ${command.resource}.${command.name}.`);
  }
  assertResourceKey(app, command.resource, command.key);
  assertResourceCommand(app, command.resource, command.name, command.args);
  if (!Number.isSafeInteger(command.at) || command.at < 0) {
    throw new TypeError("A command timestamp must be a non-negative integer.");
  }
}

function stableJson(value: unknown, seen: WeakSet<object>, path = "$"): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Command number at ${path} must be finite.`);
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Command value at ${path} must be JSON.`);
  }
  if (seen.has(value)) throw new TypeError("Commands cannot contain cycles.");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value
      .map((item, index) => stableJson(item, seen, `${path}[${index}]`))
      .join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Command object at ${path} must be a plain JSON object.`);
    }
    const result = `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item, seen, `${path}.${key}`)}`)
      .join(",")}}`;
    seen.delete(value);
    return result;
  }
  throw new TypeError("Commands must contain only JSON values.");
}
