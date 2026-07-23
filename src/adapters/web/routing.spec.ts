import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  composeWebRoutePath,
  formatWebRoute,
  matchWebRoute,
  validateWebRouteMetadata,
  validateWebRoutes,
  webProgramCompilerIR,
  WebRouteValidationError,
  type WebRouteIR,
} from "@/adapters/web/routing";

const edit: WebRouteIR = {
  feature: "tasks",
  name: "edit",
  path: "/tasks/:id",
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

    expect(webProgramCompilerIR({ version: 7, components: [], routes: [route] })).toMatchObject({
      routes: [{ name: "list" }],
    });
    expect(() => webProgramCompilerIR({ version: 2, components: [], routes: [route] })).toThrow(
      /Unsupported/,
    );
    expect(() =>
      webProgramCompilerIR({
        version: 7,
        components: [],
        routes: [{ ...route, surprise: true }],
      }),
    ).toThrow(/unsupported fields/);
    expect(() =>
      webProgramCompilerIR({
        version: 7,
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
