import { describe, expect, test } from "bun:test";

import fc from "fast-check";

import { startDependencyGroups } from "#kernel/dependency";
import {
  assertRuntimeProgramManifest,
  collectRuntimeProgramManifest,
  compileEndpointTable,
  composeFeaturePrograms,
  composeFeatures,
  featureComponentName,
  featureResourceName,
  instantiateFeatureAPIs,
} from "#kernel/feature";
import type { ApplicationManifest } from "#kernel/manifest";

const serverProgram = () => undefined;

const leaf = (resource: string, component: string) => ({
  resources: { [resource]: { state: resource } },
  components: { [component]: { render: component } },
  programs: { server: { serve: serverProgram } },
  endpoints: { callback: { method: "GET" } },
  migrations: { initial: { to: 1 } },
});

describe("Feature composition", () => {
  test("empty composition is stable", () => {
    expect(composeFeatures(undefined)).toEqual({
      resources: {},
      components: {},
      programs: [],
      endpoints: [],
      migrations: [],
      dependencies: {},
      authentication: undefined,
      manifest: { entries: [] },
    });
  });

  test("preserves deep namespaces while lowering runtime indexes", () => {
    const result = composeFeatures({
      auth: {
        ...leaf("sessions", "Account"),
        features: {
          oauth: leaf("attempts", "SignIn"),
        },
      },
    });

    expect(Object.keys(result.resources)).toEqual([
      featureResourceName("auth", "sessions"),
      featureResourceName("auth.oauth", "attempts"),
    ]);
    expect(Object.keys(result.components)).toEqual([
      featureComponentName("auth", "Account"),
      featureComponentName("auth.oauth", "SignIn"),
    ]);
    expect(result.manifest.entries).toEqual([
      {
        path: "auth",
        resources: ["sessions"],
        components: ["Account"],
        programs: ["server.serve"],
        endpoints: ["callback"],
        migrations: ["initial"],
        navigation: [],
      },
      {
        path: "auth.oauth",
        resources: ["attempts"],
        components: ["SignIn"],
        programs: ["server.serve"],
        endpoints: ["callback"],
        migrations: ["initial"],
        navigation: [],
      },
    ]);
  });

  test("isolates repeated factory-shaped instances", () => {
    const result = composeFeatures({
      archive: leaf("records", "List"),
      records: leaf("records", "List"),
    });

    expect(Object.keys(result.resources)).toEqual([
      featureResourceName("archive", "records"),
      featureResourceName("records", "records"),
    ]);
    expect(new Set(Object.keys(result.resources)).size).toBe(2);
  });

  test("is deterministic regardless of object insertion order", () => {
    const forward = composeFeatures({
      alpha: leaf("a", "A"),
      beta: leaf("b", "B"),
    });
    const reverse = composeFeatures({
      beta: leaf("b", "B"),
      alpha: leaf("a", "A"),
    });

    expect(reverse).toEqual(forward);
  });

  test("preserves deterministic manifests and namespaces across arbitrary mount order", () => {
    const names = fc.uniqueArray(
      fc.constantFrom("alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"),
      { minLength: 1, maxLength: 8 },
    );
    fc.assert(
      fc.property(names, (mounts) => {
        const definitions = Object.fromEntries(mounts.map((name) => [name, leaf("state", "View")]));
        const reversed = Object.fromEntries(
          [...mounts].reverse().map((name) => [name, leaf("state", "View")]),
        );
        const forward = composeFeatures(definitions);
        expect(composeFeatures(reversed)).toEqual(forward);
        expect(forward.manifest.entries.map(({ path }) => path)).toEqual([...mounts].sort());
        expect(new Set(Object.keys(forward.resources)).size).toBe(mounts.length);
        expect(new Set(Object.keys(forward.components)).size).toBe(mounts.length);
      }),
      { numRuns: 1_000 },
    );
  });

  test("keeps arbitrary deep mount paths explainable and collision-free", () => {
    const paths = fc.array(fc.constantFrom("alpha", "beta", "gamma", "delta"), {
      minLength: 1,
      maxLength: 12,
    });
    fc.assert(
      fc.property(paths, (segments) => {
        let definitions: NonNullable<Parameters<typeof composeFeatures>[0]> = {
          [segments.at(-1)!]: leaf("state", "View"),
        };
        for (let index = segments.length - 2; index >= 0; index--) {
          definitions = { [segments[index]!]: { features: definitions } };
        }
        const result = composeFeatures(definitions);
        const expected = segments.map((_, index) => segments.slice(0, index + 1).join("."));
        expect(result.manifest.entries.map(({ path }) => path)).toEqual(expected);
        expect(Object.keys(result.resources)).toEqual([
          featureResourceName(segments.join("."), "state"),
        ]);
        expect(Object.keys(result.components)).toEqual([
          featureComponentName(segments.join("."), "View"),
        ]);
      }),
      { numRuns: 1_000 },
    );
  });

  test("rejects names that make namespace ownership ambiguous", () => {
    expect(() => composeFeatures({ "auth.oauth": leaf("attempts", "SignIn") })).toThrow(
      "Invalid Feature name",
    );
    expect(() => composeFeatures({ auth: leaf("session/history", "Account") })).toThrow(
      "Invalid Feature name",
    );
  });

  test("rejects collisions with occupied internal indexes", () => {
    const occupied = new Set([featureResourceName("records", "records")]);
    expect(() => composeFeatures({ records: leaf("records", "List") }, occupied)).toThrow(
      "Duplicate Feature resource",
    );
  });

  test("executes Feature programs through local names with durable namespaced subscriptions", async () => {
    const calls: unknown[] = [];
    const composed = composeFeatures({
      notifications: {
        resources: { inbox: {} },
        dependencies: { server: { mail: { deliver: true } } },
        programs: {
          server: {
            delivery: {
              source: {
                events: ["inbox.received"],
                replay: "all",
                keyBy: "resource",
                version: 1,
              },
              handle(context: Record<string, unknown>, dependencies: unknown) {
                const resources = context.resources as Record<string, (key: string) => unknown>;
                calls.push([context.actor, context.api, resources.inbox!("mine"), dependencies]);
              },
            },
          },
        },
      },
    });
    const resourceName = featureResourceName("notifications", "inbox");
    const programs = composeFeaturePrograms(undefined, composed.programs);
    const started = await startDependencyGroups(composed.dependencies.server ?? {});

    await programs.server?.(
      {
        actor: { id: "program" },
        api: {
          notifications: { deliver: "semantic" },
        },
        resources: { [resourceName]: (key: string) => ({ key }) },
        consume: async (options: {
          id: string;
          events: readonly string[];
          run: (item: Record<string, unknown>) => void;
        }) => {
          options.run({
            resource: resourceName,
            event: { resource: resourceName },
            [resourceName]: {},
          });
          calls.push([{ name: options.events[0], id: options.id }]);
          return { close() {} };
        },
      },
      started.groups,
    );

    expect(calls).toEqual([
      [
        { id: "program" },
        { notifications: { deliver: "semantic" } },
        { key: "mine" },
        { mail: { deliver: true } },
      ],
      [
        {
          name: `${featureResourceName("notifications", "inbox")}.received`,
          id: "feature/notifications/program/server/delivery",
        },
      ],
    ]);
    await started.stop();
  });

  test("composes root and Feature cleanup into one Program lifecycle", async () => {
    const cleaned: string[] = [];
    const composed = composeFeatures({
      first: { programs: { server: { serve: () => () => void cleaned.push("first") } } },
      second: {
        programs: { server: { serve: async () => () => void cleaned.push("second") } },
      },
    });
    const programs = composeFeaturePrograms(
      { server: { serve: () => () => void cleaned.push("application") } },
      composed.programs,
    );
    const cleanup = await programs.server?.(
      {
        actor: { id: "program" },
        api: {},
        resources: {},
        signal: new AbortController().signal,
      },
      {},
    );

    expect(cleaned).toEqual([]);
    expect(cleanup).toBeFunction();
    await cleanup?.();
    expect(cleaned).toEqual(["second", "first", "application"]);
  });

  test("cleans initialized Feature Programs when a sibling fails to initialize", async () => {
    const cleaned: string[] = [];
    const composed = composeFeatures({
      initialized: {
        programs: { server: { serve: () => () => void cleaned.push("initialized") } },
      },
      failing: {
        programs: {
          server: {
            serve: async () => {
              await Promise.resolve();
              throw new Error("Feature Program failed");
            },
          },
        },
      },
    });
    const program = composeFeaturePrograms(undefined, composed.programs).server!;

    await expect(
      program(
        {
          actor: { id: "program" },
          api: {},
          resources: {},
          signal: new AbortController().signal,
        },
        {},
      ),
    ).rejects.toThrow("Feature Program failed");
    expect(cleaned).toEqual(["initialized"]);
  });

  test("records direct Feature dependency ownership without a global mapping", () => {
    const clock = { now: () => 1 };
    const composed = composeFeatures({
      workflows: {
        dependencies: { server: { clock } },
        programs: { server: { serve: () => undefined } },
      },
    });
    expect(composed.dependencies.server?.workflows?.clock).toBe(clock);
  });

  test("keeps runtime and extracted Program manifests identical", () => {
    const root = {
      server: {
        project: {
          source: {
            events: ["counter.changed"],
            replay: "all",
            keyBy: "resource",
            version: 3,
          },
          handle() {},
        },
      },
    };
    const runtime = collectRuntimeProgramManifest(root, []);
    const extracted: ApplicationManifest = {
      format: 1,
      contract: { hash: "contract", nodes: [], resources: {} },
      scopes: [
        {
          path: "",
          resources: [],
          components: [],
          features: [],
          programs: [
            {
              environment: "server",
              name: "project",
              kind: "events",
              events: ["counter.changed"],
              replay: "all",
              version: 3,
              key: "resource",
            },
          ],
          dependencies: [],
          navigation: [],
          endpoints: [],
          api: [],
        },
      ],
      presets: [],
    };
    expect(() => assertRuntimeProgramManifest(runtime, extracted)).not.toThrow();
    const changed = {
      ...extracted,
      scopes: [
        {
          ...extracted.scopes[0]!,
          programs: [{ ...extracted.scopes[0]!.programs[0]!, version: 4 }],
        },
      ],
    };
    expect(() => assertRuntimeProgramManifest(runtime, changed)).toThrow("disagree");
  });

  test("rejects multiple application authentication owners explicitly", () => {
    expect(() =>
      composeFeatures({
        first: { authentication: { resolve: () => null } },
        second: { authentication: { resolve: () => null } },
      }),
    ).toThrow("Authentication conflict between Feature first and Feature second.");
  });

  test("compiles native endpoint handlers and reports both collision owners", async () => {
    const handler = () => new Response("ok");
    const table = compileEndpointTable(
      { health: { method: "GET", path: "/health", handle: handler } },
      [
        {
          owner: "auth.oauth",
          name: "callback",
          value: { method: "GET", path: "/auth/callback", handle: handler },
        },
      ],
    );
    expect(await table["GET /auth/callback"]?.handle(new Request("http://local"), {})).toEqual(
      new Response("ok"),
    );
    expect(() =>
      compileEndpointTable({ callback: { method: "POST", path: "/callback", handle: handler } }, [
        {
          owner: "provider",
          name: "callback",
          value: { method: "POST", path: "/callback", handle: handler },
        },
      ]),
    ).toThrow("application.callback and provider.callback");
  });
});

describe("Feature semantic APIs", () => {
  test("a coordinator curates five child APIs without flattening their resources", () => {
    const child = (name: string) => ({
      resources: { state: {} },
      api: () => ({ name }),
    });
    const result = instantiateFeatureAPIs({
      actor: { id: "actor" },
      resolveResource: (path) => ({ path }),
      features: {
        product: {
          features: {
            auth: child("auth"),
            records: child("records"),
            search: child("search"),
            notifications: child("notifications"),
            workflows: child("workflows"),
          },
          api: ({ features }) => ({
            capabilities: [
              features.auth?.name,
              features.records?.name,
              features.search?.name,
              features.notifications?.name,
              features.workflows?.name,
            ],
          }),
        },
      },
    });

    expect(result.features.product?.api).toEqual({
      capabilities: ["auth", "records", "search", "notifications", "workflows"],
      auth: { name: "auth" },
      records: { name: "records" },
      search: { name: "search" },
      notifications: { name: "notifications" },
      workflows: { name: "workflows" },
    });
    expect(result.features.product?.api).not.toHaveProperty("resources");
    expect(result.features.product?.api).not.toHaveProperty("features");
  });

  test("gives parents child APIs without exposing child resources", () => {
    const childHandle = { value: 3, dangerous: () => "internal" };
    const result = instantiateFeatureAPIs({
      actor: { id: "actor" },
      resolveResource: (path, name) => {
        expect([path, name]).toEqual(["parent.child", "counter"]);
        return childHandle;
      },
      features: {
        parent: {
          features: {
            child: {
              resources: { counter: {} },
              api: ({ resources }) => ({
                value: (resources.counter as typeof childHandle).value,
                dangerous: (resources.counter as typeof childHandle).dangerous,
              }),
            },
          },
          api: ({ features }) => ({ value: features.child?.value }),
        },
      },
      api: ({ features }) => ({ count: features.parent?.value }),
    });

    expect(result.api.count).toBe(3);
    expect(result.api.parent).toBe(result.features.parent?.api);
    expect(result.features.parent?.api.value).toBe(3);
    expect(result.features.parent?.api.child).toEqual(childHandle);
    expect(result.features.parent?.api).not.toHaveProperty("dangerous");
    expect(result.features.parent?.api).not.toHaveProperty("resources");
  });

  test("keeps repeated instance resources and APIs isolated", () => {
    const result = instantiateFeatureAPIs({
      actor: { id: "actor" },
      resolveResource: (path) => ({ path }),
      features: {
        first: {
          resources: { state: {} },
          api: ({ resources }) => ({ path: (resources.state as { path: string }).path }),
        },
        second: {
          resources: { state: {} },
          api: ({ resources }) => ({ path: (resources.state as { path: string }).path }),
        },
      },
    });

    expect(result.features.first?.api.path).toBe("first");
    expect(result.features.second?.api.path).toBe("second");
    expect(result.features.first?.api).not.toBe(result.features.second?.api);
  });

  test("passes reactive resource values through by identity", () => {
    let value = 1;
    const count = () => value;
    const result = instantiateFeatureAPIs({
      actor: { id: "actor" },
      resolveResource: () => ({ count }),
      features: {
        counter: {
          resources: { state: {} },
          api: ({ resources }) => ({
            count: (resources.state as { count: () => number }).count,
          }),
        },
      },
      api: ({ features }) => ({ count: features.counter?.count }),
    });

    const reactiveCount = result.api.count as () => number;
    expect(reactiveCount()).toBe(1);
    value = 2;
    expect(reactiveCount()).toBe(2);
  });
});
