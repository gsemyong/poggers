import { cloneData, dataKind, equalData } from "@/core/data";
import {
  dependencyInvocation,
  dispatchDependency,
  type Dependency,
  type DependencyImplementations,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { typeKeys, typeLiteral, typeSchema, type TypeSchema } from "@/core/intrinsic";
import { distinctStream, filterStream, mapStream } from "@/core/stream";
import type {
  Identity,
  IdentityAuthorization,
  IdentityModelDefinition,
  IdentitySession,
} from "@/features/identity";
import type { Projection, ProjectionResult } from "@/features/projection";
import {
  browserReplicaCoordinationProvider,
  browserReplicaStoreProvider,
  createMemoryReplicaCoordination,
  createMemoryReplicaStore,
  type ReplicaCoordination,
  type ReplicaStore,
  type ReplicaStoreChange,
  type ReplicaStoreCommand,
  type ReplicaStoreDelta,
  type ReplicaStoreRejection,
  type ReplicaStoreState,
} from "@/features/replica/store";
import {
  getHttpValue,
  type HttpRequest,
  type HttpResponse,
  type HttpServer,
  type ServerProcess,
} from "@/platforms/server";
import type {
  BrowserMainThread,
  Identifiers,
  Scheduler,
  WebDependencyProvider,
} from "@/platforms/web";

type Empty = Record<never, never>;
type MaybePromise<Value> = Value | PromiseLike<Value>;
declare const replicaDefinition: unique symbol;

export type ReplicaCommand<Input extends object, Result extends object = Empty> = Readonly<{
  Input: Input;
  Result: Result;
}>;

/** One portable materialized change carried by every Replication realization. */
export type ReplicationChange =
  | Readonly<{ row: string; upsert: Readonly<{ id: string }> }>
  | Readonly<{ row: string; remove: Readonly<{ id: string }> }>;

/**
 * Versioned authoritative progress shared by in-process, browser, and future
 * Replication transports. Product row meaning remains owned by the Replica.
 */
export type ReplicationEnvelope = Readonly<{
  version: number;
  schema?: string;
  sequence: number;
  observations: Readonly<Record<string, string>>;
  invocations: readonly string[];
  cursor: string;
  snapshot?: object;
  changes: readonly ReplicationChange[];
}>;

/** One admitted command result plus authoritative progress observed afterward. */
export type ReplicationCommandResult = Readonly<{
  result: object;
  pull: ReplicationEnvelope;
}>;

/** Resumable command and change transport required by a local Replica. */
export type Replication = Dependency<{
  Operations: {
    pull(input: { replica: string; after?: number }): Promise<ReplicationEnvelope>;
    command(input: {
      replica: string;
      command: string;
      value: object;
      idempotencyKey: string;
      after?: number;
    }): Promise<ReplicationCommandResult>;
    changes(input: {
      replica: string;
      observations: Readonly<Record<string, string>>;
      sequence: number;
      signal?: AbortSignal;
    }): Promise<AsyncIterable<ReplicationEnvelope>>;
  };
}>;

export type ReplicaHistory<
  State extends object,
  Commands extends Readonly<Record<string, object>> = Empty,
> = Readonly<{
  State: State;
  Commands: Commands;
}>;

type ReplicaHistoryDefinition = ReplicaHistory<object, Readonly<Record<string, object>>>;

type ReplicaModelInput = Readonly<{
  Name: string;
  Version: number;
  Identity: IdentityModelDefinition;
  Projection: object;
  Rows: PropertyKey;
  Dependencies?: Readonly<Record<string, object>>;
  Commands: Readonly<Record<string, ReplicaCommand<object, object>>>;
  History?: Readonly<Record<number, ReplicaHistoryDefinition>>;
}>;

export type ReplicaModelDefinition = Readonly<{
  Name: string;
  Version: number;
  Identity: IdentityModelDefinition;
  Projection: object;
  ProjectionName: string;
  Rows: PropertyKey;
  State: object;
  Dependencies: Readonly<Record<string, object>>;
  Commands: Readonly<Record<string, ReplicaCommand<object, object>>>;
  History: Readonly<Record<number, ReplicaHistoryDefinition>>;
}>;

type ReplicaProjectionRows<Model extends ReplicaModelInput> = Projection.Rows<Model["Projection"]>;

type ReplicaProjectionState<Model extends ReplicaModelInput> = Readonly<
  Pick<ReplicaProjectionRows<Model>, Extract<Model["Rows"], keyof ReplicaProjectionRows<Model>>>
>;

/** The semantic model of one authorized local projection and its optimistic commands. */
export type Replica<Model extends ReplicaModelInput> = Readonly<
  Extract<Model["Rows"], keyof Model["Commands"]> extends never
    ? Omit<Model, "Dependencies" | "History"> & {
        State: ReplicaProjectionState<Model>;
        ProjectionName: Projection.Name<Model["Projection"]>;
        Dependencies: Model extends {
          Dependencies: infer Dependencies extends Readonly<Record<string, object>>;
        }
          ? Dependencies
          : Empty;
        History: Model extends {
          History: infer History extends Readonly<Record<number, object>>;
        }
          ? History
          : Empty;
      }
    : never
>;

type InputOf<Command extends ReplicaCommand<object, object>> = Command["Input"];
type ResultOf<Command extends ReplicaCommand<object, object>> = Command["Result"];
type PrincipalOf<Model extends ReplicaModelDefinition> = Identity.Principal<Model["Identity"]>;
type SessionOf<Model extends ReplicaModelDefinition> = IdentitySession<Model["Identity"]>;
type VersionTuple<
  Version extends number,
  Values extends readonly unknown[] = [],
> = Values["length"] extends Version
  ? Values
  : VersionTuple<Version, readonly [...Values, unknown]>;
type NextVersion<Version extends number> = [...VersionTuple<Version>, unknown]["length"];
type StateAt<
  Model extends ReplicaModelDefinition,
  Version extends number,
> = Version extends Model["Version"]
  ? Model["State"]
  : Version extends keyof Model["History"]
    ? Model["History"][Version]["State"]
    : never;

type CurrentCommandInputs<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in keyof Model["Commands"]]: InputOf<Model["Commands"][Name]>;
}>;

type CommandInputsAt<
  Model extends ReplicaModelDefinition,
  Version extends number,
> = Version extends Model["Version"]
  ? CurrentCommandInputs<Model>
  : Version extends keyof Model["History"]
    ? Readonly<
        Omit<CurrentCommandInputs<Model>, keyof Model["History"][Version]["Commands"]> &
          Model["History"][Version]["Commands"]
      >
    : never;

type ReplicaPendingAt<Model extends ReplicaModelDefinition, Version extends number> = {
  [Name in keyof CommandInputsAt<Model, Version>]: Readonly<{
    id: string;
    command: Extract<Name, string>;
    input: CommandInputsAt<Model, Version>[Name];
  }>;
}[keyof CommandInputsAt<Model, Version>];

export type ReplicaPending<Model extends ReplicaModelDefinition> = ReplicaPendingAt<
  Model,
  Model["Version"]
>;

export type ReplicaRejection<Model extends ReplicaModelDefinition> = Readonly<{
  pending: ReplicaPending<Model>;
  message: string;
}>;

export type ReplicaStatus =
  | "signed-out"
  | "loading"
  | "synchronizing"
  | "synchronized"
  | "offline"
  | "upgrade-required";

/** The complete observable local state: authority data with pending intent replayed over it. */
export type ReplicaState<Model extends ReplicaModelDefinition> = Readonly<{
  status: ReplicaStatus;
  cursor?: string;
  compatibility?: Readonly<{
    client: string;
    authority: string;
  }>;
  error?: string;
  data?: Model["State"];
  pending: readonly ReplicaPending<Model>[];
  rejected: readonly ReplicaRejection<Model>[];
}>;

type ReplicaCommandContext<
  Model extends ReplicaModelDefinition,
  Name extends keyof Model["Commands"],
> = Readonly<{
  principal: PrincipalOf<Model>;
  input: InputOf<Model["Commands"][Name]>;
  idempotencyKey: string;
  dependencies: Model["Dependencies"];
}>;

type ReplicaOptimisticContext<
  Model extends ReplicaModelDefinition,
  Name extends keyof Model["Commands"],
> = Readonly<{
  name: Model["Name"];
  state: Readonly<Model["State"]>;
  principal: PrincipalOf<Model>;
  input: InputOf<Model["Commands"][Name]>;
}>;

type MigrationTarget<Model extends ReplicaModelDefinition, Version extends number> =
  | {
      [Name in keyof CommandInputsAt<Model, Version>]: Readonly<{
        command: Extract<Name, string>;
        input: CommandInputsAt<Model, Version>[Name];
      }>;
    }[keyof CommandInputsAt<Model, Version>]
  | Readonly<{ reject: string }>;

type RequiredCommandMigration<
  Model extends ReplicaModelDefinition,
  From extends number,
  Name extends keyof CommandInputsAt<Model, From>,
> = Name extends keyof CommandInputsAt<Model, Extract<NextVersion<From>, number>>
  ? CommandInputsAt<Model, From>[Name] extends CommandInputsAt<
      Model,
      Extract<NextVersion<From>, number>
    >[Name]
    ? never
    : Name
  : Name;

type RequiredCommandMigrations<Model extends ReplicaModelDefinition, From extends number> = {
  [Name in keyof CommandInputsAt<Model, From> as RequiredCommandMigration<Model, From, Name>]: (
    input: CommandInputsAt<Model, From>[Name],
  ) => MigrationTarget<Model, Extract<NextVersion<From>, number>>;
};

type OptionalCommandMigrations<Model extends ReplicaModelDefinition, From extends number> = {
  [Name in keyof CommandInputsAt<Model, From> as RequiredCommandMigration<
    Model,
    From,
    Name
  > extends never
    ? Name
    : never]?: (
    input: CommandInputsAt<Model, From>[Name],
  ) => MigrationTarget<Model, Extract<NextVersion<From>, number>>;
};

type ReplicaMigration<
  Model extends ReplicaModelDefinition,
  From extends Extract<keyof Model["History"], number>,
> = Readonly<{
  state(state: Model["History"][From]["State"]): StateAt<Model, Extract<NextVersion<From>, number>>;
}> &
  (keyof RequiredCommandMigrations<Model, From> extends never
    ? Readonly<{
        commands?: OptionalCommandMigrations<Model, From>;
      }>
    : Readonly<{
        commands: RequiredCommandMigrations<Model, From> & OptionalCommandMigrations<Model, From>;
      }>);

export type ReplicaImplementation<Model extends ReplicaModelDefinition> = Readonly<{
  retention?: "retain" | "clear-on-sign-out";
  state(input: Readonly<{ name: Model["Name"] }>): Model["State"];
  commands: Readonly<{
    [Name in keyof Model["Commands"]]: Readonly<{
      commit(
        context: ReplicaCommandContext<Model, Name>,
      ): MaybePromise<ResultOf<Model["Commands"][Name]>>;
    }>;
  }>;
  optimistic: Readonly<{
    [Name in keyof Model["Commands"]]: (
      context: ReplicaOptimisticContext<Model, Name>,
    ) => Model["State"];
  }>;
  migrate: Readonly<{
    [Version in Extract<keyof Model["History"], number>]: ReplicaMigration<Model, Version>;
  }>;
}>;

export type ReplicaDispatchImplementation<Model extends ReplicaModelDefinition> = Readonly<{
  retention?: "retain" | "clear-on-sign-out";
  state(input: Readonly<{ name: Model["Name"] }>): Model["State"];
  dispatch: Readonly<{
    commit(
      command: Extract<keyof Model["Commands"], string>,
      context: ReplicaCommandContext<Model, keyof Model["Commands"]>,
    ): MaybePromise<object>;
    optimistic(
      command: Extract<keyof Model["Commands"], string>,
      context: ReplicaOptimisticContext<Model, keyof Model["Commands"]>,
    ): Model["State"];
  }>;
  migrate: ReplicaImplementation<Model>["migrate"];
}>;

type ReplicaRuntimeImplementation<Model extends ReplicaModelDefinition> =
  ReplicaDispatchImplementation<Model>;

type ReplicaPull<Model extends ReplicaModelDefinition> = Readonly<
  Omit<ReplicationEnvelope, "version" | "snapshot" | "changes"> & {
    version: Model["Version"];
    snapshot?: Model["State"];
    changes: readonly ReplicaChange<Model>[];
  }
>;

type ReplicaChange<Model extends ReplicaModelDefinition> = {
  [Name in Extract<keyof Model["State"], string>]:
    | Readonly<{
        row: Name;
        upsert: Readonly<{ id: string }> &
          (Model["State"][Name] extends readonly (infer Row)[] ? Row : never);
      }>
    | Readonly<{ row: Name; remove: Readonly<{ id: string }> }>;
}[Extract<keyof Model["State"], string>];

type ReplicaCommandResponse<Model extends ReplicaModelDefinition> = Readonly<
  Omit<ReplicationCommandResult, "pull"> & {
    pull: ReplicaPull<Model>;
  }
>;

type ReplicaAuthorityWire<Model extends ReplicaModelDefinition> = Readonly<
  {
    pull(input: { principal: PrincipalOf<Model>; after?: string }): Promise<ReplicaPull<Model>>;
  } & {
    [Name in keyof Model["Commands"]]: (
      input: Readonly<{
        principal: PrincipalOf<Model>;
        input: object;
        idempotencyKey: string;
      }>,
    ) => Promise<ReplicaCommandResponse<Model>>;
  }
>;

type ReplicaAuthority<Model extends ReplicaModelDefinition> = Dependency<{
  Operations: ReplicaAuthorityWire<Model>;
}>;

type ReplicaClientCommandOperation<Command extends ReplicaCommand<object, object>> = (
  input: Command["Input"],
) => Readonly<{ id: string }>;

type ReplicaClientOperations<Model extends ReplicaModelDefinition> = Readonly<
  {
    state(input?: never): Promise<ReplicaState<Model>>;
    synchronize(input?: never): Promise<ReplicaState<Model>>;
    retry(input: { id: string }): Promise<ReplicaState<Model>>;
    dismiss(input: { id: string }): Promise<ReplicaState<Model>>;
    subscribe(receive: (state: ReplicaState<Model>) => void): Disposable;
  } & {
    [Name in keyof Model["State"]]: (
      input: Projection.Query<Model["Projection"], Name>,
    ) => Promise<
      ProjectionResult<
      Model["State"][Name] extends readonly (infer Row extends Readonly<{ id: string }>)[]
        ? Row
        : never
      >
    >;
  } & {
    [Name in keyof Model["Commands"]]: ReplicaClientCommandOperation<Model["Commands"][Name]>;
  }
>;

export type ReplicaClient<Model extends ReplicaModelDefinition> = Dependency<{
  Operations: ReplicaClientOperations<Model>;
}>;

type IdentityServerRequirement<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in Model["Identity"]["Name"]]: Identity.Service<Model["Identity"]>;
}>;

type IdentityBrowserRequirement<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in Model["Identity"]["Name"]]: Identity.Client<Model["Identity"]>;
}>;

type ReplicaProjectionRequirement<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in Projection.Name<Model["Projection"]>]: Projection.Reference<Model["Projection"]>;
}>;

type ReplicaServerRequirements<Model extends ReplicaModelDefinition> = Readonly<
  Model["Dependencies"] &
    IdentityServerRequirement<Model> & {
      http: HttpServer;
    } & ReplicaProjectionRequirement<Model>
>;

type ReplicaBrowserRequirements<Model extends ReplicaModelDefinition> = Readonly<
  IdentityBrowserRequirement<Model> & {
    identifiers: Identifiers;
    replication: Replication;
    replicaCoordination: ReplicaCoordination;
    replicaStore: ReplicaStore;
    scheduler: Scheduler;
  }
>;

type ReplicaProvision<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in Model["Name"]]: ReplicaAuthority<Model>;
}>;

type ReplicaBrowserProvision<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in Model["Name"]]: ReplicaClient<Model>;
}>;

type ReplicaFeatureContract<Model extends ReplicaModelDefinition> = Readonly<{
  Providers: {
    web: {
      replication: WebDependencyProvider<Replication>;
      replicaCoordination: WebDependencyProvider<ReplicaCoordination>;
      replicaStore: WebDependencyProvider<ReplicaStore>;
    };
  };
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: ReplicaServerRequirements<Model>;
      Provides: ReplicaProvision<Model>;
    };
    browser: {
      Environment: BrowserMainThread;
      Requires: ReplicaBrowserRequirements<Model>;
      Provides: ReplicaBrowserProvision<Model>;
    };
  };
}>;

export type DefinedReplica<Model extends ReplicaModelDefinition> = Feature<
  ReplicaFeatureContract<Model>
> &
  Readonly<{ readonly [replicaDefinition]?: Model }>;

type ReplicaModelOf<Definition> =
  Definition extends Readonly<{
    readonly [replicaDefinition]?: infer Model extends ReplicaModelDefinition;
  }>
    ? Model
    : never;

export namespace Replica {
  export type Command<Input extends object, Result extends object = Empty> = ReplicaCommand<
    Input,
    Result
  >;
  export type History<
    State extends object,
    Commands extends Readonly<Record<string, object>> = Empty,
  > = ReplicaHistory<State, Commands>;
  export type Definition<Model extends ReplicaModelDefinition> = ReplicaImplementation<Model>;
  export type Client<Definition> =
    ReplicaModelOf<Definition> extends infer Model extends ReplicaModelDefinition
      ? ReplicaClient<Model>
      : never;
  export type State<Definition> =
    ReplicaModelOf<Definition> extends infer Model extends ReplicaModelDefinition
      ? ReplicaState<Model>
      : never;
}

/** @internal Web realization of Replica's semantic transport Dependency. */
export const browserReplicationProvider: WebDependencyProvider<Replication> = {
  requirements: {},
  development({ request }) {
    const json = async <Value>(input: Parameters<typeof request>[0]): Promise<Value> => {
      const response = await request(input);
      if (!response.ok) {
        const failure = (await response.json().catch(() => ({}))) as Readonly<{
          message?: string;
        }>;
        const error = new Error(
          failure.message ?? `Replication request failed (${response.status}).`,
        );
        if (response.status === 401) error.name = "ReplicationAuthenticationRequired";
        else if (response.status >= 400 && response.status < 500) {
          error.name = "ReplicationRejected";
        }
        throw error;
      }
      return (await response.json()) as Value;
    };
    return Object.freeze({
      pull({
        input,
      }: Readonly<{
        input: Parameters<Replication["pull"]>[0];
      }>): Promise<ReplicationEnvelope> {
        const query =
          input.after === undefined ? "" : `?after=${encodeURIComponent(`${input.after}`)}`;
        return json<ReplicationEnvelope>({ path: `/api/replicas/${input.replica}${query}` });
      },
      command({
        input,
      }: Readonly<{
        input: Parameters<Replication["command"]>[0];
      }>): Promise<ReplicationCommandResult> {
        return json<ReplicationCommandResult>({
          path: `/api/replicas/${input.replica}/${input.command}`,
          method: "POST",
          body: JSON.stringify(input.value),
          headers: {
            "x-kit-command": input.idempotencyKey,
            ...(input.after === undefined ? {} : { "x-kit-after": `${input.after}` }),
          },
        });
      },
      async changes({
        input,
      }: Readonly<{
        input: Parameters<Replication["changes"]>[0];
      }>): Promise<AsyncIterable<ReplicationEnvelope>> {
        const response = await request({
          path: `/api/replicas/${input.replica}/changes?after=${encodeURIComponent(
            JSON.stringify(input.observations),
          )}&sequence=${input.sequence}`,
          signal: input.signal,
        });
        if (!response.ok) {
          throw new Error(`Replication change stream failed (${response.status}).`);
        }
        if (!response.body) throw new Error("Replication change stream has no body.");
        return replicaWebRecords<ReplicationEnvelope>(response.body);
      },
    });
  },
};

async function* replicaWebRecords<Value>(body: ReadableStream<Uint8Array>): AsyncIterable<Value> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line) yield JSON.parse(line) as Value;
        newline = buffered.indexOf("\n");
      }
      if (!done) continue;
      buffered += decoder.decode();
      if (buffered) yield JSON.parse(buffered) as Value;
      return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Defines one authorized local-first Replica over existing semantic Dependencies. */
export function createReplica<const Model extends ReplicaModelDefinition>(
  definition: ReplicaImplementation<Model>,
): DefinedReplica<Model> {
  return createReplicaRuntime(
    replicaDispatchImplementation(definition),
    () => ({
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
          type: typeSchema<Model["State"]>(),
        },
      ],
    }),
    undefined,
  );
}

/** @internal Composite Feature-factory entry point; not part of the package surface. */
export function createDispatchedReplica<const Model extends ReplicaModelDefinition>(
  definition: ReplicaDispatchImplementation<Model>,
  schema: () => TypeSchema,
): DefinedReplica<Model> {
  return createReplicaRuntime(definition, schema, true);
}

function createReplicaRuntime<const Model extends ReplicaModelDefinition>(
  definition: ReplicaRuntimeImplementation<Model>,
  schema: () => TypeSchema,
  singleRow = false,
): DefinedReplica<Model> {
  return createFeature<ReplicaFeatureContract<Model>>({
    providers: {
      web: {
        replication: browserReplicationProvider,
        replicaCoordination: browserReplicaCoordinationProvider,
        replicaStore: browserReplicaStoreProvider,
      },
    },
    programs: {
      server: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const identityName = typeLiteral<Model["Identity"]["Name"]>();
          const projectionName = typeLiteral<Model["ProjectionName"]>();
          const rowNames = singleRow
            ? ([name] as unknown as readonly Extract<keyof Model["State"], string>[])
            : typeKeys<Model["State"]>();
          const modelDependencies = replicaModelDependencies<Model>(
            dependencies,
            identityName,
            projectionName,
          );
          const protocolSchema = JSON.stringify(schema());
          const authority = replicaAuthority(
            dependencies[projectionName],
            rowNames,
            (operation, context) =>
              definition.dispatch.commit(
                operation as Extract<keyof Model["Commands"], string>,
                context,
              ),
            modelDependencies,
            typeLiteral<Model["Version"]>(),
            protocolSchema,
          );
          const path = `/api/replicas/${name}`;
          const route = dependencies.http.route({
            path,
            handle: replicaHttpHandler(
              authority,
              replicaIdentity<Model>(dependencies, identityName),
              path,
            ),
          });
          return {
            [name]: Object.freeze({
              [dependencyInvocation](operation: string, input: object) {
                if (operation === "pull") {
                  return authority.pull(
                    input as Parameters<ReplicaAuthorityWire<Model>["pull"]>[0],
                  );
                }
                return authority.command(operation, input, 0);
              },
              [Symbol.dispose]: () => route[Symbol.dispose](),
            }),
          } as unknown as DependencyImplementations<ReplicaProvision<Model>>;
        },
      },
      browser: {
        async start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const identityName = replicaBrowserIdentityName(dependencies);
          const initial = definition.state({ name });
          const rowNames = Object.keys(initial) as unknown as readonly Extract<
            keyof Model["State"],
            string
          >[];
          const controller = new ReplicaController(
            name,
            replicaImplementationVersion(definition.migrate),
            definition.retention ?? "retain",
            definition,
            rowNames,
            dependencies,
            (dependencies as Readonly<Record<string, object>>)[identityName] as Identity.Client<
              Model["Identity"]
            >,
            initial,
          );
          await controller.start();
          const operations = new Map<string, (context: Readonly<{ input: unknown }>) => unknown>();
          const implementation = new Proxy(
            {
              [Symbol.asyncDispose]: () => controller[Symbol.asyncDispose](),
            },
            {
              get(target, property, receiver) {
                if (typeof property !== "string") {
                  return Reflect.get(target, property, receiver);
                }
                let operation = operations.get(property);
                if (!operation) {
                  operation = ({ input }) => controller.invoke(property, input);
                  operations.set(property, operation);
                }
                return operation;
              },
            },
          );
          return {
            [name]: implementation,
          } as unknown as DependencyImplementations<ReplicaBrowserProvision<Model>>;
        },
      },
    },
  }) as DefinedReplica<Model>;
}

function replicaDispatchImplementation<Model extends ReplicaModelDefinition>(
  definition: ReplicaImplementation<Model>,
): ReplicaDispatchImplementation<Model> {
  return {
    state: definition.state,
    dispatch: {
      commit(command, context) {
        const operation = command as string;
        const commands = definition.commands as Readonly<
          Record<
            string,
            Readonly<{
              commit(
                value: ReplicaCommandContext<Model, keyof Model["Commands"]>,
              ): MaybePromise<object>;
            }>
          >
        >;
        const implementation = commands[operation];
        if (implementation === undefined) {
          throw new ReplicaError("unknown-command", `Unknown command ${operation}.`);
        }
        return implementation.commit(context);
      },
      optimistic(command, context) {
        const operation = command as string;
        const optimistic = definition.optimistic as Readonly<
          Record<
            string,
            (value: ReplicaOptimisticContext<Model, keyof Model["Commands"]>) => Model["State"]
          >
        >;
        const implementation = optimistic[operation];
        if (implementation === undefined) return context.state;
        return implementation(context);
      },
    },
    migrate: definition.migrate,
  };
}

function replicaImplementationVersion(migrate: Readonly<Record<number, unknown>>): number {
  let version = 1;
  while (migrate[version] !== undefined) version += 1;
  for (const candidate of Object.keys(migrate)) {
    if (Number(candidate) >= version) {
      throw new Error("Replica migrations must form one adjacent history.");
    }
  }
  return version;
}

function replicaBrowserIdentityName(dependencies: Readonly<Record<string, object>>): string {
  const identities = [];
  for (const name of Object.keys(dependencies)) {
    if (
      name !== "identifiers" &&
      name !== "replication" &&
      name !== "replicaCoordination" &&
      name !== "replicaStore" &&
      name !== "scheduler"
    ) {
      identities.push(name);
    }
  }
  if (identities.length !== 1) {
    throw new Error("Replica browser Programs require exactly one Identity Dependency.");
  }
  return identities[0]!;
}

function replicaModelDependencies<Model extends ReplicaModelDefinition>(
  dependencies: ReplicaServerRequirements<Model>,
  identityName: string,
  projectionName: string,
): Model["Dependencies"] {
  const selected: Record<string, object> = {};
  for (const name of Object.keys(dependencies)) {
    if (name !== identityName && name !== projectionName && name !== "http") {
      selected[name] = dependencies[name] as object;
    }
  }
  return selected as Model["Dependencies"];
}

function replicaIdentity<Model extends ReplicaModelDefinition>(
  dependencies: Readonly<Record<string, object>>,
  name: string,
): Identity.Service<Model["Identity"]> {
  const identity = dependencies[name];
  if (identity === undefined) throw new Error("Replica Identity is unavailable.");
  return identity as Identity.Service<Model["Identity"]>;
}

function replicaAuthority<Model extends ReplicaModelDefinition>(
  projection: Projection.Reference<Model["Projection"]>,
  rowNames: readonly Extract<keyof Model["State"], string>[],
  commit: (
    operation: string,
    context: ReplicaCommandContext<Model, keyof Model["Commands"]>,
  ) => MaybePromise<object>,
  dependencies: Model["Dependencies"],
  version: Model["Version"],
  schema: string,
): Readonly<{
  pull(input: {
    principal: PrincipalOf<Model>;
    after?: number;
    metadata?: boolean;
  }): Promise<ReplicaPull<Model>>;
  observe(input: {
    principal: PrincipalOf<Model>;
    after: Readonly<Record<string, string>>;
    sequence: number;
  }): Promise<AsyncIterable<ReplicaPull<Model>>>;
  command(operation: string, input: object, after?: number): Promise<ReplicaCommandResponse<Model>>;
}> {
  const pull = async (input: {
    principal: PrincipalOf<Model>;
    after?: number;
    metadata?: boolean;
  }): Promise<ReplicaPull<Model>> => {
    const current = await dispatchDependency<{
      revision: number;
      observations: Readonly<Record<string, string>>;
      invocations: readonly string[];
      snapshot?: Model["State"];
      changes: readonly ReplicaChange<Model>[];
    }>(projection, "$synchronize", {
      principal: input.principal,
      rows: rowNames,
      ...(input.after === undefined ? {} : { after: input.after }),
    });
    return {
      version,
      ...(input.metadata ? { schema } : {}),
      sequence: current.revision,
      observations: current.observations,
      invocations: current.invocations,
      cursor: `${current.revision}`,
      ...(current.snapshot === undefined ? {} : { snapshot: current.snapshot }),
      changes: current.changes,
    };
  };
  return Object.freeze({
    pull,
    async observe({ principal, after, sequence }) {
      const source = await dispatchDependency<AsyncIterable<Readonly<{ cursor: string }>>>(
        projection,
        "observe",
        { principal, after },
      );
      let current = sequence;
      const observed = mapStream(source, async () => {
        const previous = current;
        const change = await pull({ principal, after: current });
        if (change.sequence > current) current = change.sequence;
        return {
          change,
          advanced:
            change.sequence > previous &&
            (change.snapshot !== undefined ||
              change.changes.length > 0 ||
              change.invocations.length > 0),
        };
      });
      return distinctStream(
        mapStream(
          filterStream(observed, ({ advanced }) => advanced),
          ({ change }) => change,
        ),
        (change) => change.sequence,
      );
    },
    async command(operation, received, after?: number) {
      const request = received as Readonly<{
        principal: PrincipalOf<Model>;
        input: object;
        idempotencyKey: string;
      }>;
      const result = await commit(operation, {
        principal: request.principal,
        input: request.input,
        idempotencyKey: request.idempotencyKey,
        dependencies,
      });
      return {
        result,
        pull: await pull({ principal: request.principal, after }),
      };
    },
  });
}

function replicaHttpHandler<Model extends ReplicaModelDefinition>(
  authority: ReturnType<typeof replicaAuthority<Model>>,
  identity: Identity.Service<Model["Identity"]>,
  path: string,
): (request: HttpRequest) => Promise<HttpResponse> {
  return async (request) => {
    try {
      const principal = await identity.authenticate({
        cookie: getHttpValue(request.headers, { name: "cookie" }),
      });
      if (!principal) throw new ReplicaError("unauthenticated", "Authentication is required.");
      if (request.method === "GET" && request.path === path) {
        const after = getHttpValue(request.query, { name: "after" });
        return replicaJson(
          await authority.pull(
            after
              ? {
                  principal: principal as PrincipalOf<Model>,
                  after: replicaSequence(after),
                  metadata: true,
                }
              : { principal: principal as PrincipalOf<Model>, metadata: true },
          ),
        );
      }
      if (request.method === "GET" && request.path === `${path}/changes`) {
        const changes = await authority.observe({
          principal: principal as PrincipalOf<Model>,
          after: replicaObservations(getHttpValue(request.query, { name: "after" })),
          sequence: replicaSequence(getHttpValue(request.query, { name: "sequence" }) ?? "0"),
        });
        return {
          status: 200,
          headers: [
            { name: "content-type", value: "application/x-ndjson" },
            { name: "cache-control", value: "no-store" },
            { name: "x-content-type-options", value: "nosniff" },
          ],
          body: undefined,
          stream: mapStream(changes, (change) => `${JSON.stringify(change)}\n`),
        };
      }
      const commandPrefix = `${path}/`;
      const command = request.path.startsWith(commandPrefix)
        ? request.path.slice(commandPrefix.length)
        : "";
      if (request.method !== "POST" || command.length === 0) {
        return replicaJson({ message: "Not found." }, 404);
      }
      const idempotencyKey = getHttpValue(request.headers, { name: "x-kit-command" });
      if (!idempotencyKey) {
        throw new ReplicaError("invalid-command", "A stable command identity is required.");
      }
      const afterHeader = getHttpValue(request.headers, { name: "x-kit-after" });
      return replicaJson(
        await authority.command(
          command,
          {
            principal: principal as PrincipalOf<Model>,
            input: JSON.parse(request.body) as object,
            idempotencyKey,
          },
          afterHeader === undefined ? undefined : replicaSequence(afterHeader),
        ),
      );
    } catch (error) {
      if (error instanceof ReplicaError) {
        return replicaJson(
          { code: error.code, message: error.message },
          replicaErrorStatus(error.code),
        );
      }
      return replicaJson(
        {
          code: "rejected",
          message: error instanceof Error ? error.message : "Replica command was rejected.",
        },
        409,
      );
    }
  };
}

function replicaSequence(value: string): number {
  const sequence = JSON.parse(value) as number;
  if (dataKind(sequence) !== "number" || sequence < 0 || sequence % 1 !== 0) {
    throw new ReplicaError("invalid-command", "Replica sequence is invalid.");
  }
  return sequence;
}

function replicaObservations(value: string | undefined): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  const parsed = JSON.parse(value) as Readonly<Record<string, string>>;
  if (dataKind(parsed) !== "record") {
    throw new ReplicaError("invalid-command", "Replica observation cursor is invalid.");
  }
  const result: Record<string, string> = {};
  for (const name of Object.keys(parsed)) {
    const cursor = parsed[name];
    if (dataKind(cursor) !== "string") {
      throw new ReplicaError("invalid-command", "Replica observation cursor is invalid.");
    }
    result[name] = cursor as string;
  }
  return result;
}

class ReplicaError extends Error {
  constructor(
    readonly code: "unauthenticated" | "invalid-command" | "unknown-command" | "rejected",
    message: string,
  ) {
    super(message);
    this.name = "ReplicaError";
  }
}

function replicaErrorStatus(code: ReplicaError["code"]): number {
  return code === "unauthenticated" ? 401 : code === "unknown-command" ? 404 : 409;
}

type StoredReplica<Model extends ReplicaModelDefinition> = Readonly<
  Omit<ReplicaStoreState, "principal" | "committed"> & {
    principal: PrincipalOf<Model>;
    committed?: object;
  }
>;

type MigratedReplica<Model extends ReplicaModelDefinition> = Readonly<{
  committed?: Model["State"];
  pending: readonly ReplicaPending<Model>[];
  rejected: readonly ReplicaRejection<Model>[];
}>;

type StoredReplicaCommand = ReplicaStoreCommand;
type StoredReplicaRejection = ReplicaStoreRejection;

type RuntimeReplicaCommandMigrations = Readonly<
  Record<
    string,
    (input: object) => Readonly<{ command: string; input: object } | { reject: string }>
  >
>;

function migrateReplicaCommands(
  commands: readonly StoredReplicaCommand[],
  migrations: RuntimeReplicaCommandMigrations | undefined,
): Readonly<{
  pending: readonly StoredReplicaCommand[];
  rejected: readonly StoredReplicaRejection[];
}> {
  const pending: StoredReplicaCommand[] = [];
  const rejected: StoredReplicaRejection[] = [];
  for (const command of commands) {
    const migrate = migrations?.[command.command];
    const migrated = migrate?.(command.input);
    if (migrated && "reject" in migrated) {
      rejected.push({ pending: command, message: migrated.reject });
    } else {
      pending.push({
        id: command.id,
        command: migrated?.command ?? command.command,
        input: migrated?.input ?? command.input,
      });
    }
  }
  return { pending, rejected };
}

function migrateReplicaRejections(
  rejections: readonly StoredReplicaRejection[],
  migrations: RuntimeReplicaCommandMigrations | undefined,
): readonly StoredReplicaRejection[] {
  const result: StoredReplicaRejection[] = [];
  for (const rejection of rejections) {
    const migrated = migrateReplicaCommands([rejection.pending], migrations);
    const command = migrated.pending[0];
    if (command) {
      result.push({ pending: command, message: rejection.message });
    } else {
      const rejected = migrated.rejected[0];
      if (rejected) result.push(rejected);
    }
  }
  return result;
}

class ReplicaController<Model extends ReplicaModelDefinition> implements AsyncDisposable {
  readonly #name: string;
  readonly #version: number;
  readonly #retention: "retain" | "clear-on-sign-out";
  readonly #definition: ReplicaRuntimeImplementation<Model>;
  readonly #rows: readonly string[];
  readonly #dependencies: ReplicaBrowserRequirements<Model>;
  readonly #identity: Identity.Client<Model["Identity"]>;
  readonly #initial: Model["State"];
  readonly #listeners = new Set<(state: ReplicaState<Model>) => void>();
  #state: ReplicaState<Model> = {
    status: "signed-out",
    pending: [],
    rejected: [],
  };
  #committed: Model["State"] | undefined;
  #schema: string | undefined;
  #sequence = 0;
  #observations: Readonly<Record<string, string>> = {};
  #principal: PrincipalOf<Model> | undefined;
  #authorization: IdentityAuthorization | undefined;
  #identitySubscription: Disposable | undefined;
  #coordinationSubscription: Disposable | undefined;
  #principalTransition: Promise<void> = Promise.resolve();
  #storeNotification: Promise<void> = Promise.resolve();
  #changeAbort: AbortController | undefined;
  #changes: Promise<void> | undefined;
  #retry: Disposable | undefined;
  #generation = 0;
  #retryAttempt = 0;
  #flushing: Promise<void> | undefined;
  #write: Promise<void> = Promise.resolve();
  #persistScheduled: Promise<void> | undefined;
  #persistVersion = 0;
  #persistedVersion = 0;
  #storeReplacement: Readonly<Record<string, readonly Readonly<{ id: string }>[]>> | undefined;
  #storeChanges: ReplicaStoreChange[] = [];
  readonly #pendingUpserts = new Map<string, ReplicaStoreCommand>();
  readonly #pendingRemovals = new Set<string>();
  readonly #rejectionUpserts = new Map<string, ReplicaStoreRejection>();
  readonly #rejectionRemovals = new Set<string>();
  #disposed = false;

  constructor(
    name: string,
    version: number,
    retention: "retain" | "clear-on-sign-out",
    definition: ReplicaRuntimeImplementation<Model>,
    rows: readonly string[],
    dependencies: ReplicaBrowserRequirements<Model>,
    identity: Identity.Client<Model["Identity"]>,
    initial: Model["State"],
    schema?: string,
  ) {
    this.#name = name;
    this.#version = version;
    this.#retention = retention;
    this.#schema = schema;
    this.#definition = definition;
    this.#rows = rows;
    this.#dependencies = dependencies;
    this.#identity = identity;
    this.#initial = cloneData(initial, "Replica initial state");
  }

  async start(): Promise<void> {
    this.#identitySubscription ??= this.#identity.subscribe((session) => {
      void this.#queueSession(session as SessionOf<Model> | undefined).catch((error: unknown) =>
        this.#offline(error),
      );
    });
    await this.#queueSession((await this.#identity.session()) as SessionOf<Model> | undefined);
  }

  invoke(operation: string, input: unknown): unknown {
    if (operation === "state") return Promise.resolve(this.#state);
    if (operation === "synchronize") return this.synchronize();
    if (operation === "retry") return this.retry((input as { id: string }).id);
    if (operation === "dismiss") return this.dismiss((input as { id: string }).id);
    if (operation === "subscribe") {
      const receive = input as (state: ReplicaState<Model>) => void;
      this.#listeners.add(receive);
      receive(this.#state);
      return { [Symbol.dispose]: () => this.#listeners.delete(receive) };
    }
    const data = this.#state.data as
      | Readonly<Record<string, readonly Readonly<{ id: string }>[] | undefined>>
      | undefined;
    if (this.#rows.includes(operation)) {
      const principal = this.#requirePrincipal();
      const authorization = this.#authorization;
      if (!authorization) {
        throw new ReplicaError("unauthenticated", "Identity session has no authorization context.");
      }
      return this.#dependencies.replicaStore.query({
        replica: this.#name,
        principal: principal.id,
        authorization: authorization.version,
        row: operation,
        rows: data?.[operation] ?? [],
        query: input as object,
      });
    }
    return this.command(operation, input as object);
  }

  async synchronize(): Promise<ReplicaState<Model>> {
    const principal = this.#requirePrincipal();
    const generation = this.#generation;
    if (this.#state.data === undefined) {
      this.#setState({ ...this.#state, status: "synchronizing" });
    }
    try {
      const received = await this.#dependencies.replication.pull({
        replica: this.#name,
        ...(this.#committed === undefined ? {} : { after: this.#sequence }),
      });
      const pull = canonicalReplicationEnvelope(received) as ReplicaPull<Model>;
      if (!this.#active(generation)) return this.#state;
      if (
        pull.schema === undefined ||
        pull.version !== this.#version ||
        (this.#schema !== undefined && pull.schema !== this.#schema)
      ) {
        this.#setState({
          ...this.#state,
          status: "upgrade-required",
          compatibility: {
            client: `${this.#version}:${this.#schema ?? "uninitialized"}`,
            authority: `${pull.version}:${pull.schema}`,
          },
        });
        return this.#state;
      }
      this.#schema = pull.schema;
      this.#accept(pull);
      await this.#flush(principal, generation);
      if (!this.#active(generation)) return this.#state;
      this.#retryAttempt = 0;
      this.#retry?.[Symbol.dispose]();
      this.#retry = undefined;
      this.#setState({ ...this.#state, status: "synchronized", error: undefined });
      this.#startChanges(generation);
    } catch (error) {
      if (this.#active(generation)) this.#offline(error);
    }
    return this.#state;
  }

  command(operation: string, input: object): Readonly<{ id: string }> {
    this.#requirePrincipal();
    if (this.#state.data === undefined) {
      throw new ReplicaError("rejected", "Replica local state is unavailable.");
    }
    const pending = {
      id: this.#dependencies.identifiers.create({}),
      command: operation,
      input: cloneData(input, "Replica command input"),
    } as ReplicaPending<Model>;
    this.#upsertPending(pending);
    const pendingCommands = [...this.#state.pending, pending];
    this.#setState({
      ...this.#state,
      pending: pendingCommands,
      data: this.#replay(this.#committed ?? this.#initial, pendingCommands),
    });
    const principal = this.#requirePrincipal();
    const generation = this.#generation;
    void this.#persist()
      .then(() => this.#flush(principal, generation))
      .catch((error: unknown) => {
        if (this.#active(generation)) this.#offline(error);
      });
    return { id: pending.id };
  }

  async retry(id: string): Promise<ReplicaState<Model>> {
    const rejection = this.#state.rejected.find(({ pending }) => pending.id === id);
    if (!rejection) return this.#state;
    this.#upsertPending(rejection.pending);
    this.#removeRejection(rejection.pending.id);
    this.#setState({
      ...this.#state,
      pending: [...this.#state.pending, rejection.pending],
      rejected: this.#state.rejected.filter(({ pending }) => pending.id !== id),
    });
    await this.#persist();
    await this.#flush(this.#requirePrincipal(), this.#generation);
    return this.#state;
  }

  async dismiss(id: string): Promise<ReplicaState<Model>> {
    this.#removeRejection(id);
    this.#setState({
      ...this.#state,
      rejected: this.#state.rejected.filter(({ pending }) => pending.id !== id),
    });
    await this.#persist();
    return this.#state;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#identitySubscription?.[Symbol.dispose]();
    this.#coordinationSubscription?.[Symbol.dispose]();
    this.#stopChanges();
    this.#retry?.[Symbol.dispose]();
    await Promise.allSettled(
      [
        this.#principalTransition,
        this.#changes,
        this.#flushing,
        this.#persistScheduled,
        this.#write,
        this.#storeNotification,
      ].filter(Boolean),
    );
    this.#listeners.clear();
  }

  #queueSession(session: SessionOf<Model> | undefined): Promise<void> {
    const transition = this.#principalTransition
      .catch(() => undefined)
      .then(() => this.#useSession(session));
    this.#principalTransition = transition;
    return transition;
  }

  async #useSession(session: SessionOf<Model> | undefined): Promise<void> {
    if (this.#disposed) return;
    const principal = session?.user as PrincipalOf<Model> | undefined;
    const authorization = session?.authorization;
    if (
      this.#principal !== undefined &&
      (principal === undefined ||
        this.#principal.id !== principal.id ||
        this.#authorization?.version !== authorization?.version)
    ) {
      await this.#persistScheduled?.catch(() => undefined);
    }
    if (!principal) {
      const previousPrincipal = this.#principal;
      const previousAuthorization = this.#authorization;
      this.#principal = undefined;
      this.#authorization = undefined;
      this.#committed = undefined;
      this.#generation += 1;
      this.#coordinationSubscription?.[Symbol.dispose]();
      this.#coordinationSubscription = undefined;
      this.#stopChanges();
      this.#setState({ status: "signed-out", pending: [], rejected: [] });
      if (
        this.#retention === "clear-on-sign-out" &&
        previousPrincipal !== undefined &&
        previousAuthorization !== undefined
      ) {
        await this.#dependencies.replicaStore.remove({
          replica: this.#name,
          principal: previousPrincipal.id,
          authorization: previousAuthorization.version,
        });
      }
      return;
    }
    if (!authorization) {
      throw new ReplicaError("unauthenticated", "Identity session has no authorization context.");
    }
    if (
      this.#principal?.id === principal.id &&
      equalData(this.#principal, principal) &&
      this.#authorization?.version === authorization.version
    ) {
      const credentialRotated =
        this.#authorization.session !== authorization.session ||
        this.#authorization.expiresAt !== authorization.expiresAt;
      this.#principal = principal;
      this.#authorization = authorization;
      if (credentialRotated) {
        const generation = ++this.#generation;
        this.#stopChanges();
        void this.synchronize().then(() => {
          if (this.#active(generation)) this.#startChanges(generation);
        });
      }
      return;
    }
    const sameIdentity = this.#principal?.id === principal.id;
    const authorityChanged =
      sameIdentity &&
      (!equalData(this.#principal, principal) ||
        this.#authorization?.version !== authorization.version);
    const pending = sameIdentity && !authorityChanged ? this.#state.pending : [];
    const rejected = sameIdentity
      ? [
          ...this.#state.rejected,
          ...(authorityChanged
            ? this.#state.pending.map((command) => ({
                pending: command,
                message: "Authorization context changed before the command was committed.",
              }))
            : []),
        ]
      : [];
    this.#pendingUpserts.clear();
    this.#pendingRemovals.clear();
    this.#rejectionUpserts.clear();
    this.#rejectionRemovals.clear();
    for (const rejection of rejected) this.#upsertRejection(rejection);
    this.#principal = principal;
    this.#authorization = authorization;
    this.#committed = undefined;
    this.#sequence = 0;
    this.#observations = {};
    const generation = ++this.#generation;
    this.#observeStore(principal, authorization.version, generation);
    this.#stopChanges();
    this.#retry?.[Symbol.dispose]();
    this.#retry = undefined;
    this.#setState({
      status: "loading",
      data: this.#replay(this.#initial, pending),
      pending,
      rejected,
    });
    const stored = (await this.#dependencies.replicaStore.load({
      replica: this.#name,
      principal: principal.id,
      authorization: authorization.version,
      rows: this.#rows,
    })) as StoredReplica<Model> | undefined;
    if (!this.#active(generation)) return;
    if (stored && equalData(stored.principal, principal)) {
      this.#schema = stored.schema;
      this.#sequence = stored.sequence ?? 0;
      this.#observations = stored.observations ?? {};
      const migrated = this.#migrateStored(stored);
      this.#committed = migrated.committed;
      this.#setState({
        status: migrated.committed ? "synchronized" : "loading",
        ...(stored.cursor ? { cursor: stored.cursor } : {}),
        data: this.#replay(migrated.committed ?? this.#initial, migrated.pending),
        pending: migrated.pending,
        rejected: migrated.rejected,
      });
    } else if (stored?.principal.id === principal.id && !sameIdentity) {
      const migrated = this.#migrateStored(stored);
      this.#setState({
        status: "loading",
        pending: migrated.pending,
        rejected: migrated.rejected,
      });
    } else if (stored === undefined) {
      this.#storeReplacement = cloneData(this.#initial) as Readonly<
        Record<string, readonly Readonly<{ id: string }>[]>
      >;
      this.#storeChanges = [];
    }
    void this.synchronize();
  }

  #migrateStored(stored: StoredReplica<Model>): MigratedReplica<Model> {
    if (stored.version > this.#version) {
      return { pending: [], rejected: [] };
    }
    let version = stored.version;
    let state = stored.committed;
    let pending = stored.pending;
    let rejected = stored.rejected;
    while (version < this.#version) {
      const migrate = (
        this.#definition.migrate as Readonly<
          Record<
            number,
            Readonly<{
              state(value: object): object;
              commands?: Readonly<
                Record<
                  string,
                  (
                    input: object,
                  ) => Readonly<{ command: string; input: object } | { reject: string }>
                >
              >;
            }>
          >
        >
      )[version];
      if (!migrate) return { pending: [], rejected: [] };
      if (state !== undefined) state = migrate.state(state);
      const migratedPending = migrateReplicaCommands(pending, migrate.commands);
      const migratedRejected = migrateReplicaRejections(rejected, migrate.commands);
      pending = migratedPending.pending;
      rejected = [...migratedRejected, ...migratedPending.rejected];
      version += 1;
    }
    return {
      ...(state === undefined
        ? {}
        : { committed: cloneData(state, "Replica stored state") as Model["State"] }),
      pending: cloneData(pending, "Replica stored commands") as readonly ReplicaPending<Model>[],
      rejected: cloneData(
        rejected,
        "Replica stored rejections",
      ) as readonly ReplicaRejection<Model>[],
    };
  }

  #accept(pull: ReplicaPull<Model>): void {
    if (
      pull.sequence < this.#sequence ||
      (this.#committed !== undefined && pull.sequence === this.#sequence)
    ) {
      return;
    }
    this.#applyPull(pull);
  }

  #applyPull(pull: ReplicaPull<Model>): void {
    const pending = this.#state.pending.filter(
      ({ id }) => !replicaIncludes(pull.invocations, `idempotency:${id}`),
    );
    for (const command of this.#state.pending) {
      if (!pending.includes(command)) this.#removePending(command.id);
    }
    const accepted = this.#mergePull(pull);
    if (!accepted && pending.length === this.#state.pending.length) return;
    const committed = this.#committed;
    this.#setState({
      ...this.#state,
      cursor: pull.cursor,
      pending,
      ...(committed === undefined ? {} : { data: this.#replay(committed, pending) }),
    });
    void this.#persist();
  }

  #mergePull(pull: ReplicaPull<Model>): boolean {
    if (
      pull.sequence < this.#sequence ||
      (this.#committed !== undefined && pull.sequence === this.#sequence)
    ) {
      return false;
    }
    this.#sequence = pull.sequence;
    this.#observations = pull.observations;
    if (pull.snapshot !== undefined) {
      this.#committed = cloneData(pull.snapshot, "Replica authority snapshot");
      this.#storeReplacement = this.#committed as Readonly<
        Record<string, readonly Readonly<{ id: string }>[]>
      >;
      this.#storeChanges = [];
    }
    if (pull.changes.length) {
      if (this.#committed === undefined) {
        throw new ReplicaError("rejected", "Replica received changes before its initial snapshot.");
      }
      const state = cloneData(this.#committed, "Replica committed state") as Record<
        string,
        readonly Readonly<{ id: string }>[]
      >;
      for (const change of pull.changes) {
        const current = state[change.row];
        if (!current) {
          throw new ReplicaError("rejected", `Replica change names unknown row ${change.row}.`);
        }
        const next: Readonly<{ id: string }>[] = [];
        let replaced = false;
        for (const value of current) {
          if (value.id !== ("upsert" in change ? change.upsert.id : change.remove.id)) {
            next.push(value);
          } else if ("upsert" in change) {
            next.push(change.upsert);
            replaced = true;
          }
        }
        if ("upsert" in change && !replaced) next.push(change.upsert);
        state[change.row] = next;
      }
      this.#committed = state as Model["State"];
      this.#storeChanges.push(
        ...(cloneData(pull.changes, "Replica authority changes") as readonly ReplicaStoreChange[]),
      );
    }
    return true;
  }

  async #flush(principal: PrincipalOf<Model>, generation: number): Promise<void> {
    if (this.#flushing) {
      await this.#flushing;
      if (this.#active(generation) && this.#state.pending.length) {
        await this.#flush(principal, generation);
      }
      return;
    }
    this.#flushing = this.#dependencies.replicaCoordination
      .exclusive({
        scope: this.#scope(principal.id, this.#authorization?.version ?? 0),
        task: async () => {
          await this.#reloadStore(principal, generation);
          while (this.#state.pending.length && this.#active(generation)) {
            const pending = this.#state.pending[0]!;
            try {
              const received = await this.#dependencies.replication.command({
                replica: this.#name,
                command: pending.command,
                value: pending.input,
                idempotencyKey: pending.id,
                ...(this.#committed === undefined ? {} : { after: this.#sequence }),
              });
              if (!this.#active(generation)) return;
              const response = {
                result: cloneData(received.result, "Replica command result"),
                pull: canonicalReplicationEnvelope(received.pull) as ReplicaPull<Model>,
              } as ReplicaCommandResponse<Model>;
              const pull = response.pull;
              const accepted = this.#mergePull(pull);
              const observed =
                replicaIncludes(pull.invocations, `idempotency:${pending.id}`) ||
                pull.snapshot !== undefined;
              const remaining = observed
                ? this.#state.pending.filter(({ id }) => id !== pending.id)
                : this.#state.pending;
              if (observed) this.#removePending(pending.id);
              this.#setState({
                ...this.#state,
                status: "synchronized",
                error: undefined,
                pending: remaining,
                ...(accepted ? { cursor: pull.cursor } : {}),
                data: this.#replay(this.#committed ?? this.#initial, remaining),
              });
              this.#retryAttempt = 0;
              this.#retry?.[Symbol.dispose]();
              this.#retry = undefined;
              this.#startChanges(generation);
              if (!observed) break;
            } catch (error) {
              if (!this.#active(generation)) return;
              if (
                !(error instanceof ReplicaError) &&
                (!(error instanceof Error) || error.name !== "ReplicationRejected")
              ) {
                this.#offline(error);
                break;
              }
              const remaining = this.#state.pending.filter(({ id }) => id !== pending.id);
              this.#removePending(pending.id);
              const rejection = {
                pending,
                message: error instanceof Error ? error.message : "Command rejected.",
              };
              this.#upsertRejection(rejection);
              this.#setState({
                ...this.#state,
                pending: remaining,
                rejected: [...this.#state.rejected, rejection],
                data: this.#replay(this.#committed ?? this.#initial, remaining),
              });
            }
            await this.#persist();
          }
        },
      })
      .finally(() => {
        this.#flushing = undefined;
      });
    await this.#flushing;
  }

  #replay(committed: Model["State"], pending: readonly ReplicaPending<Model>[]): Model["State"] {
    let state = cloneData(committed, "Replica replay state");
    for (const command of pending) {
      state = this.#definition.dispatch.optimistic(
        command.command as Extract<keyof Model["Commands"], string>,
        {
          name: this.#name,
          state,
          principal: this.#requirePrincipal(),
          input: command.input,
        } as ReplicaOptimisticContext<Model, keyof Model["Commands"]>,
      );
    }
    return state;
  }

  #upsertPending(command: ReplicaStoreCommand): void {
    this.#pendingRemovals.delete(command.id);
    this.#pendingUpserts.set(command.id, command);
  }

  #removePending(id: string): void {
    this.#pendingUpserts.delete(id);
    this.#pendingRemovals.add(id);
  }

  #upsertRejection(rejection: ReplicaStoreRejection): void {
    this.#rejectionRemovals.delete(rejection.pending.id);
    this.#rejectionUpserts.set(rejection.pending.id, rejection);
  }

  #removeRejection(id: string): void {
    this.#rejectionUpserts.delete(id);
    this.#rejectionRemovals.add(id);
  }

  #clearPersistedDelta(
    pending: ReplicaStoreDelta<ReplicaStoreCommand>,
    rejected: ReplicaStoreDelta<ReplicaStoreRejection>,
  ): void {
    for (const command of pending.upsert) {
      if (this.#pendingUpserts.get(command.id) === command) {
        this.#pendingUpserts.delete(command.id);
      }
    }
    for (const id of pending.remove) this.#pendingRemovals.delete(id);
    for (const rejection of rejected.upsert) {
      if (this.#rejectionUpserts.get(rejection.pending.id) === rejection) {
        this.#rejectionUpserts.delete(rejection.pending.id);
      }
    }
    for (const id of rejected.remove) this.#rejectionRemovals.delete(id);
  }

  #scope(principal: string, authorization: number): string {
    return `replica:${this.#name}:${principal}:${authorization}`;
  }

  #observeStore(principal: PrincipalOf<Model>, authorization: number, generation: number): void {
    this.#coordinationSubscription?.[Symbol.dispose]();
    this.#coordinationSubscription = this.#dependencies.replicaCoordination.subscribe({
      scope: this.#scope(principal.id, authorization),
      receive: () => {
        const notification = this.#storeNotification
          .catch(() => undefined)
          .then(async () => {
            await this.#reloadStore(principal, generation);
            if (this.#active(generation) && this.#state.pending.length) {
              await this.#flush(principal, generation);
            }
          })
          .catch((error: unknown) => {
            if (this.#active(generation)) this.#offline(error);
          });
        this.#storeNotification = notification;
      },
    });
  }

  async #reloadStore(principal: PrincipalOf<Model>, generation: number): Promise<void> {
    const authorization = this.#authorization;
    if (!authorization || !this.#active(generation)) return;
    const stored = (await this.#dependencies.replicaStore.load({
      replica: this.#name,
      principal: principal.id,
      authorization: authorization.version,
      rows: this.#rows,
    })) as StoredReplica<Model> | undefined;
    if (!stored || !this.#active(generation) || !equalData(stored.principal, principal)) {
      return;
    }
    const migrated = this.#migrateStored(stored);
    if (stored.sequence >= this.#sequence && migrated.committed !== undefined) {
      this.#schema = stored.schema;
      this.#sequence = stored.sequence;
      this.#observations = stored.observations;
      this.#committed = migrated.committed;
    }
    const pending = mergeReplicaStoreValues(
      migrated.pending,
      this.#pendingUpserts.values(),
      this.#pendingRemovals,
      ({ id }) => id,
    ) as readonly ReplicaPending<Model>[];
    const rejected = mergeReplicaStoreValues(
      migrated.rejected,
      this.#rejectionUpserts.values(),
      this.#rejectionRemovals,
      ({ pending: command }) => command.id,
    ) as readonly ReplicaRejection<Model>[];
    this.#setState({
      ...this.#state,
      ...(stored.cursor ? { cursor: stored.cursor } : {}),
      pending,
      rejected,
      ...(this.#committed === undefined ? {} : { data: this.#replay(this.#committed, pending) }),
    });
  }

  #persist(): Promise<void> {
    const principal = this.#principal;
    const authorization = this.#authorization;
    if (!principal || !authorization) return Promise.resolve();
    this.#persistVersion += 1;
    return this.#schedulePersistence(principal.id, authorization.version);
  }

  #schedulePersistence(principalId: string, authorization: number): Promise<void> {
    if (this.#persistScheduled) return this.#persistScheduled;
    const scheduled = Promise.resolve()
      .then(() => this.#drainPersistence(principalId, authorization))
      .finally(() => {
        if (this.#persistScheduled !== scheduled) return;
        this.#persistScheduled = undefined;
        if (
          !this.#disposed &&
          this.#persistedVersion < this.#persistVersion &&
          this.#principal?.id === principalId &&
          this.#authorization?.version === authorization
        ) {
          void this.#schedulePersistence(principalId, authorization).catch((error: unknown) =>
            this.#offline(error),
          );
        }
      });
    this.#persistScheduled = scheduled;
    return scheduled;
  }

  async #drainPersistence(principalId: string, authorization: number): Promise<void> {
    while (
      this.#persistedVersion < this.#persistVersion &&
      this.#principal?.id === principalId &&
      this.#authorization?.version === authorization
    ) {
      const current = this.#principal;
      const version = this.#persistVersion;
      const replacement = this.#storeReplacement;
      const changes = this.#storeChanges;
      const pending = {
        upsert: [...this.#pendingUpserts.values()],
        remove: [...this.#pendingRemovals],
      } satisfies ReplicaStoreDelta<ReplicaStoreCommand>;
      const rejected = {
        upsert: [...this.#rejectionUpserts.values()],
        remove: [...this.#rejectionRemovals],
      } satisfies ReplicaStoreDelta<ReplicaStoreRejection>;
      this.#storeReplacement = undefined;
      this.#storeChanges = [];
      const input = {
        replica: this.#name,
        principal: current.id,
        authorization,
        metadata: {
          version: this.#version,
          ...(this.#schema ? { schema: this.#schema } : {}),
          principal: cloneData(current, "Replica principal"),
          ...(this.#state.cursor ? { cursor: this.#state.cursor } : {}),
          sequence: this.#sequence,
          observations: this.#observations,
        },
        ...(replacement === undefined ? {} : { replace: replacement }),
        changes,
        pending: cloneData(pending, "Replica pending command changes"),
        rejected: cloneData(rejected, "Replica rejection changes"),
      };
      this.#write = this.#write
        .catch(() => undefined)
        .then(() => this.#dependencies.replicaStore.commit(input));
      try {
        await this.#write;
        this.#clearPersistedDelta(pending, rejected);
        this.#persistedVersion = version;
        this.#dependencies.replicaCoordination.publish({
          scope: this.#scope(current.id, authorization),
        });
      } catch (error) {
        if (this.#principal?.id === current.id && this.#committed !== undefined) {
          this.#storeReplacement = cloneData(this.#committed) as Readonly<
            Record<string, readonly Readonly<{ id: string }>[]>
          >;
          this.#storeChanges = [];
        }
        throw error;
      }
    }
  }

  #setState(state: ReplicaState<Model>): void {
    this.#state = Object.freeze(state);
    for (const receive of this.#listeners) receive(this.#state);
  }

  #startChanges(generation: number): void {
    if (!this.#active(generation) || !this.#principal) return;
    if (this.#changes) {
      if (!this.#changeAbort?.signal.aborted) return;
      const stopping = this.#changes;
      void stopping.then(() => {
        if (this.#active(generation)) this.#startChanges(generation);
      });
      return;
    }
    const abort = new AbortController();
    this.#changeAbort = abort;
    const changes = this.#followChanges(generation, abort.signal).finally(() => {
      if (this.#changeAbort === abort) this.#changeAbort = undefined;
      if (this.#changes === changes) this.#changes = undefined;
    });
    this.#changes = changes;
  }

  async #followChanges(generation: number, signal: AbortSignal): Promise<void> {
    try {
      const changes = await this.#dependencies.replication.changes({
        replica: this.#name,
        observations: this.#observations,
        sequence: this.#sequence,
        signal,
      });
      for await (const change of changes) {
        if (!this.#active(generation) || signal.aborted) return;
        this.#accept(canonicalReplicationEnvelope(change) as ReplicaPull<Model>);
      }
      if (this.#active(generation) && !signal.aborted) {
        throw new Error("Replica change stream ended unexpectedly.");
      }
    } catch (error) {
      if (this.#active(generation) && !signal.aborted) this.#offline(error);
    }
  }

  #stopChanges(): void {
    this.#changeAbort?.abort();
  }

  #offline(error: unknown): void {
    if (this.#disposed || !this.#principal) return;
    this.#setState({
      ...this.#state,
      status: "offline",
      error: error instanceof Error ? error.message : "Synchronization failed.",
    });
    this.#stopChanges();
    if (this.#retry) return;
    const generation = this.#generation;
    const milliseconds = Math.min(5_000, 250 * 2 ** this.#retryAttempt++);
    this.#retry = this.#dependencies.scheduler.after({
      milliseconds,
      run: () => {
        this.#retry = undefined;
        if (this.#active(generation)) void this.synchronize();
      },
    });
  }

  #requirePrincipal(): PrincipalOf<Model> {
    if (this.#principal) return this.#principal;
    throw new ReplicaError("unauthenticated", "Authentication is required.");
  }

  #active(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }
}

function mergeReplicaStoreValues<Value>(
  stored: readonly Value[],
  local: Iterable<Value>,
  removed: ReadonlySet<string>,
  identity: (value: Value) => string,
): readonly Value[] {
  const additions = new Map<string, Value>();
  for (const value of local) additions.set(identity(value), value);
  const merged: Value[] = [];
  for (const value of stored) {
    const id = identity(value);
    if (removed.has(id)) continue;
    merged.push(additions.get(id) ?? value);
    additions.delete(id);
  }
  for (const value of additions.values()) merged.push(value);
  return merged;
}

function replicaIncludes(values: readonly string[], value: string): boolean {
  for (const candidate of values) {
    if (candidate === value) return true;
  }
  return false;
}

function canonicalReplicationEnvelope(value: unknown): ReplicationEnvelope {
  const envelope = cloneData(value, "Replication envelope") as Partial<ReplicationEnvelope>;
  const observations = envelope.observations;
  if (
    dataKind(envelope) !== "record" ||
    !Number.isInteger(envelope.version) ||
    (envelope.version ?? 0) < 1 ||
    !Number.isInteger(envelope.sequence) ||
    (envelope.sequence ?? -1) < 0 ||
    typeof envelope.cursor !== "string" ||
    observations === undefined ||
    dataKind(observations) !== "record" ||
    !Array.isArray(envelope.invocations) ||
    !Array.isArray(envelope.changes) ||
    (envelope.schema !== undefined && typeof envelope.schema !== "string") ||
    (envelope.snapshot !== undefined && dataKind(envelope.snapshot) !== "record")
  ) {
    throw new TypeError("Replication envelope is invalid.");
  }
  for (const name of Object.keys(observations)) {
    if (typeof observations[name] !== "string") {
      throw new TypeError("Replication observation cursor is invalid.");
    }
  }
  for (const identity of envelope.invocations) {
    if (typeof identity !== "string" || identity.length === 0) {
      throw new TypeError("Replication invocation identity is invalid.");
    }
  }
  for (const change of envelope.changes) {
    if (
      dataKind(change) !== "record" ||
      typeof change.row !== "string" ||
      change.row.length === 0
    ) {
      throw new TypeError("Replication change is invalid.");
    }
    const upsert = "upsert" in change ? change.upsert : undefined;
    const remove = "remove" in change ? change.remove : undefined;
    if (
      (upsert === undefined) === (remove === undefined) ||
      (upsert !== undefined &&
        (dataKind(upsert) !== "record" ||
          typeof (upsert as Readonly<{ id?: unknown }>).id !== "string")) ||
      (remove !== undefined &&
        (dataKind(remove) !== "record" ||
          typeof (remove as Readonly<{ id?: unknown }>).id !== "string"))
    ) {
      throw new TypeError("Replication change payload is invalid.");
    }
  }
  return envelope as ReplicationEnvelope;
}

function replicaJson(value: unknown, status = 200): HttpResponse {
  return {
    status,
    headers: [{ name: "content-type", value: "application/json" }],
    body: JSON.stringify(value),
    stream: undefined,
  };
}

/** Starts a Replica against deterministic loopback boundaries for Feature-owned tests. */
export async function createReplicaFixture<Model extends ReplicaModelDefinition>(
  _replica: DefinedReplica<Model>,
  definition: ReplicaImplementation<Model>,
  input: Readonly<{
    principal: PrincipalOf<Model>;
    projection: Projection.Reference<Model["Projection"]>;
    rows: readonly Extract<keyof Model["State"], string>[];
    dependencies: Model["Dependencies"];
    name?: string;
    version?: Model["Version"];
    schema?: string;
    authoritySchema?: string;
    storage?: Map<string, unknown>;
    beforeStorageWrite?(): MaybePromise<void>;
    beforeCommand?(): MaybePromise<void>;
    identifierPrefix?: string;
    online?: boolean;
    authorizationVersion?: number;
    retention?: "retain" | "clear-on-sign-out";
  }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      client: ReplicaClient<Model>;
      state(): Promise<ReplicaState<Model>>;
      online(value: boolean): void;
      dropNextResponse(): void;
      principal(
        value: PrincipalOf<Model> | undefined,
        authorizationVersion?: number,
      ): Promise<void>;
      storage: Map<string, unknown>;
      responses: readonly Readonly<{ method: string; path: string; body: string }>[];
    }>
> {
  const name = input.name ?? "replica";
  const version = input.version ?? (1 as Model["Version"]);
  const schema = input.schema ?? `fixture:${version}`;
  const authoritySchema = input.authoritySchema ?? schema;
  const storage = input.storage ?? new Map<string, unknown>();
  const runtimeDefinition = replicaDispatchImplementation(definition);
  const authority = replicaAuthority(
    input.projection,
    input.rows,
    (operation, context) =>
      runtimeDefinition.dispatch.commit(
        operation as Extract<keyof Model["Commands"], string>,
        context,
      ),
    input.dependencies,
    version,
    authoritySchema,
  );
  let currentPrincipal: PrincipalOf<Model> | undefined = input.principal;
  let currentAuthorizationVersion = input.authorizationVersion ?? 1;
  let isOnline = input.online ?? true;
  let dropNextResponse = false;
  let identifier = 0;
  const identifierPrefix = input.identifierPrefix ?? "fixture";
  const responses: Readonly<{ method: string; path: string; body: string }>[] = [];
  const fixtureSession = (): SessionOf<Model> | undefined =>
    currentPrincipal
      ? {
          user: currentPrincipal,
          authorization: {
            session: `fixture:${currentPrincipal.id}`,
            version: currentAuthorizationVersion,
            expiresAt: Number.MAX_SAFE_INTEGER,
          },
        }
      : undefined;
  const sessionListeners = new Set<(session: SessionOf<Model> | undefined) => void>();
  const identityClient = {
    async session() {
      return fixtureSession();
    },
    async signIn() {
      if (!currentPrincipal) throw new Error("No fixture principal is configured.");
      return fixtureSession()!;
    },
    async signUp() {
      if (!currentPrincipal) throw new Error("No fixture principal is configured.");
      return fixtureSession()!;
    },
    async signOut() {
      currentPrincipal = undefined;
      for (const receive of sessionListeners) receive(undefined);
    },
    subscribe(receive: (session: SessionOf<Model> | undefined) => void) {
      sessionListeners.add(receive);
      return { [Symbol.dispose]: () => sessionListeners.delete(receive) };
    },
  } as unknown as Identity.Client<Model["Identity"]>;
  const replicaStore = createMemoryReplicaStore(
    storage,
    input.beforeStorageWrite,
  ) as unknown as Readonly<{
    load(input: { input: Parameters<ReplicaStore["load"]>[0] }): ReturnType<ReplicaStore["load"]>;
    commit(input: {
      input: Parameters<ReplicaStore["commit"]>[0];
    }): ReturnType<ReplicaStore["commit"]>;
    query(input: {
      input: Parameters<ReplicaStore["query"]>[0];
    }): ReturnType<ReplicaStore["query"]>;
    remove(input: {
      input: Parameters<ReplicaStore["remove"]>[0];
    }): ReturnType<ReplicaStore["remove"]>;
  }>;
  const replicaCoordination = createMemoryReplicaCoordination(storage) as unknown as Readonly<{
    exclusive(input: {
      input: Parameters<ReplicaCoordination["exclusive"]>[0];
    }): ReturnType<ReplicaCoordination["exclusive"]>;
    publish(input: {
      input: Parameters<ReplicaCoordination["publish"]>[0];
    }): ReturnType<ReplicaCoordination["publish"]>;
    subscribe(input: {
      input: Parameters<ReplicaCoordination["subscribe"]>[0];
    }): ReturnType<ReplicaCoordination["subscribe"]>;
  }>;
  const browserDependencies = {
    replication: {
      async pull({
        replica,
        after,
      }: Readonly<{ replica: string; after?: number }>): Promise<ReplicaPull<Model>> {
        if (!isOnline) throw new Error("Fixture network is offline.");
        if (!currentPrincipal) {
          throw new ReplicaError("unauthenticated", "Authentication is required.");
        }
        const response = await authority.pull({
          principal: currentPrincipal,
          after,
          metadata: true,
        });
        responses.push({
          method: "GET",
          path: `/api/replicas/${replica}`,
          body: JSON.stringify(response),
        });
        return response;
      },
      async command({
        replica,
        command,
        value,
        idempotencyKey,
        after,
      }: Readonly<{
        replica: string;
        command: string;
        value: object;
        idempotencyKey: string;
        after?: number;
      }>): Promise<ReplicaCommandResponse<Model>> {
        if (!isOnline) throw new Error("Fixture network is offline.");
        if (!currentPrincipal) {
          throw new ReplicaError("unauthenticated", "Authentication is required.");
        }
        await input.beforeCommand?.();
        let response: ReplicaCommandResponse<Model>;
        try {
          response = await authority.command(
            command,
            {
              principal: currentPrincipal,
              input: value,
              idempotencyKey,
            },
            after,
          );
        } catch (error) {
          throw new ReplicaError(
            "rejected",
            error instanceof Error ? error.message : "Replica command was rejected.",
          );
        }
        responses.push({
          method: "POST",
          path: `/api/replicas/${replica}/${command}`,
          body: JSON.stringify(response),
        });
        if (dropNextResponse) {
          dropNextResponse = false;
          throw new Error("Fixture response was lost after authority execution.");
        }
        return response;
      },
      async changes({
        observations,
        sequence,
        signal,
      }: Readonly<{
        replica: string;
        observations: Readonly<Record<string, string>>;
        sequence: number;
        signal?: AbortSignal;
      }>): Promise<AsyncIterable<ReplicaPull<Model>>> {
        if (!isOnline) throw new Error("Fixture network is offline.");
        if (!currentPrincipal) {
          throw new ReplicaError("unauthenticated", "Authentication is required.");
        }
        const source = await authority.observe({
          principal: currentPrincipal,
          after: observations,
          sequence,
        });
        return signal ? abortableReplicaChanges(source, signal) : source;
      },
    },
    identifiers: {
      create() {
        identifier += 1;
        return `${identifierPrefix}-command-${identifier}`;
      },
    },
    scheduler: {
      after() {
        return { [Symbol.dispose]() {} };
      },
    },
    replicaCoordination: {
      exclusive(value: Parameters<ReplicaCoordination["exclusive"]>[0]) {
        return replicaCoordination.exclusive({ input: value });
      },
      publish(value: Parameters<ReplicaCoordination["publish"]>[0]) {
        return replicaCoordination.publish({ input: value });
      },
      subscribe(value: Parameters<ReplicaCoordination["subscribe"]>[0]) {
        return replicaCoordination.subscribe({ input: value });
      },
    },
    replicaStore: {
      load(value: Parameters<ReplicaStore["load"]>[0]) {
        return replicaStore.load({ input: value });
      },
      commit(value: Parameters<ReplicaStore["commit"]>[0]) {
        return replicaStore.commit({ input: value });
      },
      query(value: Parameters<ReplicaStore["query"]>[0]) {
        return replicaStore.query({ input: value });
      },
      remove(value: Parameters<ReplicaStore["remove"]>[0]) {
        return replicaStore.remove({ input: value });
      },
    },
  } as unknown as ReplicaBrowserRequirements<Model>;
  const controller = new ReplicaController(
    name,
    version,
    input.retention ?? "retain",
    runtimeDefinition,
    input.rows,
    browserDependencies,
    identityClient,
    definition.state({ name }),
    schema,
  );
  await controller.start();
  const clientRecord: Record<string, unknown> = {
    state: () => controller.invoke("state", undefined),
    synchronize: () => controller.invoke("synchronize", undefined),
    retry: (value: { id: string }) => controller.invoke("retry", value),
    dismiss: (value: { id: string }) => controller.invoke("dismiss", value),
    subscribe: (receive: (state: ReplicaState<Model>) => void) =>
      controller.invoke("subscribe", receive),
  };
  for (const row of input.rows) {
    clientRecord[row] = (query: object) => controller.invoke(row, query);
  }
  for (const command of Object.keys(definition.commands)) {
    clientRecord[command] = (value: object) => controller.invoke(command, value);
  }
  const client = Object.freeze(clientRecord) as ReplicaClient<Model>;
  return {
    client,
    state: () => controller.invoke("state", undefined) as Promise<ReplicaState<Model>>,
    online(value: boolean) {
      isOnline = value;
    },
    dropNextResponse() {
      dropNextResponse = true;
    },
    async principal(value: PrincipalOf<Model> | undefined, authorizationVersion = 1) {
      currentPrincipal = value;
      currentAuthorizationVersion = authorizationVersion;
      const session = fixtureSession();
      for (const receive of sessionListeners) receive(session);
      await Promise.resolve();
    },
    storage,
    responses,
    [Symbol.asyncDispose]: () => controller[Symbol.asyncDispose](),
  } as unknown as AsyncDisposable & {
    client: ReplicaClient<Model>;
    state(): Promise<ReplicaState<Model>>;
    online(value: boolean): void;
    dropNextResponse(): void;
    principal(value: PrincipalOf<Model> | undefined, authorizationVersion?: number): Promise<void>;
    storage: Map<string, unknown>;
    responses: readonly Readonly<{ method: string; path: string; body: string }>[];
  };
}

function abortableReplicaChanges<Value>(
  source: AsyncIterable<Value>,
  signal: AbortSignal,
): AsyncIterable<Value> {
  return {
    async *[Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      let abort: (() => void) | undefined;
      const aborted = new Promise<IteratorResult<Value>>((resolve) => {
        abort = () => resolve({ done: true, value: undefined });
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
      try {
        while (!signal.aborted) {
          const result = await Promise.race([iterator.next(), aborted]);
          if (result.done) return;
          yield result.value;
        }
      } finally {
        if (abort) signal.removeEventListener("abort", abort);
        void iterator.return?.();
      }
    },
  };
}
