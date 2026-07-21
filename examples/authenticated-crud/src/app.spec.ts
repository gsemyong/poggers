import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  startProcess,
  type EntityEvent,
  type EntitySnapshot,
  type ProgramManifest,
} from "@poggers/kit";
import { createNodeHost } from "@poggers/kit/adapters/server";
import { describe, expect, test } from "vitest";

import { buildNativeServerProgram } from "@/adapters/server/native";
import { compileApplication } from "@/core/compiler/source";

import application, { type App } from "./app";
import type { Task } from "./features/tasks";

describe("authenticated CRUD application", () => {
  test("runs auth, durable event sourcing, authorization, and live updates in development", () =>
    verifyApplication(startNode));

  test("runs the same black-box behavior as a standalone native production Program", async () => {
    const ir = compileApplication(resolve(import.meta.dirname, "app.tsx"));
    const program = ir.programs.find(({ name }) => name === "api");
    if (!program) throw new Error("The authenticated CRUD application has no api Program.");
    const directory = await mkdtemp(resolve(tmpdir(), "poggers-authenticated-crud-native-"));
    try {
      const executable = resolve(directory, "api");
      await buildNativeServerProgram({
        application: ir.application.name,
        directory: resolve(import.meta.dirname, ".."),
        lint: true,
        output: executable,
        program,
      });
      await verifyApplication((database, port) => startNative(executable, database, port));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  test("rebuilds only a changed Feature crate and its Program", async () => {
    const ir = compileApplication(resolve(import.meta.dirname, "app.tsx"));
    const program = ir.programs.find(({ name }) => name === "api");
    if (!program) throw new Error("The authenticated CRUD application has no api Program.");
    const changed = structuredClone(program);
    const contribution = changed.contributions.find(({ feature }) => feature === "tasks.tasks");
    if (contribution?.implementation.kind !== "portable-feature") {
      throw new Error("The task contribution is not portable Feature meaning.");
    }
    const feature = contribution.implementation.feature;
    if (feature.kind !== "entity") throw new Error("The task contribution is not an entity.");
    const statement = feature.create.body[0];
    if (statement?.kind !== "return" || statement.value?.kind !== "record") {
      throw new Error("The task create function has an unexpected shape.");
    }
    const completed = statement.value.fields.find(({ name }) => name === "completed")?.value;
    if (completed?.kind !== "literal") {
      throw new Error("The task create function has no completed literal.");
    }
    Object.assign(completed, { value: !completed.value });

    const directory = await mkdtemp(resolve(tmpdir(), "poggers-native-cache-"));
    try {
      const build = (name: string, value: typeof program) =>
        buildNativeServerProgram({
          application: ir.application.name,
          cache: resolve(directory, "cache"),
          directory: resolve(import.meta.dirname, ".."),
          output: resolve(directory, name),
          program: value,
        });
      const first = await build("first", program);
      const second = await build("second", changed);
      const third = await build("third", changed);

      expect(first.cache).toBe("miss");
      expect(second.cache).toBe("miss");
      expect(second.workspace).toBe(first.workspace);
      expect(second.compiledCrates).toContain("poggers_api");
      expect(second.compiledCrates.some((name) => name.includes("tasks_tasks"))).toBe(true);
      expect(second.compiledCrates.some((name) => name.includes("identity"))).toBe(false);
      expect(second.compiledCrates).not.toContain("poggers_server_runtime");
      expect(third).toMatchObject({ cache: "hit", compiledCrates: [] });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});

async function verifyApplication(
  start: (database: string, port: number) => Promise<Readonly<{ dispose(): Promise<void> }>>,
): Promise<void> {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-authenticated-crud-"));
  const database = resolve(directory, "application.sqlite");
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  try {
    const first = await start(database, port);
    const alice = new Cookies(origin);
    const bob = new Cookies(origin);
    await expect(
      alice.post("/api/identity/sign-up/email", {
        name: "Alice",
        email: "alice@example.com",
        password: "short",
      }),
    ).rejects.toBeInstanceOf(HttpFailure);
    await alice.post("/api/identity/sign-up/email", {
      name: "Alice",
      email: "alice@example.com",
      password: "password1234",
    });
    await bob.post("/api/identity/sign-up/email", {
      name: "Bob",
      email: "bob@example.com",
      password: "password1234",
    });

    const subscription = await alice.subscribe("/api/tasks/changes");
    expect(await subscription.next<EntitySnapshot<Task>>()).toEqual({
      revision: 0,
      entities: [],
    });
    const commandHeaders = {
      "x-poggers-command": "create-durable-task",
      "x-poggers-entity": "durable-task",
    };
    const created = await alice.post<Task>("/api/tasks", { title: "Durable task" }, commandHeaders);
    expect(await alice.post<Task>("/api/tasks", { title: "Durable task" }, commandHeaders)).toEqual(
      created,
    );
    expect(await subscription.next<EntitySnapshot<Task>>()).toEqual({
      revision: 1,
      entities: [created],
    });
    expect((await bob.get<EntitySnapshot<Task>>("/api/tasks")).entities).toEqual([]);
    await expect(bob.patch(`/api/tasks/${created.id}`, { completed: true })).rejects.toMatchObject({
      status: 404,
    });
    const updated = await alice.patch<Task>(`/api/tasks/${created.id}`, {
      completed: true,
    });
    expect(await subscription.next<EntitySnapshot<Task>>()).toEqual({
      revision: 2,
      entities: [updated],
    });
    const removed = await alice.post<Task>("/api/tasks", {
      title: "Remove me",
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
    await expect(
      alice.post("/api/identity/sign-in/email", {
        email: "alice@example.com",
        password: "incorrect-password",
      }),
    ).rejects.toBeInstanceOf(HttpFailure);
    await alice.post("/api/identity/sign-in/email", {
      email: "alice@example.com",
      password: "password1234",
    });
    expect(await alice.get<EntitySnapshot<Task>>("/api/tasks")).toEqual({
      revision: 4,
      entities: [updated],
    });
    await alice.post("/api/identity/sign-out", {});
    await expect(alice.get("/api/tasks")).rejects.toMatchObject({ status: 401 });
    await second.dispose();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function startNode(database: string, port: number) {
  const capabilities = await createNodeHost<EntityEvent<Task>>({
    appName: "Poggers Operations",
    database,
    host: "127.0.0.1",
    port,
    webOrigin: "http://localhost:3000",
    secret: "poggers-authenticated-crud-test-secret",
  });
  const process = await startProcess<App>(application, "api", capabilities, serverManifest);
  return { dispose: () => process.dispose() };
}

async function startNative(executable: string, database: string, port: number) {
  const child = spawn(executable, [], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      POGGERS_DATABASE: database,
      POGGERS_WEB_ORIGIN: "http://localhost:3000",
    },
    stdio: "pipe",
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (value: string) => (output += value));
  child.stderr.setEncoding("utf8").on("data", (value: string) => (output += value));
  await expect
    .poll(
      async () => {
        if (child.exitCode !== null)
          throw new Error(output || `Native server exited ${child.exitCode}.`);
        return fetch(`http://127.0.0.1:${port}/api/identity/get-session`)
          .then(() => true)
          .catch(() => false);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return {
    dispose: () =>
      new Promise<void>((resolvePromise, reject) => {
        if (child.exitCode !== null) {
          resolvePromise();
          return;
        }
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          if (code === 0 || signal === "SIGINT") resolvePromise();
          else reject(new Error(output || `Native server exited ${code ?? signal}.`));
        });
        child.kill("SIGINT");
      }),
  };
}

const serverManifest: ProgramManifest = {
  name: "api",
  contributions: [
    {
      feature: "identity",
      requires: ["authentication", "http"],
      provides: ["identity"],
    },
    {
      feature: "tasks.tasks",
      requires: ["clock", "events", "http", "identifiers", "identity"],
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

  post<Value>(path: string, body: unknown, headers?: HeadersInit): Promise<Value> {
    return this.request(path, { method: "POST", body: JSON.stringify(body), headers });
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
    const headers = this.headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(new URL(path, this.origin), {
      ...init,
      headers,
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
