import {
  evaluateIndexedProjectionRows,
  projectionTextTerms,
  type ProjectionResult,
  type ProjectionRow,
} from "@/features/projection";

type TursoModule = typeof import("@tursodatabase/database-wasm/vite");
type TursoDatabase = Awaited<ReturnType<TursoModule["connect"]>>;

type LocalQuery = Readonly<{
  find?: object;
  select?: object;
  text?: Readonly<{ value: string; fields: readonly string[] }>;
  vector?: Readonly<{ field: string; value: readonly number[]; limit?: number }>;
}>;

type QueryInput = Readonly<{
  scope: string;
  row: string;
  rows: readonly ProjectionRow[];
  query: object;
}>;

type IndexedRow = Readonly<{
  row_id: string;
  field?: string;
  term?: string;
  score?: number;
  distance?: number;
}>;

type StoredRows = Map<string, string>;

export type TursoReplicaQueryEngine = Readonly<{
  query(input: QueryInput): Promise<ProjectionResult<ProjectionRow>>;
  remove(scope: string): Promise<void>;
}> &
  Disposable;

const schema = `
  CREATE TABLE kit_replica_terms (
    scope TEXT NOT NULL,
    row_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    field TEXT NOT NULL,
    term TEXT NOT NULL,
    PRIMARY KEY (scope, row_name, row_id, field, term)
  );
  CREATE INDEX kit_replica_terms_lookup
    ON kit_replica_terms (scope, row_name, field, term, row_id);

  CREATE TABLE kit_replica_vectors (
    scope TEXT NOT NULL,
    row_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    field TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    value BLOB NOT NULL,
    PRIMARY KEY (scope, row_name, row_id, field)
  );
  CREATE INDEX kit_replica_vectors_scope
    ON kit_replica_vectors (scope, row_name, field, dimensions, row_id);
`;

/**
 * Browser-local Rust query engine. IndexedDB remains the shared durable
 * outbox; this lazily loaded Turso mirror owns full-text and vector execution.
 */
export function createTursoReplicaQueryEngine(): TursoReplicaQueryEngine {
  const mirrored = new Map<string, StoredRows>();
  let database: Promise<TursoDatabase> | undefined;
  let work = Promise.resolve();
  let disposed = false;

  const connect = (): Promise<TursoDatabase> => {
    if (disposed) return Promise.reject(new Error("The Replica query engine is disposed."));
    database ??= import("@tursodatabase/database-wasm/vite")
      .then(({ connect: open }) => open(":memory:"))
      .then(async (connection) => {
        await connection.exec(schema);
        return connection;
      })
      .catch((error: unknown) => {
        database = undefined;
        throw error;
      });
    return database;
  };

  const ordered = <Value>(task: () => Promise<Value>): Promise<Value> => {
    const result = work.catch(() => undefined).then(task);
    work = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return Object.freeze({
    query(input: QueryInput) {
      return ordered(async () => {
        const request = input.query as LocalQuery;
        if (request.text === undefined && request.vector === undefined) {
          return evaluateIndexedProjectionRows(input.rows, input.query);
        }
        const connection = await connect();
        await synchronizeRows(connection, mirrored, input);
        const selected = selectedRows(input.rows, request);
        if (request.text !== undefined) {
          return await queryText(connection, input, selected, request.text);
        }
        return await queryVector(connection, input, selected, request.vector!);
      });
    },
    remove(scope: string) {
      return ordered(async () => {
        for (const key of mirrored.keys()) {
          if (key.startsWith(`${scope.length}:${scope}:`)) mirrored.delete(key);
        }
        if (!database) return;
        const connection = await database;
        await connection.batch(
          [
            {
              sql: "DELETE FROM kit_replica_terms WHERE scope = ?",
              args: [scope],
            },
            {
              sql: "DELETE FROM kit_replica_vectors WHERE scope = ?",
              args: [scope],
            },
          ],
          "immediate",
        );
      });
    },
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;
      mirrored.clear();
      const closing = database;
      database = undefined;
      if (closing) {
        void work
          .catch(() => undefined)
          .then(async () => (await closing).close())
          .catch(() => undefined);
      }
    },
  });
}

async function synchronizeRows(
  database: TursoDatabase,
  mirrored: Map<string, StoredRows>,
  input: QueryInput,
): Promise<void> {
  const identity = rowIdentity(input.scope, input.row);
  const previous = mirrored.get(identity) ?? new Map();
  const next = new Map(input.rows.map((row) => [row.id, JSON.stringify(row)]));
  const statements: Array<string | Readonly<{ sql: string; args: readonly (string | number)[] }>> =
    [];

  for (const [id, value] of previous) {
    if (next.get(id) === value) continue;
    deleteIndexedRow(statements, input.scope, input.row, id);
  }
  for (const row of input.rows) {
    const serialized = next.get(row.id)!;
    if (previous.get(row.id) === serialized) continue;
    if (!previous.has(row.id)) deleteIndexedRow(statements, input.scope, input.row, row.id);
    for (const [field, value] of Object.entries(row as Readonly<Record<string, unknown>>)) {
      if (typeof value === "string") {
        for (const term of projectionTextTerms(value)) {
          statements.push({
            sql:
              "INSERT INTO kit_replica_terms " +
              "(scope, row_name, row_id, field, term) VALUES (?, ?, ?, ?, ?)",
            args: [input.scope, input.row, row.id, field, term],
          });
        }
      } else if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
      ) {
        statements.push({
          sql:
            "INSERT INTO kit_replica_vectors " +
            "(scope, row_name, row_id, field, dimensions, value) " +
            "VALUES (?, ?, ?, ?, ?, vector32(?))",
          args: [input.scope, input.row, row.id, field, value.length, JSON.stringify(value)],
        });
      }
    }
  }
  if (statements.length > 0) await database.batch(statements, "immediate");
  mirrored.set(identity, next);
}

function deleteIndexedRow(
  statements: Array<string | Readonly<{ sql: string; args: readonly (string | number)[] }>>,
  scope: string,
  row: string,
  id: string,
): void {
  statements.push(
    {
      sql: "DELETE FROM kit_replica_terms WHERE scope = ? AND row_name = ? AND row_id = ?",
      args: [scope, row, id],
    },
    {
      sql: "DELETE FROM kit_replica_vectors WHERE scope = ? AND row_name = ? AND row_id = ?",
      args: [scope, row, id],
    },
  );
}

function selectedRows(rows: readonly ProjectionRow[], query: LocalQuery): readonly ProjectionRow[] {
  const selection = query.find ?? query.select;
  if (selection === undefined) return rows;
  const result = evaluateIndexedProjectionRows(rows, { find: selection });
  return result.kind === "rows" ? result.matches.map(({ row }) => row) : [];
}

async function queryText(
  database: TursoDatabase,
  input: QueryInput,
  rows: readonly ProjectionRow[],
  query: NonNullable<LocalQuery["text"]>,
): Promise<ProjectionResult<ProjectionRow>> {
  const terms = projectionTextTerms(query.value);
  if (terms.length === 0 || query.fields.length === 0) {
    return {
      kind: "rows",
      observations: {},
      matches: rows.map((row) => ({ row, score: query.fields.length })),
    };
  }
  const fields = query.fields.map(() => "?").join(", ");
  const termParameters = terms.map(() => "?").join(", ");
  const indexed = (await database.all(
    "SELECT row_id, field, term FROM kit_replica_terms " +
      "WHERE scope = ? AND row_name = ? " +
      `AND field IN (${fields}) AND term IN (${termParameters})`,
    input.scope,
    input.row,
    ...query.fields,
    ...terms,
  )) as readonly IndexedRow[];
  const matchesByField = new Map<string, Map<string, Set<string>>>();
  for (const result of indexed) {
    if (result.field === undefined || result.term === undefined) continue;
    let fieldsForRow = matchesByField.get(result.row_id);
    if (!fieldsForRow) {
      fieldsForRow = new Map();
      matchesByField.set(result.row_id, fieldsForRow);
    }
    let matchedTerms = fieldsForRow.get(result.field);
    if (!matchedTerms) {
      matchedTerms = new Set();
      fieldsForRow.set(result.field, matchedTerms);
    }
    matchedTerms.add(result.term);
  }
  const scores = new Map<string, number>();
  for (const [id, matchedFields] of matchesByField) {
    let score = 0;
    for (const matchedTerms of matchedFields.values()) {
      if (terms.every((term) => matchedTerms.has(term))) score += 1;
    }
    if (score > 0) scores.set(id, score);
  }
  const order = new Map(rows.map((row, index) => [row.id, index]));
  const matches = rows
    .filter((row) => scores.has(row.id))
    .map((row) => ({ row, score: scores.get(row.id)! }))
    .sort(
      (left, right) =>
        right.score - left.score || (order.get(left.row.id) ?? 0) - (order.get(right.row.id) ?? 0),
    );
  return { kind: "rows", observations: {}, matches };
}

async function queryVector(
  database: TursoDatabase,
  input: QueryInput,
  rows: readonly ProjectionRow[],
  query: NonNullable<LocalQuery["vector"]>,
): Promise<ProjectionResult<ProjectionRow>> {
  if (
    query.value.length === 0 ||
    query.value.some((value) => typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new Error("A Replica vector query requires a non-empty finite vector.");
  }
  const indexed = (await database.all(
    "SELECT row_id, vector_distance_cos(value, vector32(?)) AS distance " +
      "FROM kit_replica_vectors " +
      "WHERE scope = ? AND row_name = ? AND field = ? AND dimensions = ?",
    JSON.stringify(query.value),
    input.scope,
    input.row,
    query.field,
    query.value.length,
  )) as readonly IndexedRow[];
  const scores = new Map(
    indexed.map(({ row_id, distance }) => [row_id, 1 - Number(distance ?? 1)]),
  );
  const order = new Map(rows.map((row, index) => [row.id, index]));
  const matches = rows
    .filter((row) => scores.has(row.id))
    .map((row) => ({ row, score: scores.get(row.id)! }))
    .sort(
      (left, right) =>
        right.score - left.score || (order.get(left.row.id) ?? 0) - (order.get(right.row.id) ?? 0),
    )
    .slice(0, query.limit ?? rows.length);
  return { kind: "rows", observations: {}, matches };
}

function rowIdentity(scope: string, row: string): string {
  return `${scope.length}:${scope}:${row}`;
}
