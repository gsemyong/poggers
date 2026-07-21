import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  EventStore,
  EntityEvent,
  ProgramCapabilities,
  ProgramExternalCapabilities,
  StoredEvent,
} from "@poggers/kit";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

import type { App } from "../app";
import type { HttpServer } from "../features/api";
import type { AuthenticationServer, CookieCredentials, User } from "../features/identity";
import type { Task } from "../features/tasks";

export type ServerCapabilityOptions = Readonly<{
  database?: string;
  host?: string;
  port?: number;
  webOrigin?: string;
}>;

export async function createServerCapabilities(
  input: ServerCapabilityOptions = {},
): Promise<ProgramExternalCapabilities<App, "server">> {
  const host = input.host ?? "localhost";
  const port = input.port ?? 3010;
  const origin = `http://${host}:${port}`;
  const path = input.database ?? resolve(import.meta.dirname, "../../.data/application.sqlite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  const events = createSqliteEventStore<EntityEvent<Task>>(database, () => database.close());
  try {
    const auth = betterAuth({
      appName: "Poggers Operations",
      baseURL: origin,
      database,
      emailAndPassword: { enabled: true },
      secret: "poggers-authenticated-crud-development-secret-32-characters",
      trustedOrigins: [input.webOrigin ?? "http://localhost:3000"],
    });
    await (await getMigrations(auth.options)).runMigrations();
    const authentication: AuthenticationServer = Object.freeze({
      async authenticate({ credentials }: { credentials: CookieCredentials }) {
        const headers = new Headers();
        if (credentials.cookie) headers.set("cookie", credentials.cookie);
        const session = await auth.api.getSession({ headers });
        return session ? user(session.user) : undefined;
      },
      handle: ({ request }) => auth.handler(request),
    });
    const http = await createHttpCapability({
      host,
      port,
      origin,
      webOrigin: input.webOrigin ?? "http://localhost:3000",
    });
    return {
      authentication,
      events,
      identifiers: { create: randomUUID },
      clock: { now: Date.now },
      http,
    };
  } catch (error) {
    events[Symbol.dispose]();
    throw error;
  }
}

export default {
  development: () => createServerCapabilities(),
  production: () =>
    createServerCapabilities({
      database: process.env.POGGERS_DATABASE,
      host: process.env.HOST,
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
      webOrigin: process.env.WEB_ORIGIN,
    }),
} satisfies ProgramCapabilities<App, "server">;

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
      return sqliteEventStream(readEvents(stream, after), subscribers, stream);
    },
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      close();
    },
  };
}

async function createHttpCapability(input: {
  host: string;
  port: number;
  origin: string;
  webOrigin: string;
}): Promise<HttpServer & AsyncDisposable & Readonly<{ locations: readonly string[] }>> {
  const routes = new Map<string, (request: Request) => Promise<Response>>();
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method === "OPTIONS") {
        writeCors(incoming, outgoing, input.webOrigin);
        outgoing.writeHead(204).end();
        return;
      }
      const request = await webRequest(incoming, input.origin);
      const pathname = new URL(request.url).pathname;
      const route = [...routes]
        .filter(([path]) => pathname === path || pathname.startsWith(`${path}/`))
        .sort(([left], [right]) => right.length - left.length)[0];
      const response = route
        ? await route[1](request)
        : Response.json({ message: "Not found." }, { status: 404 });
      await writeResponse(incoming, outgoing, response, input.webOrigin);
    } catch (error) {
      await writeResponse(
        incoming,
        outgoing,
        Response.json(
          { message: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        ),
        input.webOrigin,
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
      if (routes.has(path))
        throw new Error(`HTTP route ${JSON.stringify(path)} is already mounted.`);
      routes.set(path, handle);
      return { [Symbol.dispose]: () => void routes.delete(path) };
    },
    async [Symbol.asyncDispose]() {
      if (disposed) return;
      disposed = true;
      routes.clear();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function sqliteEventStream<Event>(
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

async function webRequest(request: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request)
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(new URL(request.url ?? "/", origin), {
    method: request.method,
    headers: request.headers as HeadersInit,
    ...(body ? { body } : {}),
  });
}

async function writeResponse(
  request: IncomingMessage,
  response: ServerResponse,
  value: Response,
  webOrigin: string,
): Promise<void> {
  writeCors(request, response, webOrigin);
  for (const [name, header] of value.headers) response.setHeader(name, header);
  response.writeHead(value.status);
  if (!value.body) {
    response.end();
    return;
  }
  const reader = value.body.getReader();
  const cancel = () => void reader.cancel().catch(() => undefined);
  response.once("close", cancel);
  try {
    while (!response.closed && !response.destroyed) {
      const next = await reader.read();
      if (next.done) break;
      if (!response.write(next.value))
        await new Promise((resolve) => response.once("drain", resolve));
    }
    if (!response.closed && !response.destroyed) response.end();
  } finally {
    response.off("close", cancel);
    await reader.cancel().catch(() => undefined);
  }
}

function writeCors(request: IncomingMessage, response: ServerResponse, webOrigin: string): void {
  if (request.headers.origin === webOrigin) {
    response.setHeader("access-control-allow-origin", webOrigin);
    response.setHeader("vary", "origin");
  }
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "DELETE, GET, OPTIONS, PATCH, POST");
}

function user(value: { id: string; name: string; email: string }): User {
  return { id: value.id, name: value.name, email: value.email };
}
