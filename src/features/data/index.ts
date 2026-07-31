import { dispatchDependency, type DependencyContract } from "@/core/dependency";
import { createFeature, type Feature, type FeatureContractOf } from "@/core/feature";
import { typeLiteral, typeSchema } from "@/core/intrinsic";
import {
  type Aggregate,
  createAggregate,
  type AggregateFixture,
  type DefinedAggregate,
} from "@/features/aggregate";
import type { Identity, IdentityModelDefinition } from "@/features/identity";
import {
  createNamedProjection,
  type DefinedProjection,
  evaluateProjectionRows,
  type Projection,
  type ProjectionResult,
} from "@/features/projection";
import {
  createDispatchedReplica,
  type DefinedReplica,
  type Replica,
  type ReplicaDispatchImplementation,
} from "@/features/replica";

type Empty = Record<never, never>;
type MaybePromise<Value> = Value | PromiseLike<Value>;
declare const dataDefinition: unique symbol;

export type DataCommand<
  Input extends Readonly<{ id: string }>,
  Result extends object = Empty,
  Failures extends Readonly<Record<string, object>> = Empty,
> = Readonly<{
  Input: Input;
  Result: Result;
  Failures: Failures;
}>;

export type DataEvent<
  Version extends number,
  Value extends object,
  History extends Readonly<Record<number, object>> = Empty,
> = Readonly<{
  Version: Version;
  Data: Value;
  History: History;
}>;

export type DataQueries<Record extends Readonly<{ id: string }>> = Readonly<{
  Text?: keyof Record;
  Vector?: Readonly<{ Field: keyof Record; Dimensions: number }>;
  Graph?: Readonly<{ From: keyof Record; To: keyof Record }>;
  Geo?: keyof Record;
  Analytics?: true;
}>;

export type DataHistory<
  Row extends Readonly<{ id: string }>,
  Commands extends Readonly<Record<string, object>> = Empty,
> = Readonly<{
  Record: Row;
  Commands: Commands;
}>;

type DataQueryDefinition = Readonly<{
  Text?: PropertyKey;
  Vector?: Readonly<{ Field: PropertyKey; Dimensions: number }>;
  Graph?: Readonly<{ From: PropertyKey; To: PropertyKey }>;
  Geo?: PropertyKey;
  Analytics?: true;
}>;

type DataModelInput = Readonly<{
  Name: string;
  Version: number;
  Identity: IdentityModelDefinition;
  Record: Readonly<{ id: string }>;
  Commands: Readonly<
    Record<string, DataCommand<Readonly<{ id: string }>, object, Readonly<Record<string, object>>>>
  >;
  Events: Readonly<Record<string, DataEvent<number, object, Readonly<Record<number, object>>>>>;
  Queries?: DataQueryDefinition;
  History?: Readonly<
    Record<
      number,
      DataHistory<Readonly<{ id: string }>, Readonly<Record<string, Readonly<{ id: string }>>>>
    >
  >;
}>;

export type DataModelDefinition = Readonly<{
  Name: string;
  Version: number;
  Identity: IdentityModelDefinition;
  Record: Readonly<{ id: string }>;
  Commands: Readonly<
    Record<string, DataCommand<Readonly<{ id: string }>, object, Readonly<Record<string, object>>>>
  >;
  Events: Readonly<Record<string, DataEvent<number, object, Readonly<Record<number, object>>>>>;
  Queries: DataQueryDefinition;
  History: Readonly<
    Record<
      number,
      DataHistory<Readonly<{ id: string }>, Readonly<Record<string, Readonly<{ id: string }>>>>
    >
  >;
}>;

/**
 * One event-sourced, searchable, local-first record family.
 *
 * Every record and command input carries `id`, so the same deterministic
 * command can run at the authority and against the local optimistic view.
 */
export type Data<Model extends DataModelInput> = Readonly<
  Omit<Model, "Queries" | "History"> & {
    Queries: Model extends { Queries: infer Queries extends DataQueries<Model["Record"]> }
      ? Queries
      : Empty;
    History: Model extends {
      History: infer History extends Readonly<
        Record<
          number,
          DataHistory<Readonly<{ id: string }>, Readonly<Record<string, Readonly<{ id: string }>>>>
        >
      >;
    }
      ? History
      : Empty;
  }
>;

type InputOf<
  Command extends DataCommand<Readonly<{ id: string }>, object, Readonly<Record<string, object>>>,
> = Command["Input"];
type ResultOf<
  Command extends DataCommand<Readonly<{ id: string }>, object, Readonly<Record<string, object>>>,
> = Command["Result"];
type FailureOf<Failures extends Readonly<Record<string, object>>> = {
  [Name in keyof Failures]: Readonly<{ type: Name; data: Failures[Name] }>;
}[keyof Failures];
type Emission<Model extends DataModelDefinition> = {
  [Name in keyof Model["Events"]]: Readonly<{ [Event in Name]: Model["Events"][Name]["Data"] }>;
}[keyof Model["Events"]];

type VersionTuple<
  Version extends number,
  Values extends readonly unknown[] = [],
> = Values["length"] extends Version
  ? Values
  : VersionTuple<Version, readonly [...Values, unknown]>;
type NextVersion<Version extends number> = [...VersionTuple<Version>, unknown]["length"];
type DataRecordAt<
  Model extends DataModelDefinition,
  Version extends number,
> = Version extends Model["Version"]
  ? Model["Record"]
  : Version extends keyof Model["History"]
    ? Model["History"][Version]["Record"]
    : never;

type CurrentDataCommandInputs<Model extends DataModelDefinition> = Readonly<{
  [Name in keyof Model["Commands"]]: InputOf<Model["Commands"][Name]>;
}>;

type DataCommandInputsAt<
  Model extends DataModelDefinition,
  Version extends number,
> = Version extends Model["Version"]
  ? CurrentDataCommandInputs<Model>
  : Version extends keyof Model["History"]
    ? Readonly<
        Omit<CurrentDataCommandInputs<Model>, keyof Model["History"][Version]["Commands"]> &
          Model["History"][Version]["Commands"]
      >
    : never;

type DataMigrationTarget<Model extends DataModelDefinition, Version extends number> =
  | {
      [Name in keyof DataCommandInputsAt<Model, Version>]: Readonly<{
        command: Extract<Name, string>;
        input: DataCommandInputsAt<Model, Version>[Name];
      }>;
    }[keyof DataCommandInputsAt<Model, Version>]
  | Readonly<{ reject: string }>;

type RequiredDataCommandMigration<
  Model extends DataModelDefinition,
  From extends number,
  Name extends keyof DataCommandInputsAt<Model, From>,
> = Name extends keyof DataCommandInputsAt<Model, Extract<NextVersion<From>, number>>
  ? DataCommandInputsAt<Model, From>[Name] extends DataCommandInputsAt<
      Model,
      Extract<NextVersion<From>, number>
    >[Name]
    ? never
    : Name
  : Name;

type RequiredDataCommandMigrations<Model extends DataModelDefinition, From extends number> = {
  [Name in keyof DataCommandInputsAt<Model, From> as RequiredDataCommandMigration<
    Model,
    From,
    Name
  >]: (
    input: DataCommandInputsAt<Model, From>[Name],
  ) => DataMigrationTarget<Model, Extract<NextVersion<From>, number>>;
};

type OptionalDataCommandMigrations<Model extends DataModelDefinition, From extends number> = {
  [Name in keyof DataCommandInputsAt<Model, From> as RequiredDataCommandMigration<
    Model,
    From,
    Name
  > extends never
    ? Name
    : never]?: (
    input: DataCommandInputsAt<Model, From>[Name],
  ) => DataMigrationTarget<Model, Extract<NextVersion<From>, number>>;
};

type DataMigration<
  Model extends DataModelDefinition,
  From extends Extract<keyof Model["History"], number>,
> = Readonly<{
  record(
    value: Model["History"][From]["Record"],
  ): DataRecordAt<Model, Extract<NextVersion<From>, number>>;
}> &
  (keyof RequiredDataCommandMigrations<Model, From> extends never
    ? Readonly<{
        commands?: OptionalDataCommandMigrations<Model, From>;
      }>
    : Readonly<{
        commands: RequiredDataCommandMigrations<Model, From> &
          OptionalDataCommandMigrations<Model, From>;
      }>);

type DataEvolution<Model extends DataModelDefinition> = keyof Model["History"] extends never
  ? Readonly<{ migrate?: never }>
  : Readonly<{
      migrate: Readonly<{
        [Version in Extract<keyof Model["History"], number>]: DataMigration<Model, Version>;
      }>;
    }>;

type DataCommandContext<
  Model extends DataModelDefinition,
  Name extends keyof Model["Commands"],
> = Readonly<{
  key: string;
  state: Readonly<Model["Record"]>;
  principal: Identity.Principal<Model["Identity"]>;
  input: InputOf<Model["Commands"][Name]>;
  fail(failure: FailureOf<Model["Commands"][Name]["Failures"]>): never;
}>;

type DataDecision<
  Model extends DataModelDefinition,
  Name extends keyof Model["Commands"],
> = Readonly<{
  events: readonly Emission<Model>[];
  result: ResultOf<Model["Commands"][Name]>;
}>;

type DataEventDefinition<
  Model extends DataModelDefinition,
  Name extends keyof Model["Events"],
> = Aggregate.Definition<AuthorityModel<Model>>["events"][Name];

export type DataImplementation<Model extends DataModelDefinition> = Readonly<{
  retention?: "retain" | "clear-on-sign-out";
  state(input: Readonly<{ key: string }>): Model["Record"];
  commands: Readonly<{
    [Name in keyof Model["Commands"]]: (
      input: DataCommandContext<Model, Name>,
    ) => DataDecision<Model, Name>;
  }>;
  events: Readonly<{
    [Name in keyof Model["Events"]]: DataEventDefinition<Model, Name>;
  }>;
  authorize: Readonly<
    {
      read(input: {
        key: string;
        state: Readonly<Model["Record"]>;
        principal: Identity.Principal<Model["Identity"]>;
      }): MaybePromise<boolean>;
      query(input: {
        principal: Identity.Principal<Model["Identity"]>;
      }): Projection.Selection<Model["Record"]>;
    } & {
      [Name in keyof Model["Commands"]]: (input: {
        key: string;
        state: Readonly<Model["Record"]>;
        principal: Identity.Principal<Model["Identity"]>;
        input: InputOf<Model["Commands"][Name]>;
      }) => MaybePromise<boolean>;
    }
  >;
}> &
  DataEvolution<Model>;

type DataAuthorityHistory<Model extends DataModelDefinition> = Readonly<{
  [Version in Extract<keyof Model["History"], number>]: Model["History"][Version]["Record"];
}>;

type AuthorityModel<Model extends DataModelDefinition> = Readonly<{
  Name: `${Model["Name"]}Authority`;
  Key: string;
  State: Model["Record"];
  Principal: Identity.Principal<Model["Identity"]>;
  Commands: Model["Commands"];
  Events: Model["Events"];
  Version: Model["Version"];
  History: DataAuthorityHistory<Model>;
}>;

type AuthorityDefinition<Model extends DataModelDefinition> = DefinedAggregate<
  AuthorityModel<Model>
>;
type AuthorityName<Model extends DataModelDefinition> = `${Model["Name"]}Authority`;

type ProjectionQueries<Model extends DataModelDefinition> = Readonly<{
  Text: Model["Queries"] extends { Text: infer Fields extends PropertyKey }
    ? { [Name in Model["Name"]]: Fields }
    : Empty;
  Vector: Model["Queries"] extends {
    Vector: infer Vector extends Readonly<{ Field: PropertyKey; Dimensions: number }>;
  }
    ? { [Name in Model["Name"]]: Vector }
    : Empty;
  Graph: Model["Queries"] extends {
    Graph: infer Graph extends Readonly<{ From: PropertyKey; To: PropertyKey }>;
  }
    ? { [Name in Model["Name"]]: Graph }
    : Empty;
  Geo: Model["Queries"] extends { Geo: infer Field extends PropertyKey }
    ? { [Name in Model["Name"]]: Field }
    : Empty;
  Analytics: Model["Queries"] extends { Analytics: true }
    ? { [Name in Model["Name"]]: true }
    : Empty;
}>;

type ViewModel<Model extends DataModelDefinition> = Readonly<{
  Name: `${Model["Name"]}Projection`;
  Version: Model["Version"];
  Principal: Identity.Principal<Model["Identity"]>;
  Sources: { [Name in AuthorityName<Model>]: Aggregate.Events<AuthorityDefinition<Model>> };
  Rows: { [Name in Model["Name"]]: Model["Record"] };
  Queries: ProjectionQueries<Model>;
}>;

type ViewDefinition<Model extends DataModelDefinition> = DefinedProjection<ViewModel<Model>>;

type ReplicaCommands<Model extends DataModelDefinition> = Readonly<{
  [Name in keyof Model["Commands"]]: Replica.Command<
    InputOf<Model["Commands"][Name]>,
    ResultOf<Model["Commands"][Name]>
  >;
}>;

type DataReplicaHistory<Model extends DataModelDefinition> = Readonly<{
  [Version in Extract<keyof Model["History"], number>]: Replica.History<
    {
      [Name in Model["Name"]]: readonly Model["History"][Version]["Record"][];
    },
    Model["History"][Version]["Commands"]
  >;
}>;

type LocalModel<Model extends DataModelDefinition> = Readonly<{
  Name: Model["Name"];
  Version: Model["Version"];
  Identity: Model["Identity"];
  Projection: ViewDefinition<Model>;
  ProjectionName: `${Model["Name"]}Projection`;
  Rows: Model["Name"];
  State: { [Name in Model["Name"]]: readonly Model["Record"][] };
  History: DataReplicaHistory<Model>;
  Dependencies: {
    [Name in AuthorityName<Model>]: Aggregate.Reference<AuthorityDefinition<Model>>;
  };
  Commands: ReplicaCommands<Model>;
}>;

type DataFeatureContract<Model extends DataModelDefinition> = Readonly<{
  Features: {
    authority: FeatureContractOf<AuthorityDefinition<Model>>;
    projection: FeatureContractOf<ViewDefinition<Model>>;
    replica: FeatureContractOf<DefinedReplica<LocalModel<Model>>>;
  };
}>;

export type DefinedData<Model extends DataModelDefinition> = Feature<DataFeatureContract<Model>> &
  Readonly<{ readonly [dataDefinition]?: Model }>;

export type DataFixture<Model extends DataModelDefinition> = AggregateFixture<
  AuthorityModel<Model>
> &
  Readonly<{
    query(
      input: Readonly<{
        rows: readonly Model["Record"][];
        principal: Identity.Principal<Model["Identity"]>;
        query: Projection.Query<ViewDefinition<Model>, Model["Name"]>;
      }>,
    ): Promise<ProjectionResult<Model["Record"]>>;
  }>;

type DataModelOf<Definition> =
  Definition extends Readonly<{
    readonly [dataDefinition]?: infer Model extends DataModelDefinition;
  }>
    ? Model
    : never;

export namespace Data {
  export type Command<
    Input extends Readonly<{ id: string }>,
    Result extends object = Empty,
    Failures extends Readonly<Record<string, object>> = Empty,
  > = DataCommand<Input, Result, Failures>;
  export type Event<
    Version extends number,
    Value extends object,
    History extends Readonly<Record<number, object>> = Empty,
  > = DataEvent<Version, Value, History>;
  export type Queries<Record extends Readonly<{ id: string }>> = DataQueries<Record>;
  export type History<
    Record extends Readonly<{ id: string }>,
    Commands extends Readonly<globalThis.Record<string, object>> = Empty,
  > = DataHistory<Record, Commands>;
  export type Definition<Model extends DataModelDefinition> = DataImplementation<Model>;
  export type Client<Definition> =
    DataModelOf<Definition> extends infer Model extends DataModelDefinition
      ? Replica.Client<DefinedReplica<LocalModel<Model>>>
      : never;
  export type Authority<Definition> =
    DataModelOf<Definition> extends infer Model extends DataModelDefinition
      ? Aggregate.Reference<AuthorityDefinition<Model>>
      : never;
  export type State<Definition> =
    DataModelOf<Definition> extends infer Model extends DataModelDefinition
      ? Replica.State<DefinedReplica<LocalModel<Model>>>
      : never;
}

function applyDataEmissions<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
  state: Model["Record"],
  emissions: readonly Emission<Model>[],
): Model["Record"] {
  let current = state;
  for (const emission of emissions) {
    const names = Object.keys(emission);
    if (names.length !== 1) throw new Error("Data event emission must name exactly one event.");
    const name = names[0]!;
    const event = (emission as Readonly<Record<string, object>>)[name]!;
    const implementation = definition.events[name] as Readonly<{
      apply(input: { state: Model["Record"]; event: object }): Model["Record"];
    }>;
    current = implementation.apply({ state: current, event });
  }
  return current;
}

function recordKey(value: Readonly<{ id: string }>): string {
  return value.id;
}

/** Composes Aggregate, Projection, and Replica into one ordinary Feature. */
export function createData<const Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
): DefinedData<Model> {
  return createFeature<DataFeatureContract<Model>>({
    features: {
      authority: createAggregate<AuthorityModel<Model>>(dataAggregateDefinition(definition)),
      projection: createNamedProjection<ViewModel<Model>>(dataProjectionDefinition(definition), {
        sources: () =>
          [typeLiteral<AuthorityName<Model>>()] as unknown as readonly Extract<
            keyof ViewModel<Model>["Sources"],
            string
          >[],
        rows: () =>
          [typeLiteral<Model["Name"]>()] as unknown as readonly Extract<
            keyof ViewModel<Model>["Rows"],
            string
          >[],
        focus: ({ event }) =>
          ({
            [typeLiteral<Model["Name"]>()]: [event.key],
          }) as unknown as Readonly<{
            [Name in keyof ViewModel<Model>["Rows"]]?: readonly string[];
          }>,
      }),
      replica: createDispatchedReplica<LocalModel<Model>>(
        dataReplicaDefinition(definition),
        () =>
          ({
            kind: "record",
            fields: [
              {
                name: "Commands",
                optional: false,
                type: typeSchema<Model["Commands"]>(),
              },
              {
                name: "State",
                optional: false,
                type: {
                  kind: "record",
                  fields: [
                    {
                      name: typeLiteral<Model["Name"]>(),
                      optional: false,
                      type: {
                        kind: "array",
                        element: typeSchema<Model["Record"]>(),
                      },
                    },
                  ],
                },
              },
            ],
          }) as const,
      ),
    },
  }) as DefinedData<Model>;
}

/** Creates the deterministic, infrastructure-free contract surface for one Data model. */
export function createDataFixture<Model extends DataModelDefinition>(
  data: DefinedData<Model>,
  definition: DataImplementation<Model>,
): Promise<DataFixture<Model>> {
  void data;
  return createDataFixtureAsync(definition);
}

async function createDataFixtureAsync<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
): Promise<DataFixture<Model>> {
  const { createAggregateFixture } = await import("@/features/aggregate");
  const authorityDefinition = dataAggregateDefinition(definition);
  const aggregate = createAggregate<AuthorityModel<Model>>(authorityDefinition);
  const fixture = createAggregateFixture(aggregate, authorityDefinition);
  return Object.freeze({
    ...fixture,
    async query(input: Parameters<DataFixture<Model>["query"]>[0]) {
      const scope = definition.authorize.query({ principal: input.principal });
      const visible = evaluateProjectionRows(input.rows, { find: scope });
      const rows = visible.kind === "rows" ? visible.matches.map(({ row }) => row) : [];
      return evaluateProjectionRows(rows, input.query);
    },
  }) as DataFixture<Model>;
}

function dataAggregateDefinition<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
): Aggregate.Definition<AuthorityModel<Model>> {
  const migrations = dataMigrations(definition);
  return {
    state: definition.state,
    commands: definition.commands,
    events: definition.events,
    authorize: definition.authorize,
    ...(migrations === undefined
      ? {}
      : {
          evolve({
            version,
            state,
          }: Readonly<{ version: number; state: object }>): Model["Record"] {
            return migrateDataRecord(definition, version, state);
          },
        }),
  } as unknown as Aggregate.Definition<AuthorityModel<Model>>;
}

function dataProjectionDefinition<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
): Projection.Definition<ViewModel<Model>> {
  return {
    reduce({ event, rows }: Parameters<Projection.Definition<ViewModel<Model>>["reduce"]>[0]) {
      const collection = typeLiteral<Model["Name"]>();
      const records = (rows as Readonly<Record<string, readonly Model["Record"][]>>)[collection]!;
      const current =
        records.find((record) => record.id === event.key) ?? definition.state({ key: event.key });
      const implementations = definition.events as Readonly<
        Record<
          string,
          Readonly<{
            apply(input: { state: Model["Record"]; event: object }): Model["Record"];
          }>
        >
      >;
      const implementation = implementations[event.type as string]!;
      return [
        {
          upsert: {
            [collection]: implementation.apply({
              state: current,
              event: event.data,
            }),
          },
        },
      ] as unknown as readonly Projection.Mutation<ViewModel<Model>>[];
    },
    authorize({ principal }: Readonly<{ principal: Identity.Principal<Model["Identity"]> }>) {
      const collection = typeLiteral<Model["Name"]>();
      return {
        [collection]: definition.authorize.query({ principal }),
      };
    },
  } as unknown as Projection.Definition<ViewModel<Model>>;
}

function dataReplicaDefinition<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
): ReplicaDispatchImplementation<LocalModel<Model>> {
  return {
    ...(definition.retention === undefined ? {} : { retention: definition.retention }),
    state: ({ name }: Readonly<{ name: Model["Name"] }>) =>
      ({ [name]: [] }) as unknown as LocalModel<Model>["State"],
    dispatch: {
      async commit(command, context) {
        const key = recordKey(context.input as Readonly<{ id: string }>);
        const dependencies = context.dependencies as Readonly<Record<string, DependencyContract>>;
        const authorityName = Object.keys(dependencies)[0];
        if (authorityName === undefined)
          throw new Error("Data authority Dependency is unavailable.");
        const authority = dependencies[authorityName];
        if (authority === undefined) throw new Error("Data authority Dependency is unavailable.");
        const outcome = await dispatchDependency<
          | Readonly<{ status: "succeeded"; value: object }>
          | Readonly<{ status: "failed"; failure: Readonly<{ type: string }> }>
        >(authority, command, {
          key,
          principal: context.principal,
          input: context.input,
          idempotencyKey: context.idempotencyKey,
        });
        if (outcome.status === "failed") throw new Error(outcome.failure.type);
        return outcome.value;
      },
      optimistic(command, context) {
        const state = context.state as Readonly<Record<string, readonly Model["Record"][]>>;
        const collectionName = context.name;
        const key = recordKey(context.input as Readonly<{ id: string }>);
        const collection = state[collectionName] ?? [];
        const current = collection.find((record) => record.id === key) ?? definition.state({ key });
        const commands = definition.commands as Readonly<
          Record<
            string,
            (input: {
              key: string;
              state: Model["Record"];
              principal: Identity.Principal<Model["Identity"]>;
              input: object;
              fail(failure: object): never;
            }) => DataDecision<Model, keyof Model["Commands"]>
          >
        >;
        const decide = commands[command as string]!;
        const decision = decide({
          key,
          state: current,
          principal: context.principal,
          input: context.input,
          fail(failure: object): never {
            throw failure;
          },
        });
        const next = applyDataEmissions(definition, current, decision.events);
        const records: Model["Record"][] = [];
        for (const record of collection) {
          if (record.id !== key) records.push(record);
        }
        const scope = definition.authorize.query({ principal: context.principal });
        const visibility = evaluateProjectionRows([next], { find: scope });
        if (visibility.kind === "rows" && visibility.matches.length === 1) {
          records.push(next);
        }
        return {
          [collectionName]: records,
        } as unknown as LocalModel<Model>["State"];
      },
    },
    migrate: dataReplicaMigrations(definition),
  };
}

type RuntimeDataMigration = Readonly<{
  record(value: object): object;
  commands?: Readonly<
    Record<
      string,
      (input: object) => Readonly<{ command: string; input: object }> | { reject: string }
    >
  >;
}>;

function dataMigrations<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
): Readonly<Record<number, RuntimeDataMigration>> | undefined {
  return (definition as Readonly<{ migrate?: Readonly<Record<number, RuntimeDataMigration>> }>)
    .migrate;
}

function migrateDataRecord<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
  version: number,
  value: object,
): Model["Record"] {
  const migrations = dataMigrations(definition);
  if (migrations === undefined) throw new Error("Data record migration is unavailable.");
  let current = value;
  let currentVersion = version;
  let migration = migrations[currentVersion];
  while (migration !== undefined) {
    current = migration.record(current);
    currentVersion += 1;
    migration = migrations[currentVersion];
  }
  return current as Model["Record"];
}

function dataReplicaMigrations<Model extends DataModelDefinition>(
  definition: DataImplementation<Model>,
): ReplicaDispatchImplementation<LocalModel<Model>>["migrate"] {
  const migrations = dataMigrations(definition);
  if (migrations === undefined) {
    return {} as ReplicaDispatchImplementation<LocalModel<Model>>["migrate"];
  }
  const result: Record<
    number,
    Readonly<{
      state(value: object): object;
      commands?: RuntimeDataMigration["commands"];
    }>
  > = {};
  for (const name of Object.keys(migrations)) {
    const version = name as unknown as number;
    const migration = migrations[version];
    if (migration !== undefined) {
      result[version] = {
        state(value: object): object {
          const previous = value as Readonly<Record<string, readonly object[]>>;
          const collection = Object.keys(previous)[0];
          if (collection === undefined) throw new Error("Data Replica state has no collection.");
          const records = previous[collection] ?? [];
          const next: object[] = [];
          for (const record of records) next.push(migration.record(record));
          return { [collection]: next };
        },
        ...(migration.commands === undefined ? {} : { commands: migration.commands }),
      };
    }
  }
  return result as ReplicaDispatchImplementation<LocalModel<Model>>["migrate"];
}
