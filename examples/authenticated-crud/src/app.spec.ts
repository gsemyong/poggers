import { createConnection } from "node:net";
import { resolve } from "node:path";

import type { EntitySnapshot } from "@poggers/kit";
import { testApplication } from "@poggers/kit/testing";
import { chromium, firefox, webkit, type BrowserType, type Page } from "playwright";
import { expect } from "vitest";

import type { Task } from "./features/tasks";

testApplication({
  name: "authenticated CRUD application",
  directory: resolve(import.meta.dirname, ".."),
  timeout: 240_000,
  async verify({ realization, location, locations, restart }) {
    const invalidRoute = await checkedFetch(new URL("/tasks/not-a-uuid", location), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    expect(invalidRoute.status).toBe(400);
    const missingRoute = await checkedFetch(new URL("/missing", location), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    expect(missingRoute.status).toBe(404);
    const page = await checkedFetch(new URL("/tasks", location), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const document = await page.text();
    expect(page.headers.get("cache-control")).toBe("no-store");
    const documentEtag = page.headers.get("etag");
    if (realization === "production") {
      expect(documentEtag).toMatch(/^"[a-f0-9]{64}"$/);
      expect(page.headers.get("content-length")).toBe(
        String(new TextEncoder().encode(document).byteLength),
      );
      const unchanged = await checkedFetch(new URL("/tasks", location), {
        headers: { accept: "text/html", "if-none-match": documentEtag! },
        signal: AbortSignal.timeout(10_000),
      });
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers.get("etag")).toBe(documentEtag);
      expect(await unchanged.text()).toBe("");
    }
    expect(document).toContain('data-poggers-rendering="client"></div>');
    expect(document).toContain("<style data-poggers-ssr>");
    expect(document).toContain("<title>Tasks</title>");
    expect(document).toContain(
      '<meta name="description" content="Manage workspace tasks" data-poggers-route-head>',
    );
    expect(document).toContain('<meta name="robots" content="noindex" data-poggers-route-head>');
    const head = await checkedFetch(new URL("/tasks", location), {
      method: "HEAD",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    expect(head.status).toBe(page.status);
    expect(head.headers.get("content-type")).toBe(page.headers.get("content-type"));
    expect(head.headers.get("cache-control")).toBe(page.headers.get("cache-control"));
    if (realization === "production") {
      expect(head.headers.get("etag")).toBe(documentEtag);
      expect(head.headers.get("content-length")).toBe(page.headers.get("content-length"));
    }
    expect(await head.text()).toBe("");
    const authPage = await checkedFetch(new URL("/auth", location), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    expect(authPage.status).toBe(200);
    expect(authPage.headers.get("cache-control")).toBe("no-store");
    const authDocument = await authPage.text();
    expect(authDocument).toContain("<title>Sign in</title>");
    expect(authDocument).toContain('data-poggers-rendering="client"></div>');
    const unsupportedMethod = await checkedFetch(new URL("/tasks", location), {
      method: "POST",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    expect(unsupportedMethod.status).toBe(405);
    expect(unsupportedMethod.headers.get("allow")).toBe("GET, HEAD");
    const createPage = await checkedFetch(new URL("/tasks/new", location), {
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    expect(createPage.status).toBe(200);
    expect(createPage.headers.get("cache-control")).toBe("no-store");
    const createDocument = await createPage.text();
    expect(createDocument).toContain("<title>New task</title>");
    expect(createDocument).toContain('data-poggers-rendering="client"></div>');
    const clientPage = await checkedFetch(
      new URL("/tasks/8da942a4-835f-4d4e-bc08-89545d523963", location),
      { headers: { accept: "text/html" }, signal: AbortSignal.timeout(10_000) },
    );
    expect(clientPage.status).toBe(200);
    expect(clientPage.headers.get("cache-control")).toBe("no-store");
    expect(await clientPage.text()).toContain('data-poggers-rendering="client"></div>');
    if (realization === "production") {
      expect(page.headers.get("x-request-id")).toBeTruthy();
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      const allowedOrigin = new URL(location).origin;
      const allowedCors = await checkedFetch(new URL("/tasks", location), {
        headers: { accept: "text/html", origin: allowedOrigin },
        signal: AbortSignal.timeout(10_000),
      });
      expect(allowedCors.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
      expect(allowedCors.headers.get("vary")).toContain("Origin");
      const rejectedCors = await checkedFetch(new URL("/tasks", location), {
        headers: { accept: "text/html", origin: "https://untrusted.example" },
        signal: AbortSignal.timeout(10_000),
      });
      expect(rejectedCors.headers.get("access-control-allow-origin")).toBeNull();
      const oversized = await checkedFetch(new URL("/api/identity/sign-up/email", location), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(2_048) }),
        signal: AbortSignal.timeout(10_000),
      });
      expect(oversized.status).toBe(413);
      const manifestResponse = await checkedFetch(new URL("/routes.ir.json", location), {
        signal: AbortSignal.timeout(10_000),
      });
      expect(manifestResponse.status).toBe(404);
      expect(
        (
          await checkedFetch(new URL("/application.ir.json", location), {
            signal: AbortSignal.timeout(10_000),
          })
        ).status,
      ).toBe(404);
      for (const target of ["/assets/%2e%2e/routes.ir.json", "/%2e%2e/Cargo.toml"]) {
        const traversal = await rawHttp(location, `GET ${target} HTTP/1.1\r\n`);
        expect([400, 404]).toContain(rawStatus(traversal));
        expect(traversal).not.toContain("routePath");
        expect(traversal).not.toContain("[package]");
      }
      const malformed = await rawHttp(location, "GET /bad target HTTP/1.1\r\n").catch(
        (error: unknown) => {
          expect(error).toMatchObject({ code: "ECONNRESET" });
          return "";
        },
      );
      if (malformed) expect(rawStatus(malformed)).toBe(400);
      const timedOut = await rawHttp(
        location,
        "POST /api/identity/sign-up/email HTTP/1.1\r\nContent-Length: 100\r\n",
        "{",
      );
      expect(rawStatus(timedOut)).toBe(408);
      expect(
        (
          await checkedFetch(new URL("/tasks", location), {
            headers: { accept: "text/html" },
            signal: AbortSignal.timeout(10_000),
          })
        ).status,
      ).toBe(200);
    }
    const entry = document.match(/<script[^>]+src="([^"]+)"/)?.[1];
    expect(entry).toBeDefined();
    if (realization === "production") {
      expect(entry).toMatch(/^\/assets\/app-[A-Za-z0-9_-]+\.js$/);
      expect(document).toContain(`<link rel="modulepreload" href="${entry}">`);
      const script = `<script type="module" async src="${entry}">`;
      expect(document).toContain(script);
      expect(document.indexOf("<style data-poggers-ssr>")).toBeLessThan(document.indexOf(script));
    }
    const asset = await checkedFetch(new URL(entry!, location), {
      signal: AbortSignal.timeout(10_000),
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("javascript");
    const source = await asset.text();
    if (realization === "production") {
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(asset.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
      expect(asset.headers.get("content-length")).toBe(
        String(new TextEncoder().encode(source).byteLength),
      );
      const unchanged = await checkedFetch(new URL(entry!, location), {
        headers: { "if-none-match": asset.headers.get("etag")! },
        signal: AbortSignal.timeout(10_000),
      });
      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe("");
      expect(new TextEncoder().encode(source).byteLength).toBeLessThan(250_000);
      expect(source).not.toMatch(/better-auth|@nats-io|rusqlite|tokio/);
      expect(source).not.toContain("@vite/client");
      expect(source).not.toContain("browser.generated.ts");
      expect(source).not.toContain("sourceMappingURL");
      const absolutePath = source.indexOf("/Users/");
      if (absolutePath >= 0) {
        throw new Error(
          `Production browser asset contains a local path: ${source.slice(
            Math.max(0, absolutePath - 160),
            absolutePath + 320,
          )}`,
        );
      }
    }

    for (const [browserName, browserType] of [
      ["chromium", chromium],
      ["firefox", firefox],
      ["webkit", webkit],
    ] as const) {
      await verifyBrowser(location, realization, browserName, browserType);
    }

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
    const draining = await alice.subscribe("/api/tasks/changes");
    expect((await draining.next<EntitySnapshot<Task>>()).revision).toBe(4);
    const restartStarted = performance.now();
    await restart();
    expect(performance.now() - restartStarted).toBeLessThan(
      realization === "production" ? 5_000 : 15_000,
    );
    await draining.close();
    await alice.post("/api/identity/sign-out", {});
    await expect(alice.get("/api/tasks")).rejects.toMatchObject({ status: 401 });
  },
});

async function verifyBrowser(
  location: string,
  realization: "development" | "production",
  browserName: string,
  browserType: BrowserType,
): Promise<void> {
  const browser = await browserType.launch({
    headless: true,
    ...(browserName === "chromium" ? { channel: "chromium" } : {}),
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (response.status() >= 400 && url.pathname !== "/favicon.ico") {
        errors.push(`${response.status()} ${url.pathname}`);
      }
    });

    await page.goto(`${location}/tasks`, { waitUntil: "load" });
    await expect.poll(() => new URL(page.url()).pathname).toBe("/auth");
    await expectAuthPresentation(page);
    await page.getByRole("button", { name: "New here? Create an account" }).click();
    await page.getByLabel("Name").fill(`${browserName} User`);
    await page.getByLabel("Email").fill(`browser-${realization}-${browserName}@example.com`);
    await page.getByLabel("Password").fill("password1234");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("button", { name: "New task" }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/tasks");
    expect(await page.locator("style[data-poggers-presentation]").count()).toBe(1);
    await expectTaskPresentation(page);

    await page.reload({ waitUntil: "load" });
    await page.getByRole("button", { name: "New task" }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/tasks");
    expect(await page.locator("style[data-poggers-presentation]").count()).toBe(1);
    await expectTaskPresentation(page);

    await page.getByRole("button", { name: "New task" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/tasks/new");
    const title = page.getByLabel("Task title");
    await title.fill("Browser task");
    expect(await title.evaluate((element) => element === document.activeElement)).toBe(true);
    await page.getByRole("button", { name: "Save task" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/tasks");
    await page.getByRole("heading", { name: "Browser task" }).waitFor();
    await expectTaskItemPresentation(page, "Browser task");
    await page.reload({ waitUntil: "load" });
    await page.getByRole("heading", { name: "Browser task" }).waitFor();
    await expectTaskPresentation(page);
    await expectTaskItemPresentation(page, "Browser task");
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);

    await page.getByRole("button", { name: "Edit" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/tasks\/[0-9a-f-]+$/);
    await title.fill("Browser task updated");
    await page.getByRole("button", { name: "Save task" }).click();
    await page.getByRole("heading", { name: "Browser task updated" }).waitFor();
    await page.getByRole("button", { name: "Complete" }).click();
    await page.getByText("Completed", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("heading", { name: "No tasks yet" }).waitFor();
    expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/auth");
    await page.getByRole("button", { name: "Sign in" }).waitFor();
    expect(errors).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function expectTaskPresentation(page: Page): Promise<void> {
  const root = page.getByRole("region", { name: "Task administration" });
  await root.waitFor();
  expect(await root.getAttribute("class")).toMatch(/^p[a-z0-9]+$/);
  expect(
    await root.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        display: style.display,
        direction: style.flexDirection,
        maxWidth: style.maxWidth,
        padding: style.padding,
      };
    }),
  ).toEqual({ display: "flex", direction: "column", maxWidth: "980px", padding: "26px" });
}

async function expectAuthPresentation(page: Page): Promise<void> {
  const root = page.getByRole("region", { name: "Authentication" });
  await root.waitFor();
  await expectPresentedSubtree(root);
}

async function expectTaskItemPresentation(page: Page, title: string): Promise<void> {
  const heading = page.getByRole("heading", { name: title });
  const item = heading.locator("xpath=ancestor::article");
  await item.waitFor();
  await expectPresentedSubtree(item);
  expect(
    await item.evaluate((element) => {
      const style = getComputedStyle(element);
      return { display: style.display, borderWidth: style.borderWidth, padding: style.padding };
    }),
  ).toEqual({ display: "flex", borderWidth: "1px", padding: "14px" });
}

async function expectPresentedSubtree(root: ReturnType<Page["locator"]>): Promise<void> {
  const missing = await root.evaluate((element) =>
    [element, ...element.querySelectorAll("*")]
      .filter((target) => !/^p[a-z0-9]+$/.test(target.getAttribute("class") ?? ""))
      .map((target) => target.tagName.toLowerCase()),
  );
  expect(missing).toEqual([]);
}

async function checkedFetch(input: URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    throw new Error(`${init?.method ?? "GET"} ${input} failed.`, { cause });
  }
}

function rawHttp(location: string, requestLine: string, body = ""): Promise<string> {
  const url = new URL(location);
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(10_000, () => socket.destroy(new Error("Raw HTTP request timed out.")));
    socket.on("data", (value: string) => (response += value));
    socket.once("error", reject);
    socket.once("end", () => resolvePromise(response));
    socket.once("connect", () => {
      socket.write(`${requestLine}Host: ${url.host}\r\nConnection: close\r\n\r\n${body}`);
    });
  });
}

function rawStatus(response: string): number {
  const value = Number(response.match(/^HTTP\/1\.1 (\d{3})/)?.[1]);
  if (!Number.isInteger(value)) throw new Error(`Malformed raw HTTP response: ${response}`);
  return value;
}

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
    const response = await this.fetch(path, {
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
    const response = await this.fetch(path, {
      ...init,
      headers,
    });
    this.capture(response);
    await this.assert(response);
    return (await response.json()) as Value;
  }

  async fetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(new URL(path, this.origin), init);
    } catch (cause) {
      throw new Error(`${init.method ?? "GET"} ${path} failed.`, { cause });
    }
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
