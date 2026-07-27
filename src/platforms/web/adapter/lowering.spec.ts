import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SYSTEM_IR_VERSION, type SystemIR, type TypeIR } from "@/compiler/ir";
import {
  composeWebRoutePath,
  createWebHotReplacementManifest,
  formatWebRoute,
  matchWebRoute,
  sameWebHotReplacementManifest,
  validateWebRouteMetadata,
  validateWebRoutes,
  WEB_COMPILER_IR_VERSION,
  webProgramCompilerIR,
  WebRouteValidationError,
  type WebComponentContractIR,
  type WebHotReplacementManifest,
  type WebRouteIR,
} from "@/platforms/web/adapter/lowering";

const edit: WebRouteIR = {
  feature: "tasks",
  name: "edit",
  path: "/tasks/:id",
  status: 200,
  document: "shell",
  cache: false,
  metadata: {},
  params: [{ name: "id", kind: "string", optional: false, format: "uuid" }],
  search: [
    {
      name: "page",
      kind: "number",
      optional: false,
      integer: true,
      minimum: 1,
      default: 1,
    },
    {
      name: "tab",
      kind: "string",
      optional: false,
      values: ["details", "activity"],
      default: "details",
    },
    { name: "query", kind: "string", optional: true, maximumLength: 100 },
    { name: "tag", kind: "string", optional: true, repeated: true, maximumLength: 20 },
  ],
  deferred: [],
};

const identifier = fc.uuid({ version: [4] });

describe("web routing", () => {
  it("matches the canonical root Route", () => {
    const root: WebRouteIR = {
      feature: "shell",
      name: "home",
      path: "/",
      status: 200,
      document: "shell",
      cache: false,
      metadata: {},
      params: [],
      search: [],
      deferred: [],
    };

    expect(matchWebRoute([root], new URL("https://example.test/"))).toEqual({
      route: root,
      params: {},
      search: {},
    });
  });

  it("composes reusable Feature paths without admitting absolute child paths", () => {
    expect(composeWebRoutePath("/admin", "tasks/:id")).toBe("/admin/tasks/:id");
    expect(composeWebRoutePath("/admin", "")).toBe("/admin");
    expect(composeWebRoutePath("/", "")).toBe("/");
    expect(() => composeWebRoutePath("admin", "tasks")).toThrow(/absolute/);
    expect(() => composeWebRoutePath("/admin", "/tasks")).toThrow(/relative/);
  });

  it("matches literal routes before parameters and wildcards", () => {
    const routes: WebRouteIR[] = [
      {
        feature: "files",
        name: "wildcard",
        path: "/files/*rest",
        status: 200,
        document: "shell",
        cache: false,
        metadata: {},
        params: [{ name: "rest", kind: "string", optional: false }],
        search: [],
        deferred: [],
      },
      {
        feature: "files",
        name: "item",
        path: "/files/:id",
        status: 200,
        document: "shell",
        cache: false,
        metadata: {},
        params: [{ name: "id", kind: "string", optional: false }],
        search: [],
        deferred: [],
      },
      {
        feature: "files",
        name: "new",
        path: "/files/new",
        status: 200,
        document: "content",
        cache: false,
        metadata: { title: "New file" },
        params: [],
        search: [],
        deferred: [],
      },
    ];
    expect(matchWebRoute(routes, new URL("https://example.test/files/new"))?.route.name).toBe(
      "new",
    );
    expect(matchWebRoute(routes, new URL("https://example.test/files/one"))?.route.name).toBe(
      "item",
    );
    expect(matchWebRoute(routes, new URL("https://example.test/files/a/b"))?.params).toEqual({
      rest: "a/b",
    });
  });

  it("decodes defaults and rejects malformed external values", () => {
    const matched = matchWebRoute(
      [edit],
      new URL("https://example.test/tasks/8da942a4-835f-4d4e-bc08-89545d523963"),
    );
    expect(matched).toMatchObject({
      params: { id: "8da942a4-835f-4d4e-bc08-89545d523963" },
      search: { page: 1, tab: "details" },
    });
    expect(() => matchWebRoute([edit], new URL("https://example.test/tasks/not-a-uuid"))).toThrow(
      WebRouteValidationError,
    );
    expect(() =>
      matchWebRoute(
        [edit],
        new URL("https://example.test/tasks/8da942a4-835f-4d4e-bc08-89545d523963?page=1.5"),
      ),
    ).toThrow(/Invalid search parameter page/);
  });

  it("rejects ambiguous and internally inconsistent manifests", () => {
    const root = {
      ...edit,
      name: "root",
      path: "/tasks",
      params: [],
      search: [],
    };
    expect(() =>
      validateWebRoutes([
        root,
        {
          ...root,
          name: "list",
          parent: "tasks.root",
        },
      ]),
    ).not.toThrow();
    expect(() =>
      validateWebRoutes([
        edit,
        {
          ...edit,
          feature: "projects",
          name: "show",
          path: "/tasks/:task",
          params: [{ name: "task", kind: "string", optional: false }],
        },
      ]),
    ).toThrow(/ambiguous/);
    expect(() => validateWebRoutes([{ ...edit, params: [] }])).toThrow(/inconsistent/);
    expect(() => validateWebRoutes([{ ...edit, document: "stream" as "content" }])).toThrow(
      /document plan/,
    );
    expect(() =>
      validateWebRoutes([{ ...edit, cache: { scope: "public", maxAge: "five minutes" } }]),
    ).toThrow(/cache duration/);
    expect(() =>
      validateWebRoutes([{ ...edit, cache: { scope: "public", maxAge: "5m" } }]),
    ).not.toThrow();
    expect(() =>
      validateWebRoutes([
        {
          feature: "tasks",
          name: "optional",
          path: "/tasks/:id",
          status: 200,
          document: "shell",
          cache: false,
          metadata: {},
          params: [{ name: "id", kind: "string", optional: true }],
          search: [],
          deferred: [],
        },
      ]),
    ).toThrow(/required and scalar/);
    expect(() =>
      validateWebRoutes([
        {
          feature: "tasks",
          name: "invalid-rule",
          path: "/tasks",
          status: 200,
          document: "shell",
          cache: false,
          metadata: {},
          params: [],
          search: [{ name: "query", kind: "string", optional: true, minimum: 1 }],
          deferred: [],
        },
      ]),
    ).toThrow(/numeric bounds/);
  });

  it("rejects unknown or malformed persisted web compiler meaning", () => {
    const route = {
      feature: "tasks",
      name: "list",
      path: "tasks",
      status: 200,
      document: "content",
      cache: false,
      metadata: {},
      params: [],
      search: [],
      deferred: [],
      data: { kind: "record", fields: [] },
      dependencies: [],
      implementation: { load: false, view: { kind: "none" } },
      implementationSpan: { file: "src/tasks.tsx", line: 2, column: 1 },
      span: { file: "src/tasks.tsx", line: 1, column: 1 },
    } as const;

    expect(webProgramCompilerIR({ version: 11, components: [], routes: [route] })).toMatchObject({
      routes: [{ name: "list" }],
    });
    expect(() => webProgramCompilerIR({ version: 2, components: [], routes: [route] })).toThrow(
      /Unsupported/,
    );
    expect(() =>
      webProgramCompilerIR({
        version: 11,
        components: [],
        routes: [{ ...route, surprise: true }],
      }),
    ).toThrow(/unsupported fields/);
    expect(() =>
      webProgramCompilerIR({
        version: 11,
        components: [],
        routes: [{ ...route, implementation: { load: "sometimes", view: { kind: "none" } } }],
      }),
    ).toThrow(/loader/);
  });

  it("rejects cyclic and non-JSON structured metadata deterministically", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => validateWebRouteMetadata({ structuredData: [cyclic as never] }, "cyclic")).toThrow(
      /structured data/,
    );
    expect(() =>
      validateWebRouteMetadata({ structuredData: [new Date() as never] }, "date"),
    ).toThrow(/structured data/);
  });

  it("round-trips repeated search values and rejects duplicates for scalar fields", () => {
    const href = formatWebRoute(edit, {
      params: { id: "8da942a4-835f-4d4e-bc08-89545d523963" },
      search: { tag: ["one", "two"] },
    });
    expect(matchWebRoute([edit], new URL(href, "https://example.test"))?.search).toMatchObject({
      tag: ["one", "two"],
    });
    expect(() =>
      matchWebRoute(
        [edit],
        new URL("https://example.test/tasks/8da942a4-835f-4d4e-bc08-89545d523963?page=1&page=2"),
      ),
    ).toThrow(/must occur once/);
  });

  it("round-trips every valid typed destination through the matcher", () => {
    fc.assert(
      fc.property(
        identifier,
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
        fc.constantFrom("details", "activity"),
        (id, page, query, tab) => {
          const href = formatWebRoute(edit, {
            params: { id },
            search: { page, query, tab },
          });
          const matched = matchWebRoute([edit], new URL(href, "https://example.test"));
          expect(matched?.params).toEqual({ id });
          expect(matched?.search).toEqual({
            page,
            tab,
            ...(query === undefined ? {} : { query }),
          });
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("web hot replacement meaning", () => {
  it("requires the exact current state contract", () => {
    const before = hotManifest(record({ count: numberType(), label: stringType() }));
    const added = hotManifest(
      record({ count: numberType(), label: stringType(), enabled: booleanType() }),
    );
    const removed = hotManifest(record({ count: numberType() }));
    const changed = hotManifest(record({ count: stringType(), label: stringType() }));

    expect(sameWebHotReplacementManifest(before, before)).toBe(true);
    expect(sameWebHotReplacementManifest(before, added)).toBe(false);
    expect(sameWebHotReplacementManifest(before, removed)).toBe(false);
    expect(sameWebHotReplacementManifest(before, changed)).toBe(false);
  });

  it("derives a stable manifest from semantic IR rather than source spans", () => {
    expect(createWebHotReplacementManifest(hotSystem("moved.ts"))).toEqual(
      createWebHotReplacementManifest(hotSystem("one.ts")),
    );
  });

  it("rejects every changed Component and Environment contract", () => {
    const before = hotManifest(record({}), [hotComponent()]);

    expect(
      sameWebHotReplacementManifest(
        before,
        hotManifest(record({}), [hotComponent({ state: record({ offset: stringType() }) })]),
      ),
    ).toBe(false);
    expect(
      sameWebHotReplacementManifest(
        before,
        hotManifest(record({}), [hotComponent({ propCallbacks: ["onDismiss"] })]),
      ),
    ).toBe(false);
    expect(
      sameWebHotReplacementManifest(
        before,
        hotManifest(record({}), [hotComponent({ elements: [{ name: "Root", element: "main" }] })]),
      ),
    ).toBe(false);
    expect(
      sameWebHotReplacementManifest(
        before,
        hotManifest(record({}), [], { name: "browser-main", platform: "canvas" }),
      ),
    ).toBe(false);
  });

  it("accepts only an identical structural manifest", () => {
    const before = hotManifest(record({}), [hotComponent()]);
    const same = hotManifest(record({}), [hotComponent()]);
    const changed = hotManifest(record({}), [
      hotComponent({
        actions: ["drag", "release"],
      }),
    ]);

    expect(sameWebHotReplacementManifest(before, same)).toBe(true);
    expect(sameWebHotReplacementManifest(before, changed)).toBe(false);
  });
});

function hotManifest(
  state: TypeIR,
  components: readonly WebComponentContractIR[] = [],
  environment: Readonly<{ name: string; platform: string }> = {
    name: "browser-main",
    platform: "web",
  },
): WebHotReplacementManifest {
  return {
    revision: "test",
    programs: [{ id: "feature/app/program/browser", environment, state, components }],
  };
}

function hotComponent(overrides: Partial<WebComponentContractIR> = {}): WebComponentContractIR {
  return {
    name: "Drawer",
    propCallbacks: [],
    state: record({ offset: numberType() }),
    actions: ["drag"],
    elements: [{ name: "Root", element: "section" }],
    implementation: { state: true, actions: true, mount: false, view: true },
    ...overrides,
  };
}

function hotSystem(file: string): SystemIR {
  return {
    version: SYSTEM_IR_VERSION,
    system: { id: "system", name: "test" },
    platforms: ["web"],
    apps: [],
    interfaces: [],
    features: [{ id: "feature/app", path: "app", children: [], programs: [] }],
    programs: [
      {
        id: "program/browser",
        name: "browser",
        logicalName: "browser",
        environment: { name: "browser-main", platform: "web" },
        contributions: [
          {
            id: "feature/app/program/browser",
            feature: "app",
            requires: [],
            provides: [],
            extensions: {
              web: {
                version: WEB_COMPILER_IR_VERSION,
                ui: {
                  state: record({ count: numberType() }),
                  actions: [],
                  components: [],
                },
                components: [],
                routes: [],
              },
            },
            span: { file, line: 1, column: 1 },
          },
        ],
      },
    ],
  };
}

function record(fields: Readonly<Record<string, TypeIR>>): TypeIR {
  return {
    kind: "record",
    fields: Object.entries(fields).map(([name, type]) => ({ name, type, optional: false })),
  };
}

function numberType(): TypeIR {
  return { kind: "primitive", name: "number" };
}

function stringType(): TypeIR {
  return { kind: "primitive", name: "string" };
}

function booleanType(): TypeIR {
  return { kind: "primitive", name: "boolean" };
}
