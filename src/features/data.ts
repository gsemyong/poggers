import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import { distinctStream, mapStream } from "@/core/stream";
import {
  createEntity,
  type EntityAuthorization,
  type EntityApi,
  type EntityBrowserFeature,
  type EntityModel,
  type EntityPrincipal,
  type EntityServerFeature,
  type EntityService,
  type EntityValue,
} from "@/features/entity";
import type { ServerProcess } from "@/platforms/server/platform";
import type { BrowserMainThread } from "@/platforms/web/platform";

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
export type DataStore<Record extends EntityValue = EntityValue> = Readonly<{
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
  name: Model["Name"];
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

export type DataApi<Model extends DataModelDefinition> = Readonly<{
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
}>;

export type DataService<Model extends DataModelDefinition> = Readonly<{
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

export type DataServerFeature<Model extends DataModelDefinition> = Readonly<{
  Programs: {
    server: Program<
      ServerProcess,
      {
        Requires: SourceServer<Model> & { dataStore: DataStore<RecordOf<Model>> };
        Provides: ServerProvision<Model>;
      }
    >;
  };
  Features: { source: EntityServerFeature<SourceModel<Model>> };
}>;

export type DataBrowserFeature<Model extends DataModelDefinition> = Readonly<{
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        Requires: SourceBrowser<Model> & { dataStore: DataStore<RecordOf<Model>> };
        Provides: BrowserProvision<Model>;
      }
    >;
  };
  Features: { source: EntityBrowserFeature<SourceModel<Model>> };
}>;

export type DefinedData<Model extends DataModelDefinition> = Readonly<{
  dependency: Model["Name"];
  server: Feature<DataServerFeature<Model>>;
  browser: Feature<DataBrowserFeature<Model>>;
  readonly [dataModel]?: Model;
}>;

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
  const sourceName = `${implementation.name}Source` as SourceName<Model>;
  const source = createEntity<SourceModel<Model>>({
    name: sourceName,
    create: implementation.create,
    update: implementation.update,
    authorize: (input) => implementation.authorize(dataAuthorization(input)),
  });
  const configuration = Object.freeze({
    name: implementation.name,
    indexes: implementation.indexes ?? [],
    search: implementation.search ?? [],
  });

  const server = {
    features: { source: source.server },
    programs: {
      server: {
        start({
          dependencies,
        }: {
          dependencies: SourceServer<Model> & { dataStore: DataStore<RecordOf<Model>> };
        }) {
          const authority = dependencies[sourceName] as EntityService<SourceModel<Model>>;
          return {
            [implementation.name]: createDataService<Model>(
              authority,
              dependencies.dataStore,
              configuration,
            ),
          } as ServerProvision<Model>;
        },
      },
    },
  } as Feature<DataServerFeature<Model>>;

  const browser = {
    features: { source: source.browser },
    programs: {
      browser: {
        start({
          dependencies,
        }: {
          dependencies: SourceBrowser<Model> & { dataStore: DataStore<RecordOf<Model>> };
        }) {
          const authority = dependencies[sourceName] as EntityApi<SourceModel<Model>>;
          return {
            [implementation.name]: createDataApi<Model>(
              authority,
              dependencies.dataStore,
              configuration,
            ),
          } as BrowserProvision<Model>;
        },
      },
    },
  } as Feature<DataBrowserFeature<Model>>;

  return { dependency: implementation.name, server, browser };
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
      matches.map(({ record, score = 0 }) => ({
        record,
        score,
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
