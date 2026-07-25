import { dependencyInvocation, type Dependency, type DependencyContract } from "@/core/dependency";
import type { Feature } from "@/core/feature";
import { typeLiteral } from "@/core/intrinsic";
import type { Program } from "@/core/program";
import type {
  Alarm,
  Clock,
  EventStore,
  ExecutionContext,
  Identifiers,
  ServerProcess,
  Synchronization,
  Timer,
} from "@/platforms/server/platform";

type Procedure = (context: never) => object | PromiseLike<object>;
type Procedures = Readonly<Record<string, Procedure>>;
declare const actorModel: unique symbol;
declare const actorDefinition: unique symbol;
declare const actorCommandModel: unique symbol;

export type ActorModelDefinition = Readonly<{
  Name: string;
  Key: string;
  State: object;
  Dependencies?: Readonly<Record<string, DependencyContract>>;
}>;

/** The complete semantic model of one durable Actor type. */
export type Actor<Model extends ActorModelDefinition> = Readonly<Model>;

type DependenciesOf<Model extends ActorModelDefinition> = Model extends {
  Dependencies: infer Dependencies extends object;
}
  ? Dependencies
  : Record<never, never>;

type FailureOf<Failures extends Readonly<Record<string, object>>> = {
  readonly [Name in keyof Failures]: Readonly<{
    type: Name;
    data: Failures[Name];
  }>;
}[keyof Failures];

export type ActorInfrastructureFailure =
  | Readonly<{ type: "overloaded"; retryAt?: number }>
  | Readonly<{ type: "unavailable"; retryAt?: number }>
  | Readonly<{ type: "cycle"; path: readonly Readonly<{ actor: string; key: string }>[] }>
  | Readonly<{ type: "incompatible"; schema: string }>
  | Readonly<{ type: "poisoned"; invocation: string; attempts: number }>
  | Readonly<{ type: "result-expired"; invocation: string }>;

/** An operational Actor failure, separate from a command's declared product failures. */
export class ActorError extends Error {
  override readonly name = "ActorError";

  constructor(readonly failure: ActorInfrastructureFailure) {
    super(`Actor ${failure.type}`);
  }
}

type ActorOutcome<Result, Failure> =
  | Readonly<{ status: "succeeded"; value: Result }>
  | Readonly<{ status: "failed"; failure: Failure }>;

export type ActorInvocation = Readonly<{
  id: string;
}>;

type OperationInput<Input> = [Input] extends [undefined]
  ? Readonly<{ input?: never }>
  : Readonly<{ input: Input }>;

type CompletedCommandRequest<Input> = OperationInput<Input> &
  Readonly<{ wait?: "completed"; idempotencyKey?: string }>;

type AcceptedCommandRequest<Input> = OperationInput<Input> &
  Readonly<{ wait: "accepted"; idempotencyKey?: string }>;

type ActorInitialContext<Model extends ActorModelDefinition> = Readonly<{
  key: Model["Key"];
  readonly [actorModel]?: Model;
}>;

type HandlerContext<Handler> = Handler extends (context: infer Context) => unknown
  ? Context
  : never;

type HandlerInput<Handler> = HandlerContext<Handler> extends { input: infer Input } ? Input : never;

type HandlerFailure<Handler> =
  HandlerContext<Handler> extends {
    fail(failure: infer Failure): never;
  }
    ? Failure
    : never;

type HandlerResult<Handler> = Handler extends (...arguments_: never[]) => infer Result
  ? Awaited<Result>
  : never;

type ActorCommandContext<
  Model extends ActorModelDefinition,
  Input extends object | undefined,
  Failures extends Readonly<Record<string, object>> = Record<never, never>,
> = Readonly<{
  readonly [actorCommandModel]?: Model;
  key: Model["Key"];
  state: Model["State"];
  input: Input;
  dependencies: DependenciesOf<Model>;
  invocation: Readonly<{ id: string }>;
  fail(failure: FailureOf<Failures>): never;
  timers: Readonly<{
    schedule<Handler extends Procedure>(
      request: HandlerContext<Handler> extends {
        readonly [actorCommandModel]?: infer Target extends ActorModelDefinition;
      }
        ? Target extends Model
          ? Model extends Target
            ? Readonly<{
                id: string;
                at: number;
                command: Handler;
                input: HandlerInput<Handler>;
              }>
            : never
          : never
        : never,
    ): void;
    cancel(request: Readonly<{ id: string }>): void;
  }>;
}>;

type ActorQueryContext<
  Model extends ActorModelDefinition,
  Input extends object | undefined,
> = Readonly<{
  key: Model["Key"];
  state: Readonly<Model["State"]>;
  input: Input;
}>;

type ActorCommandProcedure<Model extends ActorModelDefinition> = (
  context: ActorCommandContext<Model, never>,
) => unknown;

type ActorQueryProcedure<Model extends ActorModelDefinition> = (
  context: ActorQueryContext<Model, never>,
) => unknown;

type ActorMigrationProcedure = (context: never) => object;

type ActorMigrations = Readonly<{
  state?: readonly ActorMigrationProcedure[];
  commands?: Readonly<Record<string, readonly ActorMigrationProcedure[]>>;
}>;

type ActorImplementation<Model extends ActorModelDefinition> = Readonly<{
  state(context: ActorInitialContext<Model>): Model["State"];
  commands: Readonly<Record<string, ActorCommandProcedure<Model>>>;
  queries: Readonly<Record<string, ActorQueryProcedure<Model>>>;
  migrations?: ActorMigrations;
}>;

type GenericActorImplementation = Readonly<{
  state: Procedure;
  commands: Procedures;
  queries: Procedures;
  migrations?: ActorMigrations;
}>;

type ActorKey<Definition extends GenericActorImplementation> = Parameters<
  Definition["state"]
>[0] extends { key: infer Key }
  ? Key
  : never;

type ActorOperations<Definition extends GenericActorImplementation> = Readonly<
  {
    readonly [Name in keyof Definition["commands"]]: {
      (
        request: Readonly<{ key: ActorKey<Definition> }> &
          CompletedCommandRequest<HandlerInput<Definition["commands"][Name]>>,
      ): Promise<
        ActorOutcome<
          HandlerResult<Definition["commands"][Name]>,
          HandlerFailure<Definition["commands"][Name]>
        >
      >;
      (
        request: Readonly<{ key: ActorKey<Definition> }> &
          AcceptedCommandRequest<HandlerInput<Definition["commands"][Name]>>,
      ): Promise<ActorInvocation>;
    };
  } & {
    readonly [Name in keyof Definition["queries"]]: (
      request: Readonly<{ key: ActorKey<Definition> }> &
        OperationInput<HandlerInput<Definition["queries"][Name]>>,
    ) => Promise<HandlerResult<Definition["queries"][Name]>>;
  }
>;

type ActorWireOperations<
  Definition extends GenericActorImplementation,
  Model extends ActorModelDefinition,
> = Readonly<
  {
    readonly [Name in keyof Definition["commands"]]: (
      request: Readonly<{ key: Model["Key"] }> &
        (
          | CompletedCommandRequest<HandlerInput<Definition["commands"][Name]>>
          | AcceptedCommandRequest<HandlerInput<Definition["commands"][Name]>>
        ),
    ) => Promise<
      | ActorOutcome<
          HandlerResult<Definition["commands"][Name]>,
          HandlerFailure<Definition["commands"][Name]>
        >
      | ActorInvocation
    >;
  } & {
    readonly [Name in keyof Definition["queries"]]: (
      request: Readonly<{ key: Model["Key"] }> &
        OperationInput<HandlerInput<Definition["queries"][Name]>>,
    ) => Promise<HandlerResult<Definition["queries"][Name]>>;
  }
>;

type ActorDependency<
  Definition extends GenericActorImplementation,
  Model extends ActorModelDefinition = ActorModelOf<Definition>,
> = Dependency<{ Operations: ActorWireOperations<Definition, Model> }, ActorOperations<Definition>>;

type ActorModelOf<Definition extends GenericActorImplementation> =
  HandlerContext<Definition["state"]> extends {
    readonly [actorModel]?: infer Model extends ActorModelDefinition;
  }
    ? Model
    : never;

type ActorProvision<
  Definition extends GenericActorImplementation,
  Model extends ActorModelDefinition = ActorModelOf<Definition>,
> = Readonly<{
  [Name in Model["Name"]]: ActorDependency<Definition, Model>;
}>;

type ActorFeatureContract<
  Definition extends GenericActorImplementation,
  Model extends ActorModelDefinition = ActorModelOf<Definition>,
> = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: ActorRequirements<Model>;
        Provides: ActorProvision<Definition, Model>;
      }
    >;
  };
}>;

/** A directly mountable Actor Feature with no public placement or transport controls. */
export type DefinedActor<
  Definition extends GenericActorImplementation,
  Model extends ActorModelDefinition = ActorModelOf<Definition>,
> = Feature<ActorFeatureContract<Definition, Model>> &
  Readonly<{
    readonly [actorDefinition]?: Readonly<{
      Model: Model;
      Definition: Definition;
    }>;
  }>;

type ActorDependencyOf<Definition> =
  Definition extends Readonly<{
    readonly [actorDefinition]?: Readonly<{
      Model: infer Model extends ActorModelDefinition;
      Definition: infer Implementation extends GenericActorImplementation;
    }>;
  }>
    ? ActorDependency<Implementation, Model>
    : never;

type UnknownMigrationCommand<Definition extends GenericActorImplementation> = Definition extends {
  migrations: { commands: infer Commands extends object };
}
  ? Exclude<keyof Commands, keyof Definition["commands"]>
  : never;

type ActorOperationCollision<Definition extends GenericActorImplementation> = Extract<
  keyof Definition["commands"],
  keyof Definition["queries"]
>;

type ActorDefinitionConstraint<Definition extends GenericActorImplementation> = [
  UnknownMigrationCommand<Definition> | ActorOperationCollision<Definition>,
] extends [never]
  ? unknown
  : never;

export namespace Actor {
  export type Initial<Model extends ActorModelDefinition> = ActorInitialContext<Model>;
  export type Command<
    Model extends ActorModelDefinition,
    Input extends object | undefined = undefined,
    Failures extends Readonly<Record<string, object>> = Record<never, never>,
  > = ActorCommandContext<Model, Input, Failures>;
  export type Query<
    Model extends ActorModelDefinition,
    Input extends object | undefined = undefined,
  > = ActorQueryContext<Model, Input>;
  export type Definition<Model extends ActorModelDefinition> = ActorImplementation<Model>;
  export type Reference<Definition> = ActorDependencyOf<Definition>;
  export type Error = ActorError;
  export type Failure = ActorInfrastructureFailure;
  export type Outcome<Result, Failure = never> = ActorOutcome<Result, Failure>;
  export type StateMigration<Previous extends object, Next extends object> = (
    context: Readonly<{ state: Readonly<Previous> }>,
  ) => Next;
  export type CommandMigration<Previous extends object, Next extends object> = (
    context: Readonly<{ input: Previous }>,
  ) => Next;
}

/**
 * Defines one Actor type as a reusable Feature that contributes an ordinary
 * portable Program and a semantic Dependency API.
 */
export function createActor<
  const Model extends ActorModelDefinition,
  const Definition extends GenericActorImplementation,
>(
  definition: Definition & ActorImplementation<Model> & ActorDefinitionConstraint<Definition>,
): DefinedActor<Definition, Model> {
  return createActorFeature<Model, Definition>(definition, () => typeLiteral<Model["Name"]>());
}

type RuntimeRequest<Model extends ActorModelDefinition> = Readonly<{
  key: Model["Key"];
  input?: object;
  wait?: "accepted" | "completed";
  idempotencyKey?: string;
}>;

type RuntimeInvocation = Readonly<{
  id: string;
  attempt: number;
  scheduledAt: number;
  startedAt: number;
}>;

type RuntimeCommandContext<Model extends ActorModelDefinition> = Readonly<{
  key: Model["Key"];
  state: Model["State"];
  input?: object;
  dependencies: DependenciesOf<Model>;
  invocation: Readonly<{ id: string }>;
  fail(failure: object): never;
  timers: Readonly<{
    schedule(
      request: Readonly<{ id: string; at: number; command: Procedure; input: object }>,
    ): void;
    cancel(request: Readonly<{ id: string }>): void;
  }>;
}>;

type RuntimeQueryContext<Model extends ActorModelDefinition> = Readonly<{
  key: Model["Key"];
  state: Readonly<Model["State"]>;
  input?: object;
}>;

type RuntimeCommandHandler<Model extends ActorModelDefinition> = (
  context: RuntimeCommandContext<Model>,
) => object | PromiseLike<object>;

type RuntimeQueryHandler<Model extends ActorModelDefinition> = (
  context: RuntimeQueryContext<Model>,
) => object | PromiseLike<object>;

type ActorJournalAccepted = Readonly<{
  type: "actor.command.accepted";
  invocation: string;
  operation: string;
  input?: object;
  commandVersion?: number;
  at: number;
}>;

type ActorRegistered<Model extends ActorModelDefinition> = Readonly<{
  type: "actor.registered";
  key: Model["Key"];
  at: number;
}>;

type ActorJournalCompleted<Model extends ActorModelDefinition> = Readonly<{
  type: "actor.command.completed";
  invocation: string;
  state: Model["State"];
  stateVersion?: number;
  outcome: ActorOutcome<object, object>;
  at: number;
}>;

type ActorJournalFailed = Readonly<{
  type: "actor.command.failed";
  invocation: string;
  failure: ActorInfrastructureFailure;
  at: number;
}>;

type ActorJournalClaimed = Readonly<{
  type: "actor.command.claimed";
  invocation: string;
  owner: string;
  attempt: number;
  until: number;
  at: number;
}>;

type ActorJournalPoisoned = Readonly<{
  type: "actor.command.poisoned";
  invocation: string;
  attempts: number;
  at: number;
}>;

type ActorJournalTimerScheduled = Readonly<{
  type: "actor.timer.scheduled";
  timer: string;
  generation: number;
  dueAt: number;
  operation: string;
  input: object;
  commandVersion: number;
  at: number;
}>;

type ActorJournalTimerCancelled = Readonly<{
  type: "actor.timer.cancelled";
  timer: string;
  generation: number;
  at: number;
}>;

type ActorJournalTimerFired = Readonly<{
  type: "actor.timer.fired";
  timer: string;
  generation: number;
  invocation: string;
  at: number;
}>;

type ActorJournalTimerEvent =
  | ActorJournalTimerScheduled
  | ActorJournalTimerCancelled
  | ActorJournalTimerFired;

type ActorJournalEvent<Model extends ActorModelDefinition> =
  | ActorRegistered<Model>
  | ActorJournalAccepted
  | ActorJournalClaimed
  | ActorJournalFailed
  | ActorJournalPoisoned
  | ActorJournalTimerEvent
  | ActorJournalCompleted<Model>;

type ActorRequirements<Model extends ActorModelDefinition> = DependenciesOf<Model> &
  Readonly<{
    events: EventStore;
    alarm: Alarm;
    clock: Clock;
    executionContext: ExecutionContext;
    identifiers: Identifiers;
    synchronization: Synchronization;
    timer: Timer;
  }>;

type RuntimeActorRequirements<Model extends ActorModelDefinition> = Omit<
  ActorRequirements<Model>,
  "events"
> &
  Readonly<{ events: EventStore<ActorJournalEvent<Model>> }>;

type ActorJournal<Model extends ActorModelDefinition> = Readonly<{
  revision: number;
  state: Model["State"];
  accepted: readonly ActorJournalAccepted[];
  pending: readonly ActorJournalAccepted[];
  claims: readonly ActorJournalClaimed[];
  failed: readonly ActorJournalFailed[];
  poisoned: readonly ActorJournalPoisoned[];
  completed: readonly ActorJournalCompleted<Model>[];
  timers: readonly ActorJournalTimerEvent[];
}>;

type ActorExecutionSlot = {
  stream: string;
  active: boolean;
};

type ActorExecutionSlots = Partial<Record<string, ActorExecutionSlot>>;
type ActorRegistrationCache = {
  revision: number;
  keys: Partial<Record<string, true>>;
};

type ActorJournalCache<Model extends ActorModelDefinition> = Partial<
  Record<string, ActorJournal<Model>>
>;

type ActorExecutionScope = Readonly<{
  kind: "actor";
  actor: string;
  key: string;
}>;

const actorResultRetention = 1_024;

type ActorCommandExecution<Model extends ActorModelDefinition> = Readonly<{
  state: Model["State"];
  outcome: ActorOutcome<object, object>;
  timers: readonly ActorTimerIntent[];
}>;

type ActorTimerIntent =
  | Readonly<{
      type: "schedule";
      timer: string;
      dueAt: number;
      command: Procedure;
      input: object;
    }>
  | Readonly<{ type: "cancel"; timer: string }>;

type ActiveActorTimer = Readonly<{
  timer: string;
  generation: number;
  dueAt: number;
  operation: string;
  input: object;
  commandVersion: number;
}>;

type ActorTimerSlot = {
  timer: string;
  generation: number;
  dueAt: number;
  operation: string;
  input: object;
  commandVersion: number;
  active: boolean;
};

type RuntimeStateMigration = (context: Readonly<{ state: Readonly<object> }>) => object;
type RuntimeCommandMigration = (context: Readonly<{ input: object }>) => object;

class ActorCommandFailure extends Error {
  constructor(readonly failure: object) {
    super("Actor command failed.");
    this.name = "ActorCommandFailure";
  }
}

function actorStream(name: string, key: string): string {
  return `actor:${name.length}:${name}:${key.length}:${key}`;
}

function actorRegistryStream(name: string): string {
  return `actor-registry:${name.length}:${name}`;
}

function actorAlarm(stream: string): string {
  return `actor-alarm:${stream.length}:${stream}`;
}

function actorRegistrationKey(key: string): string {
  return `${key.length}:${key}`;
}

function cloneActorState<State extends object>(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}

function resolveActorExecutionSlot(slots: ActorExecutionSlots, stream: string): ActorExecutionSlot {
  const existing = slots[stream];
  if (existing !== undefined) return existing;
  const created = { stream, active: false };
  slots[stream] = created;
  return created;
}

async function readActorJournal<Model extends ActorModelDefinition>(
  events: EventStore<ActorJournalEvent<Model>>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorJournalCache<Model>,
): Promise<ActorJournal<Model>> {
  const cached = cache[stream];
  const stored = await events.read({
    stream,
    ...(cached === undefined ? {} : { after: cached.revision }),
  });
  let revision = cached?.revision ?? 0;
  let state = cached?.state ?? initialize({ key });
  const accepted: ActorJournalAccepted[] = [];
  const pendingCandidates: ActorJournalAccepted[] = [];
  const claims: ActorJournalClaimed[] = [];
  const failed: ActorJournalFailed[] = [];
  const poisoned: ActorJournalPoisoned[] = [];
  const completed: ActorJournalCompleted<Model>[] = [];
  const timers: ActorJournalTimerEvent[] = [];
  if (cached !== undefined) {
    for (const acceptedEvent of cached.accepted) {
      accepted.push(acceptedEvent);
      pendingCandidates.push(acceptedEvent);
    }
    for (const claimEvent of cached.claims) claims.push(claimEvent);
    for (const failureEvent of cached.failed) failed.push(failureEvent);
    for (const poisonEvent of cached.poisoned) poisoned.push(poisonEvent);
    for (const completionEvent of cached.completed) completed.push(completionEvent);
    for (const timerEvent of cached.timers) timers.push(timerEvent);
  }
  for (const entry of stored) {
    revision = entry.revision;
    const event = entry.event;
    if (event.type === "actor.command.accepted") {
      accepted.push(event);
      pendingCandidates.push(event);
    } else if (event.type === "actor.command.claimed") {
      claims.push(event);
    } else if (event.type === "actor.command.failed") {
      failed.push(event);
    } else if (event.type === "actor.command.poisoned") {
      poisoned.push(event);
    } else if (event.type === "actor.timer.scheduled") {
      timers.push(event);
    } else if (event.type === "actor.timer.cancelled") {
      timers.push(event);
    } else if (event.type === "actor.timer.fired") {
      timers.push(event);
    } else if (event.type === "actor.command.completed") {
      completed.push(event);
      state = migrateActorState(event.state, event.stateVersion ?? 0, stateMigrations);
    }
  }
  const pending: ActorJournalAccepted[] = [];
  const settledCount = completed.length + failed.length + poisoned.length;
  for (let index = settledCount; index < pendingCandidates.length; index += 1) {
    const pendingCandidate = pendingCandidates[index];
    if (pendingCandidate !== undefined) pending.push(pendingCandidate);
  }
  const journal = {
    revision,
    state,
    accepted,
    pending,
    claims,
    failed,
    poisoned,
    completed,
    timers,
  };
  const current = cache[stream];
  if (current === undefined || current.revision <= revision) cache[stream] = journal;
  return journal;
}

async function registerActor<Model extends ActorModelDefinition>(
  events: EventStore<ActorJournalEvent<Model>>,
  registry: string,
  key: Model["Key"],
  at: number,
  cache: ActorRegistrationCache,
): Promise<void> {
  const registration = actorRegistrationKey(key);
  if (cache.keys[registration] === true) return;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const stored = await events.read({ stream: registry, after: cache.revision });
    let revision = cache.revision;
    for (const entry of stored) {
      revision = entry.revision;
      if (entry.event.type === "actor.registered") {
        cache.keys[actorRegistrationKey(entry.event.key)] = true;
      }
    }
    if (cache.revision < revision) cache.revision = revision;
    if (cache.keys[registration] === true) return;
    const appended = await events.append({
      stream: registry,
      expectedRevision: revision,
      events: [{ type: "actor.registered", key, at }],
    });
    if (appended !== undefined) {
      const last = appended[appended.length - 1];
      if (last !== undefined && cache.revision < last.revision) cache.revision = last.revision;
      cache.keys[registration] = true;
      return;
    }
  }
  throw new ActorError({ type: "overloaded" });
}

async function registeredActorKeys<Model extends ActorModelDefinition>(
  events: EventStore<ActorJournalEvent<Model>>,
  registry: string,
): Promise<Readonly<{ revision: number; keys: readonly Model["Key"][] }>> {
  const stored = await events.read({ stream: registry });
  let revision = 0;
  const keys: Model["Key"][] = [];
  for (const entry of stored) {
    revision = entry.revision;
    const event = entry.event;
    if (
      event.type === "actor.registered" &&
      keys.find((candidate) => candidate === event.key) === undefined
    ) {
      keys.push(event.key);
    }
  }
  return { revision, keys };
}

function activeActorTimers<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
): readonly ActiveActorTimer[] {
  const slots: ActorTimerSlot[] = [];
  for (const event of journal.timers) {
    const existing = slots.find((candidate) => candidate.timer === event.timer);
    if (event.type === "actor.timer.scheduled") {
      if (existing === undefined) {
        slots.push({
          timer: event.timer,
          generation: event.generation,
          dueAt: event.dueAt,
          operation: event.operation,
          input: event.input,
          commandVersion: event.commandVersion,
          active: true,
        });
      } else {
        existing.generation = event.generation;
        existing.dueAt = event.dueAt;
        existing.operation = event.operation;
        existing.input = event.input;
        existing.commandVersion = event.commandVersion;
        existing.active = true;
      }
    } else if (existing !== undefined) {
      existing.active = false;
    }
  }
  const active: ActiveActorTimer[] = [];
  for (const slot of slots) {
    if (slot.active) {
      active.push({
        timer: slot.timer,
        generation: slot.generation,
        dueAt: slot.dueAt,
        operation: slot.operation,
        input: slot.input,
        commandVersion: slot.commandVersion,
      });
    }
  }
  return active;
}

function nextActorTimerGeneration<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
  appended: readonly ActorJournalTimerEvent[],
  timer: string,
): number {
  let generation = 0;
  for (const event of journal.timers) {
    if (event.timer === timer && event.generation > generation) generation = event.generation;
  }
  for (const appendedEvent of appended) {
    if (appendedEvent.timer === timer && appendedEvent.generation > generation) {
      generation = appendedEvent.generation;
    }
  }
  return generation + 1;
}

function resolveActorCommandOperation<Model extends ActorModelDefinition>(
  commands: Readonly<Partial<Record<string, RuntimeCommandHandler<Model>>>>,
  names: readonly string[],
  command: Procedure,
): string {
  for (const name of names) {
    if (commands[name] === command) return name;
  }
  throw new ActorError({ type: "incompatible", schema: "timer-command" });
}

function actorTimerEvents<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
  intents: readonly ActorTimerIntent[],
  commands: Readonly<Partial<Record<string, RuntimeCommandHandler<Model>>>>,
  commandNames: readonly string[],
  migrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  now: number,
): readonly ActorJournalTimerEvent[] {
  const events: ActorJournalTimerEvent[] = [];
  for (const intent of intents) {
    const generation = nextActorTimerGeneration(journal, events, intent.timer);
    if (intent.type === "cancel") {
      events.push({
        type: "actor.timer.cancelled",
        timer: intent.timer,
        generation,
        at: now,
      });
    } else {
      const operation = resolveActorCommandOperation(commands, commandNames, intent.command);
      events.push({
        type: "actor.timer.scheduled",
        timer: intent.timer,
        generation,
        dueAt: intent.dueAt,
        operation,
        input: intent.input,
        commandVersion: migrations[operation]?.length ?? 0,
        at: now,
      });
    }
  }
  return events;
}

function migrateActorState<Model extends ActorModelDefinition>(
  state: Model["State"],
  version: number,
  migrations: readonly RuntimeStateMigration[],
): Model["State"] {
  if (version > migrations.length) {
    throw new ActorError({ type: "incompatible", schema: `state:${version}` });
  }
  let migrated: object = state;
  for (let current = version; current < migrations.length; current += 1) {
    const migrate = migrations[current];
    if (migrate === undefined) {
      throw new ActorError({ type: "incompatible", schema: `state:${current}` });
    }
    migrated = migrate({ state: migrated });
  }
  return migrated as Model["State"];
}

function migrateActorInput(
  accepted: ActorJournalAccepted,
  migrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
): object | undefined {
  const operationMigrations = migrations[accepted.operation] ?? [];
  const version = accepted.commandVersion ?? 0;
  if (version > operationMigrations.length) {
    throw new ActorError({
      type: "incompatible",
      schema: `${accepted.operation}:${version}`,
    });
  }
  let input = accepted.input;
  for (let current = version; current < operationMigrations.length; current += 1) {
    const migrate = operationMigrations[current];
    if (migrate === undefined || input === undefined) {
      throw new ActorError({
        type: "incompatible",
        schema: `${accepted.operation}:${current}`,
      });
    }
    input = migrate({ input });
  }
  return input;
}

function pendingActorCommand<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
): ActorJournalAccepted | undefined {
  return journal.pending.find(() => true);
}

function pendingActorCommandCount<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
): number {
  return journal.pending.length;
}

function latestActorClaim<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
  invocation: string,
): ActorJournalClaimed | undefined {
  let latest: ActorJournalClaimed | undefined;
  for (const claim of journal.claims) {
    if (claim.invocation === invocation) latest = claim;
  }
  return latest;
}

function nextActorWake<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
  now: number,
): number | undefined {
  let wake: number | undefined;
  const pending = pendingActorCommand(journal);
  if (pending !== undefined) {
    const claim = latestActorClaim(journal, pending.invocation);
    wake = claim === undefined || claim.until <= now ? now : claim.until;
  }
  for (const timer of activeActorTimers(journal)) {
    if (wake === undefined || timer.dueAt < wake) wake = timer.dueAt;
  }
  return wake;
}

function scheduleActorJournalWake<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  journal: ActorJournal<Model>,
): void {
  const id = actorAlarm(stream);
  const at = nextActorWake(journal, dependencies.clock.now({}));
  if (at === undefined) dependencies.alarm.cancel({ id });
  else dependencies.alarm.schedule({ id, at });
}

function retainedActorCompletion<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
  invocation: string,
): ActorJournalCompleted<Model> | undefined {
  const retainedFrom =
    journal.completed.length > actorResultRetention
      ? journal.completed.length - actorResultRetention
      : 0;
  for (let index = retainedFrom; index < journal.completed.length; index += 1) {
    const completed = journal.completed[index];
    if (completed?.invocation === invocation) return completed;
  }
  if (journal.completed.find((completed) => completed.invocation === invocation)) {
    throw new ActorError({ type: "result-expired", invocation });
  }
  return undefined;
}

function assertMatchingActorInvocation(
  accepted: ActorJournalAccepted,
  operation: string,
  input: object | undefined,
  migrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
): void {
  const migrated = migrateActorInput(accepted, migrations);
  if (
    accepted.operation === operation &&
    ((migrated === undefined && input === undefined) ||
      (migrated !== undefined &&
        input !== undefined &&
        JSON.stringify(migrated) === JSON.stringify(input)))
  ) {
    return;
  }
  throw new ActorError({ type: "incompatible", schema: accepted.invocation });
}

async function executeActorCommand<Model extends ActorModelDefinition>(
  accepted: ActorJournalAccepted,
  state: Model["State"],
  name: Model["Name"],
  key: Model["Key"],
  commands: Readonly<Partial<Record<string, RuntimeCommandHandler<Model>>>>,
  dependencies: DependenciesOf<Model>,
  migrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  executionContext: ExecutionContext,
): Promise<ActorCommandExecution<Model>> {
  return (await executionContext.run({
    scope: { kind: "actor", actor: name, key },
    async task() {
      return await executeActorCommandInScope(
        accepted,
        state,
        key,
        commands,
        dependencies,
        migrations,
      );
    },
  })) as ActorCommandExecution<Model>;
}

async function executeActorCommandInScope<Model extends ActorModelDefinition>(
  accepted: ActorJournalAccepted,
  state: Model["State"],
  key: Model["Key"],
  commands: Readonly<Partial<Record<string, RuntimeCommandHandler<Model>>>>,
  dependencies: DependenciesOf<Model>,
  migrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
): Promise<ActorCommandExecution<Model>> {
  const command = commands[accepted.operation];
  if (command === undefined) {
    throw new ActorError({ type: "incompatible", schema: accepted.operation });
  }
  const next = cloneActorState(state);
  const input = migrateActorInput(accepted, migrations);
  const timers: ActorTimerIntent[] = [];
  try {
    const value = await command({
      key,
      state: next,
      input,
      dependencies,
      invocation: { id: accepted.invocation },
      fail(failure: object): never {
        throw new ActorCommandFailure(failure);
      },
      timers: {
        schedule(request): void {
          timers.push({
            type: "schedule",
            timer: request.id,
            dueAt: request.at,
            command: request.command,
            input: request.input,
          });
        },
        cancel(request): void {
          timers.push({ type: "cancel", timer: request.id });
        },
      },
    });
    return {
      state: next,
      outcome: { status: "succeeded", value },
      timers,
    };
  } catch (error) {
    if (error instanceof ActorCommandFailure) {
      return {
        state,
        outcome: { status: "failed", failure: error.failure },
        timers: [],
      };
    }
    throw error;
  }
}

function assertNoActorCycle<Model extends ActorModelDefinition>(
  executionContext: ExecutionContext,
  name: Model["Name"],
  key: Model["Key"],
): void {
  const path: Readonly<{ actor: string; key: string }>[] = [];
  for (const scope of executionContext.current({}) as readonly ActorExecutionScope[]) {
    if (scope.kind === "actor") {
      path.push({ actor: scope.actor, key: scope.key });
    }
  }
  if (path.find((scope) => scope.actor === name && scope.key === key) !== undefined) {
    path.push({ actor: name, key });
    throw new ActorError({ type: "cycle", path });
  }
}

async function admitActorCommand<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorJournalCache<Model>,
  commandMigrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  operation: string,
  request: RuntimeRequest<Model>,
  invocation: RuntimeInvocation,
): Promise<string> {
  const invocationId =
    request.idempotencyKey === undefined ? invocation.id : `idempotency:${request.idempotencyKey}`;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const journal = await readActorJournal(
      dependencies.events,
      stream,
      key,
      initialize,
      stateMigrations,
      cache,
    );
    const previous = journal.accepted.find((candidate) => candidate.invocation === invocationId);
    if (previous !== undefined) {
      assertMatchingActorInvocation(previous, operation, request.input, commandMigrations);
      return invocationId;
    }
    if (pendingActorCommandCount(journal) >= 1_024) {
      throw new ActorError({
        type: "overloaded",
        retryAt: dependencies.clock.now({}) + 10,
      });
    }
    const appended = await dependencies.events.append({
      stream,
      expectedRevision: journal.revision,
      events: [
        {
          type: "actor.command.accepted",
          invocation: invocationId,
          operation,
          input: request.input,
          commandVersion: commandMigrations[operation]?.length ?? 0,
          at: dependencies.clock.now({}),
        },
      ],
    });
    if (appended !== undefined) return invocationId;
  }
  throw new ActorError({ type: "overloaded" });
}

async function recordActorCommandFailure<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorJournalCache<Model>,
  invocation: string,
  owner: string,
  failure: ActorInfrastructureFailure,
): Promise<void> {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const journal = await readActorJournal(
      dependencies.events,
      stream,
      key,
      initialize,
      stateMigrations,
      cache,
    );
    if (journal.failed.find((candidate) => candidate.invocation === invocation) !== undefined) {
      return;
    }
    const now = dependencies.clock.now({});
    const claim = latestActorClaim(journal, invocation);
    if (claim === undefined || claim.owner !== owner || claim.until <= now) {
      throw new ActorError({ type: "unavailable" });
    }
    const appended = await dependencies.events.append({
      stream,
      expectedRevision: journal.revision,
      events: [
        {
          type: "actor.command.failed",
          invocation,
          failure,
          at: now,
        },
      ],
    });
    if (appended !== undefined) return;
  }
  throw new ActorError({ type: "overloaded" });
}

async function admitDueActorTimer<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorJournalCache<Model>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const journal = await readActorJournal(
      dependencies.events,
      stream,
      key,
      initialize,
      stateMigrations,
      cache,
    );
    const now = dependencies.clock.now({});
    const timer = activeActorTimers(journal).find((candidate) => candidate.dueAt <= now);
    if (timer === undefined) return false;
    if (pendingActorCommandCount(journal) >= 1_024) return false;
    const invocation = `timer:${timer.timer}:${timer.generation}`;
    const appended = await dependencies.events.append({
      stream,
      expectedRevision: journal.revision,
      events: [
        {
          type: "actor.command.accepted",
          invocation,
          operation: timer.operation,
          input: timer.input,
          commandVersion: timer.commandVersion,
          at: now,
        },
        {
          type: "actor.timer.fired",
          timer: timer.timer,
          generation: timer.generation,
          invocation,
          at: now,
        },
      ],
    });
    if (appended !== undefined) return true;
  }
  throw new ActorError({ type: "overloaded" });
}

async function drainActorCommands<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  name: Model["Name"],
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorJournalCache<Model>,
  commandMigrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  commands: Readonly<Partial<Record<string, RuntimeCommandHandler<Model>>>>,
  commandNames: readonly string[],
  modelDependencies: DependenciesOf<Model>,
  owner: string,
  requestedInvocation: string | undefined,
): Promise<ActorJournalCompleted<Model> | undefined> {
  for (let executionAttempt = 0; executionAttempt < 2_048; executionAttempt += 1) {
    const admittedTimer = await admitDueActorTimer(
      dependencies,
      stream,
      key,
      initialize,
      stateMigrations,
      cache,
    );
    if (!admittedTimer) {
      const executionJournal = await readActorJournal(
        dependencies.events,
        stream,
        key,
        initialize,
        stateMigrations,
        cache,
      );
      if (requestedInvocation !== undefined) {
        const requestedCompletion = retainedActorCompletion(executionJournal, requestedInvocation);
        if (requestedCompletion !== undefined) {
          scheduleActorJournalWake(dependencies, stream, executionJournal);
          return requestedCompletion;
        }
        const requestedFailure = executionJournal.failed.find(
          (candidate) => candidate.invocation === requestedInvocation,
        );
        if (requestedFailure !== undefined) {
          throw new ActorError(requestedFailure.failure);
        }
        const requestedPoison = executionJournal.poisoned.find(
          (candidate) => candidate.invocation === requestedInvocation,
        );
        if (requestedPoison !== undefined) {
          throw new ActorError({
            type: "poisoned",
            invocation: requestedInvocation,
            attempts: requestedPoison.attempts,
          });
        }
      }
      const pending = pendingActorCommand(executionJournal);
      if (pending === undefined) {
        scheduleActorJournalWake(dependencies, stream, executionJournal);
        return undefined;
      }
      const now = dependencies.clock.now({});
      const claim = latestActorClaim(executionJournal, pending.invocation);
      if (claim === undefined || claim.until <= now) {
        if ((claim?.attempt ?? 0) >= 3) {
          await dependencies.events.append({
            stream,
            expectedRevision: executionJournal.revision,
            events: [
              {
                type: "actor.command.poisoned",
                invocation: pending.invocation,
                attempts: claim?.attempt ?? 3,
                at: now,
              },
            ],
          });
        } else {
          await dependencies.events.append({
            stream,
            expectedRevision: executionJournal.revision,
            events: [
              {
                type: "actor.command.claimed",
                invocation: pending.invocation,
                owner,
                attempt: (claim?.attempt ?? 0) + 1,
                until: now + 30_000,
                at: now,
              },
            ],
          });
        }
      } else if (claim.owner !== owner) {
        const poll = now + 10;
        await dependencies.timer.sleep({
          until: claim.until < poll ? claim.until : poll,
        });
      } else {
        let execution: ActorCommandExecution<Model>;
        try {
          execution = await executeActorCommand(
            pending,
            executionJournal.state,
            name,
            key,
            commands,
            modelDependencies,
            commandMigrations,
            dependencies.executionContext,
          );
        } catch (error) {
          if (error instanceof ActorError && error.failure.type === "cycle") {
            await recordActorCommandFailure(
              dependencies,
              stream,
              key,
              initialize,
              stateMigrations,
              cache,
              pending.invocation,
              owner,
              error.failure,
            );
          }
          throw error;
        }
        let committed = false;
        let completionAttempt = 0;
        while (completionAttempt < 128 && !committed) {
          const completionJournal = await readActorJournal(
            dependencies.events,
            stream,
            key,
            initialize,
            stateMigrations,
            cache,
          );
          const existingCompletion = completionJournal.completed.find(
            (candidate) => candidate.invocation === pending.invocation,
          );
          if (existingCompletion !== undefined) {
            committed = true;
          } else {
            const activeClaim = latestActorClaim(completionJournal, pending.invocation);
            const completedAt = dependencies.clock.now({});
            if (
              activeClaim === undefined ||
              activeClaim.owner !== owner ||
              activeClaim.until <= completedAt
            ) {
              completionAttempt = 128;
            } else {
              const completionEvents: ActorJournalEvent<Model>[] = [
                {
                  type: "actor.command.completed",
                  invocation: pending.invocation,
                  state: execution.state,
                  stateVersion: stateMigrations.length,
                  outcome: execution.outcome,
                  at: completedAt,
                },
              ];
              const timerEvents = actorTimerEvents(
                completionJournal,
                execution.timers,
                commands,
                commandNames,
                commandMigrations,
                completedAt,
              );
              for (const timerEvent of timerEvents) completionEvents.push(timerEvent);
              const appended = await dependencies.events.append({
                stream,
                expectedRevision: completionJournal.revision,
                events: completionEvents,
              });
              if (appended !== undefined) committed = true;
            }
          }
          completionAttempt += 1;
        }
      }
    }
  }
  throw new ActorError({ type: "overloaded" });
}

async function scheduleActorWake<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorJournalCache<Model>,
): Promise<void> {
  const journal = await readActorJournal(
    dependencies.events,
    stream,
    key,
    initialize,
    stateMigrations,
    cache,
  );
  scheduleActorJournalWake(dependencies, stream, journal);
}

function registerActorWake<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  name: Model["Name"],
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorJournalCache<Model>,
  commandMigrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  commands: Readonly<Partial<Record<string, RuntimeCommandHandler<Model>>>>,
  commandNames: readonly string[],
  modelDependencies: DependenciesOf<Model>,
  owner: string,
  slot: ActorExecutionSlot,
): void {
  dependencies.alarm.register({
    id: actorAlarm(stream),
    async run() {
      await dependencies.synchronization.exclusive({
        key: stream,
        async task() {
          slot.active = true;
          try {
            await drainActorCommands(
              dependencies,
              stream,
              name,
              key,
              initialize,
              stateMigrations,
              cache,
              commandMigrations,
              commands,
              commandNames,
              modelDependencies,
              owner,
              undefined,
            );
          } catch {
            // Durable journal state determines the retry time below.
          } finally {
            slot.active = false;
          }
          return {};
        },
      });
      await scheduleActorWake(dependencies, stream, key, initialize, stateMigrations, cache);
    },
  });
}

function createActorFeature<
  Model extends ActorModelDefinition,
  Definition extends GenericActorImplementation,
>(
  definition: Definition & ActorImplementation<Model> & ActorDefinitionConstraint<Definition>,
  identify: () => Model["Name"],
): DefinedActor<Definition, Model> {
  const feature = {
    programs: {
      server: {
        async start({ dependencies }: { dependencies: RuntimeActorRequirements<Model> }) {
          const name = identify();
          const registry = actorRegistryStream(name);
          const owner = dependencies.identifiers.create({});
          const slots: ActorExecutionSlots = {};
          const cache: ActorJournalCache<Model> = {};
          const modelDependencies = dependencies as unknown as DependenciesOf<Model>;
          const initialize = definition.state as unknown as (
            context: ActorInitialContext<Model>,
          ) => Model["State"];
          const commands = definition.commands as unknown as Readonly<
            Partial<Record<string, RuntimeCommandHandler<Model>>>
          >;
          const queries = definition.queries as unknown as Readonly<
            Partial<Record<string, RuntimeQueryHandler<Model>>>
          >;
          const stateMigrations = (definition.migrations?.state ??
            []) as readonly RuntimeStateMigration[];
          const commandMigrations = (definition.migrations?.commands ?? {}) as Readonly<
            Partial<Record<string, readonly RuntimeCommandMigration[]>>
          >;
          const commandNames = Object.keys(commands);
          const registered = await registeredActorKeys(dependencies.events, registry);
          const registrations: ActorRegistrationCache = {
            revision: registered.revision,
            keys: {},
          };
          for (const key of registered.keys) {
            const stream = actorStream(name, key);
            registrations.keys[actorRegistrationKey(key)] = true;
            const slot = resolveActorExecutionSlot(slots, stream);
            registerActorWake(
              dependencies,
              stream,
              name,
              key,
              initialize,
              stateMigrations,
              cache,
              commandMigrations,
              commands,
              commandNames,
              modelDependencies,
              owner,
              slot,
            );
            await scheduleActorWake(dependencies, stream, key, initialize, stateMigrations, cache);
          }
          return {
            [name]: {
              async [dependencyInvocation](
                operation: string,
                request: RuntimeRequest<Model>,
                invocation: RuntimeInvocation,
              ) {
                const query = queries[operation];
                const stream = actorStream(name, request.key);
                if (query === undefined && commands[operation] === undefined) {
                  throw new Error(`Unknown Actor operation ${operation}.`);
                }
                if (query === undefined) {
                  if (request.wait !== "accepted") {
                    assertNoActorCycle(dependencies.executionContext, name, request.key);
                  }
                  await registerActor(
                    dependencies.events,
                    registry,
                    request.key,
                    dependencies.clock.now({}),
                    registrations,
                  );
                  registerActorWake(
                    dependencies,
                    stream,
                    name,
                    request.key,
                    initialize,
                    stateMigrations,
                    cache,
                    commandMigrations,
                    commands,
                    commandNames,
                    modelDependencies,
                    owner,
                    resolveActorExecutionSlot(slots, stream),
                  );
                  const invocationId = await admitActorCommand(
                    dependencies,
                    stream,
                    request.key,
                    initialize,
                    stateMigrations,
                    cache,
                    commandMigrations,
                    operation,
                    request,
                    invocation,
                  );
                  if (request.wait === "accepted") {
                    await scheduleActorWake(
                      dependencies,
                      stream,
                      request.key,
                      initialize,
                      stateMigrations,
                      cache,
                    );
                    return { id: invocationId };
                  }

                  try {
                    const completed = (await dependencies.synchronization.exclusive({
                      key: stream,
                      async task() {
                        const commandSlot = resolveActorExecutionSlot(slots, stream);
                        commandSlot.active = true;
                        try {
                          const result = await drainActorCommands(
                            dependencies,
                            stream,
                            name,
                            request.key,
                            initialize,
                            stateMigrations,
                            cache,
                            commandMigrations,
                            commands,
                            commandNames,
                            modelDependencies,
                            owner,
                            invocationId,
                          );
                          if (result === undefined) {
                            throw new ActorError({ type: "unavailable" });
                          }
                          return result;
                        } finally {
                          commandSlot.active = false;
                        }
                      },
                    })) as ActorJournalCompleted<Model>;
                    return completed.outcome;
                  } catch (error) {
                    await scheduleActorWake(
                      dependencies,
                      stream,
                      request.key,
                      initialize,
                      stateMigrations,
                      cache,
                    );
                    throw error;
                  }
                }

                const querySlot = resolveActorExecutionSlot(slots, stream);
                if (querySlot.active) {
                  const committedJournal = await readActorJournal(
                    dependencies.events,
                    stream,
                    request.key,
                    initialize,
                    stateMigrations,
                    cache,
                  );
                  return await query({
                    key: request.key,
                    state: committedJournal.state,
                    input: request.input,
                  });
                }
                return await dependencies.synchronization.exclusive({
                  key: stream,
                  async task() {
                    querySlot.active = true;
                    try {
                      await drainActorCommands(
                        dependencies,
                        stream,
                        name,
                        request.key,
                        initialize,
                        stateMigrations,
                        cache,
                        commandMigrations,
                        commands,
                        commandNames,
                        modelDependencies,
                        owner,
                        undefined,
                      );
                      const queryJournal = await readActorJournal(
                        dependencies.events,
                        stream,
                        request.key,
                        initialize,
                        stateMigrations,
                        cache,
                      );
                      return await query({
                        key: request.key,
                        state: queryJournal.state,
                        input: request.input,
                      });
                    } finally {
                      querySlot.active = false;
                    }
                  },
                });
              },
            },
          } as unknown as ActorProvision<Definition, Model>;
        },
      },
    },
  };
  return feature as unknown as DefinedActor<Definition, Model>;
}
