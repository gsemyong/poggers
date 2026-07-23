import {
  bindDataPrincipal,
  matchesDataQuery,
  type DataApi,
  type DataModelDefinition,
  type DataProjectionQuery,
  type DataProjectionResult,
  type DataService,
  type DataStore,
  type DefinedData,
} from "@/features/data";
import type {
  EntityActions,
  EntityApi,
  EntityEvent,
  EntityService,
  EntityState,
  EntityValue,
  EventStore,
} from "@/features/entity";
import { createMemoryEventStore } from "@/features/entity.testing";
import type { HttpRequest, HttpResponse } from "@/platforms/server/platform";
import { createProgramContributionInstance } from "@/runtime/process";

type StoredCollection<Record extends EntityValue> = Readonly<{
  revision: number;
  records: readonly Record[];
  search: readonly string[];
}>;

/** In-memory reference realization for data Feature and adapter conformance tests. */
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

/** Mounts a specialized data Feature with deterministic in-memory host dependencies. */
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
  const sourceName = `${data.dependency}Source`;
  const events = createMemoryEventStore<EntityEvent<Model["Record"]>>();
  const store = input.store ?? createMemoryDataStore<Model["Record"]>();
  let identifier = 0;
  let time = 0;
  const source = createProgramContributionInstance(
    data.server.features.source.programs.server as never,
    {
      address: { program: "server", feature: `${data.dependency}.source` },
      provides: [sourceName],
      dependencies: {
        identity: { authenticate: async () => input.principal },
        events,
        identifiers: { create: () => `record-${++identifier}` },
        clock: { now: () => ++time },
        http: { route: () => ({ [Symbol.dispose]: () => undefined }) },
      },
    },
  );
  const sourceDependencies = await source.start();
  const authority = Reflect.get(sourceDependencies, sourceName) as EntityService<
    DataSourceModel<Model>
  >;
  const feature = createProgramContributionInstance(data.server.programs.server as never, {
    address: { program: "server", feature: data.dependency },
    provides: [data.dependency],
    dependencies: { [sourceName]: authority, dataStore: store },
  });
  const dependencies = await feature.start();
  const service = Reflect.get(dependencies, data.dependency) as DataService<Model>;
  return {
    api: bindDataPrincipal(service, input.principal),
    service,
    events,
    store,
    as: (principal) => bindDataPrincipal(service, principal),
    async [Symbol.asyncDispose]() {
      await feature.dispose();
      await source.dispose();
    },
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
  const sourceName = `${data.dependency}Source`;
  const events = createMemoryEventStore<EntityEvent<Model["Record"]>>();
  const store = input.store ?? createMemoryDataStore<Model["Record"]>();
  const storage = memoryStore();
  let handler: ((request: HttpRequest) => Promise<HttpResponse>) | undefined;
  let identifier = 0;
  let time = 0;
  const server = createProgramContributionInstance(
    data.server.features.source.programs.server as never,
    {
      address: { program: "server", feature: `${data.dependency}.source` },
      provides: [sourceName],
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
      },
    },
  );
  await server.start();
  const browserSource = createProgramContributionInstance(
    data.browser.features.source.programs.browser as never,
    {
      address: { program: "browser", feature: `${data.dependency}.source` },
      provides: [sourceName],
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
            if (!handler) throw new Error("The data fixture route is not mounted.");
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
      },
    },
  );
  const sourceDependencies = await browserSource.start();
  const authority = Reflect.get(sourceDependencies, sourceName) as EntityApi<
    DataSourceModel<Model>
  >;
  const browser = createProgramContributionInstance(data.browser.programs.browser as never, {
    address: { program: "browser", feature: data.dependency },
    provides: [data.dependency],
    dependencies: { [sourceName]: authority, dataStore: store },
  });
  const dependencies = await browser.start();
  const api = Reflect.get(dependencies, data.dependency) as DataApi<Model>;
  return {
    api,
    get state() {
      return browserSource.ui!.api as EntityState<DataSourceModel<Model>>;
    },
    actions: browserSource.ui!.actions as EntityActions<DataSourceModel<Model>>,
    events,
    store,
    async [Symbol.asyncDispose]() {
      await browser.dispose();
      await browserSource.dispose();
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
