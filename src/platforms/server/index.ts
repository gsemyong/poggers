import type {
  Dependency,
  DependencyContract,
  DependencyImplementation,
  DependencyProvider,
} from "@/core/dependency";

/** A headless server realization family. */
export type ServerPlatform = Readonly<{ Name: "server" }>;

type ServerDependency<Operations extends Readonly<Record<string, (input: never) => unknown>>> =
  Dependency<{ Operations: Operations }>;

export type ServerProviderConfiguration = Readonly<{
  name: string;
  environment: string;
  required?: true;
  default?: string;
  allocation?:
    | Readonly<{ kind: "port" }>
    | Readonly<{
        kind: "storage";
        name: string;
        scope: "deployment" | "process";
        type: "directory" | "file";
      }>;
  source?:
    | Readonly<{ kind: "process-location" }>
    | Readonly<{
        kind: "assets";
        platform?: string;
        format: "single" | "interfaces";
      }>;
}>;

export type ServerProviderProduction = Readonly<{
  requires?: readonly string[];
  configuration: readonly ServerProviderConfiguration[];
  crate: Readonly<{ package: string; directory: string }>;
  rust: Readonly<{ type: string; constructor: string }>;
}>;

export type ServerProviderContext = Readonly<{
  appName: string;
  configuration: Readonly<Record<string, string>>;
  origin: string;
  webOrigins: readonly string[];
  sqlite(path: string): object & Disposable;
}>;

/** One server realization packaged by the semantic owner of a Dependency. */
export type ServerDependencyProvider<Api extends DependencyContract> = DependencyProvider<
  Api,
  (
    context: ServerProviderContext,
  ) =>
    | (DependencyImplementation<Api> & Partial<Disposable & AsyncDisposable>)
    | PromiseLike<DependencyImplementation<Api> & Partial<Disposable & AsyncDisposable>>,
  ServerProviderProduction
>;

export type StoredEvent<Event = object> = Readonly<{
  stream: string;
  revision: number;
  event: Event;
}>;

export type StoredSnapshot<Snapshot = object> = Readonly<{
  stream: string;
  revision: number;
  snapshot: Snapshot;
}>;

/** Durable append-only storage available to server Programs. */
export type EventStore<Event = object, Snapshot = object> = ServerDependency<{
  read(input: {
    stream: string;
    after?: number;
    limit?: number;
  }): Promise<readonly StoredEvent<Event>[]>;
  append(input: {
    stream: string;
    expectedRevision: number;
    events: readonly Event[];
  }): Promise<readonly StoredEvent<Event>[] | undefined>;
  subscribe(input: { stream: string; after?: number }): AsyncIterable<StoredEvent<Event>>;
  loadSnapshot(input: { stream: string }): Promise<StoredSnapshot<Snapshot> | undefined>;
  saveSnapshot(input: {
    stream: string;
    expectedRevision: number;
    revision: number;
    snapshot: Snapshot;
  }): Promise<boolean>;
  compact(input: { stream: string; through: number }): Promise<void>;
}>;

/** Wall-clock observation available to server Programs. */
export type Clock = ServerDependency<{ now(input: {}): number }>;

/** Unique identity generation available to server Programs. */
export type Identifiers = ServerDependency<{ create(input: {}): string }>;

export type HttpField = Readonly<{ name: string; value: string }>;

/** Finds the first matching value in transport-neutral HTTP fields. */
export function getHttpValue(
  values: readonly HttpField[],
  input: { name: string },
): string | undefined {
  return values.find(({ name }) => name === input.name)?.value;
}

/** Transport-neutral request meaning supplied by an HTTP host adapter. */
export type HttpRequest = Readonly<{
  method: string;
  path: string;
  query: readonly HttpField[];
  headers: readonly HttpField[];
  body: string;
}>;

/** Transport-neutral response meaning consumed by an HTTP host adapter. */
export type HttpResponse = Readonly<{
  status: number;
  headers: readonly HttpField[];
  body: string | undefined;
  stream: AsyncIterable<string> | undefined;
}>;

/** Host HTTP routing available to server Features. */
export type HttpServer = ServerDependency<{
  route(input: { path: string; handle(request: HttpRequest): Promise<HttpResponse> }): Disposable;
}>;

/** Host time suspension used by server Programs without owning a runtime timer. */
export type Timer = ServerDependency<{
  sleep(input: { until: number }): Promise<void>;
}>;

/** A future invocation routed through one Program's ordinary Dependency graph. */
export type ScheduledDependencyTarget = Readonly<{
  dependency: string;
  operation: string;
  input: object;
}>;

/**
 * Replaceable future Dependency invocations scheduled by server Programs.
 *
 * Durable Features retain authoritative intent in their own storage. The
 * adapter owns delivery, retries, and production persistence; reusing an id
 * replaces the previous target.
 */
export type Alarm = ServerDependency<{
  schedule(input: { id: string; at: number; target: ScheduledDependencyTarget }): Promise<void>;
  cancel(input: { id: string }): Promise<void>;
}>;

/** Carries portable semantic scopes through asynchronous Program execution. */
export type ExecutionContext = ServerDependency<{
  current(input: {}): readonly object[];
  run(input: Readonly<{ scope: object; task(): Promise<object> }>): Promise<object>;
}>;

/** Serializes tasks sharing a key within one Program instance. */
export type Synchronization = ServerDependency<{
  exclusive(input: Readonly<{ key: string; task(): Promise<object> }>): Promise<object>;
}>;

/** Structured runtime measurement emitted by portable server Features. */
export type Telemetry = ServerDependency<{
  record(
    input: Readonly<{
      instrument: "counter" | "gauge" | "histogram";
      name: string;
      value: number;
      attributes: readonly Readonly<{ name: string; value: string }>[];
    }>,
  ): void;
}>;

/** The default long-running server environment. */
export type ServerProcess = Readonly<{
  Name: "server";
  Platform: ServerPlatform;
}>;
