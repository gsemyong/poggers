import { resolve } from "node:path";

import type { EntitySnapshot } from "@poggers/kit";
import { testApplication } from "@poggers/kit/testing";
import { expect } from "vitest";

import type { Task } from "./features/tasks";

testApplication({
  name: "authenticated CRUD application",
  directory: resolve(import.meta.dirname, ".."),
  timeout: 240_000,
  async verify({ location, locations, restart }) {
    const page = await fetch(new URL("/tasks/new", location), {
      signal: AbortSignal.timeout(10_000),
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const document = await page.text();
    const entry = document.match(/<script[^>]+src="([^"]+)"/)?.[1];
    expect(entry).toBeDefined();
    const asset = await fetch(new URL(entry!, location), {
      signal: AbortSignal.timeout(10_000),
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    await asset.body?.cancel();

    const origin = locations.server?.[0] ?? location;
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

    await restart();
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
  },
});

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
