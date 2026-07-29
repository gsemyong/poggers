import {
  dependencyInvocation,
  dispatchDependency,
  type Dependency,
  type DependencyContract,
  type DependencyImplementations,
  type DependencyReference,
} from "@/core/dependency";
import { createFeature, type Feature } from "@/core/feature";
import { typeKeys, typeLiteral } from "@/core/intrinsic";
import { mapStream } from "@/core/stream";
import { aggregateEventStreamPrefix, type Aggregate } from "@/features/aggregate";
import type { EventStore, ServerProcess, Synchronization } from "@/platforms/server";

type Empty = Record<never, never>;
type MaybePromise<Value> = Value | PromiseLike<Value>;
type Scalar = string | number | boolean | null;
type RuntimeValue = Scalar | object | undefined;
type ProjectionRow = Readonly<{ id: string }>;
declare const projectionDefinition: unique symbol;

type ProjectionModelInput = Readonly<{
  Name: string;
  Version: number;
  Principal: object;
  Sources: Readonly<Record<string, object>>;
  Rows: Readonly<Record<string, ProjectionRow>>;
  Dependencies?: Readonly<Record<string, DependencyContract>>;
  Queries?: ProjectionQueryFamilies;
}>;

export type ProjectionModelDefinition = Readonly<{
  Name: string;
  Version: number;
  Principal: object;
  Sources: Readonly<Record<string, object>>;
  Rows: Readonly<Record<string, ProjectionRow>>;
  Dependencies: Readonly<Record<string, DependencyContract>>;
  Queries: ProjectionQueryFamilies;
}>;

/** The semantic model of one rebuildable, checkpointed read projection. */
export type Projection<Model extends ProjectionModelInput> = Readonly<
  Omit<Model, "Dependencies" | "Queries"> & {
    Dependencies: Model extends {
      Dependencies: infer Dependencies extends Readonly<Record<string, DependencyContract>>;
    }
      ? Dependencies
      : Empty;
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

type ProjectionAuthorizationContext<
  Model extends ProjectionModelDefinition,
  Name extends keyof Model["Rows"],
> = Readonly<{
  principal: Model["Principal"];
  row: Readonly<Model["Rows"][Name]>;
  dependencies: Model["Dependencies"];
}>;

export type ProjectionImplementation<Model extends ProjectionModelDefinition> = Readonly<{
  reduce(
    context: ProjectionSourceContext<Model>,
  ): MaybePromise<readonly ProjectionMutation<Model>[]>;
  authorize: Readonly<{
    [Name in keyof Model["Rows"]]: (
      context: ProjectionAuthorizationContext<Model, Name>,
    ) => MaybePromise<boolean>;
  }>;
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
    Model["Dependencies"] &
    Readonly<{
      events: EventStore<object>;
      synchronization: Synchronization;
    }>
>;

type ProjectionProvision<Model extends ProjectionModelDefinition> = Readonly<{
  [Name in Model["Name"]]: ProjectionDependency<Model>;
}>;

type ProjectionFeatureContract<Model extends ProjectionModelDefinition> = Readonly<{
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

type RuntimeProjectionState = Readonly<{
  revision: number;
  cursors: Readonly<Record<string, string>>;
  rows: Readonly<Record<string, readonly object[]>>;
}>;

type ProjectionCheckpoint = Readonly<{
  type: "projection.checkpoint";
  state: RuntimeProjectionState;
}>;

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

function projectionStream(name: string, version: number): string {
  return `projection:${name.length}:${name}:${version}`;
}

function initialProjectionState(rowNames: readonly string[]): RuntimeProjectionState {
  const rows: Record<string, readonly object[]> = {};
  for (const row of rowNames) rows[row] = [];
  return { revision: 0, cursors: {}, rows };
}

async function loadProjectionState(
  events: EventStore<object>,
  stream: string,
  rowNames: readonly string[],
): Promise<RuntimeProjectionState> {
  const snapshot = await events.loadSnapshot({ stream });
  let state =
    snapshot === undefined
      ? initialProjectionState(rowNames)
      : (snapshot.snapshot as RuntimeProjectionState);
  const appended = await events.read({ stream, after: snapshot?.revision ?? 0 });
  for (const stored of appended) {
    const checkpoint = stored.event as ProjectionCheckpoint;
    if (checkpoint.type === "projection.checkpoint") state = checkpoint.state;
  }
  return state;
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
    if (mutationRow === undefined || next[mutationRow] === undefined) {
      throw new Error("Projection mutation names an unknown row.");
    }
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
  state: RuntimeProjectionState,
  sourceNames: readonly string[],
): Promise<RuntimeProjectionState> {
  let rows = state.rows;
  const cursors: Record<string, string> = { ...state.cursors };
  let changed = false;
  for (const source of sourceNames) {
    const feed = dependencies[`${source}Events`] as object;
    let done = false;
    while (!done) {
      const page = await dispatchDependency<{
        entries: readonly object[];
        cursor?: string;
        done: boolean;
      }>(feed, "scan", {
        after: cursors[source],
        limit: 100,
      });
      for (const event of page.entries) {
        const mutations = await definition.reduce({
          source,
          event,
          rows,
        } as ProjectionSourceContext<Model>);
        rows = applyProjectionMutations(rows, mutations);
        changed = true;
      }
      if (page.cursor !== undefined && page.cursor !== cursors[source]) {
        cursors[source] = page.cursor;
        changed = true;
      }
      done = page.done;
    }
  }
  return changed
    ? {
        revision: state.revision,
        cursors,
        rows,
      }
    : state;
}

async function saveProjectionState(
  events: EventStore<object>,
  stream: string,
  previous: RuntimeProjectionState,
  next: RuntimeProjectionState,
): Promise<RuntimeProjectionState> {
  if (previous === next) return previous;
  const committed = {
    ...next,
    revision: previous.revision + 1,
  };
  const appended = await events.append({
    stream,
    expectedRevision: previous.revision,
    events: [{ type: "projection.checkpoint", state: committed } satisfies ProjectionCheckpoint],
  });
  if (appended === undefined) throw new Error("Projection checkpoint conflicted.");
  const saved = await events.saveSnapshot({
    stream,
    expectedRevision: previous.revision,
    revision: committed.revision,
    snapshot: committed,
  });
  if (saved) await events.compact({ stream, through: committed.revision });
  return committed;
}

function projectionDependencies<Model extends ProjectionModelDefinition>(
  dependencies: ProjectionRequirements<Model>,
  sourceNames: readonly string[],
): Model["Dependencies"] {
  const result: Record<string, DependencyContract> = {};
  for (const name of Object.keys(dependencies)) {
    let source = name === "events" || name === "synchronization";
    for (const sourceName of sourceNames) {
      if (name === `${sourceName}Events`) source = true;
    }
    if (!source) result[name] = dependencies[name] as DependencyContract;
  }
  return result as Model["Dependencies"];
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

function selectProjectionRows(rows: readonly object[], selection: object | undefined): object[] {
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
    const a = left as Readonly<Record<string, number>>;
    const b = right as Readonly<Record<string, number>>;
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
  if (phrase.length === 0) return true;
  for (let start = 0; start < text.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (text[start + offset] !== phrase[offset]) matches = false;
    }
    if (matches) return true;
  }
  return false;
}

function vectorMatches(
  rows: readonly object[],
  query: NonNullable<RuntimeProjectionQuery["vector"]>,
): ProjectionMatch<ProjectionRow>[] {
  const matches: ProjectionMatch<ProjectionRow>[] = [];
  for (const row of rows) {
    const record = row as Readonly<Record<string, RuntimeValue>> & ProjectionRow;
    const vector = record[query.field] as readonly number[];
    let dot = 0;
    let left = 0;
    let right = 0;
    for (let index = 0; index < query.value.length; index += 1) {
      const a = vector[index] ?? 0;
      const b = query.value[index] ?? 0;
      dot += a * b;
      left += a * a;
      right += b * b;
    }
    const score = left === 0 || right === 0 ? 0 : dot / projectionSquareRoot(left * right);
    matches.push({ row: record, score });
  }
  matches.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return matches.slice(0, query.limit ?? matches.length);
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
  for (const row of rows) {
    const record = row as Readonly<Record<string, RuntimeValue>>;
    const key: Record<string, Scalar> = {};
    for (const groupField of query.groupBy ?? []) {
      key[groupField] = record[groupField] as Scalar;
    }
    let selectedGroup:
      | {
          key: Record<string, Scalar>;
          rows: Readonly<Record<string, RuntimeValue>>[];
        }
      | undefined;
    for (const candidate of groups) {
      let matches = true;
      for (const candidateField of query.groupBy ?? []) {
        if (candidate.key[candidateField] !== key[candidateField]) matches = false;
      }
      if (matches) selectedGroup = candidate;
    }
    if (selectedGroup === undefined) {
      selectedGroup = { key, rows: [] };
      groups.push(selectedGroup);
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
  dependencies: Model["Dependencies"],
  rowName: string,
  state: RuntimeProjectionState,
  request: RuntimeProjectionRequest<Model>,
): Promise<ProjectionResult<ProjectionRow>> {
  const authorize = definition.authorize[rowName] as (
    context: Readonly<{
      principal: Model["Principal"];
      row: ProjectionRow;
      dependencies: Model["Dependencies"];
    }>,
  ) => MaybePromise<boolean>;
  const visible: object[] = [];
  for (const row of state.rows[rowName] ?? []) {
    if (
      await authorize({
        principal: request.principal,
        row: row as ProjectionRow,
        dependencies,
      })
    ) {
      visible.push(row);
    }
  }
  return evaluateProjectionRows(
    visible as readonly ProjectionRow[],
    request.query,
    cursorResult(state),
  );
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

/**
 * Creates the deterministic reference surface for reducer, rebuild, query, and
 * authorization tests without starting a provider or compiling a Program.
 */
export function createProjectionFixture<Model extends ProjectionModelDefinition>(
  _projection: DefinedProjection<Model>,
  definition: ProjectionImplementation<Model>,
  input: Readonly<{ dependencies: Model["Dependencies"] }>,
): ProjectionFixture<Model> {
  return Object.freeze({
    async rebuild({ sources }) {
      let rows = initialProjectionState(Object.keys(definition.authorize)).rows;
      for (const source of Object.keys(sources)) {
        for (const event of sources[source] ?? []) {
          const mutations = await definition.reduce({
            source,
            event,
            rows,
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
      return (await queryProjection(
        definition,
        input.dependencies,
        String(request.row),
        {
          revision: 0,
          cursors: {},
          rows: request.rows,
        },
        {
          principal: request.principal,
          query: request.query as RuntimeProjectionQuery,
        },
      )) as ProjectionResult<Model["Rows"][Name]>;
    },
  });
}

/** Defines one checkpointed read Projection over typed Aggregate event feeds. */
export function createProjection<const Model extends ProjectionModelDefinition>(
  definition: ProjectionImplementation<Model>,
): DefinedProjection<Model> {
  return createFeature<ProjectionFeatureContract<Model>>({
    programs: {
      server: {
        start({ dependencies }: Readonly<{ dependencies: ProjectionRequirements<Model> }>) {
          const name = typeLiteral<Model["Name"]>();
          const version = typeLiteral<Model["Version"]>();
          const sourceNames = typeKeys<Model["Sources"]>();
          const rowNames = typeKeys<Model["Rows"]>();
          const stream = projectionStream(name, version);
          const eventStore = dependencies.events;
          const modelDependencies = projectionDependencies<Model>(dependencies, sourceNames);
          return {
            [name]: {
              async [dependencyInvocation](operation: string, received: object) {
                if (operation === "observe") {
                  const request = received as Readonly<{
                    principal: Model["Principal"];
                    after: Readonly<Record<string, string>>;
                  }>;
                  const streams = [];
                  for (const source of sourceNames) {
                    const sourceName: string = source;
                    const after = request.after[sourceName];
                    streams.push({
                      prefix: aggregateEventStreamPrefix(sourceName),
                      ...(after === undefined ? {} : { after }),
                    });
                  }
                  return mapStream(eventStore.subscribeAll({ streams }), ({ cursor }) => ({
                    cursor,
                  }));
                }
                if (!valueIn(rowNames, operation)) {
                  throw new Error(`Unknown Projection row ${operation}.`);
                }
                return await dependencies.synchronization.exclusive({
                  key: stream,
                  async task() {
                    const previous = await loadProjectionState(eventStore, stream, rowNames);
                    const refreshed = await refreshProjection(
                      dependencies,
                      definition,
                      previous,
                      sourceNames,
                    );
                    const state = await saveProjectionState(
                      eventStore,
                      stream,
                      previous,
                      refreshed,
                    );
                    return await queryProjection(
                      definition,
                      modelDependencies,
                      operation,
                      state,
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
