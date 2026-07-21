import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { startProcess, type EntitySnapshot, type ProgramManifest } from "@poggers/kit";
import { describe, expect, test } from "vitest";

import application, { type App } from "./app";
import { createServerCapabilities } from "./capabilities/server";
import type { Task } from "./features/tasks";

describe("authenticated CRUD application", () => {
  test("runs auth, durable event sourcing, authorization, and live updates end to end", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-authenticated-crud-"));
    const database = resolve(directory, "application.sqlite");
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    try {
      const first = await start(database, port);
      const alice = new Cookies(origin);
      const bob = new Cookies(origin);
      await alice.post("/api/auth/sign-up/email", {
        name: "Alice",
        email: "alice@example.com",
        password: "password1234",
      });
      await bob.post("/api/auth/sign-up/email", {
        name: "Bob",
        email: "bob@example.com",
        password: "password1234",
      });

      const subscription = await alice.subscribe("/api/tasks/changes");
      expect(await subscription.next<EntitySnapshot<Task>>()).toEqual({
        revision: 0,
        entities: [],
      });
      const created = await alice.post<Task>("/api/tasks", {
        value: { title: "Durable task" },
      });
      expect(await subscription.next<EntitySnapshot<Task>>()).toEqual({
        revision: 1,
        entities: [created],
      });
      expect((await bob.get<EntitySnapshot<Task>>("/api/tasks")).entities).toEqual([]);
      await expect(
        bob.patch(`/api/tasks/${created.id}`, { value: { completed: true } }),
      ).rejects.toMatchObject({ status: 404 });
      const updated = await alice.patch<Task>(`/api/tasks/${created.id}`, {
        value: { completed: true },
      });
      expect(await subscription.next<EntitySnapshot<Task>>()).toEqual({
        revision: 2,
        entities: [updated],
      });
      const removed = await alice.post<Task>("/api/tasks", {
        value: { title: "Remove me" },
      });
      expect((await subscription.next<EntitySnapshot<Task>>()).revision).toBe(3);
      await alice.remove(`/api/tasks/${removed.id}`);
      expect(await subscription.next<EntitySnapshot<Task>>()).toEqual({
        revision: 4,
        entities: [updated],
      });
      await subscription.close();
      await first.dispose();

      const second = await start(database, port);
      await alice.post("/api/auth/sign-in/email", {
        email: "alice@example.com",
        password: "password1234",
      });
      expect(await alice.get<EntitySnapshot<Task>>("/api/tasks")).toEqual({
        revision: 4,
        entities: [updated],
      });
      await alice.post("/api/auth/sign-out", {});
      await expect(alice.get("/api/tasks")).rejects.toMatchObject({ status: 401 });
      await second.dispose();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function start(database: string, port: number) {
  const capabilities = await createServerCapabilities({
    database,
    host: "127.0.0.1",
    port,
    webOrigin: "http://localhost:3000",
  });
  const process = await startProcess<App>(application, "server", capabilities, serverManifest);
  return { dispose: () => process.dispose() };
}

const serverManifest: ProgramManifest = {
  name: "server",
  contributions: [
    {
      feature: "api",
      requires: ["authentication", "http", "tasks"],
      provides: [],
    },
    {
      feature: "identity",
      requires: ["authentication"],
      provides: ["identity"],
    },
    {
      feature: "tasks",
      requires: ["clock", "events", "identifiers", "identity"],
      provides: ["tasks"],
    },
  ],
};

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class Cookies {
  readonly #values = new Map<string, string>();

  constructor(readonly origin: string) {}

  get<Value>(path: string): Promise<Value> {
    return this.request(path);
  }

  post<Value>(path: string, body: unknown): Promise<Value> {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }

  patch<Value>(path: string, body: unknown): Promise<Value> {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  }

  remove<Value>(path: string): Promise<Value> {
    return this.request(path, { method: "DELETE" });
  }

  async subscribe(path: string): Promise<Subscription> {
    const controller = new AbortController();
    const response = await fetch(new URL(path, this.origin), {
      headers: this.headers(),
      signal: controller.signal,
    });
    await this.assert(response);
    if (!response.body) throw new Error("The subscription returned no body.");
    return new Subscription(response.body, controller);
  }

  async request<Value>(path: string, init: RequestInit = {}): Promise<Value> {
    const response = await fetch(new URL(path, this.origin), {
      ...init,
      headers: this.headers(init.body ? { "content-type": "application/json" } : undefined),
    });
    this.capture(response);
    await this.assert(response);
    return (await response.json()) as Value;
  }

  headers(values?: HeadersInit): Headers {
    const headers = new Headers(values);
    headers.set("connection", "close");
    const cookie = [...this.#values].map(([name, value]) => `${name}=${value}`).join("; ");
    if (cookie) headers.set("cookie", cookie);
    return headers;
  }

  capture(response: Response): void {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.slice(0, value.indexOf(";"));
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      const name = pair.slice(0, separator);
      const cookie = pair.slice(separator + 1);
      if (cookie) this.#values.set(name, cookie);
      else this.#values.delete(name);
    }
  }

  async assert(response: Response): Promise<void> {
    if (response.ok) return;
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new HttpFailure(
      response.status,
      body.message ?? `Request failed with ${response.status}.`,
    );
  }
}

class Subscription {
  readonly #decoder = new TextDecoder();
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #buffer = "";

  constructor(
    body: ReadableStream<Uint8Array>,
    readonly controller: AbortController,
  ) {
    this.#reader = body.getReader();
  }

  async next<Value>(): Promise<Value> {
    while (true) {
      const newline = this.#buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        if (line) return JSON.parse(line) as Value;
      }
      const result = await this.#reader.read();
      if (result.done) throw new Error("The subscription ended before the next snapshot.");
      this.#buffer += this.#decoder.decode(result.value, { stream: true });
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.#reader.cancel().catch(() => undefined);
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate a test port.");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
