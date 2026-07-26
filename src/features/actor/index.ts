import {
  dependencyInvocation,
  type Dependency,
  type DependencyContract,
  type DependencyImplementations,
  type DependencyInvocationAuthority,
  type DependencyReference,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { typeLiteral, typeSchema, type TypeSchema } from "@/core/intrinsic";
import type { Program } from "@/core/program";
import type {
  Alarm,
  Clock,
  EventStore,
  ExecutionContext,
  Identifiers,
  ServerProcess,
  Synchronization,
  Telemetry,
  Timer,
} from "@/platforms/server";

type MaybePromise<Value> = Value | PromiseLike<Value>;
type Procedure = (context: never) => object | PromiseLike<object>;
declare const actorModel: unique symbol;
declare const actorDefinition: unique symbol;
declare const actorCommandModel: unique symbol;
declare const actorMethod: unique symbol;

type ActorMethodMode = "write" | "read";

export type ActorMethodDefinition = Readonly<{
  Mode: ActorMethodMode;
  Input: object | undefined;
  Result: object;
  Failures: Readonly<Record<string, object>>;
  readonly [actorMethod]?: never;
}>;

export type ActorModelDefinition = Readonly<{
  Name: string;
  Key: string;
  State: object;
  Dependencies?: Readonly<Record<string, DependencyContract>>;
  Methods: Readonly<Record<string, ActorMethodDefinition>>;
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

/** An operational Actor failure, separate from a method's declared product failures. */
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

type CompletedMethodRequest<Input> = OperationInput<Input> &
  Readonly<{ wait?: "completed"; idempotencyKey?: string }>;

type AcceptedMethodRequest<Input> = OperationInput<Input> &
  Readonly<{ wait: "accepted"; idempotencyKey?: string }>;

type ActorInitialContext<Model extends ActorModelDefinition> = Readonly<{
  key: Model["Key"];
  readonly [actorModel]?: Model;
}>;

type HandlerContext<Handler> = Handler extends (context: infer Context) => unknown
  ? Context
  : never;

type HandlerInput<Handler> = HandlerContext<Handler> extends { input: infer Input } ? Input : never;

type ActorWriteContext<
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
  reminders: Readonly<{
    schedule<Handler extends Procedure>(
      request: HandlerContext<Handler> extends {
        readonly [actorCommandModel]?: infer Target extends ActorModelDefinition;
      }
        ? Target extends Model
          ? Model extends Target
            ? Readonly<{
                id: string;
                at: number;
                method: Handler;
                input: HandlerInput<Handler>;
              }>
            : never
          : never
        : never,
    ): void;
    cancel(request: Readonly<{ id: string }>): void;
  }>;
}>;

type ActorReadContext<
  Model extends ActorModelDefinition,
  Input extends object | undefined,
> = Readonly<{
  key: Model["Key"];
  state: Readonly<Model["State"]>;
  input: Input;
}>;

type ActorMigrationProcedure = (context: never) => object;

type ActorMigrations<Model extends ActorModelDefinition> = Readonly<{
  state?: readonly ActorMigrationProcedure[];
  methods?: Readonly<
    Partial<Record<Extract<keyof Model["Methods"], string>, readonly ActorMigrationProcedure[]>>
  >;
}>;

type InputOfMethod<Method extends ActorMethodDefinition> = Method["Input"];
type ResultOfMethod<Method extends ActorMethodDefinition> = Method["Result"];
type FailuresOfMethod<Method extends ActorMethodDefinition> = Method["Failures"];

type ActorMethodProcedure<
  Model extends ActorModelDefinition,
  Method extends ActorMethodDefinition,
> = Method["Mode"] extends "read"
  ? (
      context: ActorReadContext<Model, InputOfMethod<Method>>,
    ) => MaybePromise<ResultOfMethod<Method>>
  : (
      context: ActorWriteContext<Model, InputOfMethod<Method>, FailuresOfMethod<Method>>,
    ) => MaybePromise<ResultOfMethod<Method>>;

type ActorImplementation<Model extends ActorModelDefinition> = Readonly<{
  state(context: ActorInitialContext<Model>): Model["State"];
  methods: Readonly<{
    [Name in keyof Model["Methods"]]: ActorMethodProcedure<Model, Model["Methods"][Name]>;
  }>;
  migrations?: ActorMigrations<Model>;
}>;

type ValidActorImplementation<Model extends ActorModelDefinition> =
  Extract<keyof Model["Methods"], "then" | "$wake"> extends never
    ? ActorImplementation<Model>
    : never;

type ActorReferenceDefinition = Readonly<{
  Key: string;
  Methods: Readonly<Record<string, ActorMethodDefinition>>;
}>;

type WriteMethodName<Model extends ActorReferenceDefinition> = {
  [Name in keyof Model["Methods"]]: Model["Methods"][Name]["Mode"] extends "write" ? Name : never;
}[keyof Model["Methods"]];

type ReadMethodName<Model extends ActorReferenceDefinition> = {
  [Name in keyof Model["Methods"]]: Model["Methods"][Name]["Mode"] extends "read" ? Name : never;
}[keyof Model["Methods"]];

const actorWakeOperation = "$wake";

type ActorWireOperations<Model extends ActorReferenceDefinition> = Readonly<
  {
    readonly [Name in WriteMethodName<Model>]: (
      request: Readonly<{ key: Model["Key"] }> &
        (
          | CompletedMethodRequest<InputOfMethod<Model["Methods"][Name]>>
          | AcceptedMethodRequest<InputOfMethod<Model["Methods"][Name]>>
        ),
    ) => Promise<
      | ActorOutcome<
          ResultOfMethod<Model["Methods"][Name]>,
          FailureOf<FailuresOfMethod<Model["Methods"][Name]>>
        >
      | ActorInvocation
    >;
  } & {
    readonly [Name in ReadMethodName<Model>]: (
      request: Readonly<{ key: Model["Key"] }> &
        OperationInput<InputOfMethod<Model["Methods"][Name]>>,
    ) => Promise<ResultOfMethod<Model["Methods"][Name]>>;
  } & {
    readonly $wake: (
      request: Readonly<{ key: Model["Key"]; dueAt: number }>,
    ) => Promise<Record<never, never>>;
  }
>;

type CompletedActorCallOptions = Readonly<{
  wait?: "completed";
  idempotencyKey?: string;
}>;

type AcceptedActorCallOptions = Readonly<{
  wait: "accepted";
  idempotencyKey?: string;
}>;

type ActorBoundWriteMethod<Method extends ActorMethodDefinition> =
  InputOfMethod<Method> extends undefined
    ? {
        (
          options?: CompletedActorCallOptions,
        ): Promise<ActorOutcome<ResultOfMethod<Method>, FailureOf<FailuresOfMethod<Method>>>>;
        (options: AcceptedActorCallOptions): Promise<ActorInvocation>;
      }
    : {
        (
          input: InputOfMethod<Method>,
          options?: CompletedActorCallOptions,
        ): Promise<ActorOutcome<ResultOfMethod<Method>, FailureOf<FailuresOfMethod<Method>>>>;
        (input: InputOfMethod<Method>, options: AcceptedActorCallOptions): Promise<ActorInvocation>;
      };

type ActorBoundOperations<Model extends ActorReferenceDefinition> = Readonly<
  {
    readonly [Name in WriteMethodName<Model>]: ActorBoundWriteMethod<Model["Methods"][Name]>;
  } & {
    readonly [Name in ReadMethodName<Model>]: InputOfMethod<
      Model["Methods"][Name]
    > extends undefined
      ? () => Promise<ResultOfMethod<Model["Methods"][Name]>>
      : (
          input: InputOfMethod<Model["Methods"][Name]>,
        ) => Promise<ResultOfMethod<Model["Methods"][Name]>>;
  }
>;

type ActorReferenceProjection<Model extends ActorReferenceDefinition> = Readonly<{
  Name: "get";
  Binding: Readonly<{ key: Model["Key"] }>;
  Inputs: Readonly<{
    [Name in keyof Model["Methods"]]: InputOfMethod<Model["Methods"][Name]>;
  }>;
  Argument: "input";
}>;

type ActorInstance<Model extends ActorReferenceDefinition> = DependencyReference<
  ActorReferenceProjection<Model>,
  ActorBoundOperations<Model>
>;

type ActorReferenceFactory<Model extends ActorReferenceDefinition> = Readonly<{
  get(input: Readonly<{ key: Model["Key"] }>): ActorInstance<Model>;
}>;

type ActorDependency<Model extends ActorReferenceDefinition> = Dependency<
  {
    Operations: ActorWireOperations<Model>;
    Reference: ActorReferenceProjection<Model>;
  },
  ActorReferenceFactory<Model>
>;

type ActorProvision<Model extends ActorModelDefinition> = Readonly<{
  [Name in Model["Name"]]: ActorDependency<Model>;
}>;

type ActorFeatureContract<Model extends ActorModelDefinition> = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: ActorRequirements<Model>;
        Provides: ActorProvision<Model>;
      }
    >;
  };
}>;

/** A directly mountable Actor Feature with no public placement or transport controls. */
export type DefinedActor<Model extends ActorModelDefinition> = Feature<
  ActorFeatureContract<Model>
> &
  Readonly<{
    readonly [actorDefinition]?: Readonly<{
      Model: Model;
    }>;
  }>;

type ActorModelOf<Definition> = Definition extends ActorReferenceDefinition
  ? Definition
  : Definition extends Readonly<{
        readonly [actorDefinition]?: Readonly<{
          Model: infer Model extends ActorModelDefinition;
        }>;
      }>
    ? Model
    : never;

type ActorDependencyOf<Definition> =
  ActorModelOf<Definition> extends infer Model extends ActorReferenceDefinition
    ? ActorDependency<Model>
    : never;

export namespace Actor {
  export type Method<
    Input extends object | undefined = undefined,
    Result extends object = Record<never, never>,
    Failures extends Readonly<Record<string, object>> = Record<never, never>,
  > = Readonly<{
    Mode: "write";
    Input: Input;
    Result: Result;
    Failures: Failures;
    readonly [actorMethod]?: never;
  }>;
  export type Read<
    Input extends object | undefined = undefined,
    Result extends object = Record<never, never>,
  > = Readonly<{
    Mode: "read";
    Input: Input;
    Result: Result;
    Failures: Record<never, never>;
    readonly [actorMethod]?: never;
  }>;
  export type Initial<Model extends ActorModelDefinition> = ActorInitialContext<Model>;
  export type Methods<Model extends ActorModelDefinition> = ActorImplementation<Model>["methods"];
  export type Handler<
    Model extends ActorModelDefinition,
    Name extends keyof Model["Methods"],
  > = ActorMethodProcedure<Model, Model["Methods"][Name]>;
  export type Definition<Model extends ActorModelDefinition> = ActorImplementation<Model>;
  export type Reference<Definition> = ActorDependencyOf<Definition>;
  export type Instance<Definition> =
    ActorModelOf<Definition> extends infer Model extends ActorReferenceDefinition
      ? ActorInstance<Model>
      : never;
  export type Error = ActorError;
  export type Failure = ActorInfrastructureFailure;
  export type Outcome<Result, Failure = never> = ActorOutcome<Result, Failure>;
  export type StateMigration<Previous extends object, Next extends object> = (
    context: Readonly<{ state: Readonly<Previous> }>,
  ) => Next;
  export type MethodMigration<Previous extends object, Next extends object> = (
    context: Readonly<{ input: Previous }>,
  ) => Next;
}

/**
 * Defines one Actor type as a reusable Feature that contributes an ordinary
 * portable Program and a semantic Dependency API.
 */
export function createActor<const Model extends ActorModelDefinition>(
  definition: ValidActorImplementation<Model>,
): DefinedActor<Model> {
  return createActorFeature<Model>(
    definition,
    () => typeLiteral<Model["Name"]>(),
    () => typeSchema<Model["Methods"]>(),
  );
}

type RuntimeRequest<Model extends ActorModelDefinition> = Readonly<{
  key: Model["Key"];
  dueAt?: number;
  input?: object;
  wait?: "accepted" | "completed";
  idempotencyKey?: string;
}>;

type RuntimeInvocation = Readonly<{
  id: string;
  attempt: number;
  scheduledAt: number;
  startedAt: number;
  authority?: DependencyInvocationAuthority;
}>;

async function assertActorAuthority(
  authority: DependencyInvocationAuthority | undefined,
): Promise<void> {
  if (authority?.assert !== undefined) await authority.assert();
}

type RuntimeCommandContext<Model extends ActorModelDefinition> = Readonly<{
  key: Model["Key"];
  state: Model["State"];
  input?: object;
  dependencies: DependenciesOf<Model>;
  invocation: Readonly<{ id: string }>;
  fail(failure: object): never;
  reminders: Readonly<{
    schedule(request: Readonly<{ id: string; at: number; method: Procedure; input: object }>): void;
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

type ActorRequirements<Model extends ActorModelDefinition> = Readonly<
  DependenciesOf<Model> & {
    events: EventStore;
    alarm: Alarm;
    clock: Clock;
    executionContext: ExecutionContext;
    identifiers: Identifiers;
    synchronization: Synchronization;
    telemetry: Telemetry;
    timer: Timer;
  }
>;

type RuntimeActorRequirements<Model extends ActorModelDefinition> = Omit<
  ActorRequirements<Model>,
  "events"
> &
  Readonly<{
    events: EventStore<ActorJournalEvent<Model>, ActorJournalSnapshot<Model>>;
  }>;

type ActorJournal<Model extends ActorModelDefinition> = Readonly<{
  revision: number;
  snapshotRevision: number;
  state: Model["State"];
  accepted: readonly ActorJournalAccepted[];
  expired: readonly ActorJournalAccepted[];
  pending: readonly ActorJournalAccepted[];
  claims: readonly ActorJournalClaimed[];
  failed: readonly ActorJournalFailed[];
  poisoned: readonly ActorJournalPoisoned[];
  completed: readonly ActorJournalCompleted<Model>[];
  timers: readonly ActorJournalTimerEvent[];
}>;

type ActorJournalSnapshot<Model extends ActorModelDefinition> = Readonly<{
  format: "kit.actor";
  version: 1;
  state: Model["State"];
  stateVersion: number;
  accepted: readonly ActorJournalAccepted[];
  expired: readonly ActorJournalAccepted[];
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

type ActorActivationPhase = "activating" | "active" | "idle" | "failed";

type ActorActivation<Model extends ActorModelDefinition> = {
  epoch: number;
  phase: ActorActivationPhase;
  touchedAt: number;
  journal?: ActorJournal<Model>;
};

type ActorActivationCache<Model extends ActorModelDefinition> = {
  epoch: number;
  entries: Partial<Record<string, ActorActivation<Model>>>;
};

type ActorExecutionScope = Readonly<{
  kind: "actor";
  actor: string;
  key: string;
}>;

const actorResultRetention = 1_024;
const actorInvocationTombstoneRetention = 1_024;
const actorActivationCapacity = 256;
const actorActivationIdle = 300_000;
const actorSnapshotInterval = 256;
const actorRegistryBatchSize = 256;

function recordActorMetric(
  telemetry: Telemetry,
  actor: string,
  instrument: "counter" | "gauge" | "histogram",
  name: string,
  value: number,
): void {
  telemetry.record({
    instrument,
    name,
    value,
    attributes: [{ name: "actor", value: actor }],
  });
}

function actorCacheMetrics<Model extends ActorModelDefinition>(
  cache: ActorActivationCache<Model>,
): Readonly<{ activations: number; entries: number }> {
  let activations = 0;
  let entries = 0;
  for (const stream of Object.keys(cache.entries)) {
    const activation = cache.entries[stream];
    if (activation !== undefined) {
      entries += 1;
      if (activation.phase === "active") activations += 1;
    }
  }
  return { activations, entries };
}

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

function actorAdmission(stream: string): string {
  return `actor-admission:${stream.length}:${stream}`;
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

function createActorActivationCache<
  Model extends ActorModelDefinition,
>(): ActorActivationCache<Model> {
  return { epoch: 0, entries: {} };
}

function beginActorActivation<Model extends ActorModelDefinition>(
  cache: ActorActivationCache<Model>,
  stream: string,
  at: number,
): ActorActivation<Model> {
  const current = cache.entries[stream];
  if (current !== undefined) {
    current.phase = "activating";
    current.touchedAt = at;
    return current;
  }
  cache.epoch += 1;
  const activation = {
    epoch: cache.epoch,
    phase: "activating" as const,
    touchedAt: at,
  };
  cache.entries[stream] = activation;
  return activation;
}

function evictActorActivations<Model extends ActorModelDefinition>(
  cache: ActorActivationCache<Model>,
  at: number,
): void {
  let retained = 0;
  for (const stream of Object.keys(cache.entries)) {
    const activation = cache.entries[stream];
    if (activation !== undefined) {
      const pending = activation.journal?.pending.length ?? 0;
      if (
        pending === 0 &&
        (activation.phase === "failed" ||
          (activation.phase === "idle" && at - activation.touchedAt >= actorActivationIdle))
      ) {
        cache.entries[stream] = undefined;
      } else {
        retained += 1;
      }
    }
  }
  while (retained > actorActivationCapacity) {
    let oldestStream: string | undefined;
    let oldestAt = at;
    let oldestEpoch = cache.epoch + 1;
    for (const candidateStream of Object.keys(cache.entries)) {
      const candidate = cache.entries[candidateStream];
      if (
        candidate !== undefined &&
        candidate.phase === "idle" &&
        (candidate.journal?.pending.length ?? 0) === 0 &&
        (candidate.touchedAt < oldestAt ||
          (candidate.touchedAt === oldestAt && candidate.epoch < oldestEpoch))
      ) {
        oldestStream = candidateStream;
        oldestAt = candidate.touchedAt;
        oldestEpoch = candidate.epoch;
      }
    }
    if (oldestStream === undefined) return;
    cache.entries[oldestStream] = undefined;
    retained -= 1;
  }
}

function idleActorActivation<Model extends ActorModelDefinition>(
  cache: ActorActivationCache<Model>,
  stream: string,
  at: number,
): void {
  const activation = cache.entries[stream];
  if (activation === undefined || activation.phase === "failed") return;
  activation.phase = "idle";
  activation.touchedAt = at;
  evictActorActivations(cache, at);
}

type ActorInvocationIndex = Partial<Record<string, true>>;

function actorInvocationKey(invocation: string): string {
  return JSON.stringify(invocation);
}

function settledActorInvocationIndex<Model extends ActorModelDefinition>(
  completed: readonly ActorJournalCompleted<Model>[],
  failed: readonly ActorJournalFailed[],
  poisoned: readonly ActorJournalPoisoned[],
): ActorInvocationIndex {
  const settled: ActorInvocationIndex = {};
  for (const completedInvocation of completed) {
    settled[actorInvocationKey(completedInvocation.invocation)] = true;
  }
  for (const failedInvocation of failed) {
    settled[actorInvocationKey(failedInvocation.invocation)] = true;
  }
  for (const poisonedInvocation of poisoned) {
    settled[actorInvocationKey(poisonedInvocation.invocation)] = true;
  }
  return settled;
}

function pendingActorInvocations<Model extends ActorModelDefinition>(
  accepted: readonly ActorJournalAccepted[],
  completed: readonly ActorJournalCompleted<Model>[],
  failed: readonly ActorJournalFailed[],
  poisoned: readonly ActorJournalPoisoned[],
): ActorJournalAccepted[] {
  const settled = settledActorInvocationIndex(completed, failed, poisoned);
  const pending: ActorJournalAccepted[] = [];
  for (const candidate of accepted) {
    if (settled[actorInvocationKey(candidate.invocation)] === undefined) {
      pending.push(candidate);
    }
  }
  return pending;
}

function compactActorTimers(timers: readonly ActorJournalTimerEvent[]): ActorJournalTimerEvent[] {
  const compacted: ActorJournalTimerEvent[] = [];
  for (const event of timers) {
    let index = 0;
    while (index < compacted.length && compacted[index]?.timer !== event.timer) {
      index += 1;
    }
    if (index === compacted.length) compacted.push(event);
    else compacted[index] = event;
  }
  return compacted;
}

function actorJournalSnapshot<Model extends ActorModelDefinition>(
  journal: ActorJournal<Model>,
  stateVersion: number,
): ActorJournalSnapshot<Model> {
  const settledIndex = settledActorInvocationIndex(
    journal.completed,
    journal.failed,
    journal.poisoned,
  );
  const pending = pendingActorInvocations(
    journal.accepted,
    journal.completed,
    journal.failed,
    journal.poisoned,
  );
  const settled: string[] = [];
  for (const candidate of journal.accepted) {
    if (settledIndex[actorInvocationKey(candidate.invocation)] !== undefined) {
      settled.push(candidate.invocation);
    }
  }
  const retained: string[] = [];
  let retainedIndex =
    settled.length > actorResultRetention ? settled.length - actorResultRetention : 0;
  while (retainedIndex < settled.length) {
    const invocation = settled[retainedIndex];
    if (invocation !== undefined) retained.push(invocation);
    retainedIndex += 1;
  }
  const retainedInvocations: ActorInvocationIndex = {};
  for (const retainedInvocation of retained) {
    retainedInvocations[actorInvocationKey(retainedInvocation)] = true;
  }
  const pendingInvocations: ActorInvocationIndex = {};
  for (const pendingInvocation of pending) {
    pendingInvocations[actorInvocationKey(pendingInvocation.invocation)] = true;
  }
  const accepted: ActorJournalAccepted[] = [];
  for (const acceptedCandidate of journal.accepted) {
    if (
      retainedInvocations[actorInvocationKey(acceptedCandidate.invocation)] !== undefined ||
      pendingInvocations[actorInvocationKey(acceptedCandidate.invocation)] !== undefined
    ) {
      accepted.push(acceptedCandidate);
    }
  }
  const expiredCandidates: ActorJournalAccepted[] = [];
  for (const previousExpired of journal.expired) expiredCandidates.push(previousExpired);
  for (const acceptedCandidateForExpiry of journal.accepted) {
    if (
      settledIndex[actorInvocationKey(acceptedCandidateForExpiry.invocation)] !== undefined &&
      retainedInvocations[actorInvocationKey(acceptedCandidateForExpiry.invocation)] === undefined
    ) {
      expiredCandidates.push(acceptedCandidateForExpiry);
    }
  }
  const expired: ActorJournalAccepted[] = [];
  let expiredIndex =
    expiredCandidates.length > actorInvocationTombstoneRetention
      ? expiredCandidates.length - actorInvocationTombstoneRetention
      : 0;
  while (expiredIndex < expiredCandidates.length) {
    const expiredCandidate = expiredCandidates[expiredIndex];
    if (expiredCandidate !== undefined) expired.push(expiredCandidate);
    expiredIndex += 1;
  }
  const claims: ActorJournalClaimed[] = [];
  for (const claimCandidate of journal.claims) {
    if (pendingInvocations[actorInvocationKey(claimCandidate.invocation)] !== undefined) {
      claims.push(claimCandidate);
    }
  }
  const failed: ActorJournalFailed[] = [];
  for (const failedCandidate of journal.failed) {
    if (retainedInvocations[actorInvocationKey(failedCandidate.invocation)] !== undefined) {
      failed.push(failedCandidate);
    }
  }
  const poisoned: ActorJournalPoisoned[] = [];
  for (const poisonedCandidate of journal.poisoned) {
    if (retainedInvocations[actorInvocationKey(poisonedCandidate.invocation)] !== undefined) {
      poisoned.push(poisonedCandidate);
    }
  }
  const completed: ActorJournalCompleted<Model>[] = [];
  for (const completedCandidate of journal.completed) {
    if (retainedInvocations[actorInvocationKey(completedCandidate.invocation)] !== undefined) {
      completed.push(completedCandidate);
    }
  }
  return {
    format: "kit.actor",
    version: 1,
    state: journal.state,
    stateVersion,
    accepted,
    expired,
    claims,
    failed,
    poisoned,
    completed,
    timers: compactActorTimers(journal.timers),
  };
}

function restoreActorSnapshot<Model extends ActorModelDefinition>(
  revision: number,
  snapshot: ActorJournalSnapshot<Model>,
  stateMigrations: readonly RuntimeStateMigration[],
): ActorJournal<Model> {
  if (snapshot.format !== "kit.actor" || snapshot.version !== 1) {
    throw new ActorError({ type: "incompatible", schema: "snapshot" });
  }
  const state = migrateActorState(snapshot.state, snapshot.stateVersion, stateMigrations);
  return {
    revision,
    snapshotRevision: revision,
    state,
    accepted: snapshot.accepted,
    expired: snapshot.expired,
    pending: pendingActorInvocations(
      snapshot.accepted,
      snapshot.completed,
      snapshot.failed,
      snapshot.poisoned,
    ),
    claims: snapshot.claims,
    failed: snapshot.failed,
    poisoned: snapshot.poisoned,
    completed: snapshot.completed,
    timers: snapshot.timers,
  };
}

async function readActorJournal<Model extends ActorModelDefinition>(
  events: EventStore<ActorJournalEvent<Model>, ActorJournalSnapshot<Model>>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorActivationCache<Model>,
  at: number,
): Promise<ActorJournal<Model>> {
  const activation = beginActorActivation(cache, stream, at);
  let cached = activation.journal;
  try {
    if (cached === undefined) {
      const snapshot = await events.loadSnapshot({ stream });
      if (snapshot !== undefined) {
        cached = restoreActorSnapshot(snapshot.revision, snapshot.snapshot, stateMigrations);
      }
    }
    const stored = await events.read({
      stream,
      ...(cached === undefined ? {} : { after: cached.revision }),
    });
    let revision = cached?.revision ?? 0;
    let state = cached?.state ?? initialize({ key });
    const accepted: ActorJournalAccepted[] = [];
    const expired: ActorJournalAccepted[] = [];
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
      for (const expiredEvent of cached.expired) expired.push(expiredEvent);
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
    const pending = pendingActorInvocations(pendingCandidates, completed, failed, poisoned);
    const journal = {
      revision,
      snapshotRevision: cached?.snapshotRevision ?? 0,
      state,
      accepted,
      expired,
      pending,
      claims,
      failed,
      poisoned,
      completed,
      timers,
    };
    const current = cache.entries[stream];
    if (
      current === undefined ||
      current.journal === undefined ||
      current.journal.revision <= revision
    ) {
      activation.journal = journal;
    }
    activation.phase = "active";
    activation.touchedAt = at;
    return activation.journal ?? journal;
  } catch (error) {
    activation.journal = undefined;
    activation.phase = "failed";
    activation.touchedAt = at;
    throw error;
  }
}

async function registerActor<Model extends ActorModelDefinition>(
  events: EventStore<ActorJournalEvent<Model>, ActorJournalSnapshot<Model>>,
  registry: string,
  key: Model["Key"],
  at: number,
  cache: ActorRegistrationCache,
): Promise<void> {
  const registration = actorRegistrationKey(key);
  if (cache.keys[registration] === true) return;
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const stored = await events.read({
      stream: registry,
      after: cache.revision,
      limit: actorRegistryBatchSize,
    });
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
  events: EventStore<ActorJournalEvent<Model>, ActorJournalSnapshot<Model>>,
  registry: string,
): Promise<Readonly<{ revision: number; keys: readonly Model["Key"][] }>> {
  let revision = 0;
  const keys: Model["Key"][] = [];
  const registered: Partial<Record<string, true>> = {};
  let reading = true;
  while (reading) {
    const stored = await events.read({
      stream: registry,
      after: revision,
      limit: actorRegistryBatchSize,
    });
    if (stored.length === 0) {
      reading = false;
    } else {
      for (const entry of stored) {
        revision = entry.revision;
        const event = entry.event;
        if (event.type === "actor.registered") {
          const registration = actorRegistrationKey(event.key);
          if (registered[registration] !== true) {
            registered[registration] = true;
            keys.push(event.key);
          }
        }
      }
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

async function scheduleActorJournalWake<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  name: Model["Name"],
  key: Model["Key"],
  journal: ActorJournal<Model>,
): Promise<void> {
  const id = actorAlarm(stream);
  const at = nextActorWake(journal, dependencies.clock.now({}));
  if (at === undefined) {
    await dependencies.alarm.cancel({ id });
  } else {
    await dependencies.alarm.schedule({
      id,
      at,
      target: {
        dependency: name,
        operation: actorWakeOperation,
        input: { key, dueAt: at },
      },
    });
  }
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
  if (journal.expired.find((expired) => expired.invocation === invocation)) {
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
      reminders: {
        schedule(request): void {
          timers.push({
            type: "schedule",
            timer: request.id,
            dueAt: request.at,
            command: request.method,
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
  cache: ActorActivationCache<Model>,
  commandMigrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  name: Model["Name"],
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
      dependencies.clock.now({}),
    );
    const previous = journal.accepted.find((candidate) => candidate.invocation === invocationId);
    if (previous !== undefined) {
      assertMatchingActorInvocation(previous, operation, request.input, commandMigrations);
      return invocationId;
    }
    const expired = journal.expired.find((candidate) => candidate.invocation === invocationId);
    if (expired !== undefined) {
      assertMatchingActorInvocation(expired, operation, request.input, commandMigrations);
      throw new ActorError({ type: "result-expired", invocation: invocationId });
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
    if (appended !== undefined) {
      recordActorMetric(
        dependencies.telemetry,
        name,
        "gauge",
        "actor.queue.depth",
        pendingActorCommandCount(journal) + 1,
      );
      return invocationId;
    }
  }
  throw new ActorError({ type: "overloaded" });
}

async function admitSerializedActorCommand<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  registry: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorActivationCache<Model>,
  commandMigrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  name: Model["Name"],
  operation: string,
  request: RuntimeRequest<Model>,
  invocation: RuntimeInvocation,
  registrations: ActorRegistrationCache,
): Promise<string> {
  const admitted = (await dependencies.synchronization.exclusive({
    key: actorAdmission(stream),
    async task() {
      await registerActor(
        dependencies.events,
        registry,
        key,
        dependencies.clock.now({}),
        registrations,
      );
      return {
        invocation: await admitActorCommand(
          dependencies,
          stream,
          key,
          initialize,
          stateMigrations,
          cache,
          commandMigrations,
          name,
          operation,
          request,
          invocation,
        ),
      };
    },
  })) as Readonly<{ invocation: string }>;
  return admitted.invocation;
}

async function recordActorCommandFailure<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorActivationCache<Model>,
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
      dependencies.clock.now({}),
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
  cache: ActorActivationCache<Model>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const journal = await readActorJournal(
      dependencies.events,
      stream,
      key,
      initialize,
      stateMigrations,
      cache,
      dependencies.clock.now({}),
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

async function snapshotActorHistory<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorActivationCache<Model>,
): Promise<void> {
  const journal = await readActorJournal(
    dependencies.events,
    stream,
    key,
    initialize,
    stateMigrations,
    cache,
    dependencies.clock.now({}),
  );
  if (journal.revision - journal.snapshotRevision < actorSnapshotInterval) return;
  const saved = await dependencies.events.saveSnapshot({
    stream,
    expectedRevision: journal.snapshotRevision,
    revision: journal.revision,
    snapshot: actorJournalSnapshot(journal, stateMigrations.length),
  });
  let through = journal.revision;
  if (!saved) {
    const current = await dependencies.events.loadSnapshot({ stream });
    if (current === undefined || current.revision <= journal.snapshotRevision) return;
    through = current.revision;
  }
  await dependencies.events.compact({ stream, through });
  cache.entries[stream] = undefined;
}

async function drainActorCommands<Model extends ActorModelDefinition>(
  dependencies: RuntimeActorRequirements<Model>,
  stream: string,
  name: Model["Name"],
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorActivationCache<Model>,
  commandMigrations: Readonly<Partial<Record<string, readonly RuntimeCommandMigration[]>>>,
  commands: Readonly<Partial<Record<string, RuntimeCommandHandler<Model>>>>,
  commandNames: readonly string[],
  modelDependencies: DependenciesOf<Model>,
  owner: string,
  requestedInvocation: string | undefined,
  authority?: DependencyInvocationAuthority,
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
        dependencies.clock.now({}),
      );
      if (requestedInvocation !== undefined) {
        const requestedCompletion = retainedActorCompletion(executionJournal, requestedInvocation);
        if (requestedCompletion !== undefined) {
          await scheduleActorJournalWake(dependencies, stream, name, key, executionJournal);
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
        await scheduleActorJournalWake(dependencies, stream, name, key, executionJournal);
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
          const nextAttempt = (claim?.attempt ?? 0) + 1;
          const claimed = await dependencies.events.append({
            stream,
            expectedRevision: executionJournal.revision,
            events: [
              {
                type: "actor.command.claimed",
                invocation: pending.invocation,
                owner,
                attempt: nextAttempt,
                until: now + 30_000,
                at: now,
              },
            ],
          });
          if (claimed !== undefined && nextAttempt > 1) {
            recordActorMetric(dependencies.telemetry, name, "counter", "actor.retries", 1);
          }
        }
      } else if (claim.owner !== owner) {
        const poll = now + 10;
        await dependencies.timer.sleep({
          until: claim.until < poll ? claim.until : poll,
        });
      } else {
        let execution: ActorCommandExecution<Model>;
        try {
          await assertActorAuthority(authority);
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
          if (execution.outcome.status === "failed") {
            recordActorMetric(dependencies.telemetry, name, "counter", "actor.failures", 1);
          }
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
            dependencies.clock.now({}),
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
              await assertActorAuthority(authority);
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
              if (appended !== undefined) {
                committed = true;
                try {
                  await snapshotActorHistory(
                    dependencies,
                    stream,
                    key,
                    initialize,
                    stateMigrations,
                    cache,
                  );
                } catch {
                  // Snapshotting is retried after later commits; journal state is authoritative.
                }
              }
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
  name: Model["Name"],
  key: Model["Key"],
  initialize: (context: ActorInitialContext<Model>) => Model["State"],
  stateMigrations: readonly RuntimeStateMigration[],
  cache: ActorActivationCache<Model>,
): Promise<void> {
  const journal = await readActorJournal(
    dependencies.events,
    stream,
    key,
    initialize,
    stateMigrations,
    cache,
    dependencies.clock.now({}),
  );
  await scheduleActorJournalWake(dependencies, stream, name, key, journal);
}

type RuntimeMethodFieldSchema = Readonly<{
  kind: string;
  value?: string;
  fields?: readonly Readonly<{
    name: string;
    type: Readonly<{ kind: string; value?: string }>;
  }>[];
}>;

type RuntimeActorMethodsSchema = Readonly<{
  kind: string;
  fields?: readonly Readonly<{ name: string; type: RuntimeMethodFieldSchema }>[];
}>;

function actorMethodModes(schema: TypeSchema): Readonly<Record<string, ActorMethodMode>> {
  const root = schema as unknown as RuntimeActorMethodsSchema;
  if (root.kind !== "record" || root.fields === undefined) {
    throw new Error("Actor Methods must materialize as a record.");
  }
  const modes: Partial<Record<string, ActorMethodMode>> = {};
  for (const method of root.fields) {
    if (method.type.kind !== "record" || method.type.fields === undefined) {
      throw new Error(`Actor method ${method.name} has no semantic definition.`);
    }
    let mode: ActorMethodMode | undefined;
    for (const field of method.type.fields) {
      if (
        field.name === "Mode" &&
        field.type.kind === "literal" &&
        (field.type.value === "write" || field.type.value === "read")
      ) {
        mode = field.type.value;
      }
    }
    if (mode === undefined) {
      throw new Error(`Actor method ${method.name} has no read/write mode.`);
    }
    modes[method.name] = mode;
  }
  return modes as Readonly<Record<string, ActorMethodMode>>;
}

function createActorFeature<Model extends ActorModelDefinition>(
  definition: ActorImplementation<Model>,
  identify: () => Model["Name"],
  describe: () => TypeSchema,
): DefinedActor<Model> {
  return createFeature<ActorFeatureContract<Model>>({
    programs: {
      server: {
        async start({ dependencies }: Readonly<{ dependencies: ActorRequirements<Model> }>) {
          const runtimeDependencies = dependencies as unknown as RuntimeActorRequirements<Model>;
          const name = identify();
          const registry = actorRegistryStream(name);
          const owner = runtimeDependencies.identifiers.create({});
          const slots: ActorExecutionSlots = {};
          const cache = createActorActivationCache<Model>();
          const modelDependencies = runtimeDependencies as unknown as DependenciesOf<Model>;
          const initialize = definition.state as unknown as (
            context: ActorInitialContext<Model>,
          ) => Model["State"];
          const methods = definition.methods as unknown as Readonly<
            Record<string, RuntimeCommandHandler<Model> | RuntimeQueryHandler<Model>>
          >;
          const methodModes = actorMethodModes(describe());
          const commands: Partial<Record<string, RuntimeCommandHandler<Model>>> = {};
          const queries: Partial<Record<string, RuntimeQueryHandler<Model>>> = {};
          for (const methodName of Object.keys(methods)) {
            const method = methods[methodName];
            const mode = methodModes[methodName];
            if (method === undefined || mode === undefined) {
              throw new Error(`Actor method ${methodName} has no semantic definition.`);
            }
            if (mode === "read") {
              queries[methodName] = method as RuntimeQueryHandler<Model>;
            } else {
              commands[methodName] = method as RuntimeCommandHandler<Model>;
            }
          }
          const stateMigrations = (definition.migrations?.state ??
            []) as readonly RuntimeStateMigration[];
          const commandMigrations = (definition.migrations?.methods ?? {}) as Readonly<
            Partial<Record<string, readonly RuntimeCommandMigration[]>>
          >;
          const commandNames = Object.keys(commands);
          const registered = await registeredActorKeys(runtimeDependencies.events, registry);
          const registrations: ActorRegistrationCache = {
            revision: registered.revision,
            keys: {},
          };
          for (const key of registered.keys) {
            const stream = actorStream(name, key);
            registrations.keys[actorRegistrationKey(key)] = true;
            resolveActorExecutionSlot(slots, stream);
            await scheduleActorWake(
              runtimeDependencies,
              stream,
              name,
              key,
              initialize,
              stateMigrations,
              cache,
            );
            idleActorActivation(cache, stream, runtimeDependencies.clock.now({}));
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
                recordActorMetric(runtimeDependencies.telemetry, name, "counter", "actor.calls", 1);
                recordActorMetric(
                  runtimeDependencies.telemetry,
                  name,
                  "counter",
                  cache.entries[stream]?.journal === undefined
                    ? "actor.cache.misses"
                    : "actor.cache.hits",
                  1,
                );
                if (invocation.attempt > 1) {
                  recordActorMetric(
                    runtimeDependencies.telemetry,
                    name,
                    "counter",
                    "actor.retries",
                    1,
                  );
                }
                const cacheMetrics = actorCacheMetrics(cache);
                recordActorMetric(
                  runtimeDependencies.telemetry,
                  name,
                  "gauge",
                  "actor.activations",
                  cacheMetrics.activations,
                );
                recordActorMetric(
                  runtimeDependencies.telemetry,
                  name,
                  "gauge",
                  "actor.cache.entries",
                  cacheMetrics.entries,
                );
                if (operation === actorWakeOperation && request.dueAt !== undefined) {
                  const reminderLag = runtimeDependencies.clock.now({}) - request.dueAt;
                  recordActorMetric(
                    runtimeDependencies.telemetry,
                    name,
                    "histogram",
                    "actor.reminder.lag",
                    reminderLag < 0 ? 0 : reminderLag,
                  );
                }
                if (
                  operation !== actorWakeOperation &&
                  query === undefined &&
                  commands[operation] === undefined
                ) {
                  throw new Error(`Unknown Actor operation ${operation}.`);
                }
                try {
                  if (operation === actorWakeOperation) {
                    await assertActorAuthority(invocation.authority);
                    return await runtimeDependencies.synchronization.exclusive({
                      key: stream,
                      async task() {
                        const wakeSlot = resolveActorExecutionSlot(slots, stream);
                        wakeSlot.active = true;
                        try {
                          await drainActorCommands(
                            runtimeDependencies,
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
                            invocation.authority,
                          );
                          return {};
                        } finally {
                          wakeSlot.active = false;
                        }
                      },
                    });
                  }
                  if (query === undefined) {
                    if (request.wait !== "accepted") {
                      assertNoActorCycle(runtimeDependencies.executionContext, name, request.key);
                    }
                    if (request.wait === "accepted") {
                      const invocationId = await admitSerializedActorCommand(
                        runtimeDependencies,
                        stream,
                        registry,
                        request.key,
                        initialize,
                        stateMigrations,
                        cache,
                        commandMigrations,
                        name,
                        operation,
                        request,
                        invocation,
                        registrations,
                      );
                      await scheduleActorWake(
                        runtimeDependencies,
                        stream,
                        name,
                        request.key,
                        initialize,
                        stateMigrations,
                        cache,
                      );
                      return { id: invocationId };
                    }

                    try {
                      const completed = (await runtimeDependencies.synchronization.exclusive({
                        key: stream,
                        async task() {
                          const commandSlot = resolveActorExecutionSlot(slots, stream);
                          commandSlot.active = true;
                          try {
                            const invocationId = await admitSerializedActorCommand(
                              runtimeDependencies,
                              stream,
                              registry,
                              request.key,
                              initialize,
                              stateMigrations,
                              cache,
                              commandMigrations,
                              name,
                              operation,
                              request,
                              invocation,
                              registrations,
                            );
                            const result = await drainActorCommands(
                              runtimeDependencies,
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
                              invocation.authority,
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
                        runtimeDependencies,
                        stream,
                        name,
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
                    await assertActorAuthority(invocation.authority);
                    const committedJournal = await readActorJournal(
                      runtimeDependencies.events,
                      stream,
                      request.key,
                      initialize,
                      stateMigrations,
                      cache,
                      runtimeDependencies.clock.now({}),
                    );
                    return await query({
                      key: request.key,
                      state: committedJournal.state,
                      input: request.input,
                    });
                  }
                  return await runtimeDependencies.synchronization.exclusive({
                    key: stream,
                    async task() {
                      querySlot.active = true;
                      try {
                        await drainActorCommands(
                          runtimeDependencies,
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
                          invocation.authority,
                        );
                        const queryJournal = await readActorJournal(
                          runtimeDependencies.events,
                          stream,
                          request.key,
                          initialize,
                          stateMigrations,
                          cache,
                          runtimeDependencies.clock.now({}),
                        );
                        await assertActorAuthority(invocation.authority);
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
                } catch (cause) {
                  recordActorMetric(
                    runtimeDependencies.telemetry,
                    name,
                    "counter",
                    "actor.failures",
                    1,
                  );
                  throw cause;
                } finally {
                  const slot = slots[stream];
                  if (slot === undefined || !slot.active) {
                    idleActorActivation(cache, stream, runtimeDependencies.clock.now({}));
                  }
                }
              },
            },
          } as DependencyImplementations<ActorProvision<Model>>;
        },
      },
    },
  });
}
