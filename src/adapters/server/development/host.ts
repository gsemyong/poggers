import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DeliverPolicy,
  DiscardPolicy,
  JetStreamApiCodes,
  JetStreamApiError,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
  type JetStreamClient,
  type JetStreamManager,
  type StoredMsg,
} from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

import type { DependencyContractIR } from "@/compiler/ir";
import type { HttpField, HttpRequest, HttpResponse, HttpServer } from "@/platforms/server/platform";
import { conformExternalDependencies } from "@/runtime/process";

type StoredEvent<Event> = Readonly<{
  stream: string;
  revision: number;
  event: Event;
}>;

type EventStore<Event> = Readonly<{
  read(input: { stream: string; after?: number }): Promise<readonly StoredEvent<Event>[]>;
  append(input: {
    stream: string;
    expectedRevision: number;
    events: readonly Event[];
  }): Promise<readonly StoredEvent<Event>[] | undefined>;
  subscribe(input: { stream: string; after?: number }): AsyncIterable<StoredEvent<Event>>;
}>;

type AuthenticationBackend = Readonly<{
  authenticate(input: {
    cookie?: string;
  }): Promise<Readonly<{ id: string; name: string; email: string }> | undefined>;
  handle(input: { request: HttpRequest; path: string }): Promise<HttpResponse>;
}>;

type Identifiers = Readonly<{ create(input: {}): string }>;
type Clock = Readonly<{ now(input: {}): number }>;

export type NodeHostOptions = Readonly<{
  directory?: string;
  database?: string;
  host?: string;
  port?: number;
  shutdownTimeout?: number;
  webOrigin?: string;
  appName?: string;
  secret?: string;
  eventStore?: NodeEventStoreOptions;
}>;

export type NodeEventStoreOptions =
  | Readonly<{ kind: "sqlite" }>
  | Readonly<{ kind: "jetstream"; servers: string | readonly string[]; stream?: string }>;

type HostedEventStore<Event> = EventStore<Event> & (Disposable | AsyncDisposable);
type ReloadableHttpServer = HttpServer &
  AsyncDisposable &
  Readonly<{
    locations: readonly string[];
    [beginRouteReplacement](): Disposable;
  }>;

export type NodeHost<Event> = Readonly<{
  authentication: AuthenticationBackend;
  events: HostedEventStore<Event>;
  identifiers: Identifiers;
  clock: Clock;
  http: HttpServer & AsyncDisposable & Readonly<{ locations: readonly string[] }>;
}>;
export type NodeHostDependency = keyof NodeHost<unknown>;

const beginRouteReplacement = Symbol("poggers.server.begin-route-replacement");

/** Opens the adapter-owned overlap window used by transactional development replacement. */
export function beginNodeHostReplacement(
  dependencies: Readonly<Record<string, unknown>>,
): Disposable {
  const http = dependencies.http as
    | Readonly<{ [beginRouteReplacement]?(): Disposable }>
    | undefined;
  return http?.[beginRouteReplacement]?.() ?? { [Symbol.dispose]() {} };
}

/** Implements the reusable host boundary; Features own all domain routing and APIs. */
export function createNodeHost<
  Event = unknown,
  const Dependencies extends readonly DependencyContractIR[] = readonly DependencyContractIR[],
>(
  input: NodeHostOptions & Readonly<{ dependencies: Dependencies }>,
): Promise<
  Pick<NodeHost<Event>, Extract<Dependencies[number]["name"], NodeHostDependency>> &
    Readonly<Record<string, unknown>>
>;
export async function createNodeHost<Event = unknown>(
  input: NodeHostOptions & Readonly<{ dependencies: readonly DependencyContractIR[] }>,
): Promise<Readonly<Record<string, unknown>>> {
  const available: readonly NodeHostDependency[] = [
    "authentication",
    "clock",
    "events",
    "http",
    "identifiers",
  ];
  const requested = new Set(input.dependencies.map(({ name }) => name));
  for (const dependency of requested) {
    if (!available.includes(dependency as NodeHostDependency)) {
      throw new Error(
        `Server Platform does not implement host Dependency ${JSON.stringify(dependency)}.`,
      );
    }
  }
  const host = input.host ?? "localhost";
  const port = input.port ?? numberEnvironment("PORT") ?? 3010;
  const origin = `http://${host}:${port}`;
  let database: DatabaseSync | undefined;
  let databaseClosed = false;
  const closeDatabase = () => {
    if (!database || databaseClosed) return;
    databaseClosed = true;
    database.close();
  };
  const eventStore = resolveEventStore(input);
  if (
    requested.has("authentication") ||
    (requested.has("events") && eventStore.kind === "sqlite")
  ) {
    const path =
      input.database ??
      process.env.POGGERS_DATABASE ??
      resolve(input.directory ?? process.cwd(), ".data/system.sqlite");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    database = new DatabaseSync(path);
  }
  const result: {
    authentication?: AuthenticationBackend;
    events?: HostedEventStore<Event>;
    identifiers?: Identifiers;
    clock?: Clock;
    http?: HttpServer & AsyncDisposable & Readonly<{ locations: readonly string[] }>;
  } = {};
  try {
    if (requested.has("authentication")) {
      const auth = betterAuth({
        appName: input.appName ?? "Poggers",
        baseURL: origin,
        database: database!,
        emailAndPassword: { enabled: true },
        secret:
          input.secret ??
          process.env.BETTER_AUTH_SECRET ??
          "poggers-development-authentication-secret",
        trustedOrigins: [input.webOrigin ?? "http://localhost:3000"],
      });
      await (await getMigrations(auth.options)).runMigrations();
      result.authentication = Object.freeze({
        async authenticate({ cookie }) {
          const headers = new Headers();
          if (cookie) headers.set("cookie", cookie);
          const session = await auth.api.getSession({ headers });
          return session
            ? { id: session.user.id, name: session.user.name, email: session.user.email }
            : undefined;
        },
        async handle({ request, path: mountedPath }) {
          const url = new URL(origin);
          url.pathname = `/api/auth${request.path.slice(mountedPath.length)}`;
          for (const { name, value } of request.query) url.searchParams.append(name, value);
          const headers = new Headers();
          for (const { name, value } of request.headers) headers.append(name, value);
          const response = await auth.handler(
            new Request(url, {
              method: request.method,
              headers,
              ...(!["GET", "HEAD"].includes(request.method) && request.body
                ? { body: request.body }
                : {}),
            }),
          );
          return semanticResponse(response);
        },
        [Symbol.dispose]: closeDatabase,
      });
    }
    if (requested.has("events")) {
      result.events =
        eventStore.kind === "jetstream"
          ? await createJetStreamEventStore<Event>(eventStore)
          : createSqliteEventStore<Event>(database!, closeDatabase);
    }
    if (requested.has("identifiers")) result.identifiers = { create: () => randomUUID() };
    if (requested.has("clock")) result.clock = { now: () => Date.now() };
    if (requested.has("http")) {
      result.http = await createNodeHttpServer({
        host,
        port,
        origin,
        shutdownTimeout:
          input.shutdownTimeout ??
          durationEnvironment("POGGERS_HTTP_SHUTDOWN_TIMEOUT_MS") ??
          10_000,
        webOrigin: input.webOrigin ?? "http://localhost:3000",
      });
    }
    return conformExternalDependencies(input.dependencies, result);
  } catch (error) {
    await result.http?.[Symbol.asyncDispose]();
    await disposeHostedEventStore(result.events);
    closeDatabase();
    throw error;
  }
}

function numberEnvironment(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new TypeError(`${name} must be an integer between 0 and 65535.`);
  }
  return parsed;
}

function durationEnvironment(name: string): number | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function resolveEventStore(input: NodeHostOptions): NodeEventStoreOptions {
  if (input.eventStore) return input.eventStore;
  const servers = process.env.NATS_URL;
  return process.env.POGGERS_EVENT_STORE === "jetstream" && servers
    ? { kind: "jetstream", servers, stream: process.env.POGGERS_EVENT_STREAM }
    : { kind: "sqlite" };
}

async function disposeHostedEventStore(
  store: HostedEventStore<unknown> | undefined,
): Promise<void> {
  if (!store) return;
  if (Symbol.asyncDispose in store) await store[Symbol.asyncDispose]();
  else store[Symbol.dispose]();
}

export function createSqliteEventStore<Event>(
  database: DatabaseSync,
  close: () => void = () => undefined,
): EventStore<Event> & Disposable {
  database.exec(`
    CREATE TABLE IF NOT EXISTS poggers_events (
      stream TEXT NOT NULL,
      revision INTEGER NOT NULL,
      event TEXT NOT NULL,
      PRIMARY KEY (stream, revision)
    ) STRICT
  `);
  const read = database.prepare(
    "SELECT revision, event FROM poggers_events WHERE stream = ? AND revision > ? ORDER BY revision",
  );
  const revision = database.prepare(
    "SELECT COALESCE(MAX(revision), 0) AS revision FROM poggers_events WHERE stream = ?",
  );
  const insert = database.prepare(
    "INSERT INTO poggers_events (stream, revision, event) VALUES (?, ?, ?)",
  );
  const subscribers = new Map<string, Set<(event: StoredEvent<Event>) => void>>();
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new Error("The event store is disposed.");
  };
  const readEvents = (stream: string, after: number): readonly StoredEvent<Event>[] => {
    assertLive();
    return (read.all(stream, after) as Array<{ revision: number; event: string }>).map((row) => ({
      stream,
      revision: row.revision,
      event: JSON.parse(row.event) as Event,
    }));
  };

  return {
    read: async ({ stream, after = 0 }) => readEvents(stream, after),
    async append({ stream, expectedRevision, events }) {
      assertLive();
      database.exec("BEGIN IMMEDIATE");
      try {
        const row = revision.get(stream) as { revision: number };
        if (row.revision !== expectedRevision) {
          database.exec("ROLLBACK");
          return undefined;
        }
        const appended = events.map((event, index) => {
          const stored = { stream, revision: expectedRevision + index + 1, event };
          insert.run(stream, stored.revision, JSON.stringify(event));
          return stored;
        });
        database.exec("COMMIT");
        for (const event of appended) {
          for (const publish of subscribers.get(stream) ?? []) publish(event);
        }
        return appended;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    subscribe({ stream, after = 0 }) {
      return eventStream(readEvents(stream, after), subscribers, stream);
    },
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      close();
    },
  };
}

type JetStreamBatch<Event> = Readonly<{
  stream: string;
  expectedRevision: number;
  events: readonly Event[];
}>;

/** Network authority for the semantic EventStore contract; Features remain transport-agnostic. */
export async function createJetStreamEventStore<Event>(
  options: Extract<NodeEventStoreOptions, { kind: "jetstream" }>,
): Promise<EventStore<Event> & AsyncDisposable> {
  const connection = await connect({
    servers: typeof options.servers === "string" ? options.servers : [...options.servers],
  });
  const streamName = options.stream ?? "POGGERS_EVENTS";
  const prefix = "poggers.events";
  let manager: JetStreamManager;
  try {
    manager = await jetstreamManager(connection);
    await ensureEventStream(manager, streamName, prefix);
  } catch (error) {
    await connection.close();
    throw error;
  }
  const client = jetstream(connection);
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new Error("The event store is disposed.");
  };

  return {
    async read({ stream, after = 0 }) {
      assertLive();
      return readJetStreamEvents<Event>(
        client,
        streamName,
        eventSubject(prefix, stream),
        stream,
        after,
      );
    },
    async append({ stream, expectedRevision, events }) {
      assertLive();
      const subject = eventSubject(prefix, stream);
      const current = await lastJetStreamBatch<Event>(manager, streamName, subject);
      if (batchRevision(current?.batch) !== expectedRevision) return undefined;
      if (events.length === 0) return [];
      try {
        await client.publish(
          subject,
          new TextEncoder().encode(JSON.stringify({ stream, expectedRevision, events })),
          { expect: { lastSubjectSequence: current?.sequence ?? 0 } },
        );
      } catch (error) {
        if (
          error instanceof JetStreamApiError &&
          (error.code === JetStreamApiCodes.StreamWrongLastSequence ||
            error.code === JetStreamApiCodes.StreamWrongLastSequenceUnknown)
        ) {
          return undefined;
        }
        throw error;
      }
      return storedBatch(stream, expectedRevision, events);
    },
    subscribe({ stream, after = 0 }) {
      assertLive();
      return subscribeJetStreamEvents<Event>(
        client,
        streamName,
        eventSubject(prefix, stream),
        stream,
        after,
      );
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      await connection.drain();
    },
  };
}

async function ensureEventStream(
  manager: JetStreamManager,
  stream: string,
  prefix: string,
): Promise<void> {
  const subject = `${prefix}.>`;
  try {
    const current = await manager.streams.info(stream);
    validateEventStream(current.config, stream, subject);
    return;
  } catch (error) {
    if (!(error instanceof JetStreamApiError) || error.code !== JetStreamApiCodes.StreamNotFound) {
      throw error;
    }
  }
  try {
    await manager.streams.add({
      name: stream,
      subjects: [subject],
      retention: RetentionPolicy.Limits,
      discard: DiscardPolicy.Old,
      storage: StorageType.File,
      allow_direct: true,
    });
  } catch (error) {
    const current = await manager.streams.info(stream).catch(() => undefined);
    if (!current) throw error;
    validateEventStream(current.config, stream, subject);
  }
}

function validateEventStream(
  config: Readonly<{
    subjects: readonly string[];
    retention: RetentionPolicy;
    discard: DiscardPolicy;
    storage: StorageType;
  }>,
  stream: string,
  subject: string,
): void {
  if (
    !config.subjects.includes(subject) ||
    config.retention !== RetentionPolicy.Limits ||
    config.discard !== DiscardPolicy.Old ||
    config.storage !== StorageType.File
  ) {
    throw new TypeError(
      `JetStream ${JSON.stringify(stream)} is incompatible with the EventStore contract.`,
    );
  }
}

async function lastJetStreamBatch<Event>(
  manager: JetStreamManager,
  stream: string,
  subject: string,
): Promise<Readonly<{ sequence: number; batch: JetStreamBatch<Event> }> | undefined> {
  let message: StoredMsg | null;
  try {
    message = await manager.streams.getMessage(stream, { last_by_subj: subject });
  } catch (error) {
    if (error instanceof JetStreamApiError && error.code === JetStreamApiCodes.NoMessageFound) {
      return;
    }
    throw error;
  }
  return message ? { sequence: message.seq, batch: decodeBatch<Event>(message.data) } : undefined;
}

async function readJetStreamEvents<Event>(
  client: JetStreamClient,
  streamName: string,
  subject: string,
  stream: string,
  after: number,
): Promise<readonly StoredEvent<Event>[]> {
  const consumer = await client.consumers.get(streamName, {
    filter_subjects: subject,
    deliver_policy: DeliverPolicy.All,
  });
  const result: StoredEvent<Event>[] = [];
  try {
    let pending = (await consumer.info()).num_pending;
    while (pending > 0) {
      const messages = await consumer.fetch({
        max_messages: Math.min(pending, 1_000),
        expires: 1_000,
      });
      let received = 0;
      for await (const message of messages) {
        received += 1;
        appendBatch(result, decodeBatch<Event>(message.data), stream, after);
      }
      if (!received) throw new Error(`JetStream EventStore timed out while reading ${stream}.`);
      pending -= received;
    }
    return result;
  } finally {
    await consumer.delete();
  }
}

function subscribeJetStreamEvents<Event>(
  client: JetStreamClient,
  streamName: string,
  subject: string,
  stream: string,
  after: number,
): AsyncIterable<StoredEvent<Event>> {
  return {
    async *[Symbol.asyncIterator]() {
      const consumer = await client.consumers.get(streamName, {
        filter_subjects: subject,
        deliver_policy: DeliverPolicy.All,
      });
      const messages = await consumer.consume();
      let revision = after;
      try {
        for await (const message of messages) {
          const stored: StoredEvent<Event>[] = [];
          appendBatch(stored, decodeBatch<Event>(message.data), stream, revision);
          for (const event of stored) {
            if (event.revision !== revision + 1) {
              throw new Error(`JetStream EventStore observed a gap at ${stream}:${revision + 1}.`);
            }
            revision = event.revision;
            yield event;
          }
        }
      } finally {
        await messages.close();
        await consumer.delete();
      }
    },
  };
}

function decodeBatch<Event>(data: Uint8Array): JetStreamBatch<Event> {
  const value = JSON.parse(new TextDecoder().decode(data)) as Partial<JetStreamBatch<Event>>;
  if (
    typeof value.stream !== "string" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    !Array.isArray(value.events)
  ) {
    throw new TypeError("JetStream EventStore received an invalid append batch.");
  }
  return value as JetStreamBatch<Event>;
}

function appendBatch<Event>(
  target: StoredEvent<Event>[],
  batch: JetStreamBatch<Event>,
  stream: string,
  after: number,
): void {
  if (batch.stream !== stream)
    throw new TypeError("JetStream EventStore stream identity mismatch.");
  for (const event of storedBatch(stream, batch.expectedRevision, batch.events)) {
    if (event.revision > after) target.push(event);
  }
}

function storedBatch<Event>(
  stream: string,
  expectedRevision: number,
  events: readonly Event[],
): readonly StoredEvent<Event>[] {
  return events.map((event, index) => ({
    stream,
    revision: expectedRevision + index + 1,
    event,
  }));
}

function batchRevision(batch: JetStreamBatch<unknown> | undefined): number {
  return batch ? batch.expectedRevision + batch.events.length : 0;
}

function eventSubject(prefix: string, stream: string): string {
  return `${prefix}.${Buffer.from(stream).toString("base64url")}`;
}

async function createNodeHttpServer(input: {
  host: string;
  port: number;
  origin: string;
  shutdownTimeout: number;
  webOrigin: string;
}): Promise<ReloadableHttpServer> {
  if (!Number.isSafeInteger(input.shutdownTimeout) || input.shutdownTimeout < 1) {
    throw new TypeError("HTTP shutdownTimeout must be a positive integer.");
  }
  type Route = Readonly<{ handle(request: HttpRequest): Promise<HttpResponse> }>;
  const routes = new Map<string, Route[]>();
  const streams = new Set<ServerResponse>();
  const shutdown = new AbortController();
  let replacementScopes = 0;
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method === "OPTIONS") {
        writeCors(incoming, outgoing, input.webOrigin);
        outgoing.writeHead(204).end();
        return;
      }
      const request = await semanticRequest(incoming, input.origin);
      const pathname = request.path;
      const route = [...routes]
        .filter(
          ([path, registrations]) =>
            registrations.length > 0 && (pathname === path || pathname.startsWith(`${path}/`)),
        )
        .sort(([left], [right]) => right.length - left.length)[0];
      const response = route
        ? await route[1].at(-1)!.handle(request)
        : jsonHttpResponse({ message: "Not found." }, 404);
      await writeResponse(incoming, outgoing, response, input.webOrigin, shutdown.signal, streams);
    } catch (error) {
      if (outgoing.headersSent) {
        outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      await writeResponse(
        incoming,
        outgoing,
        jsonHttpResponse({ message: error instanceof Error ? error.message : String(error) }, 500),
        input.webOrigin,
        shutdown.signal,
        streams,
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, resolve);
  });
  let disposed = false;
  return {
    locations: [input.origin],
    route({ path, handle }) {
      if (typeof handle !== "function") {
        throw new TypeError(`HTTP route ${JSON.stringify(path)} requires a handler function.`);
      }
      const registrations = routes.get(path) ?? [];
      if (registrations.length && replacementScopes === 0) {
        throw new Error(`HTTP route ${JSON.stringify(path)} is already mounted.`);
      }
      const registration = { handle };
      registrations.push(registration);
      routes.set(path, registrations);
      return {
        [Symbol.dispose]() {
          const current = routes.get(path);
          if (!current) return;
          const index = current.indexOf(registration);
          if (index >= 0) current.splice(index, 1);
          if (current.length === 0) routes.delete(path);
        },
      };
    },
    [beginRouteReplacement]() {
      replacementScopes++;
      let complete = false;
      return {
        [Symbol.dispose]() {
          if (complete) return;
          complete = true;
          replacementScopes--;
        },
      };
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      shutdown.abort();
      for (const stream of streams) stream.destroy();
      routes.clear();
      const closing = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      const timeout = setTimeout(() => server.closeAllConnections(), input.shutdownTimeout);
      try {
        await closing;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function eventStream<Event>(
  initial: readonly StoredEvent<Event>[],
  subscribers: Map<string, Set<(event: StoredEvent<Event>) => void>>,
  stream: string,
): AsyncIterable<StoredEvent<Event>> {
  return {
    [Symbol.asyncIterator]() {
      const queued = [...initial];
      let waiting: ((event: IteratorResult<StoredEvent<Event>>) => void) | undefined;
      let active = true;
      const publish = (event: StoredEvent<Event>) => {
        if (!active) return;
        if (waiting) {
          const resolve = waiting;
          waiting = undefined;
          resolve({ done: false, value: event });
        } else queued.push(event);
      };
      const listeners = subscribers.get(stream) ?? new Set();
      listeners.add(publish);
      subscribers.set(stream, listeners);
      return {
        next() {
          const event = queued.shift();
          if (event) return Promise.resolve({ done: false as const, value: event });
          if (!active) return Promise.resolve({ done: true as const, value: undefined });
          return new Promise<IteratorResult<StoredEvent<Event>>>((resolve) => (waiting = resolve));
        },
        return() {
          active = false;
          listeners.delete(publish);
          waiting?.({ done: true, value: undefined });
          waiting = undefined;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      };
    },
  };
}

async function semanticRequest(request: IncomingMessage, origin: string): Promise<HttpRequest> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const url = new URL(request.url ?? "/", origin);
  const headers: HttpField[] = [];
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.push({ name, value: item });
    } else if (value !== undefined) {
      headers.push({ name, value });
    }
  }
  return {
    method: request.method ?? "GET",
    path: url.pathname,
    query: [...url.searchParams].map(([name, value]) => ({ name, value })),
    headers,
    body: chunks.length ? Buffer.concat(chunks).toString("utf8") : "",
  };
}

async function writeResponse(
  request: IncomingMessage,
  response: ServerResponse,
  value: HttpResponse,
  webOrigin: string,
  shutdown: AbortSignal,
  streams: Set<ServerResponse>,
): Promise<void> {
  if (!Number.isInteger(value.status) || !Array.isArray(value.headers)) {
    throw new TypeError(`HTTP handler returned an invalid response: ${JSON.stringify(value)}.`);
  }
  writeCors(request, response, webOrigin);
  for (const { name, value: header } of value.headers) response.appendHeader(name, header);
  response.writeHead(value.status);
  if (value.body !== undefined) {
    response.end(value.body);
    return;
  }
  if (!value.stream) {
    response.end();
    return;
  }
  const reader = value.stream[Symbol.asyncIterator]();
  const cancel = () => void reader.return?.().catch(() => undefined);
  const stop = () => {
    if (!response.closed && !response.destroyed && !response.writableEnded) response.end();
  };
  streams.add(response);
  response.once("close", cancel);
  shutdown.addEventListener("abort", stop, { once: true });
  try {
    if (shutdown.aborted) stop();
    while (!response.closed && !response.destroyed && !response.writableEnded) {
      const next = await reader.next();
      if (next.done) break;
      if (!response.write(next.value)) {
        await new Promise((resolve) => response.once("drain", resolve));
      }
    }
    if (!response.closed && !response.destroyed) response.end();
  } finally {
    streams.delete(response);
    response.off("close", cancel);
    shutdown.removeEventListener("abort", stop);
    await reader.return?.().catch(() => undefined);
  }
}

async function semanticResponse(response: Response): Promise<HttpResponse> {
  const headers: HttpField[] = [];
  for (const [name, value] of response.headers) headers.push({ name, value });
  for (const value of response.headers.getSetCookie()) {
    if (!headers.some((field) => field.name === "set-cookie" && field.value === value)) {
      headers.push({ name: "set-cookie", value });
    }
  }
  return {
    status: response.status,
    headers,
    body: response.body ? await response.text() : undefined,
    stream: undefined,
  };
}

function jsonHttpResponse(value: object, status: number): HttpResponse {
  return {
    status,
    headers: [{ name: "content-type", value: "application/json" }],
    body: JSON.stringify(value),
    stream: undefined,
  };
}

function writeCors(request: IncomingMessage, response: ServerResponse, webOrigin: string): void {
  if (request.headers.origin === webOrigin) {
    response.setHeader("access-control-allow-origin", webOrigin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader(
    "access-control-allow-headers",
    "content-type, x-poggers-command, x-poggers-entity",
  );
  response.setHeader("access-control-allow-methods", "DELETE, GET, OPTIONS, PATCH, POST");
}
