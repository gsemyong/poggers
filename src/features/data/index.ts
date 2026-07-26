import {
  createUncheckedDependencyClient,
  type Dependency,
  type DependencyImplementation,
  type DependencyImplementations,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { distinctStream, mapStream } from "@/core/stream";
import { startFeatureFixture } from "@/execution/process";
import {
  createEntity,
  createMemoryEventStore,
  type EntityActions,
  type EntityAuthorization,
  type EntityApi,
  type EntityEvent,
  type EntityFeature,
  type EntityModel,
  type EntityPrincipal,
  type EntityService,
  type EntityState,
  type EntityValue,
  type EventStore,
} from "@/features/entity";
import type {
  HttpRequest,
  HttpResponse,
  ServerDependencyProvider,
  ServerProcess,
} from "@/platforms/server";
import type { BrowserMainThread, WebDependencyProvider } from "@/platforms/web";

type MaybePromise<Value> = Value | PromiseLike<Value>;
type FieldOf<Model extends DataModelDefinition> = Extract<keyof Model["Record"], string>;
type RecordOf<Model extends DataModelDefinition> = Model["Record"];
type CreateOf<Model extends DataModelDefinition> = Model["Create"];
type UpdateOf<Model extends DataModelDefinition> = Model["Update"];
type PrincipalOf<Model extends DataModelDefinition> = Model["Principal"];
type SourceName<Model extends DataModelDefinition> = `${Model["Name"]}Source`;
type Scalar = string | number | boolean | null;
declare const dataModel: unique symbol;

export type DataModelDefinition = Readonly<{
  Name: string;
  Principal: EntityPrincipal;
  Record: EntityValue;
  Create: object;
  Update: object;
}>;

/** Validates and preserves the semantic definition consumed by the data factory. */
export type DataModel<Definition extends DataModelDefinition> = Readonly<Definition>;

type TextField<Record extends EntityValue> = {
  [Field in Extract<keyof Record, string>]: NonNullable<Record[Field]> extends string
    ? Field
    : never;
}[Extract<keyof Record, string>];

type ScalarField<Record extends EntityValue> = {
  [Field in Extract<keyof Record, string>]: NonNullable<Record[Field]> extends Exclude<Scalar, null>
    ? Field
    : never;
}[Extract<keyof Record, string>];

type OrderedField<Record extends EntityValue> = {
  [Field in Extract<keyof Record, string>]: NonNullable<Record[Field]> extends string | number
    ? Field
    : never;
}[Extract<keyof Record, string>];

type OrderedValue<Value> = NonNullable<Value> extends string | number ? NonNullable<Value> : never;

export type DataCondition<Value> =
  | NonNullable<Value>
  | null
  | Readonly<{
      equals?: NonNullable<Value> | null;
      not?: NonNullable<Value> | null;
      oneOf?: readonly NonNullable<Value>[];
      greaterThan?: OrderedValue<Value>;
      atLeast?: OrderedValue<Value>;
      lessThan?: OrderedValue<Value>;
      atMost?: OrderedValue<Value>;
    }>;

export type DataQuery<Record extends EntityValue> = Readonly<{
  where?: Readonly<{
    [Field in ScalarField<Record>]?: DataCondition<Record[Field]>;
  }>;
  order?: readonly Readonly<{
    field: OrderedField<Record>;
    direction?: "ascending" | "descending";
  }>[];
  offset?: number;
  limit?: number;
}>;

export type DataSearch<Record extends EntityValue> = DataQuery<Record> & Readonly<{ text: string }>;

export type DataMatch<Record extends EntityValue> = Readonly<{
  record: Record;
  score: number;
}>;

export type DataSnapshot<Record extends EntityValue> = Readonly<{
  revision: number;
  records: readonly Record[];
}>;

export type DataSearchSnapshot<Record extends EntityValue> = Readonly<{
  revision: number;
  matches: readonly DataMatch<Record>[];
}>;

/** Adapter-facing projection request. It is not exposed by a Feature factory. */
export type DataProjectionQuery<Record extends EntityValue = EntityValue> = DataQuery<Record> &
  Readonly<{ text?: string }>;

export type DataProjectionResult<Record extends EntityValue = EntityValue> = Readonly<{
  record: Record;
  score?: number;
}>;

/** Replaceable local projection storage implemented by a Platform adapter. */
export type DataStore<Record extends EntityValue = EntityValue> = Dependency<{
  Operations: {
    replace(input: {
      collection: string;
      revision: number;
      records: readonly Record[];
      indexes: readonly string[];
      search: readonly string[];
    }): Promise<void>;
    query(input: {
      collection: string;
      query: DataProjectionQuery<Record>;
    }): Promise<readonly DataProjectionResult<Record>[]>;
  };
}>;

export type DataAuthorization<Model extends DataModelDefinition> =
  | Readonly<{
      operation: "read" | "create" | "remove";
      principal: PrincipalOf<Model>;
      record: RecordOf<Model>;
    }>
  | Readonly<{
      operation: "update";
      principal: PrincipalOf<Model>;
      previous: RecordOf<Model>;
      record: RecordOf<Model>;
    }>;

export type DataImplementation<Model extends DataModelDefinition> = Readonly<{
  indexes?: readonly Extract<FieldOf<Model>, ScalarField<RecordOf<Model>>>[];
  search?: readonly TextField<RecordOf<Model>>[];
  create(input: {
    id: string;
    principal: PrincipalOf<Model>;
    input: CreateOf<Model>;
  }): RecordOf<Model>;
  update(input: {
    principal: PrincipalOf<Model>;
    previous: RecordOf<Model>;
    input: UpdateOf<Model>;
  }): RecordOf<Model>;
  authorize(input: DataAuthorization<Model>): MaybePromise<boolean>;
}>;

export type DataApi<Model extends DataModelDefinition> = Dependency<{
  Operations: {
    get(input: { id: string }): Promise<RecordOf<Model>>;
    query(input?: DataQuery<RecordOf<Model>>): Promise<DataSnapshot<RecordOf<Model>>>;
    search(input: DataSearch<RecordOf<Model>>): Promise<DataSearchSnapshot<RecordOf<Model>>>;
    create(input: CreateOf<Model>): Promise<RecordOf<Model>>;
    update(input: { id: string; changes: UpdateOf<Model> }): Promise<RecordOf<Model>>;
    remove(input: { id: string }): Promise<RecordOf<Model>>;
    watch(input?: DataQuery<RecordOf<Model>>): AsyncIterable<DataSnapshot<RecordOf<Model>>>;
    watchSearch(
      input: DataSearch<RecordOf<Model>>,
    ): AsyncIterable<DataSearchSnapshot<RecordOf<Model>>>;
  };
}>;

export type DataService<Model extends DataModelDefinition> = Dependency<{
  Operations: {
    get(input: { principal: PrincipalOf<Model>; id: string }): Promise<RecordOf<Model>>;
    query(input: {
      principal: PrincipalOf<Model>;
      query?: DataQuery<RecordOf<Model>>;
    }): Promise<DataSnapshot<RecordOf<Model>>>;
    search(input: {
      principal: PrincipalOf<Model>;
      search: DataSearch<RecordOf<Model>>;
    }): Promise<DataSearchSnapshot<RecordOf<Model>>>;
    create(input: {
      principal: PrincipalOf<Model>;
      value: CreateOf<Model>;
    }): Promise<RecordOf<Model>>;
    update(input: {
      principal: PrincipalOf<Model>;
      id: string;
      changes: UpdateOf<Model>;
    }): Promise<RecordOf<Model>>;
    remove(input: { principal: PrincipalOf<Model>; id: string }): Promise<RecordOf<Model>>;
    watch(input: {
      principal: PrincipalOf<Model>;
      query?: DataQuery<RecordOf<Model>>;
    }): AsyncIterable<DataSnapshot<RecordOf<Model>>>;
    watchSearch(input: {
      principal: PrincipalOf<Model>;
      search: DataSearch<RecordOf<Model>>;
    }): AsyncIterable<DataSearchSnapshot<RecordOf<Model>>>;
  };
}>;

type SourceModel<Model extends DataModelDefinition> = EntityModel<{
  Name: SourceName<Model>;
  Principal: PrincipalOf<Model>;
  Value: RecordOf<Model>;
  Create: CreateOf<Model>;
  Update: UpdateOf<Model>;
  Filter: DataQuery<RecordOf<Model>>;
}>;

type SourceServer<Model extends DataModelDefinition> = Readonly<{
  [Name in SourceName<Model>]: EntityService<SourceModel<Model>>;
}>;

type SourceBrowser<Model extends DataModelDefinition> = Readonly<{
  [Name in SourceName<Model>]: EntityApi<SourceModel<Model>>;
}>;

type ServerProvision<Model extends DataModelDefinition> = Readonly<{
  [Name in Model["Name"]]: DataService<Model>;
}>;

type BrowserProvision<Model extends DataModelDefinition> = Readonly<{
  [Name in Model["Name"]]: DataApi<Model>;
}>;

export type DataFeature<Model extends DataModelDefinition> = Readonly<{
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: SourceServer<Model> & { dataStore: DataStore<RecordOf<Model>> };
      Provides: ServerProvision<Model>;
    };
    browser: {
      Environment: BrowserMainThread;
      Requires: SourceBrowser<Model> & { dataStore: DataStore<RecordOf<Model>> };
      Provides: BrowserProvision<Model>;
    };
  };
  Providers: {
    server: { dataStore: ServerDependencyProvider<DataStore<RecordOf<Model>>> };
    web: { dataStore: WebDependencyProvider<DataStore<RecordOf<Model>>> };
  };
  Features: { source: EntityFeature<SourceModel<Model>> };
}>;

export type DefinedData<Model extends DataModelDefinition> = Feature<DataFeature<Model>> &
  Readonly<{ readonly [dataModel]?: Model }>;

/** Feature-owned server realization for local Data projections. */
const serverDataStoreProvider: ServerDependencyProvider<DataStore> = {
  async development({ configuration }) {
    const { connect } = await import("@tursodatabase/database");
    const path = configuration.database;
    if (!path) throw new Error("The DataStore provider requires its database configuration.");
    return createTursoDataStoreImplementation(
      connect(path, { experimental: ["index_method"] }) as unknown as Promise<TursoDatabase>,
    );
  },
  production: {
    configuration: [
      {
        name: "database",
        environment: "KIT_DATA_DATABASE",
        default: ".kit/data/data.turso",
        allocation: {
          kind: "storage",
          name: "data.turso",
          scope: "deployment",
          type: "file",
        },
      },
    ],
    crate: { package: "kit-server-data", directory: "./providers/server/rust" },
    rust: { type: "kit_server_data::Data", constructor: "kit_server_data::create" },
  },
};

/** Feature-owned browser realization for local Data projections. */
const webDataStoreProvider: WebDependencyProvider<DataStore> = {
  requirements: { crossOriginIsolation: true },
  development() {
    return createTursoDataStoreImplementation(async () => {
      const { connect } = await import("@tursodatabase/database-wasm/vite");
      return (await connect("kit-data.db", {
        experimental: ["index_method"],
      })) as unknown as TursoDatabase;
    }) as DependencyImplementation<DataStore<EntityValue>> & AsyncDisposable;
  },
};

/** Binds one established principal to the server data service. */
export function bindDataPrincipal<Model extends DataModelDefinition>(
  service: DataService<Model>,
  principal: PrincipalOf<Model>,
): DataApi<Model> {
  return Object.freeze({
    get: ({ id }) => service.get({ principal, id }),
    query: (query) => service.query({ principal, query }),
    search: (search) => service.search({ principal, search }),
    create: (value) => service.create({ principal, value }),
    update: ({ id, changes }) => service.update({ principal, id, changes }),
    remove: ({ id }) => service.remove({ principal, id }),
    watch: (query) => service.watch({ principal, query }),
    watchSearch: (search) => service.watchSearch({ principal, search }),
  });
}

/** Creates a typed, event-sourced data Feature with local query projections. */
export function createData<Model extends DataModelDefinition>(
  implementation: DataImplementation<Model>,
): DefinedData<Model> {
  const serverStore = serverDataStoreProvider as unknown as ServerDependencyProvider<
    DataStore<RecordOf<Model>>
  >;
  const webStore = webDataStoreProvider as unknown as WebDependencyProvider<
    DataStore<RecordOf<Model>>
  >;
  const source = createEntity<SourceModel<Model>>({
    create: implementation.create,
    update: implementation.update,
    authorize: (input) => implementation.authorize(dataAuthorization(input)),
  });

  return createFeature<DataFeature<Model>>({
    providers: {
      server: { dataStore: serverStore },
      web: { dataStore: webStore },
    },
    features: { source },
    programs: {
      server: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const sourceName = `${name}Source` as SourceName<Model>;
          const authority = dependencies[sourceName] as EntityService<SourceModel<Model>>;
          const service = createDataService<Model>(authority, dependencies.dataStore, {
            name,
            indexes: implementation.indexes ?? [],
            search: implementation.search ?? [],
          });
          return {
            [name]: Object.freeze({
              get: ({ input }) => service.get(input),
              query: ({ input }) => service.query(input),
              search: ({ input }) => service.search(input),
              create: ({ input }) => service.create(input),
              update: ({ input }) => service.update(input),
              remove: ({ input }) => service.remove(input),
              watch: ({ input }) => service.watch(input),
              watchSearch: ({ input }) => service.watchSearch(input),
            } satisfies DependencyImplementation<DataService<Model>>),
          } as unknown as DependencyImplementations<ServerProvision<Model>>;
        },
      },
      browser: {
        start({ dependencies, provides }) {
          const name = provides[0] as Model["Name"];
          const sourceName = `${name}Source` as SourceName<Model>;
          const authority = dependencies[sourceName] as EntityApi<SourceModel<Model>>;
          const api = createDataApi<Model>(authority, dependencies.dataStore, {
            name,
            indexes: implementation.indexes ?? [],
            search: implementation.search ?? [],
          });
          return {
            [name]: Object.freeze({
              get: ({ input }) => api.get(input),
              query: ({ input }) => api.query(input),
              search: ({ input }) => api.search(input),
              create: ({ input }) => api.create(input),
              update: ({ input }) => api.update(input),
              remove: ({ input }) => api.remove(input),
              watch: ({ input }) => api.watch(input),
              watchSearch: ({ input }) => api.watchSearch(input),
            } satisfies DependencyImplementation<DataApi<Model>>),
          } as unknown as DependencyImplementations<BrowserProvision<Model>>;
        },
      },
    },
  }) as DefinedData<Model>;
}

type ProjectionConfiguration = Readonly<{
  name: string;
  indexes: readonly string[];
  search: readonly string[];
}>;

function createDataService<Model extends DataModelDefinition>(
  authority: EntityService<SourceModel<Model>>,
  store: DataStore<RecordOf<Model>>,
  configuration: ProjectionConfiguration,
): DataService<Model> {
  return Object.freeze({
    get: (input) => authority.get(input),
    async query({ principal, query }) {
      const snapshot = await authority.list({ principal });
      return projectQuery(
        store,
        collection(configuration.name, principal),
        snapshot,
        configuration,
        query,
      );
    },
    async search({ principal, search }) {
      const snapshot = await authority.list({ principal });
      return projectSearch(
        store,
        collection(configuration.name, principal),
        snapshot,
        configuration,
        search,
      );
    },
    create: ({ principal, value }) => authority.create({ principal, value }),
    update: ({ principal, id, changes }) => authority.update({ principal, id, changes }),
    remove: ({ principal, id }) => authority.remove({ principal, id }),
    watch({ principal, query }) {
      return watchQuery(
        authority.changes({ principal }),
        store,
        collection(configuration.name, principal),
        configuration,
        query,
      );
    },
    watchSearch({ principal, search }) {
      return watchSearch(
        authority.changes({ principal }),
        store,
        collection(configuration.name, principal),
        configuration,
        search,
      );
    },
  });
}

function createDataApi<Model extends DataModelDefinition>(
  authority: EntityApi<SourceModel<Model>>,
  store: DataStore<RecordOf<Model>>,
  configuration: ProjectionConfiguration,
): DataApi<Model> {
  const collectionName = `browser:${configuration.name}`;
  return Object.freeze({
    get: (input) => authority.get(input),
    async query(query) {
      const snapshot = await authority.list();
      return projectQuery(store, collectionName, snapshot, configuration, query);
    },
    async search(search) {
      const snapshot = await authority.list();
      return projectSearch(store, collectionName, snapshot, configuration, search);
    },
    create: (input) => authority.create(input),
    update: (input) => authority.update(input),
    remove: (input) => authority.remove(input),
    watch(query) {
      return watchQuery(authority.changes(), store, collectionName, configuration, query);
    },
    watchSearch(search) {
      return watchSearch(authority.changes(), store, collectionName, configuration, search);
    },
  });
}

async function projectQuery<Model extends DataModelDefinition>(
  store: DataStore<RecordOf<Model>>,
  collectionName: string,
  snapshot: Readonly<{ revision: number; entities: readonly RecordOf<Model>[] }>,
  configuration: ProjectionConfiguration,
  query?: DataQuery<RecordOf<Model>>,
): Promise<DataSnapshot<RecordOf<Model>>> {
  await replaceProjection(store, collectionName, snapshot, configuration);
  const records = await store.query({
    collection: collectionName,
    query: query ?? {},
  });
  return {
    revision: snapshot.revision,
    records: Object.freeze(records.map(({ record }) => record)),
  };
}

async function projectSearch<Model extends DataModelDefinition>(
  store: DataStore<RecordOf<Model>>,
  collectionName: string,
  snapshot: Readonly<{ revision: number; entities: readonly RecordOf<Model>[] }>,
  configuration: ProjectionConfiguration,
  search: DataSearch<RecordOf<Model>>,
): Promise<DataSearchSnapshot<RecordOf<Model>>> {
  await replaceProjection(store, collectionName, snapshot, configuration);
  const matches = await store.query({
    collection: collectionName,
    query: { ...search, text: search.text },
  });
  return {
    revision: snapshot.revision,
    matches: Object.freeze(
      matches.map(({ record, score }) => ({
        record,
        score: score ?? 0,
      })),
    ),
  };
}

async function replaceProjection<Model extends DataModelDefinition>(
  store: DataStore<RecordOf<Model>>,
  collectionName: string,
  snapshot: Readonly<{ revision: number; entities: readonly RecordOf<Model>[] }>,
  configuration: ProjectionConfiguration,
): Promise<void> {
  await store.replace({
    collection: collectionName,
    revision: snapshot.revision,
    records: snapshot.entities,
    indexes: configuration.indexes,
    search: configuration.search,
  });
}

function watchQuery<Model extends DataModelDefinition>(
  snapshots: AsyncIterable<Readonly<{ revision: number; entities: readonly RecordOf<Model>[] }>>,
  store: DataStore<RecordOf<Model>>,
  collectionName: string,
  configuration: ProjectionConfiguration,
  query?: DataQuery<RecordOf<Model>>,
): AsyncIterable<DataSnapshot<RecordOf<Model>>> {
  return distinctStream(
    mapStream(snapshots, (snapshot) =>
      projectQuery(store, collectionName, snapshot, configuration, query),
    ),
    ({ records }) => records,
  );
}

function watchSearch<Model extends DataModelDefinition>(
  snapshots: AsyncIterable<Readonly<{ revision: number; entities: readonly RecordOf<Model>[] }>>,
  store: DataStore<RecordOf<Model>>,
  collectionName: string,
  configuration: ProjectionConfiguration,
  search: DataSearch<RecordOf<Model>>,
): AsyncIterable<DataSearchSnapshot<RecordOf<Model>>> {
  return distinctStream(
    mapStream(snapshots, (snapshot) =>
      projectSearch(store, collectionName, snapshot, configuration, search),
    ),
    ({ matches }) => matches,
  );
}

function collection<Model extends DataModelDefinition>(
  name: string,
  principal: PrincipalOf<Model>,
): string {
  return `${name}:${principal.id}`;
}

function dataAuthorization<Model extends DataModelDefinition>(
  input: EntityAuthorization<SourceModel<Model>>,
): DataAuthorization<Model> {
  if (input.operation === "update") {
    return {
      operation: input.operation,
      principal: input.principal,
      previous: input.previous,
      record: input.entity,
    };
  }
  return {
    operation: input.operation,
    principal: input.principal,
    record: input.entity,
  };
}

/** Reference predicate used by conformance tests and non-SQL realizations. */
export function matchesDataQuery<Record extends EntityValue>(
  record: Record,
  query: DataQuery<Record>,
): boolean {
  for (const [field, condition] of Object.entries(query.where ?? {})) {
    if (!matchesCondition(Reflect.get(record, field), condition)) return false;
  }
  return true;
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
    return Object.is(value, condition);
  }
  const operations = condition as Readonly<Record<string, unknown>>;
  if ("equals" in operations && !Object.is(value, operations.equals)) return false;
  if ("not" in operations && Object.is(value, operations.not)) return false;
  if (
    "oneOf" in operations &&
    (!Array.isArray(operations.oneOf) ||
      !operations.oneOf.some((candidate) => Object.is(value, candidate)))
  ) {
    return false;
  }
  if ("greaterThan" in operations && !compare(value, operations.greaterThan, (a, b) => a > b)) {
    return false;
  }
  if ("atLeast" in operations && !compare(value, operations.atLeast, (a, b) => a >= b)) {
    return false;
  }
  if ("lessThan" in operations && !compare(value, operations.lessThan, (a, b) => a < b)) {
    return false;
  }
  if ("atMost" in operations && !compare(value, operations.atMost, (a, b) => a <= b)) {
    return false;
  }
  return true;
}

type Statement = string | Readonly<{ sql: string; args?: readonly unknown[] }>;

export type TursoDatabase = Readonly<{
  exec(sql: string): Promise<void>;
  batch(statements: readonly Statement[], mode?: "deferred" | "immediate"): Promise<unknown>;
  all(sql: string, ...parameters: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  close(): Promise<void>;
}>;

type TursoDatabaseSource = Promise<TursoDatabase> | (() => Promise<TursoDatabase>);

/** Implements the Data projection contract over the common Turso database API. */
export function createTursoDataStore<Record extends EntityValue = EntityValue>(
  source: TursoDatabaseSource,
): DataStore<Record> & AsyncDisposable {
  const collections = new Map<string, Promise<Collection<Record>>>();
  const connect = typeof source === "function" ? source : () => source;
  let database = typeof source === "function" ? undefined : source;
  let disposed = false;
  const requireDatabase = async () => {
    if (disposed) throw new Error("The Turso data store is disposed.");
    database ??= connect();
    return database;
  };
  const ensure = (
    name: string,
    indexes: readonly string[] = [],
    search: readonly string[] = [],
  ): Promise<Collection<Record>> => {
    let pending = collections.get(name);
    if (!pending) {
      pending = createCollection(requireDatabase(), name);
      collections.set(name, pending);
    }
    return pending.then(async (collection) => {
      await collection.configure(indexes, search);
      return collection;
    });
  };

  const store: DataStore<Record> & AsyncDisposable = {
    async replace({ collection, revision, records, indexes, search }) {
      const current = await ensure(collection, indexes, search);
      await current.replace(revision, records, search);
    },
    async query({ collection, query }) {
      const current = await ensure(collection);
      return current.query(query);
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      collections.clear();
      if (database) await (await database).close();
    },
  };
  return Object.freeze(store);
}

/** Implements the DataStore provider envelope for a host adapter. */
function createTursoDataStoreImplementation<Record extends EntityValue = EntityValue>(
  database: TursoDatabaseSource,
): DependencyImplementation<DataStore<Record>> & AsyncDisposable {
  const store = createTursoDataStore<Record>(database);
  return Object.freeze({
    replace: ({ input }) => store.replace(input),
    query: ({ input }) => store.query(input),
    [Symbol.asyncDispose]: () => store[Symbol.asyncDispose](),
  } satisfies DependencyImplementation<DataStore<Record>> & AsyncDisposable);
}

type Collection<Record extends EntityValue> = Readonly<{
  configure(indexes: readonly string[], search: readonly string[]): Promise<void>;
  replace(revision: number, records: readonly Record[], search: readonly string[]): Promise<void>;
  query(query: DataProjectionQuery<Record>): Promise<readonly DataProjectionResult<Record>[]>;
}>;

async function createCollection<Record extends EntityValue>(
  database: Promise<TursoDatabase>,
  name: string,
): Promise<Collection<Record>> {
  const connection = await database;
  const table = `kit_data_${hash(name)}`;
  const configuredIndexes = new Set<string>();
  let searchable = false;
  let projectedRevision: number | undefined;
  let projectedSearch: string | undefined;
  await connection.exec(`
    CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      record TEXT NOT NULL,
      search_text TEXT NOT NULL
    )
  `);

  return {
    async configure(indexes, search) {
      for (const field of indexes) {
        identifier(field);
        if (configuredIndexes.has(field)) continue;
        await connection.exec(
          `CREATE INDEX IF NOT EXISTS ${table}_${hash(field)} ` +
            `ON ${table}(json_extract(record, ${quote(jsonPath(field))}))`,
        );
        configuredIndexes.add(field);
      }
      if (search.length && !searchable) {
        for (const field of search) identifier(field);
        await connection.exec(
          `CREATE INDEX IF NOT EXISTS ${table}_search ON ${table} USING fts (search_text)`,
        );
        searchable = true;
      }
    },
    async replace(revision, records, search) {
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new TypeError("A data projection revision must be a non-negative safe integer.");
      }
      if (projectedRevision !== undefined && revision < projectedRevision) {
        throw new Error(
          `Data projection ${JSON.stringify(name)} cannot move from revision ${projectedRevision} to ${revision}.`,
        );
      }
      const searchKey = JSON.stringify(search);
      if (projectedRevision === revision && projectedSearch === searchKey) return;
      const statements: Statement[] = [`DELETE FROM ${table}`];
      for (const value of records) {
        const record = dataRecord(value);
        statements.push({
          sql: `INSERT INTO ${table} (id, revision, record, search_text) VALUES (?, ?, ?, ?)`,
          args: [
            record.id,
            revision,
            JSON.stringify(record),
            search
              .map((field) => Reflect.get(record, field))
              .filter((field): field is string => typeof field === "string")
              .join("\n"),
          ],
        });
      }
      await connection.batch(statements, "immediate");
      projectedRevision = revision;
      projectedSearch = searchKey;
    },
    async query(query) {
      const compiled = compileQuery(table, query, searchable);
      const rows = await connection.all(compiled.sql, ...compiled.parameters);
      return rows.map((row) => ({
        record: JSON.parse(String(row.record)) as Record,
        ...(typeof row.score === "number" ? { score: row.score } : {}),
      }));
    },
  };
}

type CompiledQuery = Readonly<{ sql: string; parameters: readonly unknown[] }>;

function compileQuery<Record extends EntityValue>(
  table: string,
  query: DataProjectionQuery<Record>,
  searchable: boolean,
): CompiledQuery {
  const clauses: string[] = [];
  const parameters: unknown[] = [];
  const text = query.text === undefined ? undefined : searchText(query.text);
  if (text !== undefined) {
    if (!searchable || text === "") {
      return { sql: `SELECT record FROM ${table} WHERE 0`, parameters };
    }
    clauses.push("fts_match(search_text, ?)");
    parameters.push(text);
  }
  for (const [field, condition] of Object.entries(query.where ?? {})) {
    identifier(field);
    compileCondition(
      `json_extract(record, ${quote(jsonPath(field))})`,
      condition,
      clauses,
      parameters,
    );
  }
  const score = text === undefined ? "NULL AS score" : "fts_score(search_text, ?) AS score";
  if (text !== undefined && text !== "") parameters.unshift(text);
  const order = compileOrder(query.order, text !== undefined);
  const pagination = compilePagination(query, parameters);
  const matches =
    `SELECT id, record, ${score} FROM ${table}` +
    (clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "");
  return {
    sql: `SELECT record, score FROM (${matches}) AS matches ORDER BY ${order}${pagination}`,
    parameters,
  };
}

function compileCondition(
  expression: string,
  condition: unknown,
  clauses: string[],
  parameters: unknown[],
): void {
  if (condition === null || typeof condition !== "object" || Array.isArray(condition)) {
    equality(expression, condition, false, clauses, parameters);
    return;
  }
  const operations = condition as Readonly<Record<string, unknown>>;
  const supported = new Set([
    "equals",
    "not",
    "oneOf",
    "greaterThan",
    "atLeast",
    "lessThan",
    "atMost",
  ]);
  for (const operation of Object.keys(operations)) {
    if (!supported.has(operation)) {
      throw new TypeError(`Unsupported data query operation ${JSON.stringify(operation)}.`);
    }
  }
  if ("equals" in operations) {
    equality(expression, operations.equals, false, clauses, parameters);
  }
  if ("not" in operations) equality(expression, operations.not, true, clauses, parameters);
  if ("oneOf" in operations) {
    if (!Array.isArray(operations.oneOf)) {
      throw new TypeError("Data query oneOf must be an array.");
    }
    if (!operations.oneOf.length) clauses.push("0");
    else {
      clauses.push(`${expression} IN (${operations.oneOf.map(() => "?").join(", ")})`);
      parameters.push(...operations.oneOf.map(bindValue));
    }
  }
  comparison(expression, "greaterThan", ">", operations, clauses, parameters);
  comparison(expression, "atLeast", ">=", operations, clauses, parameters);
  comparison(expression, "lessThan", "<", operations, clauses, parameters);
  comparison(expression, "atMost", "<=", operations, clauses, parameters);
}

function equality(
  expression: string,
  value: unknown,
  negated: boolean,
  clauses: string[],
  parameters: unknown[],
): void {
  if (value === null) {
    clauses.push(`${expression} IS ${negated ? "NOT " : ""}NULL`);
    return;
  }
  clauses.push(`${expression} ${negated ? "!=" : "="} ?`);
  parameters.push(bindValue(value));
}

function comparison(
  expression: string,
  operation: string,
  operator: string,
  operations: Readonly<Record<string, unknown>>,
  clauses: string[],
  parameters: unknown[],
): void {
  if (!(operation in operations)) return;
  const value = operations[operation];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new TypeError(`Data query ${operation} requires a string or number.`);
  }
  clauses.push(`${expression} ${operator} ?`);
  parameters.push(value);
}

function compileOrder<Record extends EntityValue>(
  order: DataProjectionQuery<Record>["order"],
  search: boolean,
): string {
  const fields = (order ?? []).map(({ field, direction = "ascending" }) => {
    identifier(field);
    return (
      `json_extract(record, ${quote(jsonPath(field))}) ` +
      (direction === "descending" ? "DESC" : "ASC")
    );
  });
  if (search && !fields.length) fields.push("score ASC");
  fields.push("id ASC");
  return fields.join(", ");
}

function compilePagination<Record extends EntityValue>(
  query: DataProjectionQuery<Record>,
  parameters: unknown[],
): string {
  const offset = query.offset ?? 0;
  const limit = query.limit;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new TypeError("Data query offset must be a non-negative safe integer.");
  }
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new TypeError("Data query limit must be a non-negative safe integer.");
  }
  if (limit === undefined && offset === 0) return "";
  parameters.push(limit ?? -1, offset);
  return " LIMIT ? OFFSET ?";
}

function dataRecord(value: unknown): Readonly<Record<string, unknown>> & { id: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A projected data record must be an object.");
  }
  const id = Reflect.get(value, "id");
  if (typeof id !== "string" || id === "") {
    throw new TypeError("A projected data record must have a non-empty string id.");
  }
  return value as Readonly<Record<string, unknown>> & { id: string };
}

function identifier(value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new TypeError(`Data field ${JSON.stringify(value)} is not a portable identifier.`);
  }
}

function jsonPath(field: string): string {
  return `$.${field}`;
}

function bindValue(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError("Data predicates support only finite numbers, strings, booleans, and null.");
}

function searchText(value: string): string {
  return [...value.matchAll(/[\p{L}\p{N}_]+/gu)].map(([term]) => `"${term}"`).join(" ");
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function hash(value: string): string {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0)!;
    result = Math.imul(result, 16_777_619);
  }
  return (result >>> 0).toString(36);
}

type StoredCollection<Record extends EntityValue> = Readonly<{
  revision: number;
  records: readonly Record[];
  search: readonly string[];
}>;

/** In-memory reference realization for Data Feature and adapter conformance tests. */
export function createMemoryDataStore<Record extends EntityValue>(): DataStore<Record> {
  const collections = new Map<string, StoredCollection<Record>>();
  return Object.freeze({
    async replace({ collection, revision, records, search }) {
      const current = collections.get(collection);
      if (current && revision < current.revision) {
        throw new Error(
          `Data projection ${JSON.stringify(collection)} cannot move from revision ${current.revision} to ${revision}.`,
        );
      }
      if (current?.revision === revision && equalStrings(current.search, search)) return;
      collections.set(collection, {
        revision,
        records: structuredClone(records),
        search: Object.freeze([...search]),
      });
    },
    async query({ collection, query }) {
      const stored = collections.get(collection) ?? { revision: 0, records: [], search: [] };
      return queryMemory(stored, query);
    },
  });
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Mounts a specialized Data Feature with deterministic in-memory host Dependencies. */
export async function createDataFixture<Model extends DataModelDefinition>(
  data: DefinedData<Model>,
  input: Readonly<{
    principal: Model["Principal"];
    store?: DataStore<Model["Record"]>;
  }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      api: DataApi<Model>;
      service: DataService<Model>;
      events: EventStore<EntityEvent<Model["Record"]>>;
      store: DataStore<Model["Record"]>;
      as(principal: Model["Principal"]): DataApi<Model>;
    }>
> {
  const name = "data" as Model["Name"];
  const sourceName = `${name}Source`;
  const events = createMemoryEventStore<EntityEvent<Model["Record"]>>();
  const store = input.store ?? createMemoryDataStore<Model["Record"]>();
  let identifier = 0;
  let time = 0;
  const process = await startFeatureFixture<DataFeature<Model>>({
    feature: data,
    program: "server",
    contributions: [
      { feature: "", requires: [sourceName, "dataStore"], provides: [name] },
      {
        feature: "source",
        requires: ["identity", "events", "identifiers", "clock", "http"],
        provides: [sourceName],
      },
    ],
    dependencies: {
      identity: { authenticate: async () => input.principal },
      events,
      identifiers: { create: () => `record-${++identifier}` },
      clock: { now: () => ++time },
      http: { route: () => ({ [Symbol.dispose]: () => undefined }) },
      dataStore: store,
    },
  });
  const implementation = process.contributions.find(({ address }) => address.feature === "feature")
    ?.provided[name];
  if (!implementation || typeof implementation !== "object") {
    await process.dispose();
    throw new Error("The Data fixture did not provide its semantic API.");
  }
  const service = createUncheckedDependencyClient(implementation as never) as DataService<Model>;
  return {
    api: bindDataPrincipal(service, input.principal),
    service,
    events,
    store,
    as: (principal) => bindDataPrincipal(service, principal),
    [Symbol.asyncDispose]: () => process.dispose(),
  };
}

/** Mounts the generated browser and server Programs around an in-memory transport. */
export async function createDataBrowserFixture<Model extends DataModelDefinition>(
  data: DefinedData<Model>,
  input: Readonly<{
    principal: Model["Principal"];
    store?: DataStore<Model["Record"]>;
  }>,
): Promise<
  AsyncDisposable &
    Readonly<{
      api: DataApi<Model>;
      state: EntityState<DataSourceModel<Model>>;
      actions: EntityActions<DataSourceModel<Model>>;
      events: EventStore<EntityEvent<Model["Record"]>>;
      store: DataStore<Model["Record"]>;
    }>
> {
  const name = "data" as Model["Name"];
  const sourceName = `${name}Source`;
  const events = createMemoryEventStore<EntityEvent<Model["Record"]>>();
  const store = input.store ?? createMemoryDataStore<Model["Record"]>();
  const storage = memoryStore();
  let handler: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;
  let identifier = 0;
  let time = 0;
  const server = await startFeatureFixture<DataFeature<Model>>({
    feature: data,
    program: "server",
    contributions: [
      { feature: "", requires: [sourceName, "dataStore"], provides: [name] },
      {
        feature: "source",
        requires: ["identity", "events", "identifiers", "clock", "http"],
        provides: [sourceName],
      },
    ],
    dependencies: {
      identity: { authenticate: async () => input.principal },
      events,
      identifiers: { create: () => `server-record-${++identifier}` },
      clock: { now: () => ++time },
      http: {
        route(route: { handle(request: HttpRequest): Promise<HttpResponse> }) {
          handler = route.handle;
          return { [Symbol.dispose]: () => (handler = undefined) };
        },
      },
      dataStore: store,
    },
  });
  const browser = await startFeatureFixture<DataFeature<Model>>({
    feature: data,
    program: "browser",
    contributions: [
      { feature: "", requires: [sourceName, "dataStore"], provides: [name] },
      {
        feature: "source",
        requires: ["identity", "http", "storage", "identifiers", "scheduler"],
        provides: [sourceName],
      },
    ],
    dependencies: {
      identity: {
        session: async () => ({ user: input.principal }),
        signIn: async () => ({ user: input.principal }),
        signUp: async () => ({ user: input.principal }),
        signOut: async () => undefined,
        subscribe: () => ({ [Symbol.dispose]: () => undefined }),
      },
      http: {
        request(request: WebRequest) {
          if (!handler) throw new Error("The Data fixture route is not mounted.");
          return webResponse(handler(httpRequest(request)));
        },
      },
      storage,
      identifiers: { create: () => `browser-record-${++identifier}` },
      scheduler: {
        after({ milliseconds, run }: { milliseconds: number; run(): void }) {
          const timeout = setTimeout(run, milliseconds);
          return { [Symbol.dispose]: () => clearTimeout(timeout) };
        },
      },
      dataStore: store,
    },
  });
  const implementation = browser.contributions.find(({ address }) => address.feature === "feature")
    ?.provided[name];
  if (!implementation || typeof implementation !== "object") {
    await browser.dispose();
    await server.dispose();
    throw new Error("The Data browser fixture did not provide its semantic API.");
  }
  const api = createUncheckedDependencyClient(implementation as never) as DataApi<Model>;
  return {
    api,
    get state() {
      return browser.ui["feature.source"] as EntityState<DataSourceModel<Model>>;
    },
    actions: browser.contributions.find(({ address }) => address.feature === "feature.source")!.ui!
      .actions as EntityActions<DataSourceModel<Model>>,
    events,
    store,
    async [Symbol.asyncDispose]() {
      await browser.dispose();
      await server.dispose();
    },
  };
}

type DataSourceModel<Model extends DataModelDefinition> = Readonly<{
  Name: `${Model["Name"]}Source`;
  Principal: Model["Principal"];
  Value: Model["Record"];
  Create: Model["Create"];
  Update: Model["Update"];
  Filter: object;
}>;

type WebRequest = Readonly<{
  path: string;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}>;

function memoryStore() {
  const values = new Map<string, unknown>();
  return {
    async read<Value>({ key }: { key: string }): Promise<Value | undefined> {
      return structuredClone(values.get(key)) as Value | undefined;
    },
    async write<Value>({ key, value }: { key: string; value: Value }): Promise<void> {
      values.set(key, structuredClone(value));
    },
    async remove({ key }: { key: string }): Promise<void> {
      values.delete(key);
    },
  };
}

function httpRequest(input: WebRequest): HttpRequest {
  const url = new URL(input.path, "http://fixture.local");
  return {
    method: input.method ?? "GET",
    path: url.pathname,
    query: [...url.searchParams].map(([name, value]) => ({ name, value })),
    headers: Object.entries(input.headers ?? {}).map(([name, value]) => ({ name, value })),
    body: input.body ?? "",
  };
}

async function webResponse(value: Promise<HttpResponse>): Promise<Response> {
  const response = await value;
  const headers = new Headers();
  for (const { name, value: header } of response.headers) headers.append(name, header);
  if (response.body !== undefined) {
    return new Response(response.body, { status: response.status, headers });
  }
  const iterator = response.stream?.[Symbol.asyncIterator]();
  const body = iterator
    ? new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(new TextEncoder().encode(next.value));
        },
        async cancel() {
          await iterator.return?.();
        },
      })
    : null;
  return new Response(body, { status: response.status, headers });
}

function queryMemory<Record extends EntityValue>(
  stored: StoredCollection<Record>,
  query: DataProjectionQuery<Record>,
): readonly DataProjectionResult<Record>[] {
  const text = query.text?.trim();
  if (text !== undefined && text === "") return [];
  const terms = text === undefined ? [] : tokenize(text);
  let rows = stored.records
    .filter((record) =>
      (
        matchesDataQuery as (
          record: EntityValue,
          query: DataProjectionQuery<EntityValue>,
        ) => boolean
      )(record, query as DataProjectionQuery<EntityValue>),
    )
    .map((record) => ({
      record,
      score: terms.length ? searchScore(record, stored.search, terms) : undefined,
    }))
    .filter((row) => !terms.length || row.score !== undefined);
  rows = rows.sort((left, right) => compareRows(left, right, query));
  const offset = query.offset ?? 0;
  const limit = query.limit ?? rows.length;
  return rows.slice(offset, offset + limit);
}

function compareRows<Record extends EntityValue>(
  left: DataProjectionResult<Record>,
  right: DataProjectionResult<Record>,
  query: DataProjectionQuery<Record>,
): number {
  for (const { field, direction = "ascending" } of query.order ?? []) {
    const compared = compareValues(
      Reflect.get(left.record as object, field),
      Reflect.get(right.record as object, field),
    );
    if (compared !== 0) return direction === "descending" ? -compared : compared;
  }
  if (query.text !== undefined && !(query.order?.length ?? 0)) {
    const compared = (left.score ?? 0) - (right.score ?? 0);
    if (compared !== 0) return compared;
  }
  return String(Reflect.get(left.record as object, "id")).localeCompare(
    String(Reflect.get(right.record as object, "id")),
  );
}

function compareValues(left: unknown, right: unknown): number {
  if (Object.is(left, right)) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return left < right ? -1 : 1;
}

function searchScore(
  record: object,
  fields: readonly string[],
  terms: readonly string[],
): number | undefined {
  const words = tokenize(
    fields
      .map((field) => Reflect.get(record, field))
      .filter((value): value is string => typeof value === "string")
      .join(" "),
  );
  let matches = 0;
  for (const term of terms) {
    const count = words.filter((word) => word === term).length;
    if (!count) return undefined;
    matches += count;
  }
  return -matches;
}

function tokenize(value: string): string[] {
  return [...value.toLocaleLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)].map(([term]) => term);
}

function compare(
  left: unknown,
  right: unknown,
  operation: (left: string | number, right: string | number) => boolean,
): boolean {
  if (
    (typeof left !== "string" && typeof left !== "number") ||
    (typeof right !== "string" && typeof right !== "number") ||
    typeof left !== typeof right
  ) {
    return false;
  }
  return operation(left, right);
}
