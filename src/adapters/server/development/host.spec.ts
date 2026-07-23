import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { beginNodeHostReplacement, createNodeHost } from "@/adapters/server/development/host";
import type { DependencyContractIR, TypeIR } from "@/compiler/ir";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("server Platform host", () => {
  test("allocates only the Dependencies required by one Program instance", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "kit-host-"));
    directories.push(directory);

    const empty = await createNodeHost({ dependencies: [], directory });
    expect(empty).toEqual({});
    await expect(access(resolve(directory, ".data"))).rejects.toHaveProperty("code", "ENOENT");

    const utilities = await createNodeHost({
      dependencies: [
        dependency("clock", "now", primitive("number")),
        dependency("identifiers", "create", primitive("string")),
      ],
      directory,
    });
    expect(Object.keys(utilities).sort()).toEqual(["clock", "identifiers"]);
    expect(typeof utilities.clock.now({})).toBe("number");
    expect(utilities.identifiers.create({})).toMatch(/^[0-9a-f-]{36}$/);
    await expect(access(resolve(directory, ".data"))).rejects.toHaveProperty("code", "ENOENT");
  });

  test("rejects requirements the Platform cannot supply", async () => {
    await expect(
      createNodeHost({ dependencies: [{ name: "unknown", operations: [] }] }),
    ).rejects.toThrow('Server Platform does not implement host Dependency "unknown".');
  });

  test("allows browser commands from every declared interface origin", async () => {
    const port = await availablePort();
    const host = await createNodeHost({
      dependencies: [httpDependency],
      host: "127.0.0.1",
      port,
      webOrigins: ["http://localhost:3000", "http://localhost:3001"],
    });
    for (const origin of ["http://localhost:3000", "http://localhost:3001"]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-headers": "content-type,x-kit-command,x-kit-entity",
          "access-control-request-method": "POST",
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-headers")).toContain("x-kit-command");
      expect(response.headers.get("access-control-allow-headers")).toContain("x-kit-entity");
    }
    const rejected = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
      method: "OPTIONS",
      headers: { origin: "https://untrusted.example" },
    });
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
    await host.http[Symbol.asyncDispose]();
  });

  test("overlaps routes only inside a transactional Program replacement", async () => {
    const port = await availablePort();
    const host = await createNodeHost({
      dependencies: [httpDependency],
      host: "127.0.0.1",
      port,
    });
    const response = (body: string) => async () => ({
      status: 200,
      headers: [],
      body,
      stream: undefined,
    });
    const first = host.http.route({ path: "/probe", handle: response("first") });
    expect(() => host.http.route({ path: "/probe", handle: response("invalid") })).toThrow(
      'HTTP route "/probe" is already mounted.',
    );

    let second: Disposable;
    {
      using _replacement = beginNodeHostReplacement(host);
      second = host.http.route({ path: "/probe", handle: response("second") });
    }
    expect(await (await fetch(`http://127.0.0.1:${port}/probe`)).text()).toBe("second");
    first[Symbol.dispose]();
    expect(await (await fetch(`http://127.0.0.1:${port}/probe`)).text()).toBe("second");

    second[Symbol.dispose]();
    await host.http[Symbol.asyncDispose]();
  });

  test("bounds shutdown while a streaming response remains open", async () => {
    const port = await availablePort();
    const host = await createNodeHost({
      dependencies: [httpDependency],
      host: "127.0.0.1",
      port,
    });
    host.http.route({
      path: "/stream",
      async handle() {
        let first = true;
        return {
          status: 200,
          headers: [{ name: "content-type", value: "text/plain" }],
          body: undefined,
          stream: {
            [Symbol.asyncIterator]() {
              return {
                next() {
                  if (first) {
                    first = false;
                    return Promise.resolve({ done: false as const, value: "ready\n" });
                  }
                  return new Promise<IteratorResult<string>>(() => undefined);
                },
                return() {
                  return Promise.resolve({ done: true as const, value: undefined });
                },
              };
            },
          },
        };
      },
    });
    const response = await fetch(`http://127.0.0.1:${port}/stream`);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("ready\n");

    const started = performance.now();
    await host.http[Symbol.asyncDispose]();
    expect(performance.now() - started).toBeLessThan(1_000);
    await reader.cancel().catch(() => undefined);
  });
});

const httpDependency = dependency("http", "route", {
  kind: "opaque",
  name: "Disposable",
});

function primitive(name: "number" | "string"): TypeIR {
  return { kind: "primitive", name };
}

function dependency<const Name extends string>(
  name: Name,
  operation: string,
  output: TypeIR,
): DependencyContractIR & Readonly<{ name: Name }> {
  return {
    name,
    operations: [
      {
        name: operation,
        mode: "synchronous",
        input: { kind: "opaque", name: "Input" },
        output,
      },
    ],
  };
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
