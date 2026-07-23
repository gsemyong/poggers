import type { DataProjectionQuery, DataProjectionResult, DataStore } from "@/features/data";
import type { EntityValue } from "@/features/entity";

export type { DataStore } from "@/features/data";

type Statement = string | Readonly<{ sql: string; args?: readonly unknown[] }>;

export type TursoDatabase = Readonly<{
  exec(sql: string): Promise<void>;
  batch(statements: readonly Statement[], mode?: "deferred" | "immediate"): Promise<unknown>;
  all(sql: string, ...parameters: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
  close(): Promise<void>;
}>;

/** Implements the Data projection contract over the common Turso database API. */
export function createTursoDataStore<Record extends EntityValue = EntityValue>(
  database: Promise<TursoDatabase>,
): DataStore<Record> & AsyncDisposable {
  const collections = new Map<string, Promise<Collection<Record>>>();
  let disposed = false;
  const requireDatabase = async () => {
    if (disposed) throw new Error("The Turso data store is disposed.");
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
      await (await database).close();
    },
  };
  return Object.freeze(store);
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
    if (!searchable || text === "")
      return { sql: `SELECT record FROM ${table} WHERE 0`, parameters };
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
