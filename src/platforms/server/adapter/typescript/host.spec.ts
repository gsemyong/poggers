import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, test } from "vitest";

import type { DependencyContractIR, TypeIR } from "@/compiler/ir";
import type { DependencyContract } from "@/core/dependency";
import {
  beginNodeHostReplacement,
  bindNodeAlarmDispatcher,
  createNodeHost,
  createSqliteEventStore,
  type NodeFeatureDependencyProviders,
} from "@/platforms/server/adapter/typescript/host";
import {
  clockConformance,
  identifiersConformance,
  timerConformance,
} from "@/platforms/server/testing";
import type { DependencyConformanceTarget } from "@/testing/dependency";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

clockConformance.test(nodeHostTarget("clock", dependency("clock", "now", primitive("number"))));
identifiersConformance.test(
  nodeHostTarget("identifiers", dependency("identifiers", "create", primitive("string"))),
);
timerConformance.test(
  nodeHostTarget("timer", {
    name: "timer",
    binding: "envelope",
    operations: [
      {
        name: "sleep",
        mode: "asynchronous",
        input: { kind: "opaque", name: "Deadline" },
        output: { kind: "primitive", name: "void" },
      },
    ],
  }),
);

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

  test("realizes an owner-selected Feature provider without recognizing its Dependency name", async () => {
    let configured: string | undefined;
    let disposed = false;
    const providers = {
      probe: {
        development({ configuration }: { configuration: Readonly<Record<string, string>> }) {
          configured = configuration.value;
          return {
            read({ input }: { input: { value: string } }) {
              return `${configuration.value}:${input.value}`;
            },
            [Symbol.dispose]() {
              disposed = true;
            },
          };
        },
        production: {
          configuration: [
            {
              name: "value",
              environment: "KIT_TEST_PROVIDER_VALUE",
              default: "feature",
            },
          ],
          crate: { package: "test-provider", directory: "." },
          rust: { type: "test_provider::Provider", constructor: "test_provider::create" },
        },
      },
    } as unknown as NodeFeatureDependencyProviders;
    const host = await createNodeHost({
      dependencies: [dependency("probe", "read", primitive("string"))],
      providers,
    });

    expect(configured).toBe("feature");
    expect(
      (host.probe as { read(input: { value: string }): string }).read({ value: "value" }),
    ).toBe("feature:value");
    await (host.probe as AsyncDisposable)[Symbol.asyncDispose]();
    expect(disposed).toBe(true);
  });

  test("dispatches, replaces, cancels, and disposes scheduled Dependency targets", async () => {
    const host = await createNodeHost({ dependencies: [alarmDependency] });
    const calls: string[] = [];
    using _binding = bindNodeAlarmDispatcher(host, async ({ target }) => {
      calls.push(target.operation);
    });
    await host.alarm.schedule({
      id: "replacement",
      at: 0,
      target: {
        dependency: "counter",
        operation: "first",
        input: {},
      },
    });
    await host.alarm.schedule({
      id: "replacement",
      at: 0,
      target: {
        dependency: "counter",
        operation: "second",
        input: {},
      },
    });
    await host.alarm.schedule({
      id: "cancelled",
      at: 0,
      target: {
        dependency: "counter",
        operation: "cancelled",
        input: {},
      },
    });
    await host.alarm.cancel({ id: "cancelled" });

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
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
    expect(await events.read({ stream: "canonical", limit: 1 })).toEqual(appended?.slice(0, 1));
  });

  test("snapshots and compacts SQLite streams without resetting their revision", async () => {
    using events = createSqliteEventStore<Record<string, unknown>>(new DatabaseSync(":memory:"));
    await events.append({
      stream: "compacted",
      expectedRevision: 0,
      events: [{ value: 1 }, { value: 2 }],
    });

    await expect(events.compact({ stream: "compacted", through: 2 })).rejects.toThrow(
      "has no safe snapshot",
    );
    await expect(
      events.saveSnapshot({
        stream: "compacted",
        expectedRevision: 1,
        revision: 2,
        snapshot: { value: 2 },
      }),
    ).resolves.toBe(false);
    await expect(
      events.saveSnapshot({
        stream: "compacted",
        expectedRevision: 0,
        revision: 2,
        snapshot: { value: 2 },
      }),
    ).resolves.toBe(true);
    await expect(
      events.saveSnapshot({
        stream: "compacted",
        expectedRevision: 0,
        revision: 2,
        snapshot: { value: 3 },
      }),
    ).resolves.toBe(false);

    await events.compact({ stream: "compacted", through: 2 });
    await expect(events.read({ stream: "compacted" })).resolves.toEqual([]);
    await expect(
      events.append({
        stream: "compacted",
        expectedRevision: 2,
        events: [{ value: 3 }],
      }),
    ).resolves.toEqual([
      {
        stream: "compacted",
        revision: 3,
        event: { value: 3 },
      },
    ]);
    await expect(events.loadSnapshot({ stream: "compacted" })).resolves.toEqual({
      stream: "compacted",
      revision: 2,
      snapshot: { value: 2 },
    });
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
  binding: "envelope",
  operations: ["schedule", "cancel"].map((name) => ({
    name,
    mode: "asynchronous" as const,
    input: { kind: "opaque" as const, name: "Input" },
    output: { kind: "primitive" as const, name: "void" as const },
  })),
} as const satisfies DependencyContractIR;
const executionContextDependency = {
  name: "executionContext",
  binding: "envelope",
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
  binding: "envelope",
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
    binding: "envelope",
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

function nodeHostTarget<Api extends DependencyContract>(
  name: string,
  contract: DependencyContractIR,
): DependencyConformanceTarget<Api> {
  return {
    name: "Node.js TypeScript",
    async create() {
      const host = await createNodeHost({ dependencies: [contract] });
      return {
        api: host[name] as Api,
        async dispose() {
          const resource = host[name] as Partial<Disposable & AsyncDisposable>;
          const dispose = resource[Symbol.asyncDispose];
          if (dispose) await dispose.call(resource);
          else resource[Symbol.dispose]?.();
        },
      };
    },
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
