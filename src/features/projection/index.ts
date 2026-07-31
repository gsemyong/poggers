import {
  dependencyInvocation,
  dispatchDependency,
  type Dependency,
  type DependencyContract,
  type DependencyImplementation,
  type DependencyImplementations,
  type DependencyReference,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { typeKeys, typeLiteral } from "@/core/intrinsic";
import { mapStream } from "@/core/stream";
import { aggregateEventStreamPrefix, type Aggregate } from "@/features/aggregate";
import type {
  EventStore,
  ServerDependencyProvider,
  ServerProcess,
  Synchronization,
} from "@/platforms/server";

type Empty = Record<never, never>;
type Scalar = string | number | boolean | null;
type RuntimeValue = Scalar | object | undefined;
export type ProjectionRow = Readonly<{ id: string }>;
declare const projectionDefinition: unique symbol;

type ProjectionModelInput = Readonly<{
  Name: string;
  Version: number;
  Principal: object;
  Sources: Readonly<Record<string, object>>;
  Rows: Readonly<Record<string, ProjectionRow>>;
  Queries?: ProjectionQueryFamilies;
}>;

export type ProjectionModelDefinition = Readonly<{
  Name: string;
  Version: number;
  Principal: object;
  Sources: Readonly<Record<string, object>>;
  Rows: Readonly<Record<string, ProjectionRow>>;
  Queries: ProjectionQueryFamilies;
}>;

/** The semantic model of one rebuildable, checkpointed read projection. */
export type Projection<Model extends ProjectionModelInput> = Readonly<
  Omit<Model, "Queries"> & {
    Queries: Model extends {
      Queries: infer Queries extends ProjectionQueryFamilies;
    }
      ? Queries
      : EmptyProjectionQueries;
  }
>;

export type ProjectionQueryFamilies = Readonly<{
  Text?: Readonly<Record<string, PropertyKey>>;
  Vector?: Readonly<
    Record<
      string,
      Readonly<{
        Field: PropertyKey;
        Dimensions: number;
      }>
    >
  >;
  Graph?: Readonly<
    Record<
      string,
      Readonly<{
        From: PropertyKey;
        To: PropertyKey;
      }>
    >
  >;
  Geo?: Readonly<Record<string, PropertyKey>>;
  Analytics?: Readonly<Record<string, true>>;
}>;

type EmptyProjectionQueries = Readonly<{
  Text: Empty;
  Vector: Empty;
  Graph: Empty;
  Geo: Empty;
  Analytics: Empty;
}>;

type RowsOf<Model extends ProjectionModelDefinition> = Readonly<{
  [Name in keyof Model["Rows"]]: readonly Model["Rows"][Name][];
}>;

type SourceEvent<Source> = Aggregate.EventOf<Source>;

type ProjectionSourceContext<Model extends ProjectionModelDefinition> = {
  [Name in keyof Model["Sources"]]: Readonly<{
    source: Name;
    event: SourceEvent<Model["Sources"][Name]>;
    rows: RowsOf<Model>;
  }>;
}[keyof Model["Sources"]];

type ProjectionSourceEvent<Model extends ProjectionModelDefinition> = {
  [Name in keyof Model["Sources"]]: Readonly<{
    source: Name;
    event: SourceEvent<Model["Sources"][Name]>;
  }>;
}[keyof Model["Sources"]];

type ProjectionFocus<Model extends ProjectionModelDefinition> = Readonly<{
  [Name in keyof Model["Rows"]]?: readonly string[];
}>;

type ProjectionMutation<Model extends ProjectionModelDefinition> =
  | {
      [Name in keyof Model["Rows"]]: Readonly<{
        upsert: Readonly<{ [Row in Name]: Model["Rows"][Name] }>;
      }>;
    }[keyof Model["Rows"]]
  | {
      [Name in keyof Model["Rows"]]: Readonly<{
        remove: Readonly<{ [Row in Name]: Readonly<{ id: string }> }>;
      }>;
    }[keyof Model["Rows"]];

type ProjectionAuthorizationContext<Model extends ProjectionModelDefinition> = Readonly<{
  principal: Model["Principal"];
}>;

type ProjectionAuthorization<Model extends ProjectionModelDefinition> = Readonly<{
  [Name in keyof Model["Rows"]]: ProjectionSelection<Model["Rows"][Name]>;
}>;

export type ProjectionImplementation<Model extends ProjectionModelDefinition> = Readonly<{
  reduce(context: ProjectionSourceContext<Model>): readonly ProjectionMutation<Model>[];
  authorize(context: ProjectionAuthorizationContext<Model>): ProjectionAuthorization<Model>;
}>;

type OrderedValue<Value> = NonNullable<Value> extends number ? NonNullable<Value> : never;

type ScalarField<Row extends ProjectionRow> = {
  [Field in Extract<keyof Row, string>]: NonNullable<Row[Field]> extends Exclude<Scalar, null>
    ? Field
    : never;
}[Extract<keyof Row, string>];

type OrderedField<Row extends ProjectionRow> = {
  [Field in Extract<keyof Row, string>]: NonNullable<Row[Field]> extends number ? Field : never;
}[Extract<keyof Row, string>];

type NumericField<Row extends ProjectionRow> = {
  [Field in Extract<keyof Row, string>]: NonNullable<Row[Field]> extends number ? Field : never;
}[Extract<keyof Row, string>];

export type ProjectionCondition<Value> = Readonly<{
  equal?: NonNullable<Value> | null;
  not?: NonNullable<Value> | null;
  oneOf?: readonly NonNullable<Value>[];
  greaterThan?: OrderedValue<Value>;
  atLeast?: OrderedValue<Value>;
  lessThan?: OrderedValue<Value>;
  atMost?: OrderedValue<Value>;
}>;

export type ProjectionSelection<Row extends ProjectionRow> = Readonly<{
  where?: Readonly<{
    [Field in ScalarField<Row>]?: ProjectionCondition<Row[Field]>;
  }>;
  order?: readonly Readonly<{
    field: OrderedField<Row>;
    direction?: "ascending" | "descending";
  }>[];
  offset?: number;
  limit?: number;
}>;

type FindQuery<Row extends ProjectionRow> = Readonly<{
  find: ProjectionSelection<Row>;
}>;

type TextQuery<Row extends ProjectionRow, Fields extends PropertyKey> = Readonly<{
  text: Readonly<{
    value: string;
    fields: readonly Extract<Fields, Extract<keyof Row, string>>[];
  }>;
  select?: ProjectionSelection<Row>;
}>;

type VectorQuery<
  Row extends ProjectionRow,
  Definition extends Readonly<{
    Field: PropertyKey;
    Dimensions: number;
  }>,
> = Readonly<{
  vector: Readonly<{
    field: Extract<Definition["Field"], Extract<keyof Row, string>>;
    value: readonly number[];
    limit?: number;
  }>;
  select?: ProjectionSelection<Row>;
}>;

type GraphQuery<
  Row extends ProjectionRow,
  Definition extends Readonly<{
    From: PropertyKey;
    To: PropertyKey;
  }>,
> = Readonly<{
  graph: Readonly<{
    from: Extract<Definition["From"], Extract<keyof Row, string>>;
    to: Extract<Definition["To"], Extract<keyof Row, string>>;
    start: string;
    depth: number;
    direction?: "outgoing" | "incoming" | "both";
  }>;
}>;

type GeoQuery<Row extends ProjectionRow, Field extends PropertyKey> = Readonly<{
  geo: Readonly<{
    field: Extract<Field, Extract<keyof Row, string>>;
    origin: Readonly<{ latitude: number; longitude: number }>;
    within?: number;
    limit?: number;
  }>;
  select?: ProjectionSelection<Row>;
}>;

type ProjectionMeasure<Row extends ProjectionRow> =
  | Readonly<{ count: true }>
  | Readonly<{ sum: NumericField<Row> }>
  | Readonly<{ minimum: NumericField<Row> }>
  | Readonly<{ maximum: NumericField<Row> }>
  | Readonly<{ average: NumericField<Row> }>;

type AnalyticsQuery<Row extends ProjectionRow> = Readonly<{
  analytics: Readonly<{
    groupBy?: readonly ScalarField<Row>[];
    measures: Readonly<Record<string, ProjectionMeasure<Row>>>;
  }>;
  select?: ProjectionSelection<Row>;
}>;

type QueryFamilyOf<
  Model extends ProjectionModelDefinition,
  Family extends keyof ProjectionQueryFamilies,
  Name extends keyof Model["Rows"],
> = Family extends keyof Model["Queries"]
  ? Name extends keyof Model["Queries"][Family]
    ? Model["Queries"][Family][Name]
    : never
  : never;

export type ProjectionQuery<
  Model extends ProjectionModelDefinition,
  Name extends keyof Model["Rows"],
> =
  | FindQuery<Model["Rows"][Name]>
  | (QueryFamilyOf<Model, "Text", Name> extends infer Fields extends PropertyKey
      ? TextQuery<Model["Rows"][Name], Fields>
      : never)
  | (QueryFamilyOf<Model, "Vector", Name> extends infer Family extends Readonly<{
      Field: PropertyKey;
      Dimensions: number;
    }>
      ? VectorQuery<Model["Rows"][Name], Family>
      : never)
  | (QueryFamilyOf<Model, "Graph", Name> extends infer Family extends Readonly<{
      From: PropertyKey;
      To: PropertyKey;
    }>
      ? GraphQuery<Model["Rows"][Name], Family>
      : never)
  | (QueryFamilyOf<Model, "Geo", Name> extends infer Field extends PropertyKey
      ? GeoQuery<Model["Rows"][Name], Field>
      : never)
  | (QueryFamilyOf<Model, "Analytics", Name> extends true
      ? AnalyticsQuery<Model["Rows"][Name]>
      : never);

export type ProjectionMatch<Row extends ProjectionRow> = Readonly<{
  row: Row;
  score?: number;
  distance?: number;
}>;

export type ProjectionGroup = Readonly<{
  key: Readonly<Record<string, Scalar>>;
  measures: Readonly<Record<string, number>>;
}>;

export type ProjectionResult<Row extends ProjectionRow> =
  | Readonly<{
      kind: "rows";
      revision?: number;
      cursor?: string;
      observations: Readonly<Record<string, string>>;
      matches: readonly ProjectionMatch<Row>[];
    }>
  | Readonly<{
      kind: "analytics";
      revision?: number;
      cursor?: string;
      observations: Readonly<Record<string, string>>;
      groups: readonly ProjectionGroup[];
    }>;

type ProjectionWireOperations<Model extends ProjectionModelDefinition> = Readonly<
  {
    observe(input: {
      principal: Model["Principal"];
      after: Readonly<Record<string, string>>;
    }): Promise<AsyncIterable<Readonly<{ cursor: string }>>>;
    $synchronize(input: {
      principal: Model["Principal"];
      rows: readonly Extract<keyof Model["Rows"], string>[];
      after?: number;
    }): Promise<ProjectionSynchronization<Model>>;
  } & {
    [Name in keyof Model["Rows"]]: (
      input: RuntimeProjectionRequest<Model>,
    ) => Promise<ProjectionResult<Model["Rows"][Name]>>;
  }
>;

type ProjectionReferenceDefinition<Model extends ProjectionModelDefinition> = Readonly<{
  Name: "for";
  Binding: Readonly<{ principal: Model["Principal"] }>;
  Inputs: Readonly<{
    [Name in keyof Model["Rows"]]: ProjectionQuery<Model, Name>;
  }>;
  Argument: "query";
}>;

type ProjectionInstance<Model extends ProjectionModelDefinition> = DependencyReference<
  ProjectionReferenceDefinition<Model>,
  Readonly<{
    [Name in keyof Model["Rows"]]: (
      query: ProjectionQuery<Model, Name>,
    ) => Promise<ProjectionResult<Model["Rows"][Name]>>;
  }>
>;

type ProjectionDependency<Model extends ProjectionModelDefinition> = Dependency<
  {
    Operations: ProjectionWireOperations<Model>;
    Reference: ProjectionReferenceDefinition<Model>;
  },
  Readonly<{
    for(input: Readonly<{ principal: Model["Principal"] }>): ProjectionInstance<Model>;
  }>
>;

type ProjectionSourceRequirements<Model extends ProjectionModelDefinition> = Readonly<{
  [Name in Extract<keyof Model["Sources"], string> as `${Name}Events`]: Extract<
    Model["Sources"][Name],
    DependencyContract
  >;
}>;

type ProjectionRequirements<Model extends ProjectionModelDefinition> = Readonly<
  ProjectionSourceRequirements<Model> &
    Readonly<{
      events: EventStore<object>;
      queries: ProjectionStore;
      synchronization: Synchronization;
    }>
>;

type ProjectionProvision<Model extends ProjectionModelDefinition> = Readonly<{
  [Name in Model["Name"]]: ProjectionDependency<Model>;
}>;

type ProjectionFeatureContract<Model extends ProjectionModelDefinition> = Readonly<{
  Providers: {
    server: {
      queries: ServerDependencyProvider<ProjectionStore>;
    };
  };
  Programs: {
    server: {
      Environment: ServerProcess;
      Requires: ProjectionRequirements<Model>;
      Provides: ProjectionProvision<Model>;
    };
  };
}>;

export type DefinedProjection<Model extends ProjectionModelDefinition> = Feature<
  ProjectionFeatureContract<Model>
> &
  Readonly<{ readonly [projectionDefinition]?: Model }>;

type ProjectionModelOf<Definition> =
  Definition extends Readonly<{
    readonly [projectionDefinition]?: infer Model extends ProjectionModelDefinition;
  }>
    ? Model
    : never;

export namespace Projection {
  export type Model<Definition> = ProjectionModelOf<Definition>;
  export type Name<Definition> =
    ProjectionModelOf<Definition> extends infer Model extends ProjectionModelDefinition
      ? Model["Name"]
      : never;
  export type Definition<Model extends ProjectionModelDefinition> = ProjectionImplementation<Model>;
  export type Reference<Definition> =
    ProjectionModelOf<Definition> extends infer Model extends ProjectionModelDefinition
      ? ProjectionDependency<Model>
      : never;
  export type Instance<Definition> =
    ProjectionModelOf<Definition> extends infer Model extends ProjectionModelDefinition
      ? ProjectionInstance<Model>
      : never;
  export type Rows<Definition> =
    ProjectionModelOf<Definition> extends infer Model extends ProjectionModelDefinition
      ? RowsOf<Model>
      : never;
  export type Query<Definition, Name extends keyof Projection.Rows<Definition>> =
    ProjectionModelOf<Definition> extends infer Model extends ProjectionModelDefinition
      ? Name extends keyof Model["Rows"]
        ? ProjectionQuery<Model, Name>
        : never
      : never;
  export type Selection<Row extends Readonly<{ id: string }>> = ProjectionSelection<Row>;
  export type Mutation<Model extends ProjectionModelDefinition> = ProjectionMutation<Model>;
}

type ProjectionFixtureSources<Model extends ProjectionModelDefinition> = Readonly<{
  [Name in keyof Model["Sources"]]: readonly SourceEvent<Model["Sources"][Name]>[];
}>;

export type ProjectionFixture<Model extends ProjectionModelDefinition> = Readonly<{
  rebuild(
    input: Readonly<{
      sources: ProjectionFixtureSources<Model>;
    }>,
  ): Promise<RowsOf<Model>>;
  query<Name extends keyof Model["Rows"]>(
    input: Readonly<{
      rows: RowsOf<Model>;
      row: Name;
      principal: Model["Principal"];
      query: ProjectionQuery<Model, Name>;
    }>,
  ): Promise<ProjectionResult<Model["Rows"][Name]>>;
}>;

/** @internal Serializable state shared by ProjectionStore realizations and conformance. */
export type RuntimeProjectionState = Readonly<{
  revision: number;
  cursors: Readonly<Record<string, string>>;
  rows: Readonly<Record<string, readonly object[]>>;
}>;

/** @internal Durable Projection checkpoint returned after one atomic commit. */
export type ProjectionStoreCheckpoint = Readonly<{
  revision: number;
  cursors: Readonly<Record<string, string>>;
}>;

/** @internal One materialized row transition committed with its source cursor. */
export type ProjectionStateChange = Readonly<{
  row: string;
  id: string;
  before?: Readonly<{ id: string }>;
  after?: Readonly<{ id: string }>;
}>;

/** @internal One atomic ProjectionStore revision retained for incremental replication. */
export type ProjectionStoreRevision = Readonly<{
  revision: number;
  cursors: Readonly<Record<string, string>>;
  invocations: readonly string[];
  changes: readonly ProjectionStateChange[];
}>;

/**
 * Durable materialized-view storage. Projection owns query meaning; providers
 * own transactions, indexes, physical layout, and execution.
 */
export type ProjectionStore = Dependency<{
  Operations: {
    load(input: {
      projection: string;
      version: number;
      rows: readonly string[];
    }): Promise<RuntimeProjectionState>;
    read(input: {
      projection: string;
      version: number;
      keys: Readonly<Record<string, readonly string[]>>;
    }): Promise<Readonly<Record<string, readonly object[]>>>;
    commit(input: {
      projection: string;
      version: number;
      expectedRevision: number;
      cursors: Readonly<Record<string, string>>;
      invocations: readonly string[];
      changes: readonly ProjectionStateChange[];
    }): Promise<ProjectionStoreCheckpoint | undefined>;
    changes(input: {
      projection: string;
      version: number;
      after: number;
      limit: number;
    }): Promise<readonly ProjectionStoreRevision[]>;
    query(input: {
      projection: string;
      version: number;
      row: string;
      scope: object;
      query: object;
    }): Promise<ProjectionResult<ProjectionRow>>;
  };
}>;

type ProjectionSynchronizationChange<Model extends ProjectionModelDefinition> = {
  [Name in Extract<keyof Model["Rows"], string>]:
    | Readonly<{ row: Name; upsert: Model["Rows"][Name] }>
    | Readonly<{ row: Name; remove: Readonly<{ id: string }> }>;
}[Extract<keyof Model["Rows"], string>];

type ProjectionSynchronization<Model extends ProjectionModelDefinition> = Readonly<{
  revision: number;
  observations: Readonly<Record<string, string>>;
  invocations: readonly string[];
  snapshot?: Readonly<{
    [Name in keyof Model["Rows"]]?: readonly Model["Rows"][Name][];
  }>;
  changes: readonly ProjectionSynchronizationChange<Model>[];
}>;

const retainedProjectionChanges = 256;

type RuntimeProjectionQuery = Readonly<{
  find?: object;
  text?: Readonly<{ value: string; fields: readonly string[] }>;
  vector?: Readonly<{ field: string; value: readonly number[]; limit?: number }>;
  graph?: Readonly<{
    from: string;
    to: string;
    start: string;
    depth: number;
    direction?: "outgoing" | "incoming" | "both";
  }>;
  geo?: Readonly<{
    field: string;
    origin: Readonly<{ latitude: number; longitude: number }>;
    within?: number;
    limit?: number;
  }>;
  analytics?: Readonly<{
    groupBy?: readonly string[];
    measures: Readonly<Record<string, object>>;
  }>;
  select?: object;
}>;

type RuntimeProjectionRequest<Model extends ProjectionModelDefinition> = Readonly<{
  principal: Model["Principal"];
  query: RuntimeProjectionQuery;
}>;

function initialProjectionState(rowNames: readonly string[]): RuntimeProjectionState {
  const rows: Record<string, readonly object[]> = {};
  for (const row of rowNames) rows[row] = [];
  return { revision: 0, cursors: {}, rows };
}

async function loadProjectionState(
  store: ProjectionStore,
  projection: string,
  version: number,
  rowNames: readonly string[],
): Promise<RuntimeProjectionState> {
  return await store.load({ projection, version, rows: rowNames });
}

function applyProjectionChanges(
  rows: Readonly<Record<string, readonly object[]>>,
  changes: readonly ProjectionStateChange[],
): Readonly<Record<string, readonly object[]>> {
  let next = rows;
  for (const change of changes) {
    const copied: Record<string, readonly object[]> = { ...next };
    const values: object[] = [];
    let replaced = false;
    for (const value of next[change.row] ?? []) {
      if ((value as Readonly<{ id: string }>).id !== change.id) {
        values.push(value);
      } else if (change.after !== undefined) {
        values.push(change.after);
        replaced = true;
      }
    }
    if (change.after !== undefined && !replaced) values.push(change.after);
    copied[change.row] = values;
    next = copied;
  }
  return next;
}

function projectionStateChanges(
  previous: Readonly<Record<string, readonly object[]>>,
  next: Readonly<Record<string, readonly object[]>>,
): readonly ProjectionStateChange[] {
  const changes: ProjectionStateChange[] = [];
  for (const row of Object.keys(next)) {
    const before = previous[row] ?? [];
    const after = next[row] ?? [];
    for (const current of before) {
      const id = (current as Readonly<{ id: string }>).id;
      let replacement: object | undefined;
      for (const candidate of after) {
        if ((candidate as Readonly<{ id: string }>).id === id) replacement = candidate;
      }
      if (replacement === undefined) {
        changes.push({ row, id, before: current as Readonly<{ id: string }> });
      } else if (JSON.stringify(current) !== JSON.stringify(replacement)) {
        changes.push({
          row,
          id,
          before: current as Readonly<{ id: string }>,
          after: replacement as Readonly<{ id: string }>,
        });
      }
    }
    for (const added of after) {
      const addedId = (added as Readonly<{ id: string }>).id;
      let existed = false;
      for (const previousValue of before) {
        if ((previousValue as Readonly<{ id: string }>).id === addedId) existed = true;
      }
      if (!existed) {
        changes.push({ row, id: addedId, after: added as Readonly<{ id: string }> });
      }
    }
  }
  return changes;
}

function applyProjectionMutations(
  rows: Readonly<Record<string, readonly object[]>>,
  mutations: readonly object[],
): Readonly<Record<string, readonly object[]>> {
  const next: Record<string, object[]> = {};
  for (const rowName of Object.keys(rows)) {
    const rowCopies: object[] = [];
    for (const existing of rows[rowName] ?? []) rowCopies.push(existing);
    next[rowName] = rowCopies;
  }
  for (const value of mutations) {
    const mutation = value as Readonly<{
      upsert?: Readonly<Record<string, Readonly<{ id: string }>>>;
      remove?: Readonly<Record<string, Readonly<{ id: string }>>>;
    }>;
    const operation = mutation.upsert ?? mutation.remove;
    if (operation === undefined) throw new Error("Projection mutation has no operation.");
    const names = Object.keys(operation);
    if (names.length !== 1) throw new Error("Projection mutation must name exactly one row.");
    const mutationRow = names[0];
    if (mutationRow === undefined) {
      throw new Error("Projection mutation names an unknown row.");
    }
    next[mutationRow] ??= [];
    const record = operation[mutationRow];
    if (record === undefined) throw new Error("Projection mutation has no record.");
    const targetRows = next[mutationRow];
    if (targetRows === undefined) throw new Error("Projection row storage is unavailable.");
    let found = -1;
    for (let index = 0; index < targetRows.length; index += 1) {
      const candidate = targetRows[index] as Readonly<{ id: string }>;
      if (candidate.id === record.id) found = index;
    }
    if (mutation.upsert !== undefined) {
      if (found < 0) targetRows.push(record);
      else targetRows[found] = record;
    } else if (found >= 0) {
      const retained: object[] = [];
      for (let retainedIndex = 0; retainedIndex < targetRows.length; retainedIndex += 1) {
        if (retainedIndex !== found) retained.push(targetRows[retainedIndex] as object);
      }
      next[mutationRow] = retained;
    }
  }
  return next;
}

async function refreshProjection<Model extends ProjectionModelDefinition>(
  dependencies: ProjectionRequirements<Model>,
  definition: ProjectionImplementation<Model>,
  store: ProjectionStore,
  projection: string,
  version: number,
  state: RuntimeProjectionState,
  sourceNames: readonly string[],
  focus?: (event: ProjectionSourceEvent<Model>) => ProjectionFocus<Model>,
): Promise<
  Readonly<{
    state: RuntimeProjectionState;
    invocations: readonly string[];
    changes: readonly ProjectionStateChange[];
    done: boolean;
  }>
> {
  let rows = state.rows;
  const cursors: Record<string, string> = { ...state.cursors };
  const invocations: string[] = [];
  const changes: ProjectionStateChange[] = [];
  const loaded: string[] = [];
  let changed = false;
  let done = true;
  for (const source of sourceNames) {
    const feed = dependencies[`${source}Events`] as object;
    const page = await dispatchDependency<{
      entries: readonly object[];
      cursor?: string;
      done: boolean;
    }>(feed, "scan", {
      after: cursors[source],
      limit: 100,
    });
    done = done && page.done;
    for (const event of page.entries) {
      const invocation = (event as Readonly<{ metadata: Readonly<{ invocation: string }> }>)
        .metadata.invocation;
      if (!valueIn(invocations, invocation)) invocations.push(invocation);
      if (focus !== undefined) {
        const keys = focus({
          source,
          event,
        } as ProjectionSourceEvent<Model>) as Readonly<Record<string, readonly string[]>>;
        const missing: Record<string, string[]> = {};
        for (const row of Object.keys(keys)) {
          for (const id of keys[row] ?? []) {
            const identity = `${row.length}:${row}:${id.length}:${id}`;
            if (!valueIn(loaded, identity)) {
              loaded.push(identity);
              const rowKeys = missing[row] ?? [];
              rowKeys.push(id);
              missing[row] = rowKeys;
            }
          }
        }
        if (Object.keys(missing).length > 0) {
          rows = mergeProjectionRows(
            rows,
            await store.read({
              projection,
              version,
              keys: missing,
            }),
          );
        }
      }
      const previousRows = rows;
      const mutations = definition.reduce({
        source,
        event,
        rows,
      } as ProjectionSourceContext<Model>);
      rows = applyProjectionMutations(rows, mutations);
      for (const change of projectionStateChanges(previousRows, rows)) {
        changes.push(change);
      }
      changed = true;
    }
    if (page.cursor !== undefined && page.cursor !== cursors[source]) {
      cursors[source] = page.cursor;
      changed = true;
    }
  }
  return {
    state: changed
      ? {
          revision: state.revision,
          cursors,
          rows,
        }
      : state,
    invocations,
    changes,
    done,
  };
}

function mergeProjectionRows(
  current: Readonly<Record<string, readonly object[]>>,
  loaded: Readonly<Record<string, readonly object[]>>,
): Readonly<Record<string, readonly object[]>> {
  const merged: Record<string, readonly object[]> = { ...current };
  for (const row of Object.keys(loaded)) {
    const values: object[] = [];
    for (const currentValue of merged[row] ?? []) values.push(currentValue);
    for (const candidate of loaded[row] ?? []) {
      const id = (candidate as Readonly<{ id: string }>).id;
      let exists = false;
      for (const value of values) {
        if ((value as Readonly<{ id: string }>).id === id) exists = true;
      }
      if (!exists) values.push(candidate);
    }
    merged[row] = values;
  }
  return merged;
}

async function saveProjectionState(
  store: ProjectionStore,
  projection: string,
  version: number,
  previous: RuntimeProjectionState,
  refreshed: Readonly<{
    state: RuntimeProjectionState;
    invocations: readonly string[];
    changes: readonly ProjectionStateChange[];
  }>,
): Promise<RuntimeProjectionState | undefined> {
  const next = refreshed.state;
  if (previous === next) return previous;
  const committed = await store.commit({
    projection,
    version,
    expectedRevision: previous.revision,
    cursors: next.cursors,
    invocations: refreshed.invocations,
    changes: refreshed.changes,
  });
  if (committed === undefined) return undefined;
  return {
    revision: committed.revision,
    cursors: committed.cursors,
    rows: next.rows,
  };
}

async function catchUpProjection<Model extends ProjectionModelDefinition>(
  dependencies: ProjectionRequirements<Model>,
  definition: ProjectionImplementation<Model>,
  store: ProjectionStore,
  projection: string,
  version: number,
  rowNames: readonly string[],
  sourceNames: readonly string[],
  focus?: (event: ProjectionSourceEvent<Model>) => ProjectionFocus<Model>,
): Promise<RuntimeProjectionState> {
  let state = await loadProjectionState(
    store,
    projection,
    version,
    focus === undefined ? rowNames : [],
  );
  while (true) {
    const refreshed = await refreshProjection(
      dependencies,
      definition,
      store,
      projection,
      version,
      state,
      sourceNames,
      focus,
    );
    const committed = await saveProjectionState(store, projection, version, state, refreshed);
    if (committed === undefined) {
      state = await loadProjectionState(
        store,
        projection,
        version,
        focus === undefined ? rowNames : [],
      );
    } else {
      const next = committed;
      if (refreshed.done) return next;
      if (next === state) {
        throw new Error("Projection source did not advance while reporting more events.");
      }
      state =
        focus === undefined
          ? next
          : {
              revision: next.revision,
              cursors: next.cursors,
              rows: initialProjectionState([]).rows,
            };
    }
  }
}

function valueIn(values: readonly RuntimeValue[], value: RuntimeValue): boolean {
  for (const candidate of values) {
    if (candidate === value) return true;
  }
  return false;
}

function matchesCondition(value: RuntimeValue, condition: object | undefined): boolean {
  if (condition === undefined) return true;
  const expected = condition as Readonly<{
    equal?: RuntimeValue;
    not?: RuntimeValue;
    oneOf?: readonly RuntimeValue[];
    greaterThan?: number;
    atLeast?: number;
    lessThan?: number;
    atMost?: number;
  }>;
  if (expected.equal !== undefined && value !== expected.equal) return false;
  if (expected.not !== undefined && value === expected.not) return false;
  if (expected.oneOf !== undefined && !valueIn(expected.oneOf, value)) return false;
  const ordered = value as number;
  if (expected.greaterThan !== undefined && !(ordered > expected.greaterThan)) return false;
  if (expected.atLeast !== undefined && !(ordered >= expected.atLeast)) return false;
  if (expected.lessThan !== undefined && !(ordered < expected.lessThan)) return false;
  if (expected.atMost !== undefined && !(ordered <= expected.atMost)) return false;
  return true;
}

function selectProjectionRows(
  rows: readonly ProjectionRow[],
  selection: object | undefined,
): ProjectionRow[] {
  const query = (selection ?? {}) as Readonly<{
    where?: Readonly<Record<string, object>>;
    order?: readonly Readonly<{ field: string; direction?: "ascending" | "descending" }>[];
    offset?: number;
    limit?: number;
  }>;
  const selected = rows.filter((row) => {
    const record = row as Readonly<Record<string, RuntimeValue>>;
    for (const field of Object.keys(query.where ?? {})) {
      if (!matchesCondition(record[field], query.where?.[field])) return false;
    }
    return true;
  });
  selected.sort((left, right) => {
    const a = left as unknown as Readonly<Record<string, number>>;
    const b = right as unknown as Readonly<Record<string, number>>;
    for (const order of query.order ?? []) {
      const direction = order.direction === "descending" ? -1 : 1;
      if ((a[order.field] ?? 0) < (b[order.field] ?? 0)) return -direction;
      if ((a[order.field] ?? 0) > (b[order.field] ?? 0)) return direction;
    }
    return 0;
  });
  return selected.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? selected.length));
}

function textMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["text"]>,
): ProjectionMatch<ProjectionRow>[] {
  const phrase = query.value;
  const matches: ProjectionMatch<ProjectionRow>[] = [];
  for (const row of rows) {
    const record = row as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
    let score = 0;
    for (const field of query.fields) {
      const text = record[field] as string;
      if (containsText(text, phrase)) score += 1;
    }
    if (score > 0) matches.push({ row: record, score });
  }
  matches.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  return matches;
}

function containsText(text: string, phrase: string): boolean {
  const expected = projectionTextTerms(phrase);
  if (expected.length === 0) return true;
  const available = projectionTextTerms(text);
  for (const term of expected) {
    if (!available.some((candidate) => candidate === term)) return false;
  }
  return true;
}

function indexedTextMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["text"]>,
): ProjectionMatch<ProjectionRow>[] {
  const terms = projectionTextTerms(query.value);
  const scores = new Map<number, number>();
  for (const field of query.fields) {
    const index = projectionTextIndex(rows, field);
    if (terms.length === 0) {
      for (let row = 0; row < rows.length; row += 1) {
        scores.set(row, (scores.get(row) ?? 0) + 1);
      }
      continue;
    }
    const first = index.get(terms[0]!) ?? [];
    const remaining = terms.slice(1).map((term) => new Set(index.get(term) ?? []));
    for (const row of first) {
      if (remaining.every((postings) => postings.has(row))) {
        scores.set(row, (scores.get(row) ?? 0) + 1);
      }
    }
  }
  return [...scores]
    .sort(([leftRow, leftScore], [rightRow, rightScore]) =>
      leftScore === rightScore ? leftRow - rightRow : rightScore - leftScore,
    )
    .map(([row, score]) => ({
      row: rows[row] as ProjectionRow,
      score,
    }));
}

const projectionTextIndexes = new WeakMap<
  readonly object[],
  Map<string, Map<string, readonly number[]>>
>();

function projectionTextIndex(
  rows: readonly object[],
  field: string,
): Map<string, readonly number[]> {
  let fields = projectionTextIndexes.get(rows);
  if (!fields) {
    fields = new Map();
    projectionTextIndexes.set(rows, fields);
  }
  const existing = fields.get(field);
  if (existing) return existing;
  const index = new Map<string, number[]>();
  for (let row = 0; row < rows.length; row += 1) {
    const value = (rows[row] as Readonly<Record<string, RuntimeValue>>)[field] as string;
    for (const term of projectionTextTerms(value)) {
      const postings = index.get(term);
      if (postings) postings.push(row);
      else index.set(term, [row]);
    }
  }
  fields.set(field, index);
  return index;
}

/** @internal Canonical terms shared by reference and provider query realizations. */
export function projectionTextTerms(value: string): readonly string[] {
  const normalized = value.toLowerCase();
  const terms: string[] = [];
  let term = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    const alphanumeric = (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    if (alphanumeric) {
      term += normalized.slice(index, index + 1);
    } else if (term.length > 0) {
      if (!terms.some((candidate) => candidate === term)) terms.push(term);
      term = "";
    }
  }
  if (term.length > 0 && !terms.some((candidate) => candidate === term)) {
    terms.push(term);
  }
  return terms;
}

function vectorMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["vector"]>,
): ProjectionMatch<ProjectionRow>[] {
  const matches: ProjectionMatch<ProjectionRow>[] = [];
  for (const row of rows) {
    const record = row as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
    const vector = record[query.field] as readonly number[];
    const score = projectionVectorScore(vector, query.value);
    matches.push({ row: record, score });
  }
  matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return matches.slice(0, query.limit ?? matches.length);
}

const projectionVectorIndexes = new WeakMap<
  readonly object[],
  Map<string, readonly Readonly<{ row: ProjectionRow; value: readonly number[] }>[]>
>();

function indexedVectorMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["vector"]>,
): ProjectionMatch<ProjectionRow>[] {
  let fields = projectionVectorIndexes.get(rows);
  if (!fields) {
    fields = new Map();
    projectionVectorIndexes.set(rows, fields);
  }
  let entries = fields.get(query.field);
  if (!entries) {
    entries = rows.map((row) => {
      const record = row as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
      return { row: record, value: record[query.field] as readonly number[] };
    });
    fields.set(query.field, entries);
  }
  return entries
    .map(({ row, value }) => ({
      row,
      score: projectionVectorScore(value, query.value),
    }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, query.limit ?? entries.length);
}

function projectionVectorScore(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < right.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  return leftMagnitude === 0 || rightMagnitude === 0
    ? 0
    : dot / projectionSquareRoot(leftMagnitude * rightMagnitude);
}

function graphMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["graph"]>,
): ProjectionMatch<ProjectionRow>[] {
  const result: ProjectionMatch<ProjectionRow>[] = [];
  let frontier = [query.start];
  const visited = [query.start];
  let depth = 1;
  while (depth <= query.depth) {
    const next: string[] = [];
    for (const row of rows) {
      const edge = row as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
      const from = edge[query.from] as string;
      const to = edge[query.to] as string;
      const outgoing = valueIn(frontier, from);
      const incoming = valueIn(frontier, to);
      const direction = query.direction ?? "outgoing";
      if (
        (direction === "outgoing" && outgoing) ||
        (direction === "incoming" && incoming) ||
        (direction === "both" && (outgoing || incoming))
      ) {
        result.push({ row: edge, distance: depth });
        const destination = outgoing ? to : from;
        if (!valueIn(visited, destination)) {
          visited.push(destination);
          next.push(destination);
        }
      }
    }
    frontier = next;
    depth += 1;
  }
  return result;
}

type ProjectionGraphIndex = Readonly<{
  outgoing: ReadonlyMap<string, readonly number[]>;
  incoming: ReadonlyMap<string, readonly number[]>;
}>;

const projectionGraphIndexes = new WeakMap<readonly object[], Map<string, ProjectionGraphIndex>>();

function indexedGraphMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["graph"]>,
): ProjectionMatch<ProjectionRow>[] {
  const index = projectionGraphIndex(rows, query.from, query.to);
  const result: ProjectionMatch<ProjectionRow>[] = [];
  let frontier = [query.start];
  const visited = new Set(frontier);
  let depth = 1;
  while (depth <= query.depth) {
    const candidates = new Set<number>();
    for (const node of frontier) {
      if (query.direction !== "incoming") {
        for (const row of index.outgoing.get(node) ?? []) candidates.add(row);
      }
      if (query.direction === "incoming" || query.direction === "both") {
        for (const row of index.incoming.get(node) ?? []) candidates.add(row);
      }
    }
    const next: string[] = [];
    for (const row of [...candidates].sort((left, right) => left - right)) {
      const edge = rows[row] as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
      const from = edge[query.from] as string;
      const to = edge[query.to] as string;
      const outgoing = valueIn(frontier, from);
      const incoming = valueIn(frontier, to);
      const direction = query.direction ?? "outgoing";
      if (
        (direction === "outgoing" && outgoing) ||
        (direction === "incoming" && incoming) ||
        (direction === "both" && (outgoing || incoming))
      ) {
        result.push({ row: edge, distance: depth });
        const destination = outgoing ? to : from;
        if (!visited.has(destination)) {
          visited.add(destination);
          next.push(destination);
        }
      }
    }
    frontier = next;
    depth += 1;
  }
  return result;
}

function projectionGraphIndex(
  rows: readonly object[],
  from: string,
  to: string,
): ProjectionGraphIndex {
  let fields = projectionGraphIndexes.get(rows);
  if (!fields) {
    fields = new Map();
    projectionGraphIndexes.set(rows, fields);
  }
  const key = `${from}\u0000${to}`;
  const existing = fields.get(key);
  if (existing) return existing;
  const outgoing = new Map<string, number[]>();
  const incoming = new Map<string, number[]>();
  for (let row = 0; row < rows.length; row += 1) {
    const edge = rows[row] as Readonly<Record<string, RuntimeValue>>;
    const source = edge[from] as string;
    const target = edge[to] as string;
    const sourceRows = outgoing.get(source);
    if (sourceRows) sourceRows.push(row);
    else outgoing.set(source, [row]);
    const targetRows = incoming.get(target);
    if (targetRows) targetRows.push(row);
    else incoming.set(target, [row]);
  }
  const index = { outgoing, incoming };
  fields.set(key, index);
  return index;
}

function geoMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["geo"]>,
): ProjectionMatch<ProjectionRow>[] {
  const matches: ProjectionMatch<ProjectionRow>[] = [];
  for (const row of rows) {
    const record = row as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
    const point = record[query.field] as Readonly<{ latitude: number; longitude: number }>;
    const latitude = (point.latitude - query.origin.latitude) * 111_320;
    const middleLatitude =
      ((point.latitude + query.origin.latitude) * 0.5 * 3.141592653589793) / 180;
    const longitude =
      (point.longitude - query.origin.longitude) * 111_320 * projectionCosine(middleLatitude);
    const distance = projectionSquareRoot(latitude * latitude + longitude * longitude);
    if (query.within === undefined || distance <= query.within) {
      matches.push({ row: record, distance });
    }
  }
  matches.sort((left, right) => (left.distance ?? 0) - (right.distance ?? 0));
  return matches.slice(0, query.limit ?? matches.length);
}

type ProjectionGeoEntry = Readonly<{
  index: number;
  row: ProjectionRow;
  point: Readonly<{ latitude: number; longitude: number }>;
}>;

const projectionGeoIndexes = new WeakMap<
  readonly object[],
  Map<string, readonly ProjectionGeoEntry[]>
>();

function indexedGeoMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["geo"]>,
): ProjectionMatch<ProjectionRow>[] {
  const entries = projectionGeoIndex(rows, query.field);
  let start = 0;
  let end = entries.length;
  if (query.within !== undefined) {
    const latitudeDelta = query.within / 111_320;
    start = projectionGeoLowerBound(entries, query.origin.latitude - latitudeDelta);
    end = projectionGeoUpperBound(entries, query.origin.latitude + latitudeDelta);
  }
  const matches: Readonly<{
    index: number;
    match: ProjectionMatch<ProjectionRow>;
  }>[] = entries.slice(start, end).flatMap((entry) => {
    const latitude = (entry.point.latitude - query.origin.latitude) * 111_320;
    const middleLatitude =
      ((entry.point.latitude + query.origin.latitude) * 0.5 * 3.141592653589793) / 180;
    const longitude =
      (entry.point.longitude - query.origin.longitude) * 111_320 * projectionCosine(middleLatitude);
    const distance = projectionSquareRoot(latitude * latitude + longitude * longitude);
    return query.within !== undefined && distance > query.within
      ? []
      : [{ index: entry.index, match: { row: entry.row, distance } }];
  });
  return matches
    .sort(
      (left, right) =>
        (left.match.distance ?? 0) - (right.match.distance ?? 0) || left.index - right.index,
    )
    .slice(0, query.limit ?? matches.length)
    .map(({ match }) => match);
}

function projectionGeoIndex(rows: readonly object[], field: string): readonly ProjectionGeoEntry[] {
  let fields = projectionGeoIndexes.get(rows);
  if (!fields) {
    fields = new Map();
    projectionGeoIndexes.set(rows, fields);
  }
  const existing = fields.get(field);
  if (existing) return existing;
  const entries = rows
    .map((row, index) => {
      const record = row as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
      return {
        index,
        row: record,
        point: record[field] as Readonly<{ latitude: number; longitude: number }>,
      };
    })
    .sort(
      (left, right) =>
        left.point.latitude - right.point.latitude ||
        left.point.longitude - right.point.longitude ||
        left.index - right.index,
    );
  fields.set(field, entries);
  return entries;
}

function projectionGeoLowerBound(entries: readonly ProjectionGeoEntry[], latitude: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle]!.point.latitude < latitude) low = middle + 1;
    else high = middle;
  }
  return low;
}

function projectionGeoUpperBound(entries: readonly ProjectionGeoEntry[], latitude: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle]!.point.latitude <= latitude) low = middle + 1;
    else high = middle;
  }
  return low;
}

function projectionSquareRoot(value: number): number {
  if (value <= 0) return 0;
  let estimate = value > 1 ? value : 1;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    estimate = (estimate + value / estimate) * 0.5;
  }
  return estimate;
}

function projectionCosine(value: number): number {
  const square = value * value;
  const fourth = square * square;
  const sixth = fourth * square;
  return 1 - square / 2 + fourth / 24 - sixth / 720;
}

function analyticsGroups(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["analytics"]>,
): ProjectionGroup[] {
  const groups: {
    key: Record<string, Scalar>;
    rows: Readonly<Record<string, RuntimeValue>>[];
  }[] = [];
  const groupsByKey: Record<string, number> = {};
  for (const row of rows) {
    const record = row as Readonly<Record<string, RuntimeValue>>;
    const key: Record<string, Scalar> = {};
    const identityValues: Scalar[] = [];
    for (const groupField of query.groupBy ?? []) {
      key[groupField] = record[groupField] as Scalar;
      identityValues.push(key[groupField]!);
    }
    const identity = JSON.stringify(identityValues);
    const indexed = groupsByKey[`$${identity}`];
    let selectedGroup = indexed === undefined ? undefined : groups[indexed];
    if (!selectedGroup) {
      selectedGroup = { key, rows: [] };
      groups.push(selectedGroup);
      groupsByKey[`$${identity}`] = groups.length - 1;
    }
    selectedGroup.rows.push(record);
  }
  const result: ProjectionGroup[] = [];
  for (const finalizedGroup of groups) {
    const measures: Record<string, number> = {};
    for (const name of Object.keys(query.measures)) {
      const measure = query.measures[name] as Readonly<{
        count?: true;
        sum?: string;
        minimum?: string;
        maximum?: string;
        average?: string;
      }>;
      const measureField = measure.sum ?? measure.minimum ?? measure.maximum ?? measure.average;
      if (measure.count) measures[name] = finalizedGroup.rows.length;
      else if (measureField !== undefined) {
        const values: number[] = [];
        for (const measureRow of finalizedGroup.rows) {
          values.push(measureRow[measureField] as number);
        }
        if (measure.sum !== undefined) {
          let sumTotal = 0;
          for (const sumValue of values) sumTotal += sumValue;
          measures[name] = sumTotal;
        } else if (measure.minimum !== undefined) {
          let minimum = values[0] ?? 0;
          for (const minimumValue of values) {
            if (minimumValue < minimum) minimum = minimumValue;
          }
          measures[name] = minimum;
        } else if (measure.maximum !== undefined) {
          let maximum = values[0] ?? 0;
          for (const maximumValue of values) {
            if (maximumValue > maximum) maximum = maximumValue;
          }
          measures[name] = maximum;
        } else {
          let averageTotal = 0;
          for (const averageValue of values) averageTotal += averageValue;
          measures[name] = averageTotal / (values.length === 0 ? 1 : values.length);
        }
      }
    }
    result.push({ key: finalizedGroup.key, measures });
  }
  return result;
}

async function queryProjection<Model extends ProjectionModelDefinition>(
  definition: ProjectionImplementation<Model>,
  store: ProjectionStore,
  projection: string,
  version: number,
  rowName: string,
  request: RuntimeProjectionRequest<Model>,
): Promise<ProjectionResult<ProjectionRow>> {
  const scopes = definition.authorize({ principal: request.principal });
  const scope = scopes[rowName] as ProjectionSelection<ProjectionRow> | undefined;
  if (!scope) throw new Error(`Projection row ${rowName} has no authorization policy.`);
  return await store.query({
    projection,
    version,
    row: rowName,
    scope,
    query: request.query,
  });
}

async function synchronizeProjection<Model extends ProjectionModelDefinition>(
  definition: ProjectionImplementation<Model>,
  store: ProjectionStore,
  projection: string,
  version: number,
  state: RuntimeProjectionState,
  rowNames: readonly string[],
  request: Readonly<{
    principal: Model["Principal"];
    rows: readonly string[];
    after?: number;
  }>,
): Promise<ProjectionSynchronization<Model>> {
  for (const row of request.rows) {
    if (!valueIn(rowNames, row)) throw new Error(`Unknown Projection row ${row}.`);
  }
  const snapshot = async (): Promise<ProjectionSynchronization<Model>> => {
    const rows: Record<string, readonly object[]> = {};
    for (const row of request.rows) {
      const result = await queryProjection(definition, store, projection, version, row, {
        principal: request.principal,
        query: { find: {} },
      });
      if (result.kind !== "rows") {
        throw new Error(`Projection synchronization row ${row} returned analytics.`);
      }
      rows[row] = result.matches.map(({ row: value }) => value);
    }
    return {
      revision: state.revision,
      observations: state.cursors,
      invocations: [],
      snapshot: rows as ProjectionSynchronization<Model>["snapshot"],
      changes: [],
    };
  };

  const after = request.after;
  if (after === undefined || after < 0 || after > state.revision) {
    return await snapshot();
  }
  if (after === state.revision) {
    return {
      revision: state.revision,
      observations: state.cursors,
      invocations: [],
      changes: [],
    };
  }

  const retained = await store.changes({
    projection,
    version,
    after,
    limit: retainedProjectionChanges + 1,
  });
  if (
    retained[0]?.revision !== after + 1 ||
    retained[retained.length - 1]?.revision !== state.revision ||
    retained.length > retainedProjectionChanges
  ) {
    return await snapshot();
  }

  const changes: Array<
    Readonly<{ row: string; upsert: object } | { row: string; remove: Readonly<{ id: string }> }>
  > = [];
  const invocations: string[] = [];
  for (const stored of retained) {
    for (const invocation of stored.invocations) {
      if (!valueIn(invocations, invocation)) invocations.push(invocation);
    }
    for (const change of stored.changes) {
      if (valueIn(request.rows, change.row)) {
        const scopes = definition.authorize({ principal: request.principal });
        const scope = scopes[change.row] as ProjectionSelection<ProjectionRow> | undefined;
        if (!scope) throw new Error(`Projection row ${change.row} has no authorization policy.`);
        const beforeVisible =
          change.before !== undefined && selectProjectionRows([change.before], scope).length === 1;
        const afterVisible =
          change.after !== undefined && selectProjectionRows([change.after], scope).length === 1;
        if (afterVisible) {
          changes.push({ row: change.row, upsert: change.after! });
        } else if (beforeVisible) {
          changes.push({ row: change.row, remove: { id: change.id } });
        }
      }
    }
  }
  return {
    revision: state.revision,
    observations: state.cursors,
    invocations,
    changes: changes as unknown as readonly ProjectionSynchronizationChange<Model>[],
  };
}

/** Evaluates a typed Projection query over rows already filtered by authority. */
export function evaluateProjectionRows<Row extends ProjectionRow>(
  rows: readonly Row[],
  query: object,
  cursor: Readonly<{
    revision?: number;
    cursor?: string;
    observations: Readonly<Record<string, string>>;
  }> = { observations: {} },
): ProjectionResult<Row> {
  const request = query as RuntimeProjectionQuery;
  const selection = request.find ?? request.select;
  const selected = selectProjectionRows(rows, selection);
  if (request.analytics !== undefined) {
    return {
      kind: "analytics",
      ...cursor,
      groups: analyticsGroups(selected, request.analytics),
    };
  }
  let matches: ProjectionMatch<ProjectionRow>[];
  if (request.text !== undefined) matches = textMatches(selected, request.text);
  else if (request.vector !== undefined) {
    matches = vectorMatches(selected, request.vector);
  } else if (request.graph !== undefined) {
    matches = graphMatches(selected, request.graph);
  } else if (request.geo !== undefined) {
    matches = geoMatches(selected, request.geo);
  } else {
    matches = selected.map((row) => ({ row: row as ProjectionRow }));
  }
  return {
    kind: "rows",
    ...cursor,
    matches,
  } as ProjectionResult<Row>;
}

/** @internal Browser-local indexed evaluator over one immutable Replica row revision. */
export function evaluateIndexedProjectionRows<Row extends ProjectionRow>(
  rows: readonly Row[],
  query: object,
  cursor: Readonly<{
    revision?: number;
    cursor?: string;
    observations: Readonly<Record<string, string>>;
  }> = { observations: {} },
): ProjectionResult<Row> {
  const request = query as RuntimeProjectionQuery;
  const selection = request.find ?? request.select;
  const selected = selectProjectionRows(rows, selection);
  if (request.analytics !== undefined) {
    return {
      kind: "analytics",
      ...cursor,
      groups: analyticsGroups(selected, request.analytics),
    };
  }
  let matches: ProjectionMatch<ProjectionRow>[];
  if (request.text !== undefined) matches = indexedTextMatches(selected, request.text);
  else if (request.vector !== undefined) matches = indexedVectorMatches(selected, request.vector);
  else if (request.graph !== undefined) matches = indexedGraphMatches(selected, request.graph);
  else if (request.geo !== undefined) matches = indexedGeoMatches(selected, request.geo);
  else matches = selected.map((row) => ({ row: row as ProjectionRow }));
  return {
    kind: "rows",
    ...cursor,
    matches,
  } as ProjectionResult<Row>;
}

function cursorResult(state: RuntimeProjectionState): Readonly<{
  revision?: number;
  cursor?: string;
  observations: Readonly<Record<string, string>>;
}> {
  return state.revision === 0
    ? { observations: state.cursors }
    : {
        revision: state.revision,
        cursor: `${state.revision}`,
        observations: state.cursors,
      };
}

type SqliteStatement = Readonly<{
  run(...values: readonly unknown[]): unknown;
  get(...values: readonly unknown[]): unknown;
  all(...values: readonly unknown[]): readonly unknown[];
}>;

type SqliteDatabase = Readonly<{
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}>;

type SqliteProjectionSelection = Readonly<{
  selection?: ProjectionSelection<ProjectionRow>;
  query: object;
}>;

function runtimeProjectionSelection(query: object): SqliteProjectionSelection {
  const request = query as RuntimeProjectionQuery;
  if (request.find !== undefined) {
    return {
      selection: request.find as ProjectionSelection<ProjectionRow>,
      query: { find: {} },
    };
  }
  if (request.select === undefined) return { query };
  const remaining: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(request)) {
    if (name !== "select") remaining[name] = value;
  }
  return {
    selection: request.select as ProjectionSelection<ProjectionRow>,
    query: remaining,
  };
}

function indexSqliteProjectionScalars(
  database: SqliteDatabase,
  projection: string,
  version: number,
  row: string,
  id: string,
  value: Readonly<{ id: string }>,
): void {
  const insert = database.prepare(
    "INSERT INTO kit_projection_scalars " +
      "(projection, version, row_name, row_id, field, kind, text_value, number_value, " +
      "boolean_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [field, item] of Object.entries(value)) {
    if (item === null) {
      insert.run(projection, version, row, id, field, "null", null, null, null);
    } else if (typeof item === "string") {
      insert.run(projection, version, row, id, field, "string", item, null, null);
    } else if (typeof item === "number" && Number.isFinite(item)) {
      insert.run(projection, version, row, id, field, "number", null, item, null);
    } else if (typeof item === "boolean") {
      insert.run(projection, version, row, id, field, "boolean", null, null, item ? 1 : 0);
    }
  }
}

function indexSqliteProjectionTerms(
  database: SqliteDatabase,
  projection: string,
  version: number,
  row: string,
  id: string,
  value: Readonly<{ id: string }>,
): void {
  const insert = database.prepare(
    "INSERT INTO kit_projection_terms " +
      "(projection, version, row_name, row_id, field, term) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const [field, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    for (const term of projectionTextTerms(item)) {
      insert.run(projection, version, row, id, field, term);
    }
  }
}

function indexSqliteProjectionGeo(
  database: SqliteDatabase,
  projection: string,
  version: number,
  row: string,
  id: string,
  value: Readonly<{ id: string }>,
): void {
  const insert = database.prepare(
    "INSERT INTO kit_projection_geo " +
      "(projection, version, row_name, row_id, field, latitude, longitude) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [field, item] of Object.entries(value)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const point = item as Readonly<{ latitude?: unknown; longitude?: unknown }>;
    if (
      typeof point.latitude === "number" &&
      Number.isFinite(point.latitude) &&
      typeof point.longitude === "number" &&
      Number.isFinite(point.longitude)
    ) {
      insert.run(projection, version, row, id, field, point.latitude, point.longitude);
    }
  }
}

function indexSqliteProjectionVectors(
  database: SqliteDatabase,
  projection: string,
  version: number,
  row: string,
  id: string,
  value: Readonly<{ id: string }>,
): void {
  const insert = database.prepare(
    "INSERT INTO kit_projection_vectors " +
      "(projection, version, row_name, row_id, field, dimensions, value) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  for (const [field, item] of Object.entries(value)) {
    if (
      !Array.isArray(item) ||
      item.length === 0 ||
      !item.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ) {
      continue;
    }
    insert.run(projection, version, row, id, field, item.length, JSON.stringify(item));
  }
}

function sqliteProjectionRows(
  database: SqliteDatabase,
  projection: string,
  version: number,
  row: string,
  scope: ProjectionSelection<ProjectionRow>,
  request: SqliteProjectionSelection,
): Readonly<{
  rows: readonly Readonly<{ value: string }>[];
  query: object;
}> {
  const values: unknown[] = [projection, version, row];
  const authorized = sqliteProjectionSelectionSql("source", scope, values, {
    projection,
    version,
    row,
  });
  const common =
    "SELECT source.row_id, source.value FROM kit_projection_rows source " +
    "WHERE source.projection = ? AND source.version = ? AND source.row_name = ?";
  const ctes = [`authorized AS (${common}${authorized})`];
  let selected = "authorized";
  if (request.selection !== undefined) {
    const querySelection = sqliteProjectionSelectionSql("candidate", request.selection, values, {
      projection,
      version,
      row,
    });
    ctes.push(
      `selected AS (SELECT candidate.row_id, candidate.value FROM authorized candidate WHERE 1 = 1${querySelection})`,
    );
    selected = "selected";
  }
  const analytics = (request.query as RuntimeProjectionQuery).analytics;
  if (analytics !== undefined) {
    const fields = new Set(analytics.groupBy ?? []);
    for (const value of Object.values(analytics.measures)) {
      const measure = value as Readonly<{
        sum?: string;
        minimum?: string;
        maximum?: string;
        average?: string;
      }>;
      const field = measure.sum ?? measure.minimum ?? measure.maximum ?? measure.average;
      if (field !== undefined) fields.add(field);
    }
    values.push(projection, version, row);
    const fieldValues = [...fields];
    values.push(...fieldValues);
    const stored = database
      .prepare(
        `WITH ${ctes.join(", ")} ` +
          `SELECT candidate.row_id, scalar.field, scalar.kind, scalar.text_value, ` +
          `scalar.number_value, scalar.boolean_value FROM ${selected} candidate ` +
          `LEFT JOIN kit_projection_scalars scalar ON scalar.projection = ? ` +
          `AND scalar.version = ? AND scalar.row_name = ? ` +
          `AND scalar.row_id = candidate.row_id` +
          (fieldValues.length
            ? ` AND scalar.field IN (${fieldValues.map(() => "?").join(", ")})`
            : " AND 0 = 1") +
          " ORDER BY candidate.row_id, scalar.field",
      )
      .all(...values) as readonly Readonly<{
      row_id: string;
      field: string | null;
      kind: string | null;
      text_value: string | null;
      number_value: number | null;
      boolean_value: number | null;
    }>[];
    const records = new Map<string, Record<string, RuntimeValue>>();
    for (const item of stored) {
      let record = records.get(item.row_id);
      if (!record) {
        record = { id: item.row_id };
        records.set(item.row_id, record);
      }
      if (item.field === null || item.kind === null) continue;
      record[item.field] =
        item.kind === "null"
          ? null
          : item.kind === "string"
            ? item.text_value!
            : item.kind === "number"
              ? item.number_value!
              : item.boolean_value === 1;
    }
    return {
      rows: [...records.values()].map((value) => ({ value: JSON.stringify(value) })),
      query: request.query,
    };
  }
  const vector = (request.query as RuntimeProjectionQuery).vector;
  if (vector !== undefined) {
    values.push(projection, version, row, vector.field, vector.value.length);
    const candidates = database
      .prepare(
        `WITH ${ctes.join(", ")} ` +
          `SELECT candidate.row_id, stored.value FROM ${selected} candidate ` +
          `JOIN kit_projection_vectors stored ON stored.projection = ? ` +
          `AND stored.version = ? AND stored.row_name = ? ` +
          `AND stored.row_id = candidate.row_id AND stored.field = ? ` +
          `AND stored.dimensions = ? ORDER BY candidate.row_id`,
      )
      .all(...values) as readonly Readonly<{ row_id: string; value: string }>[];
    const scored = candidates
      .map((candidate) => ({
        id: candidate.row_id,
        score: projectionVectorScore(
          JSON.parse(candidate.value) as readonly number[],
          vector.value,
        ),
      }))
      .sort(
        (left, right) =>
          right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .slice(0, vector.limit ?? candidates.length);
    const read = database.prepare(
      "SELECT value FROM kit_projection_rows " +
        "WHERE projection = ? AND version = ? AND row_name = ? AND row_id = ?",
    );
    return {
      rows: scored.flatMap(({ id }) => {
        const stored = read.get(projection, version, row, id) as
          | Readonly<{ value: string }>
          | undefined;
        return stored === undefined ? [] : [stored];
      }),
      query: request.query,
    };
  }
  let result = `SELECT value FROM ${selected}`;
  const text = (request.query as RuntimeProjectionQuery).text;
  if (text !== undefined) {
    const terms = projectionTextTerms(text.value);
    if (text.fields.length === 0) {
      result = `SELECT value FROM ${selected} WHERE 0 = 1`;
    } else if (terms.length > 0) {
      values.push(projection, version, row, ...text.fields, terms[0]);
      result =
        `SELECT DISTINCT candidate.value FROM ${selected} candidate ` +
        `JOIN kit_projection_terms term ON term.projection = ? AND term.version = ? ` +
        `AND term.row_name = ? AND term.row_id = candidate.row_id ` +
        `WHERE term.field IN (${text.fields.map(() => "?").join(", ")}) AND term.term = ? ` +
        `ORDER BY candidate.row_id`;
    }
  } else {
    const graph = (request.query as RuntimeProjectionQuery).graph;
    if (graph !== undefined) {
      values.push(projection, version, row, graph.from, projection, version, row, graph.to);
      ctes.push(
        `edges AS (` +
          `SELECT candidate.row_id, candidate.value, source.text_value AS source, ` +
          `target.text_value AS target FROM ${selected} candidate ` +
          `JOIN kit_projection_scalars source ON source.projection = ? AND source.version = ? ` +
          `AND source.row_name = ? AND source.row_id = candidate.row_id ` +
          `AND source.field = ? AND source.kind = 'string' ` +
          `JOIN kit_projection_scalars target ON target.projection = ? AND target.version = ? ` +
          `AND target.row_name = ? AND target.row_id = candidate.row_id ` +
          `AND target.field = ? AND target.kind = 'string')`,
      );
      const direction = graph.direction ?? "outgoing";
      const join =
        direction === "incoming"
          ? "edges.target = walk.node"
          : direction === "both"
            ? "(edges.source = walk.node OR edges.target = walk.node)"
            : "edges.source = walk.node";
      const destination =
        direction === "incoming"
          ? "edges.source"
          : direction === "both"
            ? "CASE WHEN edges.source = walk.node THEN edges.target ELSE edges.source END"
            : "edges.target";
      values.push(graph.start, graph.depth);
      ctes.push(
        `walk(edge_id, node, depth) AS (` +
          `SELECT '' AS edge_id, ? AS node, 0 AS depth ` +
          `UNION SELECT edges.row_id, ${destination}, walk.depth + 1 ` +
          `FROM walk JOIN edges ON ${join} WHERE walk.depth < ?)`,
      );
      result =
        `SELECT DISTINCT edges.value FROM walk JOIN edges ON edges.row_id = walk.edge_id ` +
        `WHERE walk.depth > 0 ORDER BY edges.row_id`;
    } else {
      const geo = (request.query as RuntimeProjectionQuery).geo;
      if (geo !== undefined) {
        values.push(projection, version, row, geo.field);
        let bounds = "";
        if (geo.within !== undefined) {
          const latitudeDelta = geo.within / 111_320;
          values.push(geo.origin.latitude - latitudeDelta, geo.origin.latitude + latitudeDelta);
          bounds = " AND point.latitude BETWEEN ? AND ?";
        }
        result =
          `SELECT candidate.value FROM ${selected} candidate ` +
          `JOIN kit_projection_geo point ON point.projection = ? AND point.version = ? ` +
          `AND point.row_name = ? AND point.row_id = candidate.row_id AND point.field = ?` +
          bounds +
          " ORDER BY candidate.row_id";
      }
    }
  }
  const stored = database
    .prepare(`WITH RECURSIVE ${ctes.join(", ")} ${result}`)
    .all(...values) as readonly Readonly<{ value: string }>[];
  return { rows: stored, query: request.query };
}

function sqliteProjectionSelectionSql(
  alias: string,
  selection: ProjectionSelection<ProjectionRow>,
  values: unknown[],
  identity: Readonly<{ projection: string; version: number; row: string }>,
): string {
  let sql = "";
  for (const [field, condition] of Object.entries(selection.where ?? {})) {
    const expected = condition as Readonly<{
      equal?: Scalar;
      not?: Scalar;
      oneOf?: readonly Scalar[];
      greaterThan?: number;
      atLeast?: number;
      lessThan?: number;
      atMost?: number;
    }>;
    if (expected.equal !== undefined) {
      sql += sqliteProjectionScalarPredicate(alias, field, expected.equal, false, values, identity);
    }
    if (expected.not !== undefined) {
      sql += sqliteProjectionScalarPredicate(alias, field, expected.not, true, values, identity);
    }
    if (expected.oneOf !== undefined) {
      if (expected.oneOf.length === 0) {
        sql += " AND 0 = 1";
      } else {
        values.push(identity.projection, identity.version, identity.row, field);
        const choices: string[] = [];
        for (const value of expected.oneOf) {
          choices.push(sqliteProjectionScalarMatch(value, values));
        }
        sql +=
          ` AND EXISTS (SELECT 1 FROM kit_projection_scalars scalar WHERE ` +
          `scalar.projection = ? AND scalar.version = ? AND scalar.row_name = ? ` +
          `AND scalar.row_id = ${alias}.row_id AND scalar.field = ? AND (${choices.join(" OR ")}))`;
      }
    }
    for (const [operator, symbol] of [
      ["greaterThan", ">"],
      ["atLeast", ">="],
      ["lessThan", "<"],
      ["atMost", "<="],
    ] as const) {
      const boundary = expected[operator];
      if (boundary === undefined) continue;
      values.push(identity.projection, identity.version, identity.row, field, boundary);
      sql +=
        ` AND EXISTS (SELECT 1 FROM kit_projection_scalars scalar WHERE ` +
        `scalar.projection = ? AND scalar.version = ? AND scalar.row_name = ? ` +
        `AND scalar.row_id = ${alias}.row_id AND scalar.field = ? ` +
        `AND scalar.kind = 'number' AND scalar.number_value ${symbol} ?)`;
    }
  }
  const order = selection.order ?? [];
  if (order.length) {
    const expressions: string[] = [];
    for (const item of order) {
      values.push(identity.projection, identity.version, identity.row, item.field);
      expressions.push(
        `(SELECT scalar.number_value FROM kit_projection_scalars scalar ` +
          `WHERE scalar.projection = ? AND scalar.version = ? AND scalar.row_name = ? ` +
          `AND scalar.row_id = ${alias}.row_id AND scalar.field = ? AND scalar.kind = 'number') ` +
          (item.direction === "descending" ? "DESC" : "ASC"),
      );
    }
    sql += ` ORDER BY ${expressions.join(", ")}, ${alias}.row_id`;
  } else {
    sql += ` ORDER BY ${alias}.row_id`;
  }
  if (selection.limit !== undefined) {
    values.push(selection.limit);
    sql += " LIMIT ?";
  } else if (selection.offset !== undefined) {
    sql += " LIMIT -1";
  }
  if (selection.offset !== undefined) {
    values.push(selection.offset);
    sql += " OFFSET ?";
  }
  return sql;
}

function sqliteProjectionScalarPredicate(
  alias: string,
  field: string,
  value: Scalar | undefined,
  negate: boolean,
  values: unknown[],
  identity: Readonly<{ projection: string; version: number; row: string }>,
): string {
  values.push(identity.projection, identity.version, identity.row, field);
  const match = sqliteProjectionScalarMatch(value, values);
  return (
    ` AND ${negate ? "NOT " : ""}EXISTS (` +
    `SELECT 1 FROM kit_projection_scalars scalar WHERE ` +
    `scalar.projection = ? AND scalar.version = ? AND scalar.row_name = ? ` +
    `AND scalar.row_id = ${alias}.row_id AND scalar.field = ? AND ${match})`
  );
}

function sqliteProjectionScalarMatch(value: Scalar | undefined, values: unknown[]): string {
  if (value === null) return "scalar.kind = 'null'";
  if (typeof value === "string") {
    values.push(value);
    return "scalar.kind = 'string' AND scalar.text_value = ?";
  }
  if (typeof value === "number") {
    values.push(value);
    return "scalar.kind = 'number' AND scalar.number_value = ?";
  }
  if (typeof value === "boolean") {
    values.push(value ? 1 : 0);
    return "scalar.kind = 'boolean' AND scalar.boolean_value = ?";
  }
  return "0 = 1";
}

/** @internal Deterministic in-memory reference provider used by conformance tests. */
export function createMemoryProjectionStore(): DependencyImplementation<ProjectionStore> {
  const states = new Map<string, RuntimeProjectionState>();
  const revisions = new Map<string, ProjectionStoreRevision[]>();
  const identity = (projection: string, version: number) =>
    `${projection.length}:${projection}:${version}`;
  const load = (
    projection: string,
    version: number,
    rowNames: readonly string[],
  ): RuntimeProjectionState => {
    const stored = states.get(identity(projection, version));
    if (!stored) return initialProjectionState(rowNames);
    const rows: Record<string, readonly object[]> = {};
    for (const row of rowNames) rows[row] = stored.rows[row] ?? [];
    return {
      revision: stored.revision,
      cursors: stored.cursors,
      rows,
    };
  };

  return {
    async load({ input }) {
      return load(input.projection, input.version, input.rows);
    },
    async read({ input }) {
      const stored =
        states.get(identity(input.projection, input.version)) ?? initialProjectionState([]);
      const rows: Record<string, object[]> = {};
      for (const row of Object.keys(input.keys)) {
        const requested = input.keys[row] ?? [];
        const values: object[] = [];
        for (const value of stored.rows[row] ?? []) {
          if (valueIn(requested, (value as Readonly<{ id: string }>).id)) values.push(value);
        }
        rows[row] = values;
      }
      return rows;
    },
    async commit({ input }) {
      const key = identity(input.projection, input.version);
      const current = states.get(key) ?? initialProjectionState([]);
      if (current.revision !== input.expectedRevision) return undefined;
      const revision = current.revision + 1;
      const next = {
        revision,
        cursors: input.cursors,
        rows: applyProjectionChanges(current.rows, input.changes),
      };
      states.set(key, next);
      const retained = revisions.get(key) ?? [];
      retained.push({
        revision,
        cursors: input.cursors,
        invocations: input.invocations,
        changes: input.changes,
      });
      if (retained.length > retainedProjectionChanges) {
        retained.splice(0, retained.length - retainedProjectionChanges);
      }
      revisions.set(key, retained);
      return { revision, cursors: input.cursors };
    },
    async changes({ input }) {
      return (revisions.get(identity(input.projection, input.version)) ?? [])
        .filter(({ revision }) => revision > input.after)
        .slice(0, input.limit);
    },
    async query({ input }) {
      const state =
        states.get(identity(input.projection, input.version)) ?? initialProjectionState([]);
      const rows = state.rows[input.row] ?? [];
      const visible = selectProjectionRows(
        rows as readonly ProjectionRow[],
        input.scope as ProjectionSelection<ProjectionRow>,
      );
      return evaluateProjectionRows(visible, input.query, cursorResult(state));
    },
  };
}

/** @internal Transactional TypeScript SQLite ProjectionStore provider. */
export function createSqliteProjectionStore(
  database: SqliteDatabase,
): DependencyImplementation<ProjectionStore> {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS kit_projection_state (
      projection TEXT NOT NULL,
      version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      cursors TEXT NOT NULL,
      PRIMARY KEY (projection, version)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS kit_projection_rows (
      projection TEXT NOT NULL,
      version INTEGER NOT NULL,
      row_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (projection, version, row_name, row_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS kit_projection_rows_collection
      ON kit_projection_rows (projection, version, row_name, row_id);
    CREATE TABLE IF NOT EXISTS kit_projection_scalars (
      projection TEXT NOT NULL,
      version INTEGER NOT NULL,
      row_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      field TEXT NOT NULL,
      kind TEXT NOT NULL,
      text_value TEXT,
      number_value REAL,
      boolean_value INTEGER,
      PRIMARY KEY (projection, version, row_name, row_id, field)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS kit_projection_scalars_text
      ON kit_projection_scalars
      (projection, version, row_name, field, kind, text_value, row_id);
    CREATE INDEX IF NOT EXISTS kit_projection_scalars_number
      ON kit_projection_scalars
      (projection, version, row_name, field, kind, number_value, row_id);
    CREATE INDEX IF NOT EXISTS kit_projection_scalars_boolean
      ON kit_projection_scalars
      (projection, version, row_name, field, kind, boolean_value, row_id);
    CREATE TABLE IF NOT EXISTS kit_projection_terms (
      projection TEXT NOT NULL,
      version INTEGER NOT NULL,
      row_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      field TEXT NOT NULL,
      term TEXT NOT NULL,
      PRIMARY KEY (projection, version, row_name, row_id, field, term)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS kit_projection_terms_lookup
      ON kit_projection_terms
      (projection, version, row_name, field, term, row_id);
    CREATE TABLE IF NOT EXISTS kit_projection_geo (
      projection TEXT NOT NULL,
      version INTEGER NOT NULL,
      row_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      field TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      PRIMARY KEY (projection, version, row_name, row_id, field)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS kit_projection_geo_latitude
      ON kit_projection_geo
      (projection, version, row_name, field, latitude, longitude, row_id);
    CREATE INDEX IF NOT EXISTS kit_projection_geo_longitude
      ON kit_projection_geo
      (projection, version, row_name, field, longitude, latitude, row_id);
    CREATE TABLE IF NOT EXISTS kit_projection_vectors (
      projection TEXT NOT NULL,
      version INTEGER NOT NULL,
      row_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      field TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (projection, version, row_name, row_id, field)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS kit_projection_vectors_lookup
      ON kit_projection_vectors
      (projection, version, row_name, field, dimensions, row_id);
    CREATE TABLE IF NOT EXISTS kit_projection_changes (
      projection TEXT NOT NULL,
      version INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      cursors TEXT NOT NULL,
      changes TEXT NOT NULL,
      PRIMARY KEY (projection, version, revision)
    ) STRICT;
  `);

  const load = (
    projection: string,
    version: number,
    rowNames: readonly string[],
  ): RuntimeProjectionState => {
    const metadata = database
      .prepare(
        "SELECT revision, cursors FROM kit_projection_state " +
          "WHERE projection = ?1 AND version = ?2",
      )
      .get(projection, version) as Readonly<{ revision: number; cursors: string }> | undefined;
    const rows: Record<string, object[]> = {};
    for (const row of rowNames) rows[row] = [];
    for (const row of rowNames) {
      const stored = database
        .prepare(
          "SELECT value FROM kit_projection_rows " +
            "WHERE projection = ?1 AND version = ?2 AND row_name = ?3 ORDER BY row_id",
        )
        .all(projection, version, row) as readonly Readonly<{ value: string }>[];
      for (const item of stored) rows[row]!.push(JSON.parse(item.value) as object);
    }
    return {
      revision: metadata?.revision ?? 0,
      cursors: metadata ? (JSON.parse(metadata.cursors) as Readonly<Record<string, string>>) : {},
      rows,
    };
  };

  return {
    async load({ input }) {
      return load(input.projection, input.version, input.rows);
    },
    async read({ input }) {
      const rows: Record<string, object[]> = {};
      for (const row of Object.keys(input.keys)) {
        const values: object[] = [];
        const statement = database.prepare(
          "SELECT value FROM kit_projection_rows " +
            "WHERE projection = ?1 AND version = ?2 AND row_name = ?3 AND row_id = ?4",
        );
        for (const id of input.keys[row] ?? []) {
          const stored = statement.get(input.projection, input.version, row, id) as
            | Readonly<{ value: string }>
            | undefined;
          if (stored !== undefined) values.push(JSON.parse(stored.value) as object);
        }
        rows[row] = values;
      }
      return rows;
    },
    async commit({ input }) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const current = database
          .prepare(
            "SELECT revision FROM kit_projection_state " + "WHERE projection = ?1 AND version = ?2",
          )
          .get(input.projection, input.version) as Readonly<{ revision: number }> | undefined;
        if ((current?.revision ?? 0) !== input.expectedRevision) {
          database.exec("ROLLBACK");
          return undefined;
        }
        const revision = input.expectedRevision + 1;
        for (const change of input.changes) {
          database
            .prepare(
              "DELETE FROM kit_projection_scalars WHERE projection = ?1 AND version = ?2 " +
                "AND row_name = ?3 AND row_id = ?4",
            )
            .run(input.projection, input.version, change.row, change.id);
          database
            .prepare(
              "DELETE FROM kit_projection_terms WHERE projection = ?1 AND version = ?2 " +
                "AND row_name = ?3 AND row_id = ?4",
            )
            .run(input.projection, input.version, change.row, change.id);
          database
            .prepare(
              "DELETE FROM kit_projection_geo WHERE projection = ?1 AND version = ?2 " +
                "AND row_name = ?3 AND row_id = ?4",
            )
            .run(input.projection, input.version, change.row, change.id);
          database
            .prepare(
              "DELETE FROM kit_projection_vectors WHERE projection = ?1 AND version = ?2 " +
                "AND row_name = ?3 AND row_id = ?4",
            )
            .run(input.projection, input.version, change.row, change.id);
          if (change.after === undefined) {
            database
              .prepare(
                "DELETE FROM kit_projection_rows WHERE projection = ?1 AND version = ?2 " +
                  "AND row_name = ?3 AND row_id = ?4",
              )
              .run(input.projection, input.version, change.row, change.id);
          } else {
            database
              .prepare(
                "INSERT INTO kit_projection_rows " +
                  "(projection, version, row_name, row_id, value) VALUES (?1, ?2, ?3, ?4, ?5) " +
                  "ON CONFLICT (projection, version, row_name, row_id) " +
                  "DO UPDATE SET value = excluded.value",
              )
              .run(
                input.projection,
                input.version,
                change.row,
                change.id,
                JSON.stringify(change.after),
              );
            indexSqliteProjectionScalars(
              database,
              input.projection,
              input.version,
              change.row,
              change.id,
              change.after,
            );
            indexSqliteProjectionTerms(
              database,
              input.projection,
              input.version,
              change.row,
              change.id,
              change.after,
            );
            indexSqliteProjectionGeo(
              database,
              input.projection,
              input.version,
              change.row,
              change.id,
              change.after,
            );
            indexSqliteProjectionVectors(
              database,
              input.projection,
              input.version,
              change.row,
              change.id,
              change.after,
            );
          }
        }
        database
          .prepare(
            "INSERT INTO kit_projection_state (projection, version, revision, cursors) " +
              "VALUES (?1, ?2, ?3, ?4) ON CONFLICT (projection, version) " +
              "DO UPDATE SET revision = excluded.revision, cursors = excluded.cursors",
          )
          .run(input.projection, input.version, revision, JSON.stringify(input.cursors));
        database
          .prepare(
            "INSERT INTO kit_projection_changes " +
              "(projection, version, revision, cursors, changes) VALUES (?1, ?2, ?3, ?4, ?5)",
          )
          .run(
            input.projection,
            input.version,
            revision,
            JSON.stringify(input.cursors),
            JSON.stringify({
              invocations: input.invocations,
              changes: input.changes,
            }),
          );
        database
          .prepare(
            "DELETE FROM kit_projection_changes WHERE projection = ?1 AND version = ?2 " +
              "AND revision <= ?3",
          )
          .run(input.projection, input.version, Math.max(0, revision - retainedProjectionChanges));
        database.exec("COMMIT");
        return { revision, cursors: input.cursors };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    async changes({ input }) {
      const rows = database
        .prepare(
          "SELECT revision, cursors, changes FROM kit_projection_changes " +
            "WHERE projection = ?1 AND version = ?2 AND revision > ?3 " +
            "ORDER BY revision LIMIT ?4",
        )
        .all(input.projection, input.version, input.after, input.limit) as readonly Readonly<{
        revision: number;
        cursors: string;
        changes: string;
      }>[];
      return rows.map((row) => ({
        revision: row.revision,
        cursors: JSON.parse(row.cursors) as Readonly<Record<string, string>>,
        ...(JSON.parse(row.changes) as Readonly<{
          invocations: readonly string[];
          changes: readonly ProjectionStateChange[];
        }>),
      }));
    },
    async query({ input }) {
      const metadata = database
        .prepare(
          "SELECT revision, cursors FROM kit_projection_state " +
            "WHERE projection = ?1 AND version = ?2",
        )
        .get(input.projection, input.version) as
        | Readonly<{ revision: number; cursors: string }>
        | undefined;
      const selected = sqliteProjectionRows(
        database,
        input.projection,
        input.version,
        input.row,
        input.scope as ProjectionSelection<ProjectionRow>,
        runtimeProjectionSelection(input.query),
      );
      const stored = selected.rows;
      const rows = stored.map(({ value }) => JSON.parse(value) as ProjectionRow);
      return evaluateProjectionRows(rows, selected.query, {
        ...(metadata && metadata.revision > 0
          ? { revision: metadata.revision, cursor: `${metadata.revision}` }
          : {}),
        observations: metadata
          ? (JSON.parse(metadata.cursors) as Readonly<Record<string, string>>)
          : {},
      });
    },
  };
}

/**
 * Creates the deterministic reference surface for reducer, rebuild, query, and
 * authorization tests without starting a provider or compiling a Program.
 */
export function createProjectionFixture<Model extends ProjectionModelDefinition>(
  _projection: DefinedProjection<Model>,
  definition: ProjectionImplementation<Model>,
): ProjectionFixture<Model> {
  return Object.freeze({
    async rebuild({ sources }) {
      let rows: Readonly<Record<string, readonly object[]>> = {};
      for (const source of Object.keys(sources)) {
        for (const event of sources[source] ?? []) {
          const mutations = definition.reduce({
            source,
            event,
            rows: new Proxy(rows, {
              get(target, property) {
                return typeof property === "string" ? (target[property] ?? []) : undefined;
              },
            }),
          } as ProjectionSourceContext<Model>);
          rows = applyProjectionMutations(rows, mutations);
        }
      }
      return rows as RowsOf<Model>;
    },
    async query<Name extends keyof Model["Rows"]>(
      request: Readonly<{
        rows: RowsOf<Model>;
        row: Name;
        principal: Model["Principal"];
        query: ProjectionQuery<Model, Name>;
      }>,
    ) {
      const scopes = definition.authorize({ principal: request.principal });
      const scope = scopes[request.row];
      const visible = selectProjectionRows(request.rows[request.row], scope);
      return evaluateProjectionRows(visible, request.query) as ProjectionResult<
        Model["Rows"][Name]
      >;
    },
  });
}

/** Defines one checkpointed read Projection over typed Aggregate event feeds. */
export function createProjection<const Model extends ProjectionModelDefinition>(
  definition: ProjectionImplementation<Model>,
): DefinedProjection<Model> {
  return createProjectionRuntime(definition, undefined);
}

/** @internal Static identity supplied by composite Feature factories. */
export function createNamedProjection<const Model extends ProjectionModelDefinition>(
  definition: ProjectionImplementation<Model>,
  meaning: Readonly<{
    sources(): readonly Extract<keyof Model["Sources"], string>[];
    rows(): readonly Extract<keyof Model["Rows"], string>[];
    focus?(event: ProjectionSourceEvent<Model>): ProjectionFocus<Model>;
  }>,
): DefinedProjection<Model> {
  return createProjectionRuntime(definition, meaning);
}

function createProjectionRuntime<const Model extends ProjectionModelDefinition>(
  definition: ProjectionImplementation<Model>,
  meaning?: Readonly<{
    sources(): readonly Extract<keyof Model["Sources"], string>[];
    rows(): readonly Extract<keyof Model["Rows"], string>[];
    focus?(event: ProjectionSourceEvent<Model>): ProjectionFocus<Model>;
  }>,
): DefinedProjection<Model> {
  return createFeature<ProjectionFeatureContract<Model>>({
    providers: {
      server: {
        queries: projectionStoreProvider,
      },
    },
    programs: {
      server: {
        start({ dependencies }: Readonly<{ dependencies: ProjectionRequirements<Model> }>) {
          const name = typeLiteral<Model["Name"]>();
          const version = typeLiteral<Model["Version"]>();
          const sourceNames =
            meaning === undefined ? typeKeys<Model["Sources"]>() : meaning.sources();
          const rowNames = meaning === undefined ? typeKeys<Model["Rows"]>() : meaning.rows();
          const focus = meaning?.focus;
          const lock = `projection:${name.length}:${name}:${version}`;
          const eventStore = dependencies.events;
          const store = dependencies.queries;
          return {
            [name]: {
              async [dependencyInvocation](operation: string, received: object) {
                if (operation === "observe") {
                  const observation = received as Readonly<{
                    principal: Model["Principal"];
                    after: Readonly<Record<string, string>>;
                  }>;
                  const streams = [];
                  for (const source of sourceNames) {
                    const sourceName: string = source;
                    const after = observation.after[sourceName];
                    streams.push({
                      prefix: aggregateEventStreamPrefix(sourceName),
                      ...(after === undefined ? {} : { after }),
                    });
                  }
                  return mapStream(eventStore.subscribeAll({ streams }), ({ cursor }) => ({
                    cursor,
                  }));
                }
                if (operation === "$synchronize") {
                  const synchronization = received as Readonly<{
                    principal: Model["Principal"];
                    rows: readonly string[];
                    after?: number;
                  }>;
                  return await dependencies.synchronization.exclusive({
                    key: lock,
                    async task() {
                      const state = await catchUpProjection(
                        dependencies,
                        definition,
                        store,
                        name,
                        version,
                        rowNames,
                        sourceNames,
                        focus,
                      );
                      return await synchronizeProjection(
                        definition,
                        store,
                        name,
                        version,
                        state,
                        rowNames,
                        synchronization,
                      );
                    },
                  });
                }
                if (!valueIn(rowNames, operation)) {
                  throw new Error(`Unknown Projection row ${operation}.`);
                }
                return await dependencies.synchronization.exclusive({
                  key: lock,
                  async task() {
                    await catchUpProjection(
                      dependencies,
                      definition,
                      store,
                      name,
                      version,
                      rowNames,
                      sourceNames,
                      focus,
                    );
                    return await queryProjection(
                      definition,
                      store,
                      name,
                      version,
                      operation,
                      received as RuntimeProjectionRequest<Model>,
                    );
                  },
                });
              },
            },
          } as unknown as DependencyImplementations<ProjectionProvision<Model>>;
        },
      },
    },
  });
}

const projectionStoreProvider: ServerDependencyProvider<ProjectionStore> = {
  development({ configuration, sqlite }) {
    return createSqliteProjectionStore(
      sqlite(configuration.database ?? ".kit/data/projections.sqlite") as unknown as SqliteDatabase,
    );
  },
  production: {
    configuration: [
      {
        name: "database",
        environment: "KIT_PROJECTION_DATABASE",
        default: ".kit/data/projections.sqlite",
        allocation: {
          kind: "storage",
          name: "projections.sqlite",
          scope: "deployment",
          type: "file",
        },
      },
    ],
    crate: {
      package: "kit-server-projection-store",
      directory: "./providers/server/rust",
    },
    rust: {
      type: "kit_server_projection_store::ProjectionStore",
      constructor: "kit_server_projection_store::create",
    },
  },
};
