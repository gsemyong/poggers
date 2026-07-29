import {
  dependencyInvocation,
  dispatchDependency,
  type Dependency,
  type DependencyContract,
  type DependencyImplementations,
  type DependencyReference,
} from "@/core/dependency";
import { createFeature, type Feature, type FeatureContractOf } from "@/core/feature";
import { typeKeys, typeLiteral, typeSchema, type TypeSchema } from "@/core/intrinsic";
import {
  createActorFactory,
  listActorKeys,
  readActorFactoryRecords,
  type Actor,
  type ActorFactoryRecord,
  type ActorKeyPage,
  type DefinedActor,
} from "@/features/actor";
import type { EventStore, ServerProcess } from "@/platforms/server";

type Empty = Record<never, never>;
type MaybePromise<Value> = Value | PromiseLike<Value>;
type RuntimeDependencyInvocation = Readonly<{
  id: string;
  attempt: number;
  scheduledAt: number;
  startedAt: number;
  deadline?: number;
}>;
declare const aggregateCommand: unique symbol;
declare const aggregateDefinition: unique symbol;
declare const aggregateEventsDefinition: unique symbol;
declare const aggregateReferenceDefinition: unique symbol;

export type AggregateCommandDefinition = Readonly<{
  Input: object | undefined;
  Result: object;
  Failures: Readonly<Record<string, object>>;
  readonly [aggregateCommand]?: never;
}>;

export type AggregateEventDefinition = Readonly<{
  Version: number;
  Data: object;
  History: Readonly<Record<number, object>>;
}>;

type AggregateModelInput = Readonly<{
  Name: string;
  Key: string;
  State: object;
  Principal: object;
  Dependencies?: Readonly<Record<string, DependencyContract>>;
  Commands: Readonly<Record<string, AggregateCommandDefinition>>;
  Events: Readonly<Record<string, AggregateEventDefinition>>;
}>;

export type AggregateModelDefinition = Readonly<{
  Name: string;
  Key: string;
  State: object;
  Principal: object;
  Dependencies: Readonly<Record<string, DependencyContract>>;
  Commands: Readonly<Record<string, AggregateCommandDefinition>>;
  Events: Readonly<Record<string, AggregateEventDefinition>>;
}>;

/** The complete semantic model of one event-sourced consistency boundary. */
export type Aggregate<Model extends AggregateModelInput> = Readonly<
  Omit<Model, "Dependencies"> & {
    Dependencies: Model extends {
      Dependencies: infer Dependencies extends Readonly<Record<string, DependencyContract>>;
    }
      ? Dependencies
      : Empty;
  }
>;

type InputOf<Command extends AggregateCommandDefinition> = Command["Input"];
type ResultOf<Command extends AggregateCommandDefinition> = Command["Result"];
type FailuresOf<Command extends AggregateCommandDefinition> = Command["Failures"];
type EventData<Event extends AggregateEventDefinition> = Event["Data"];

type FailureOf<Failures extends Readonly<Record<string, object>>> = {
  [Name in keyof Failures]: Readonly<{
    type: Name;
    data: Failures[Name];
  }>;
}[keyof Failures];

export type AggregateFailure<Failures extends Readonly<Record<string, object>> = Empty> =
  | FailureOf<Failures>
  | Readonly<{ type: "forbidden"; data: Empty }>;

export type AggregateOutcome<Result extends object, Failure = never> =
  | Readonly<{ status: "succeeded"; value: Result }>
  | Readonly<{ status: "failed"; failure: Failure }>;

type AggregateEmission<Model extends AggregateModelDefinition> = {
  [Name in keyof Model["Events"]]: Readonly<{
    [EventName in Name]: EventData<Model["Events"][Name]>;
  }>;
}[keyof Model["Events"]];

type AggregateMigratedEvent<Model extends AggregateModelDefinition> = {
  [Name in keyof Model["Events"]]: Readonly<{
    type: Name;
    version: number;
    data: EventData<Model["Events"][Name]>;
  }>;
}[keyof Model["Events"]];

type AggregateDecision<Model extends AggregateModelDefinition, Result extends object> = Readonly<{
  events: readonly AggregateEmission<Model>[];
  result: Result;
}>;

type AggregateCommandContext<
  Model extends AggregateModelDefinition,
  Command extends AggregateCommandDefinition,
> = Readonly<{
  key: Model["Key"];
  state: Readonly<Model["State"]>;
  principal: Model["Principal"];
  input: InputOf<Command>;
  dependencies: Model["Dependencies"];
  invocation: Readonly<{ id: string; at: number }>;
  fail(failure: FailureOf<FailuresOf<Command>>): never;
}>;

type AggregateAuthorizationContext<
  Model extends AggregateModelDefinition,
  Input extends object | undefined,
> = Readonly<{
  key: Model["Key"];
  state: Readonly<Model["State"]>;
  principal: Model["Principal"];
  input: Input;
  dependencies: Model["Dependencies"];
}>;

type AggregateEventContext<
  Model extends AggregateModelDefinition,
  Event extends AggregateEventDefinition,
> = Readonly<{
  state: Readonly<Model["State"]>;
  event: Readonly<Event["Data"]>;
}>;

type TupleOf<
  Length extends number,
  Values extends readonly unknown[] = [],
> = Values["length"] extends Length ? Values : TupleOf<Length, readonly [...Values, unknown]>;

type Next<Version extends number> = [...TupleOf<Version>, unknown]["length"];

type EventAt<
  Event extends AggregateEventDefinition,
  Version extends number,
> = Version extends Event["Version"]
  ? Event["Data"]
  : Version extends keyof Event["History"]
    ? Event["History"][Version]
    : never;

type AggregateEventEvolution<Event extends AggregateEventDefinition> =
  keyof Event["History"] extends never
    ? Readonly<{ migrate?: never }>
    : Readonly<{
        migrate: Readonly<{
          [Version in Extract<keyof Event["History"], number>]: (
            value: Event["History"][Version],
          ) => EventAt<Event, Extract<Next<Version>, number>>;
        }>;
      }>;

export type AggregateImplementation<Model extends AggregateModelDefinition> = Readonly<{
  state(context: Readonly<{ key: Model["Key"] }>): Model["State"];
  commands: Readonly<{
    [Name in keyof Model["Commands"]]: (
      context: AggregateCommandContext<Model, Model["Commands"][Name]>,
    ) => MaybePromise<AggregateDecision<Model, ResultOf<Model["Commands"][Name]>>>;
  }>;
  events: Readonly<{
    [Name in keyof Model["Events"]]: Readonly<{
      apply(context: AggregateEventContext<Model, Model["Events"][Name]>): Model["State"];
    }> &
      AggregateEventEvolution<Model["Events"][Name]>;
  }>;
  authorize: Readonly<
    {
      read(context: AggregateAuthorizationContext<Model, undefined>): MaybePromise<boolean>;
    } & {
      [Name in keyof Model["Commands"]]: (
        context: AggregateAuthorizationContext<Model, InputOf<Model["Commands"][Name]>>,
      ) => MaybePromise<boolean>;
    }
  >;
}>;

export type AggregateSnapshot<State extends object> = Readonly<{
  revision: number;
  state: Readonly<State>;
}>;

export type AggregateEventRecord<Model extends AggregateModelDefinition> = {
  [Name in keyof Model["Events"]]: Readonly<{
    id: string;
    aggregate: Model["Name"];
    key: Model["Key"];
    revision: number;
    type: Name;
    version: Model["Events"][Name]["Version"];
    data: Model["Events"][Name]["Data"];
    metadata: Readonly<{
      command: string;
      invocation: string;
    }>;
    at: number;
  }>;
}[keyof Model["Events"]];

export type AggregateStoredEvent<Model extends AggregateModelDefinition> = {
  [Name in keyof Model["Events"]]: Readonly<{
    id: string;
    aggregate: Model["Name"];
    key: Model["Key"];
    revision: number;
    type: Name;
    version: number;
    data: object;
    metadata: Readonly<{
      command: string;
      invocation: string;
    }>;
    at: number;
  }>;
}[keyof Model["Events"]];

export type AggregateEventPage<Model extends AggregateModelDefinition> = Readonly<{
  entries: readonly AggregateEventRecord<Model>[];
  cursor: number;
  done: boolean;
}>;

export type AggregateEventFeedPage<Model extends AggregateModelDefinition> = Readonly<{
  entries: readonly AggregateEventRecord<Model>[];
  cursor?: string;
  done: boolean;
}>;

type RuntimeAggregateState<Model extends AggregateModelDefinition> = {
  revision: number;
  value: Model["State"];
};

type RuntimeAggregateCommand = Readonly<{
  name: string;
  principal: object;
  input?: object;
}>;

type RuntimeAggregateFailure =
  | Readonly<{ type: "domain"; data: Readonly<{ failure: object }> }>
  | Readonly<{ type: "forbidden"; data: Empty }>;

type AggregateRuntime<Model extends AggregateModelDefinition> = Actor<{
  Name: `${Model["Name"]}:aggregate`;
  Key: Model["Key"];
  State: RuntimeAggregateState<Model>;
  Dependencies: Model["Dependencies"];
  Methods: {
    $command: Actor.Method<
      RuntimeAggregateCommand,
      Readonly<{ result: object }>,
      {
        domain: Readonly<{ failure: object }>;
        forbidden: Empty;
      }
    >;
    $state: Actor.Read<
      Readonly<{ principal: Model["Principal"] }>,
      AggregateSnapshot<Model["State"]>
    >;
  };
}>;

type AggregateCommandRequest<
  Model extends AggregateModelDefinition,
  Command extends AggregateCommandDefinition,
> = Readonly<{
  key: Model["Key"];
  principal: Model["Principal"];
  input?: InputOf<Command>;
  wait?: "accepted" | "completed";
  idempotencyKey?: string;
}>;

type AggregateWireOperations<Model extends AggregateModelDefinition> = Readonly<
  {
    list(
      request: Readonly<{ after?: number; limit?: number }>,
    ): Promise<ActorKeyPage<Model["Key"]>>;
    state(
      request: Readonly<{ key: Model["Key"]; principal: Model["Principal"] }>,
    ): Promise<AggregateSnapshot<Model["State"]>>;
    events(
      request: Readonly<{
        key: Model["Key"];
        principal: Model["Principal"];
        after?: number;
        limit?: number;
      }>,
    ): Promise<AggregateEventPage<Model>>;
  } & {
    [Name in keyof Model["Commands"]]: (
      request: AggregateCommandRequest<Model, Model["Commands"][Name]>,
    ) => Promise<
      | AggregateOutcome<
          ResultOf<Model["Commands"][Name]>,
          AggregateFailure<FailuresOf<Model["Commands"][Name]>>
        >
      | Readonly<{ id: string }>
    >;
  }
>;

type AggregateReferenceProjection<Model extends AggregateModelDefinition> = Readonly<{
  Name: "get";
  Binding: Readonly<{ key: Model["Key"]; principal: Model["Principal"] }>;
  Inputs: Readonly<
    {
      state: undefined;
      events: Readonly<{ after?: number; limit?: number }>;
    } & {
      [Name in keyof Model["Commands"]]: InputOf<Model["Commands"][Name]>;
    }
  >;
  Argument: "input";
}>;

type CompletedCommandOptions = Readonly<{
  wait?: "completed";
  idempotencyKey?: string;
}>;

type AcceptedCommandOptions = Readonly<{
  wait: "accepted";
  idempotencyKey?: string;
}>;

type AggregateBoundCommand<Command extends AggregateCommandDefinition> =
  InputOf<Command> extends undefined
    ? {
        (
          options?: CompletedCommandOptions,
        ): Promise<AggregateOutcome<ResultOf<Command>, AggregateFailure<FailuresOf<Command>>>>;
        (options: AcceptedCommandOptions): Promise<Readonly<{ id: string }>>;
      }
    : {
        (
          input: InputOf<Command>,
          options?: CompletedCommandOptions,
        ): Promise<AggregateOutcome<ResultOf<Command>, AggregateFailure<FailuresOf<Command>>>>;
        (
          input: InputOf<Command>,
          options: AcceptedCommandOptions,
        ): Promise<Readonly<{ id: string }>>;
      };

type AggregateInstance<Model extends AggregateModelDefinition> = DependencyReference<
  AggregateReferenceProjection<Model>,
  Readonly<
    {
      state(): Promise<AggregateSnapshot<Model["State"]>>;
      events(
        input: Readonly<{ after?: number; limit?: number }>,
      ): Promise<AggregateEventPage<Model>>;
    } & {
      [Name in keyof Model["Commands"]]: AggregateBoundCommand<Model["Commands"][Name]>;
    }
  >
>;

type AggregateReferenceFactory<Model extends AggregateModelDefinition> = Readonly<{
  get(
    input: Readonly<{
      key: Model["Key"];
      principal: Model["Principal"];
    }>,
  ): AggregateInstance<Model>;
  list(input?: Readonly<{ after?: number; limit?: number }>): Promise<ActorKeyPage<Model["Key"]>>;
}>;

type AggregateDependency<Model extends AggregateModelDefinition> = Dependency<
  {
    Operations: AggregateWireOperations<Model>;
    Reference: AggregateReferenceProjection<Model>;
  },
  AggregateReferenceFactory<Model>
> &
  Readonly<{ readonly [aggregateReferenceDefinition]?: Model }>;

type AggregateEventsDependency<Model extends AggregateModelDefinition> = Dependency<{
  Operations: {
    scan(input: { after?: string; limit?: number }): Promise<AggregateEventFeedPage<Model>>;
  };
}> &
  Readonly<{ readonly [aggregateEventsDefinition]?: Model }>;

type AggregateProvision<Model extends AggregateModelDefinition> = Readonly<{
  [Name in Model["Name"]]: AggregateDependency<Model>;
}> &
  Readonly<{
    [Name in `${Model["Name"]}Events`]: AggregateEventsDependency<Model>;
  }>;

type AggregateRuntimeRequirement<Model extends AggregateModelDefinition> = Readonly<{
  [Name in `${Model["Name"]}:aggregate`]: Actor.Reference<DefinedActor<AggregateRuntime<Model>>>;
}> &
  Readonly<{ events: EventStore<object> }>;

type AggregateFeatureContract<Model extends AggregateModelDefinition> = Readonly<{
  Features: {
    runtime: FeatureContractOf<DefinedActor<AggregateRuntime<Model>>>;
  };
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: AggregateRuntimeRequirement<Model>;
      Provides: AggregateProvision<Model>;
    };
  };
}>;

/** A reusable event-sourced Aggregate Feature backed by the Actor kernel. */
export type DefinedAggregate<Model extends AggregateModelDefinition> = Feature<
  AggregateFeatureContract<Model>
> &
  Readonly<{ readonly [aggregateDefinition]?: Model }>;

type AggregateModelOf<Definition> =
  Definition extends Readonly<{
    readonly [aggregateDefinition]?: infer Model extends AggregateModelDefinition;
  }>
    ? Model
    : never;

export namespace Aggregate {
  export type Command<
    Input extends object | undefined = undefined,
    Result extends object = Empty,
    Failures extends Readonly<Record<string, object>> = Empty,
  > = Readonly<{
    Input: Input;
    Result: Result;
    Failures: Failures;
    readonly [aggregateCommand]?: never;
  }>;

  export type Event<
    Version extends number,
    Data extends object,
    History extends Readonly<Record<number, object>> = Empty,
  > = Readonly<{
    Version: Version;
    Data: Data;
    History: History;
  }>;

  export type Definition<Model extends AggregateModelDefinition> = AggregateImplementation<Model>;
  export type Outcome<Result extends object, Failure = never> = AggregateOutcome<Result, Failure>;
  export type Reference<Definition> =
    AggregateModelOf<Definition> extends infer Model extends AggregateModelDefinition
      ? AggregateDependency<Model>
      : never;
  export type Instance<Definition> =
    AggregateModelOf<Definition> extends infer Model extends AggregateModelDefinition
      ? AggregateInstance<Model>
      : never;
  export type CommandOf<
    Definition,
    Name extends keyof AggregateModelOf<Definition>["Commands"],
  > = AggregateModelOf<Definition>["Commands"][Name];
  export type EventRecord<Definition> =
    AggregateModelOf<Definition> extends infer Model extends AggregateModelDefinition
      ? AggregateEventRecord<Model>
      : never;
  export type StoredEvent<Definition> =
    AggregateModelOf<Definition> extends infer Model extends AggregateModelDefinition
      ? AggregateStoredEvent<Model>
      : never;
  export type Events<Definition> =
    AggregateModelOf<Definition> extends infer Model extends AggregateModelDefinition
      ? AggregateEventsDependency<Model>
      : never;
  export type EventOf<Events> =
    Events extends Readonly<{
      readonly [aggregateEventsDefinition]?: infer Model extends AggregateModelDefinition;
    }>
      ? AggregateEventRecord<Model>
      : never;
}

type AggregateFixtureExecution<
  Model extends AggregateModelDefinition,
  Name extends keyof Model["Commands"],
> = Readonly<{
  outcome: AggregateOutcome<
    ResultOf<Model["Commands"][Name]>,
    AggregateFailure<FailuresOf<Model["Commands"][Name]>>
  >;
  snapshot: AggregateSnapshot<Model["State"]>;
  events: readonly AggregateEmission<Model>[];
}>;

export type AggregateFixture<Model extends AggregateModelDefinition> = Readonly<{
  initial(input: Readonly<{ key: Model["Key"] }>): AggregateSnapshot<Model["State"]>;
  execute<Name extends keyof Model["Commands"]>(
    input: Readonly<{
      command: Name;
      key: Model["Key"];
      principal: Model["Principal"];
      state: AggregateSnapshot<Model["State"]>;
      input: InputOf<Model["Commands"][Name]>;
      invocation?: Readonly<{ id: string; at: number }>;
    }>,
  ): Promise<AggregateFixtureExecution<Model, Name>>;
  replay(
    input: Readonly<{
      key: Model["Key"];
      events: readonly AggregateEmission<Model>[];
    }>,
  ): AggregateSnapshot<Model["State"]>;
  migrate(
    event: Readonly<{
      type: keyof Model["Events"];
      version: number;
      data: object;
    }>,
  ): AggregateMigratedEvent<Model>;
}>;

type RuntimeAggregateFactory<Model extends AggregateModelDefinition> = Readonly<{
  name: Model["Name"];
  definition: AggregateImplementation<Model>;
  versions: Readonly<Record<string, number>>;
}>;

type RuntimeAggregateCommandContext<Model extends AggregateModelDefinition> = Readonly<{
  key: Model["Key"];
  state: RuntimeAggregateState<Model>;
  input: RuntimeAggregateCommand;
  dependencies: Model["Dependencies"];
  factory: RuntimeAggregateFactory<Model>;
  invocation: Readonly<{ id: string; at: number }>;
  fail(failure: RuntimeAggregateFailure): never;
  journal: Readonly<{ record(value: object): void }>;
}>;

type RuntimeAggregateReadContext<Model extends AggregateModelDefinition> = Readonly<{
  key: Model["Key"];
  state: Readonly<RuntimeAggregateState<Model>>;
  input: Readonly<{ principal: Model["Principal"] }>;
  dependencies: Model["Dependencies"];
  factory: RuntimeAggregateFactory<Model>;
}>;

type RuntimeEventDefinitionSchema = Readonly<{
  kind: string;
  fields?: readonly Readonly<{
    name: string;
    type: Readonly<{
      kind: string;
      value?: string | number | boolean | null;
    }>;
  }>[];
}>;

type RuntimeEventsSchema = Readonly<{
  kind: string;
  fields?: readonly Readonly<{
    name: string;
    type: RuntimeEventDefinitionSchema;
  }>[];
}>;

function aggregateEventVersions(schema: TypeSchema): Readonly<Record<string, number>> {
  const root = schema as unknown as RuntimeEventsSchema;
  if (root.kind !== "record" || root.fields === undefined) {
    throw new Error("Aggregate Events must materialize as a record.");
  }
  const versions: Partial<Record<string, number>> = {};
  for (const event of root.fields) {
    if (event.type.kind !== "record" || event.type.fields === undefined) {
      throw new Error(`Aggregate event ${event.name} has no semantic definition.`);
    }
    let version: number | undefined;
    for (const field of event.type.fields) {
      if (field.name === "Version" && field.type.kind === "literal") {
        version = field.type.value as number;
      }
    }
    if (version === undefined || version < 1) {
      throw new Error(`Aggregate event ${event.name} has no positive integer Version.`);
    }
    versions[event.name] = version;
  }
  return versions as Readonly<Record<string, number>>;
}

function aggregateRuntimeMethods<Model extends AggregateModelDefinition>(): Actor.Definition<
  AggregateRuntime<Model>
>["methods"] {
  return {
    async $command(received) {
      const context = received as unknown as RuntimeAggregateCommandContext<Model>;
      const definition = context.factory.definition;
      const command = definition.commands[context.input.name];
      const authorize = definition.authorize[context.input.name];
      if (command === undefined || authorize === undefined) {
        throw new Error(`Unknown Aggregate command ${context.input.name}.`);
      }
      const allowed = await authorize({
        key: context.key,
        state: context.state.value,
        principal: context.input.principal as Model["Principal"],
        input: context.input.input,
        dependencies: context.dependencies,
      });
      if (!allowed) context.fail({ type: "forbidden", data: {} });
      const decision = await command({
        key: context.key,
        state: context.state.value,
        principal: context.input.principal as Model["Principal"],
        input: context.input.input,
        dependencies: context.dependencies,
        invocation: context.invocation,
        fail(failure: object): never {
          return context.fail({ type: "domain", data: { failure } });
        },
      });
      let next = context.state.value;
      let offset = 0;
      for (const emitted of decision.events) {
        const names = Object.keys(emitted);
        if (names.length !== 1) {
          throw new Error("Each Aggregate event emission must contain exactly one event.");
        }
        const eventName = names[0];
        if (eventName === undefined) throw new Error("Aggregate event name is unavailable.");
        const version = context.factory.versions[eventName];
        if (version === undefined) {
          throw new Error(`Unknown Aggregate event ${eventName}.`);
        }
        const data = (emitted as unknown as Readonly<Record<string, object>>)[eventName];
        if (data === undefined) throw new Error(`Aggregate event ${eventName} has no data.`);
        next = applyAggregateEvent(definition, eventName, next, data);
        offset += 1;
        context.journal.record({
          id: `${context.invocation.id}:${offset}`,
          aggregate: context.factory.name,
          key: context.key,
          revision: context.state.revision + offset,
          type: eventName,
          version,
          data,
          metadata: {
            command: context.input.name,
            invocation: context.invocation.id,
          },
          at: context.invocation.at,
        });
      }
      context.state.value = next;
      context.state.revision += offset;
      return { result: decision.result };
    },
    async $state(received) {
      const context = received as unknown as RuntimeAggregateReadContext<Model>;
      const allowed = await context.factory.definition.authorize.read({
        key: context.key,
        state: context.state.value,
        principal: context.input.principal,
        input: undefined,
        dependencies: context.dependencies,
      });
      if (!allowed) throw new AggregateError("forbidden");
      return {
        revision: context.state.revision,
        state: context.state.value,
      };
    },
  } as Actor.Definition<AggregateRuntime<Model>>["methods"];
}

function applyAggregateEvent<Model extends AggregateModelDefinition>(
  definition: AggregateImplementation<Model>,
  eventName: string,
  state: Model["State"],
  data: object,
): Model["State"] {
  const event = definition.events[eventName] as
    | Readonly<{ apply(context: { state: Model["State"]; event: object }): Model["State"] }>
    | undefined;
  if (event === undefined) throw new Error(`Unknown Aggregate event ${eventName}.`);
  return event.apply({ state, event: data });
}

function createAggregateRuntime<Model extends AggregateModelDefinition>(
  definition: AggregateImplementation<Model>,
): DefinedActor<AggregateRuntime<Model>> {
  return createActorFactory<AggregateRuntime<Model>>(
    {
      state({ key }) {
        return {
          revision: 0,
          value: definition.state({ key }),
        };
      },
      methods: aggregateRuntimeMethods<Model>(),
    },
    () => typeLiteral<`${Model["Name"]}:aggregate`>(),
    () => ({ $command: "write", $state: "read" }),
    () => ({
      name: typeLiteral<Model["Name"]>(),
      definition,
      versions: aggregateEventVersions(typeSchema<Model["Events"]>()),
    }),
    () => 1,
    () => ({}),
    () => ({ kind: typeLiteral<Model["Name"]>(), retain: true }),
  );
}

/** A rejected Aggregate operation, separate from a command's domain failures. */
export class AggregateError extends Error {
  override readonly name = "AggregateError";

  constructor(readonly code: "forbidden" | "invalid-event" | "migration") {
    super(`Aggregate ${code}`);
  }
}

function upgradeAggregateRecord<Model extends AggregateModelDefinition>(
  definition: AggregateImplementation<Model>,
  versions: Readonly<Record<string, number>>,
  record: ActorFactoryRecord,
): AggregateEventRecord<Model> {
  const candidate = record.record as Readonly<{
    id: string;
    aggregate: Model["Name"];
    key: Model["Key"];
    revision: number;
    type: string;
    version: number;
    data: object;
    metadata: Readonly<{ command: string; invocation: string }>;
    at: number;
  }>;
  const event = definition.events[candidate.type];
  const current = versions[candidate.type];
  if (event === undefined || current === undefined) throw new AggregateError("invalid-event");
  if (candidate.version > current) throw new AggregateError("migration");
  let version = candidate.version;
  let data = candidate.data;
  while (version < current) {
    const migrate = (
      event as Readonly<{ migrate?: Readonly<Record<number, (value: object) => object>> }>
    ).migrate?.[version];
    if (migrate === undefined) throw new AggregateError("migration");
    data = migrate(data);
    version += 1;
  }
  return {
    ...candidate,
    version: current,
    data,
  } as AggregateEventRecord<Model>;
}

function mapAggregateFailure(failure: RuntimeAggregateFailure): AggregateFailure {
  return failure.type === "domain"
    ? (failure.data.failure as AggregateFailure)
    : { type: "forbidden", data: {} };
}

class AggregateFixtureFailure extends Error {
  constructor(readonly failure: object) {
    super("Aggregate fixture command failed.");
  }
}

/**
 * Creates the fast, deterministic test surface owned by an Aggregate factory.
 * It performs no I/O and uses the same reducers and upcasters as the runtime.
 */
export function createAggregateFixture<Model extends AggregateModelDefinition>(
  _aggregate: DefinedAggregate<Model>,
  definition: AggregateImplementation<Model>,
  input: Readonly<{ dependencies: Model["Dependencies"] }>,
): AggregateFixture<Model> {
  const migrate = (
    stored: Readonly<{
      type: keyof Model["Events"];
      version: number;
      data: object;
    }>,
  ): AggregateMigratedEvent<Model> => {
    const event = definition.events[stored.type];
    if (event === undefined || stored.version < 1) throw new AggregateError("invalid-event");
    const migrations = (
      event as Readonly<{ migrate?: Readonly<Record<number, (value: object) => object>> }>
    ).migrate;
    let version = stored.version;
    let data = stored.data;
    let next = migrations?.[version];
    while (next !== undefined) {
      data = next(data);
      version += 1;
      next = migrations?.[version];
    }
    const latestMigration =
      migrations === undefined ? 0 : Math.max(0, ...Object.keys(migrations).map(Number));
    if (
      (latestMigration === 0 && version !== 1) ||
      (latestMigration > 0 && version !== latestMigration + 1)
    ) {
      throw new AggregateError("migration");
    }
    return { type: stored.type, version, data } as AggregateMigratedEvent<Model>;
  };
  return Object.freeze({
    initial({ key }) {
      return {
        revision: 0,
        state: definition.state({ key }),
      };
    },
    async execute<Name extends keyof Model["Commands"]>(
      request: Readonly<{
        command: Name;
        key: Model["Key"];
        principal: Model["Principal"];
        state: AggregateSnapshot<Model["State"]>;
        input: InputOf<Model["Commands"][Name]>;
        invocation?: Readonly<{ id: string; at: number }>;
      }>,
    ): Promise<AggregateFixtureExecution<Model, Name>> {
      const command = definition.commands[request.command];
      const authorize = definition.authorize[request.command];
      const allowed = await authorize({
        key: request.key,
        state: request.state.state,
        principal: request.principal,
        input: request.input,
        dependencies: input.dependencies,
      });
      if (!allowed) {
        return {
          outcome: { status: "failed", failure: { type: "forbidden", data: {} } },
          snapshot: request.state,
          events: [],
        };
      }
      const invocation = request.invocation ?? {
        id: `fixture:${String(request.command)}:${request.state.revision + 1}`,
        at: request.state.revision + 1,
      };
      let decision: AggregateDecision<Model, ResultOf<Model["Commands"][Name]>>;
      try {
        decision = await command({
          key: request.key,
          state: request.state.state,
          principal: request.principal,
          input: request.input,
          dependencies: input.dependencies,
          invocation,
          fail(failure): never {
            throw new AggregateFixtureFailure(failure);
          },
        });
      } catch (error) {
        if (!(error instanceof AggregateFixtureFailure)) throw error;
        return {
          outcome: {
            status: "failed",
            failure: error.failure as FailureOf<FailuresOf<Model["Commands"][Name]>>,
          },
          snapshot: request.state,
          events: [],
        };
      }
      let state = request.state.state;
      const events: AggregateEmission<Model>[] = [];
      let revision = request.state.revision;
      for (const emission of decision.events) {
        const names = Object.keys(emission);
        if (names.length !== 1) {
          throw new AggregateError("invalid-event");
        }
        const eventName = names[0];
        if (eventName === undefined) throw new AggregateError("invalid-event");
        const data = (emission as unknown as Readonly<Record<string, object>>)[eventName];
        if (data === undefined) throw new AggregateError("invalid-event");
        revision += 1;
        state = applyAggregateEvent(definition, eventName, state, data);
        events.push(emission);
      }
      return {
        outcome: { status: "succeeded", value: decision.result },
        snapshot: { revision, state },
        events,
      };
    },
    replay({ key, events }) {
      let state = definition.state({ key });
      let revision = 0;
      for (const emission of events) {
        const names = Object.keys(emission);
        if (names.length !== 1) throw new AggregateError("invalid-event");
        const eventName = names[0];
        if (eventName === undefined) throw new AggregateError("invalid-event");
        const data = (emission as unknown as Readonly<Record<string, object>>)[eventName];
        if (data === undefined) throw new AggregateError("invalid-event");
        state = applyAggregateEvent(definition, eventName, state, data);
        revision += 1;
      }
      return { revision, state };
    },
    migrate,
  });
}

function aggregateHasCommand(commands: readonly string[], operation: string): boolean {
  for (const command of commands) {
    if (command === operation) return true;
  }
  return false;
}

/** @internal Durable EventStore stream prefix for one Aggregate's Actor-backed event feed. */
export function aggregateEventStreamPrefix(name: string): string {
  const runtime = `${name}:aggregate`;
  return `actor:${runtime.length}:${runtime}:`;
}

async function scanAggregateEvents<Model extends AggregateModelDefinition>(
  events: EventStore<object>,
  name: string,
  definition: AggregateImplementation<Model>,
  versions: Readonly<Record<string, number>>,
  request: Readonly<{ after?: string; limit?: number }>,
): Promise<AggregateEventFeedPage<Model>> {
  const limit = request.limit ?? 100;
  const entries: AggregateEventRecord<Model>[] = [];
  let cursor = request.after;
  let done = false;
  while (entries.length < limit && !done) {
    const stored = await events.scan({ after: cursor, limit: 128 });
    done = stored.length < 128;
    for (const positioned of stored) {
      cursor = positioned.cursor;
      const event = positioned.event as Readonly<{
        type?: string;
        kind?: string;
        invocation?: string;
        record?: object;
        at?: number;
      }>;
      if (
        event.type === "actor.factory.recorded" &&
        event.kind === name &&
        event.invocation !== undefined &&
        event.record !== undefined &&
        event.at !== undefined
      ) {
        entries.push(
          upgradeAggregateRecord(definition, versions, {
            cursor: positioned.revision,
            invocation: event.invocation,
            kind: event.kind,
            record: event.record,
            at: event.at,
          }),
        );
      }
      if (entries.length >= limit) return { entries, cursor, done: false };
    }
  }
  return {
    entries,
    ...(cursor === undefined ? {} : { cursor }),
    done,
  };
}

/**
 * Defines one event-sourced Aggregate. Names and schemas come from the model;
 * the value supplies decisions, reducers, migrations, and authorization only.
 */
export function createAggregate<const Model extends AggregateModelDefinition>(
  definition: AggregateImplementation<Model>,
): DefinedAggregate<Model> {
  const runtime = createAggregateRuntime(definition);
  return createFeature<AggregateFeatureContract<Model>>({
    features: { runtime },
    programs: {
      server: {
        start({ dependencies }: Readonly<{ dependencies: AggregateRuntimeRequirement<Model> }>) {
          const name = typeLiteral<Model["Name"]>();
          const eventsName = typeLiteral<`${Model["Name"]}Events`>();
          const runtimeName = typeLiteral<`${Model["Name"]}:aggregate`>();
          const commandNames = typeKeys<Model["Commands"]>();
          const versions = aggregateEventVersions(typeSchema<Model["Events"]>());
          const actor = dependencies[runtimeName] as object;
          const eventStore = dependencies.events;
          return {
            [name]: {
              async [dependencyInvocation](
                operation: string,
                received: object,
                invocation: RuntimeDependencyInvocation,
              ) {
                if (operation === "list") {
                  return await listActorKeys<Model["Key"]>(
                    actor,
                    received as Readonly<{ after?: number; limit?: number }>,
                  );
                }
                const request = received as Readonly<{
                  key: Model["Key"];
                  principal: Model["Principal"];
                  input?: object;
                  wait?: "accepted" | "completed";
                  idempotencyKey?: string;
                  after?: number;
                  limit?: number;
                }>;
                if (operation === "state") {
                  return await dispatchDependency<AggregateSnapshot<Model["State"]>>(
                    actor,
                    "$state",
                    {
                      key: request.key,
                      input: { principal: request.principal },
                    },
                  );
                }
                if (operation === "events") {
                  await dispatchDependency<AggregateSnapshot<Model["State"]>>(actor, "$state", {
                    key: request.key,
                    input: { principal: request.principal },
                  });
                  const page = await readActorFactoryRecords(actor, {
                    key: request.key,
                    after: request.after,
                    limit: request.limit,
                  });
                  const entries: AggregateEventRecord<Model>[] = [];
                  let cursor = request.after ?? 0;
                  for (const entry of page.entries) {
                    cursor = entry.cursor;
                    if (entry.kind === name) {
                      entries.push(upgradeAggregateRecord(definition, versions, entry));
                    }
                  }
                  return { entries, cursor, done: page.done } satisfies AggregateEventPage<Model>;
                }
                if (!aggregateHasCommand(commandNames, operation)) {
                  throw new Error(`Unknown Aggregate operation ${operation}.`);
                }
                const outcome = await dispatchDependency<
                  | Actor.Outcome<Readonly<{ result: object }>, RuntimeAggregateFailure>
                  | Readonly<{ id: string }>
                >(
                  actor,
                  "$command",
                  {
                    key: request.key,
                    input: {
                      name: operation,
                      principal: request.principal,
                      input: request.input,
                    },
                    wait: request.wait,
                    idempotencyKey: request.idempotencyKey,
                  },
                  {
                    idempotencyKey: request.idempotencyKey ?? invocation.id,
                    attempt: invocation.attempt,
                    scheduledAt: invocation.scheduledAt,
                    startedAt: invocation.startedAt,
                    deadline: invocation.deadline,
                  },
                );
                const accepted = outcome as Readonly<{ id?: string }>;
                if (accepted.id !== undefined) return { id: accepted.id };
                const completed = outcome as Actor.Outcome<
                  Readonly<{ result: object }>,
                  RuntimeAggregateFailure
                >;
                if (completed.status === "failed") {
                  return {
                    status: "failed",
                    failure: mapAggregateFailure(completed.failure),
                  };
                }
                return {
                  status: "succeeded",
                  value: completed.value.result,
                };
              },
            },
            [eventsName]: {
              async scan({
                input,
              }: Readonly<{
                input: Readonly<{ after?: string; limit?: number }>;
              }>) {
                return await scanAggregateEvents(eventStore, name, definition, versions, input);
              },
            },
          } as DependencyImplementations<AggregateProvision<Model>>;
        },
      },
    },
  });
}
