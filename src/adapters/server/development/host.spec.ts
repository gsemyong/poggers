import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import {
  beginNodeHostReplacement,
  createNodeHost,
  createSqliteEventStore,
} from "@/adapters/server/development/host";
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

  test("registers, replaces, cancels, and disposes process alarms", async () => {
    const host = await createNodeHost({ dependencies: [alarmDependency] });
    const calls: string[] = [];
    host.alarm.register({
      id: "replacement",
      async run() {
        calls.push("first");
      },
    });
    host.alarm.register({
      id: "replacement",
      async run() {
        calls.push("second");
      },
    });
    host.alarm.schedule({ id: "replacement", at: 0 });
    host.alarm.register({
      id: "cancelled",
      async run() {
        calls.push("cancelled");
      },
    });
    host.alarm.schedule({ id: "cancelled", at: 0 });
    host.alarm.cancel({ id: "cancelled" });

    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(calls).toEqual(["second"]);
    host.alarm[Symbol.dispose]();
  });

  test("preserves execution scopes across asynchronous work without leaking them", async () => {
    const host = await createNodeHost({ dependencies: [executionContextDependency] });
    const scope = { actor: "account", key: "one" };

    await expect(
      host.executionContext.run({
        scope,
        async task() {
          await Promise.resolve();
          return { scopes: host.executionContext.current({}) };
        },
      }),
    ).resolves.toEqual({ scopes: [scope] });
    expect(host.executionContext.current({})).toEqual([]);
  });

  test("serializes tasks sharing one local synchronization key", async () => {
    const host = await createNodeHost({ dependencies: [synchronizationDependency] });
    let active = 0;
    let maximum = 0;

    await Promise.all(
      Array.from({ length: 8 }, (_, value) =>
        host.synchronization.exclusive({
          key: "actor:one",
          async task() {
            active += 1;
            maximum = Math.max(maximum, active);
            await Promise.resolve();
            active -= 1;
            return { value };
          },
        }),
      ),
    );

    expect(maximum).toBe(1);
  });

  test("returns the exact canonical event representation that it persists", async () => {
    using events = createSqliteEventStore<Record<string, unknown>>(new DatabaseSync(":memory:"));
    const appended = await events.append({
      stream: "canonical",
      expectedRevision: 0,
      events: [
        {
          second: 2,
          first: [{ omitted: undefined, value: -0 }, undefined],
          omitted: undefined,
        },
      ],
    });

    expect(appended?.[0]?.event).toEqual({
      first: [{ value: 0 }, null],
      second: 2,
    });
    expect(await events.read({ stream: "canonical" })).toEqual(appended);
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
const alarmDependency = {
  name: "alarm",
  operations: ["register", "schedule", "cancel"].map((name) => ({
    name,
    mode: "synchronous" as const,
    input: { kind: "opaque" as const, name: "Input" },
    output: { kind: "primitive" as const, name: "void" as const },
  })),
} as const satisfies DependencyContractIR;
const executionContextDependency = {
  name: "executionContext",
  operations: [
    {
      name: "current",
      mode: "synchronous",
      input: { kind: "record", fields: [] },
      output: { kind: "opaque", name: "Scopes" },
    },
    {
      name: "run",
      mode: "asynchronous",
      input: { kind: "opaque", name: "Execution" },
      output: { kind: "opaque", name: "Result" },
    },
  ],
} as const satisfies DependencyContractIR;
const synchronizationDependency = {
  name: "synchronization",
  operations: [
    {
      name: "exclusive",
      mode: "asynchronous",
      input: { kind: "opaque", name: "ExclusiveExecution" },
      output: { kind: "opaque", name: "Result" },
    },
  ],
} as const satisfies DependencyContractIR;

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
