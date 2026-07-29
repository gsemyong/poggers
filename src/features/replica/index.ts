import { cloneData, equalData } from "@/core/data";
import {
  dependencyInvocation,
  dispatchDependency,
  type Dependency,
  type DependencyImplementations,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { typeKeys, typeLiteral, typeSchema } from "@/core/intrinsic";
import type { Identity, IdentityModelDefinition } from "@/features/identity";
import {
  evaluateProjectionRows,
  type Projection,
  type ProjectionResult,
} from "@/features/projection";
import {
  getHttpValue,
  type HttpRequest,
  type HttpResponse,
  type HttpServer,
  type ServerProcess,
} from "@/platforms/server";
import type {
  BrowserMainThread,
  HttpClient,
  Identifiers,
  LocalStore,
  Scheduler,
} from "@/platforms/web";

type Empty = Record<never, never>;
type MaybePromise<Value> = Value | PromiseLike<Value>;
declare const replicaDefinition: unique symbol;

export type ReplicaCommand<Input extends object, Result extends object = Empty> = Readonly<{
  Input: Input;
  Result: Result;
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
  state: Readonly<Model["State"]>;
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

type ReplicaCommits<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in keyof Model["Commands"]]: Pick<ReplicaImplementation<Model>["commands"][Name], "commit">;
}>;

type ReplicaClientImplementation<Model extends ReplicaModelDefinition> = Pick<
  ReplicaImplementation<Model>,
  "commands" | "optimistic" | "migrate"
>;

type ReplicaPull<Model extends ReplicaModelDefinition> = Readonly<{
  version: Model["Version"];
  schema: string;
  cursor: string;
  snapshot?: Model["State"];
  changes: readonly Readonly<{
    cursor: string;
    replace: Model["State"];
  }>[];
}>;

type ReplicaCommandResponse = Readonly<{
  result: object;
  pull: Readonly<{
    version: number;
    schema: string;
    cursor: string;
    snapshot?: object;
    changes: readonly Readonly<{ cursor: string; replace: object }>[];
  }>;
}>;

type ReplicaProtocolSchema<Model extends ReplicaModelDefinition> = Readonly<{
  State: Model["State"];
  Commands: Model["Commands"];
}>;

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
    ) => Promise<ReplicaCommandResponse>;
  }
>;

type ReplicaAuthority<Model extends ReplicaModelDefinition> = Dependency<{
  Operations: ReplicaAuthorityWire<Model>;
}>;

type ReplicaClientCommandOperation<Command extends ReplicaCommand<object, object>> = (
  input: Command["Input"],
) => Promise<Readonly<{ id: string }>>;

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
    http: HttpClient;
    identifiers: Identifiers;
    scheduler: Scheduler;
    storage: LocalStore;
  }
>;

type ReplicaProvision<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in Model["Name"]]: ReplicaAuthority<Model>;
}>;

type ReplicaBrowserProvision<Model extends ReplicaModelDefinition> = Readonly<{
  [Name in Model["Name"]]: ReplicaClient<Model>;
}>;

type ReplicaFeatureContract<Model extends ReplicaModelDefinition> = Readonly<{
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

/** Defines one authorized local-first Replica over existing semantic Dependencies. */
export function createReplica<const Model extends ReplicaModelDefinition>(
  definition: ReplicaImplementation<Model>,
): DefinedReplica<Model> {
  const commits: ReplicaCommits<Model> = definition.commands;
  return createFeature<ReplicaFeatureContract<Model>>({
    programs: {
      server: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const identityName = typeLiteral<Model["Identity"]["Name"]>();
          const projectionName = typeLiteral<Model["ProjectionName"]>();
          const rowNames = typeKeys<Model["State"]>();
          const modelDependencies = replicaModelDependencies<Model>(
            dependencies,
            identityName,
            projectionName,
          );
          const schema = JSON.stringify(typeSchema<ReplicaProtocolSchema<Model>>());
          const authority = replicaAuthority(
            dependencies[projectionName],
            rowNames,
            commits,
            modelDependencies,
            typeLiteral<Model["Version"]>(),
            schema,
          );
          const path = `/api/replicas/${name}`;
          const route = dependencies.http.route({
            path,
            handle: replicaHttpHandler(
              authority,
              replicaIdentity<Model>(dependencies, identityName),
              path,
              Object.keys(commits),
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
                return authority.command(operation, input);
              },
              [Symbol.dispose]: () => route[Symbol.dispose](),
            }),
          } as unknown as DependencyImplementations<ReplicaProvision<Model>>;
        },
      },
      browser: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const identityName = replicaBrowserIdentityName(dependencies);
          const controller = new ReplicaController(
            name,
            replicaImplementationVersion(definition),
            definition,
            dependencies,
            (dependencies as Readonly<Record<string, object>>)[identityName] as Identity.Client<
              Model["Identity"]
            >,
          );
          void controller.start();
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
    if (name !== "http" && name !== "identifiers" && name !== "scheduler" && name !== "storage") {
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
  commands: ReplicaCommits<Model>,
  dependencies: Model["Dependencies"],
  version: Model["Version"],
  schema: string,
): Readonly<{
  pull(input: { principal: PrincipalOf<Model>; after?: string }): Promise<ReplicaPull<Model>>;
  command(operation: string, input: object): Promise<ReplicaCommandResponse>;
}> {
  const pull = async (input: {
    principal: PrincipalOf<Model>;
    after?: string;
  }): Promise<ReplicaPull<Model>> => {
    const current = await replicaSnapshot<Model>(projection, rowNames, input.principal);
    return {
      version,
      schema,
      cursor: current.cursor,
      ...(input.after === undefined ? { snapshot: current.state } : {}),
      changes:
        input.after === undefined || input.after === current.cursor
          ? []
          : [{ cursor: current.cursor, replace: current.state }],
    };
  };
  return Object.freeze({
    pull,
    async command(operation, received) {
      const request = received as Readonly<{
        principal: PrincipalOf<Model>;
        input: object;
        idempotencyKey: string;
      }>;
      const command = commands[operation] as
        | Readonly<{
            commit(context: {
              principal: PrincipalOf<Model>;
              input: object;
              idempotencyKey: string;
              dependencies: Model["Dependencies"];
            }): MaybePromise<object>;
          }>
        | undefined;
      if (!command) throw new ReplicaError("unknown-command", `Unknown command ${operation}.`);
      const result = await command.commit({
        principal: request.principal,
        input: request.input,
        idempotencyKey: request.idempotencyKey,
        dependencies,
      });
      return {
        result,
        pull: await pull({ principal: request.principal }),
      };
    },
  });
}

async function replicaSnapshot<Model extends ReplicaModelDefinition>(
  projection: Projection.Reference<Model["Projection"]>,
  rowNames: readonly Extract<keyof Model["State"], string>[],
  principal: PrincipalOf<Model>,
): Promise<Readonly<{ cursor: string; state: Model["State"] }>> {
  const state: Record<string, readonly object[]> = {};
  let cursor = "";
  for (const row of rowNames) {
    const name: string = row;
    const result = await dispatchDependency<ProjectionResult<Readonly<{ id: string }>>>(
      projection,
      name,
      { principal, query: { find: {} } },
    );
    if (result.kind !== "rows") {
      throw new ReplicaError("rejected", `Projection row ${name} returned analytics.`);
    }
    state[name] = result.matches.map(({ row: value }) => value);
    const positioned = `${name}:${result.cursor ?? "0"}`;
    cursor = cursor === "" ? positioned : `${cursor}|${positioned}`;
  }
  return {
    cursor,
    state: state as Model["State"],
  };
}

function replicaHttpHandler<Model extends ReplicaModelDefinition>(
  authority: ReturnType<typeof replicaAuthority<Model>>,
  identity: Identity.Service<Model["Identity"]>,
  path: string,
  commands: readonly string[],
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
              ? { principal: principal as PrincipalOf<Model>, after }
              : { principal: principal as PrincipalOf<Model> },
          ),
        );
      }
      const commandPrefix = `${path}/`;
      const command = request.path.startsWith(commandPrefix)
        ? request.path.slice(commandPrefix.length)
        : "";
      if (request.method !== "POST" || !replicaCommandExists(commands, command)) {
        return replicaJson({ message: "Not found." }, 404);
      }
      const idempotencyKey = getHttpValue(request.headers, { name: "x-kit-command" });
      if (!idempotencyKey) {
        throw new ReplicaError("invalid-command", "A stable command identity is required.");
      }
      return replicaJson(
        await authority.command(command, {
          principal: principal as PrincipalOf<Model>,
          input: JSON.parse(request.body) as object,
          idempotencyKey,
        }),
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

function replicaCommandExists(commands: readonly string[], command: string): boolean {
  for (const candidate of commands) {
    if (candidate === command) return true;
  }
  return false;
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

type StoredReplica<Model extends ReplicaModelDefinition> = Readonly<{
  version: number;
  schema?: string;
  principal: PrincipalOf<Model>;
  cursor?: string;
  committed?: object;
  pending: readonly Readonly<{ id: string; command: string; input: object }>[];
  rejected: readonly Readonly<{
    pending: Readonly<{ id: string; command: string; input: object }>;
    message: string;
  }>[];
}>;

type MigratedReplica<Model extends ReplicaModelDefinition> = Readonly<{
  committed?: Model["State"];
  pending: readonly ReplicaPending<Model>[];
  rejected: readonly ReplicaRejection<Model>[];
}>;

type StoredReplicaCommand = Readonly<{
  id: string;
  command: string;
  input: object;
}>;

type StoredReplicaRejection = Readonly<{
  pending: StoredReplicaCommand;
  message: string;
}>;

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
  readonly #definition: ReplicaClientImplementation<Model>;
  readonly #dependencies: ReplicaBrowserRequirements<Model>;
  readonly #identity: Identity.Client<Model["Identity"]>;
  readonly #listeners = new Set<(state: ReplicaState<Model>) => void>();
  #state: ReplicaState<Model> = {
    status: "signed-out",
    pending: [],
    rejected: [],
  };
  #committed: Model["State"] | undefined;
  #schema: string | undefined;
  #principal: PrincipalOf<Model> | undefined;
  #identitySubscription: Disposable | undefined;
  #retry: Disposable | undefined;
  #generation = 0;
  #retryAttempt = 0;
  #flushing: Promise<void> | undefined;
  #write: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(
    name: string,
    version: number,
    definition: ReplicaClientImplementation<Model>,
    dependencies: ReplicaBrowserRequirements<Model>,
    identity: Identity.Client<Model["Identity"]>,
    schema?: string,
  ) {
    this.#name = name;
    this.#version = version;
    this.#schema = schema;
    this.#definition = definition;
    this.#dependencies = dependencies;
    this.#identity = identity;
  }

  async start(): Promise<void> {
    this.#identitySubscription ??= this.#identity.subscribe((session) => {
      void this.#usePrincipal(session?.user as PrincipalOf<Model> | undefined).catch(
        (error: unknown) => this.#offline(error),
      );
    });
    await this.#usePrincipal(
      (await this.#identity.session())?.user as PrincipalOf<Model> | undefined,
    );
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
    if (operation in this.#definition.commands) return this.command(operation, input as object);
    const data = this.#state.data as
      | Readonly<Record<string, readonly Readonly<{ id: string }>[] | undefined>>
      | undefined;
    if (data !== undefined && Object.hasOwn(data, operation)) {
      return Promise.resolve(evaluateProjectionRows(data[operation] ?? [], input as object));
    }
    throw new ReplicaError("unknown-command", `Unknown Replica operation ${operation}.`);
  }

  async synchronize(): Promise<ReplicaState<Model>> {
    const principal = this.#requirePrincipal();
    const generation = this.#generation;
    this.#setState({ ...this.#state, status: "synchronizing" });
    try {
      const pull = await replicaRequest<ReplicaPull<Model>>(
        this.#dependencies.http,
        `/api/replicas/${this.#name}`,
        this.#state.cursor ? { after: this.#state.cursor } : {},
      );
      if (!this.#active(generation)) return this.#state;
      if (
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
      this.#setState({ ...this.#state, status: "synchronized" });
    } catch (error) {
      if (this.#active(generation)) this.#offline(error);
    }
    return this.#state;
  }

  async command(operation: string, input: object): Promise<Readonly<{ id: string }>> {
    this.#requirePrincipal();
    if (!(operation in this.#definition.commands)) {
      throw new ReplicaError("unknown-command", `Unknown command ${operation}.`);
    }
    if (this.#state.data === undefined) await this.synchronize();
    if (this.#state.data === undefined) {
      throw new ReplicaError("rejected", "Replica state is unavailable while offline.");
    }
    const pending = {
      id: this.#dependencies.identifiers.create({}),
      command: operation,
      input: cloneData(input),
    } as ReplicaPending<Model>;
    const pendingCommands = [...this.#state.pending, pending];
    this.#setState({
      ...this.#state,
      pending: pendingCommands,
      data: this.#replay(this.#committed!, pendingCommands),
    });
    this.#persist();
    void this.#flush(this.#requirePrincipal(), this.#generation);
    return { id: pending.id };
  }

  async retry(id: string): Promise<ReplicaState<Model>> {
    const rejection = this.#state.rejected.find(({ pending }) => pending.id === id);
    if (!rejection) return this.#state;
    this.#setState({
      ...this.#state,
      pending: [...this.#state.pending, rejection.pending],
      rejected: this.#state.rejected.filter(({ pending }) => pending.id !== id),
    });
    this.#persist();
    await this.#flush(this.#requirePrincipal(), this.#generation);
    return this.#state;
  }

  async dismiss(id: string): Promise<ReplicaState<Model>> {
    this.#setState({
      ...this.#state,
      rejected: this.#state.rejected.filter(({ pending }) => pending.id !== id),
    });
    this.#persist();
    return this.#state;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#identitySubscription?.[Symbol.dispose]();
    this.#retry?.[Symbol.dispose]();
    await Promise.allSettled([this.#flushing, this.#write].filter(Boolean));
    this.#listeners.clear();
  }

  async #usePrincipal(principal: PrincipalOf<Model> | undefined): Promise<void> {
    if (this.#disposed) return;
    if (!principal) {
      this.#principal = undefined;
      this.#committed = undefined;
      this.#generation += 1;
      this.#setState({ status: "signed-out", pending: [], rejected: [] });
      return;
    }
    if (this.#principal?.id === principal.id && equalData(this.#principal, principal)) {
      this.#principal = principal;
      await this.synchronize();
      return;
    }
    const sameIdentity = this.#principal?.id === principal.id;
    const authorityChanged = sameIdentity && !equalData(this.#principal, principal);
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
    this.#principal = principal;
    this.#committed = undefined;
    const generation = ++this.#generation;
    this.#retry?.[Symbol.dispose]();
    this.#retry = undefined;
    this.#setState({ status: "loading", pending, rejected });
    const stored = await this.#dependencies.storage.read<StoredReplica<Model>>({
      key: this.#storageKey(principal),
    });
    if (!this.#active(generation)) return;
    if (stored && equalData(stored.principal, principal)) {
      this.#schema = stored.schema;
      const migrated = this.#migrateStored(stored);
      this.#committed = migrated.committed;
      this.#setState({
        status: "loading",
        ...(stored.cursor ? { cursor: stored.cursor } : {}),
        ...(migrated.committed ? { data: this.#replay(migrated.committed, migrated.pending) } : {}),
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
    }
    await this.synchronize();
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
      ...(state === undefined ? {} : { committed: cloneData(state) as Model["State"] }),
      pending: cloneData(pending) as readonly ReplicaPending<Model>[],
      rejected: cloneData(rejected) as readonly ReplicaRejection<Model>[],
    };
  }

  #accept(pull: ReplicaPull<Model>): void {
    if (pull.snapshot !== undefined) this.#committed = cloneData(pull.snapshot);
    for (const change of pull.changes) {
      this.#committed = cloneData(change.replace);
    }
    const committed = this.#committed;
    this.#setState({
      ...this.#state,
      cursor: pull.cursor,
      ...(committed === undefined ? {} : { data: this.#replay(committed, this.#state.pending) }),
    });
    this.#persist();
  }

  async #flush(principal: PrincipalOf<Model>, generation: number): Promise<void> {
    if (this.#flushing) {
      await this.#flushing;
      if (this.#active(generation) && this.#state.pending.length) {
        await this.#flush(principal, generation);
      }
      return;
    }
    this.#flushing = (async () => {
      while (this.#state.pending.length && this.#active(generation)) {
        const pending = this.#state.pending[0]!;
        try {
          const response = await replicaRequest<ReplicaCommandResponse>(
            this.#dependencies.http,
            `/api/replicas/${this.#name}/${pending.command}`,
            {},
            {
              method: "POST",
              body: JSON.stringify(pending.input),
              headers: { "x-kit-command": pending.id },
            },
          );
          if (!this.#active(generation)) return;
          const remaining = this.#state.pending.slice(1);
          if (response.pull.snapshot !== undefined) {
            this.#committed = cloneData(response.pull.snapshot as Model["State"]);
          }
          for (const change of response.pull.changes) {
            this.#committed = cloneData(change.replace as Model["State"]);
          }
          this.#setState({
            ...this.#state,
            pending: remaining,
            cursor: response.pull.cursor,
            ...(this.#committed ? { data: this.#replay(this.#committed, remaining) } : {}),
          });
        } catch (error) {
          if (!this.#active(generation)) return;
          if (!(error instanceof ReplicaError)) {
            this.#offline(error);
            break;
          }
          const remaining = this.#state.pending.slice(1);
          this.#setState({
            ...this.#state,
            pending: remaining,
            rejected: [
              ...this.#state.rejected,
              {
                pending,
                message: error instanceof Error ? error.message : "Command rejected.",
              },
            ],
            ...(this.#committed === undefined
              ? {}
              : { data: this.#replay(this.#committed, remaining) }),
          });
        }
        this.#persist();
      }
    })().finally(() => {
      this.#flushing = undefined;
    });
    await this.#flushing;
  }

  #replay(committed: Model["State"], pending: readonly ReplicaPending<Model>[]): Model["State"] {
    let state = cloneData(committed);
    for (const command of pending) {
      const optimistic = this.#definition.optimistic[command.command] as
        | ((context: { state: Model["State"]; input: object }) => Model["State"])
        | undefined;
      if (optimistic) state = optimistic({ state, input: command.input });
    }
    return state;
  }

  #persist(): void {
    const principal = this.#principal;
    if (!principal) return;
    const stored: StoredReplica<Model> = {
      version: this.#version,
      ...(this.#schema ? { schema: this.#schema } : {}),
      principal: cloneData(principal),
      ...(this.#state.cursor ? { cursor: this.#state.cursor } : {}),
      ...(this.#committed ? { committed: this.#committed } : {}),
      pending: this.#state.pending,
      rejected: this.#state.rejected,
    };
    this.#write = this.#write
      .catch(() => undefined)
      .then(() =>
        this.#dependencies.storage.write({
          key: this.#storageKey(principal),
          value: stored,
        }),
      );
  }

  #setState(state: ReplicaState<Model>): void {
    this.#state = Object.freeze(state);
    for (const receive of this.#listeners) receive(this.#state);
  }

  #offline(error: unknown): void {
    if (this.#disposed || !this.#principal) return;
    this.#setState({
      ...this.#state,
      status: "offline",
      error: error instanceof Error ? error.message : "Synchronization failed.",
    });
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

  #storageKey(principal: PrincipalOf<Model>): string {
    return `replica:${this.#name}:${principal.id}`;
  }

  #active(generation: number): boolean {
    return !this.#disposed && generation === this.#generation;
  }
}

async function replicaRequest<Value>(
  http: HttpClient,
  path: string,
  query: Readonly<Record<string, string>>,
  request: Readonly<{
    method?: string;
    headers?: Readonly<Record<string, string>>;
    body?: string;
  }> = {},
): Promise<Value> {
  const search = new URLSearchParams(query).toString();
  const response = await http.request({
    path: search ? `${path}?${search}` : path,
    ...request,
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as Readonly<{
      message?: string;
    }>;
    throw new ReplicaError(
      "rejected",
      failure.message ?? `Replica request failed (${response.status}).`,
    );
  }
  return (await response.json()) as Value;
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
    online?: boolean;
  }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      client: ReplicaClient<Model>;
      state(): Promise<ReplicaState<Model>>;
      online(value: boolean): void;
      dropNextResponse(): void;
      principal(value: PrincipalOf<Model> | undefined): Promise<void>;
      storage: Map<string, unknown>;
    }>
> {
  const name = input.name ?? "replica";
  const version = input.version ?? (1 as Model["Version"]);
  const schema = input.schema ?? `fixture:${version}`;
  const authoritySchema = input.authoritySchema ?? schema;
  const storage = input.storage ?? new Map<string, unknown>();
  const authority = replicaAuthority(
    input.projection,
    input.rows,
    definition.commands,
    input.dependencies,
    version,
    authoritySchema,
  );
  let currentPrincipal: PrincipalOf<Model> | undefined = input.principal;
  let isOnline = input.online ?? true;
  let dropNextResponse = false;
  let identifier = 0;
  const sessionListeners = new Set<
    (session: Readonly<{ user: PrincipalOf<Model> }> | undefined) => void
  >();
  const identityService = {
    async authenticate() {
      return currentPrincipal;
    },
  } as unknown as Identity.Service<Model["Identity"]>;
  const handler = replicaHttpHandler(
    authority,
    identityService,
    `/api/replicas/${name}`,
    Object.keys(definition.commands),
  );
  const identityClient = {
    async session() {
      return currentPrincipal ? { user: currentPrincipal } : undefined;
    },
    async signIn() {
      if (!currentPrincipal) throw new Error("No fixture principal is configured.");
      return { user: currentPrincipal };
    },
    async signUp() {
      if (!currentPrincipal) throw new Error("No fixture principal is configured.");
      return { user: currentPrincipal };
    },
    async signOut() {
      currentPrincipal = undefined;
      for (const receive of sessionListeners) receive(undefined);
    },
    subscribe(receive: (session: Readonly<{ user: PrincipalOf<Model> }> | undefined) => void) {
      sessionListeners.add(receive);
      return { [Symbol.dispose]: () => sessionListeners.delete(receive) };
    },
  } as unknown as Identity.Client<Model["Identity"]>;
  const browserDependencies = {
    http: {
      async request(request: {
        path: string;
        method?: string;
        headers?: Readonly<Record<string, string>>;
        body?: string;
      }) {
        if (!isOnline) throw new Error("Fixture network is offline.");
        const url = new URL(request.path, "http://fixture");
        const response = await handler({
          method: request.method ?? "GET",
          path: url.pathname,
          query: [...url.searchParams].map(([fieldName, value]) => ({
            name: fieldName,
            value,
          })),
          headers: Object.entries(request.headers ?? {}).map(([fieldName, value]) => ({
            name: fieldName,
            value,
          })),
          body: request.body ?? "",
        });
        if (dropNextResponse) {
          dropNextResponse = false;
          throw new Error("Fixture response was lost after authority execution.");
        }
        const headers = new Headers();
        for (const field of response.headers) headers.append(field.name, field.value);
        return new Response(response.body, { status: response.status, headers });
      },
    },
    identifiers: {
      create() {
        identifier += 1;
        return `fixture-command-${identifier}`;
      },
    },
    scheduler: {
      after() {
        return { [Symbol.dispose]() {} };
      },
    },
    storage: {
      async read<Value>({ key }: { key: string }) {
        return storage.get(key) as Value | undefined;
      },
      async write<Value>({ key, value }: { key: string; value: Value }) {
        storage.set(key, cloneData(value));
      },
      async remove({ key }: { key: string }) {
        storage.delete(key);
      },
    },
  } as unknown as ReplicaBrowserRequirements<Model>;
  const controller = new ReplicaController(
    name,
    version,
    definition,
    browserDependencies,
    identityClient,
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
    async principal(value: PrincipalOf<Model> | undefined) {
      currentPrincipal = value;
      const session = value ? { user: value } : undefined;
      for (const receive of sessionListeners) receive(session);
      await Promise.resolve();
    },
    storage,
    [Symbol.asyncDispose]: () => controller[Symbol.asyncDispose](),
  } as unknown as AsyncDisposable & {
    client: ReplicaClient<Model>;
    state(): Promise<ReplicaState<Model>>;
    online(value: boolean): void;
    dropNextResponse(): void;
    principal(value: PrincipalOf<Model> | undefined): Promise<void>;
    storage: Map<string, unknown>;
  };
}
