import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { webCompilerExtension } from "@/adapters/web/compiler";
import {
  webApplicationCompilerIR,
  webFeatureCompilerIR,
  webProgramCompilerIR,
} from "@/adapters/web/routing";
import { compileApplication } from "@/compiler/source";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("web compiler extension", () => {
  test("owns mounted paths, rendering, cache, metadata, and validation meaning", async () => {
    const entry = await fixture(routeApplicationSource());
    const generic = compileApplication(entry);
    expect(generic.features[0]?.extensions).toBeUndefined();
    expect(generic.programs[0]?.contributions[0]?.extensions).toBeUndefined();

    const ir = compileApplication(entry, [webCompilerExtension]);
    expect(webApplicationCompilerIR(ir.application.extensions?.web)).toEqual({
      version: 7,
      installation: {
        display: "standalone",
        icons: [
          { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
        ],
        offline: { fallback: { to: "tasks.edit", params: { id: "offline" } } },
        shortcuts: [],
        start: { to: "tasks.edit", params: { id: "start" } },
      },
    });
    expect(webFeatureCompilerIR(ir.features[0]?.extensions?.web)).toEqual({
      version: 7,
      routePath: "admin",
    });
    const web = webProgramCompilerIR(ir.programs[0]?.contributions[0]?.extensions?.web);
    expect(web.routes).toEqual([
      expect.objectContaining({
        feature: "tasks",
        name: "edit",
        path: ":id",
        document: "content",
        cache: { scope: "private", maxAge: "5m" },
        metadata: {
          title: "Edit task",
          description: "Task editor",
          alternates: [{ language: "sk", href: "/sk/admin" }],
          social: {
            card: "summary_large_image",
            images: [{ url: "/task.png", alt: "Task", width: 1200, height: 630 }],
          },
          icons: [{ url: "/icon.svg", rel: "icon", type: "image/svg+xml" }],
          structuredData: [{ "@context": "https://schema.org", "@type": "WebPage" }],
          priorityImage: { url: "/task.png", sourceSet: "/task.png 1x" },
        },
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
            optional: true,
            values: ["activity", "details"],
          },
        ],
        dependencies: [expect.objectContaining({ name: "tasks" })],
        implementation: {
          load: expect.objectContaining({
            entry: expect.objectContaining({ name: "edit.load", asynchronous: true }),
          }),
          view: {
            kind: "text",
            value: { kind: "path", root: "data", path: ["title"] },
          },
        },
      }),
    ]);
    expect(JSON.stringify(web.routes[0]?.implementation.load)).toContain(
      '"kind":"dependency-call"',
    );
  });

  test("rejects incomplete web Route implementations at the web boundary", async () => {
    const entry = await fixture(
      routeApplicationSource().replace(
        "          view({ data }: { data: { title: string } }) { return data.title; },",
        "",
      ),
    );
    expect(() => compileApplication(entry)).not.toThrow();
    expect(() => compileApplication(entry, [webCompilerExtension])).toThrow(/must implement view/);
  });

  test("allows a public loader whose type omits request authority", async () => {
    const entry = await fixture(
      routeApplicationSource().replace('Scope: "private"', 'Scope: "public"'),
    );
    expect(() => compileApplication(entry, [webCompilerExtension])).not.toThrow();
  });

  test("lowers deferred Route data and its sole reveal boundary", async () => {
    const entry = await fixture(deferredRouteApplicationSource(), "app.tsx");
    const ir = compileApplication(entry, [webCompilerExtension]);
    const route = webProgramCompilerIR(ir.programs[0]?.contributions[0]?.extensions?.web)
      .routes[0]!;

    expect(route.deferred).toEqual(["activity"]);
    expect(route.implementation.view).toEqual({
      kind: "await",
      value: { kind: "path", root: "data", path: ["activity"] },
      item: "activity",
      pending: { kind: "text", value: { kind: "literal", value: "Loading" } },
      resolved: {
        kind: "fragment",
        children: [{ kind: "text", value: { kind: "local", name: "activity", path: [] } }],
      },
      error: {
        item: "error",
        body: { kind: "text", value: { kind: "literal", value: "Unavailable" } },
      },
    });
    expect(JSON.stringify(route.implementation.load)).toContain('"kind":"closure"');
  });
});

async function fixture(source: string, name = "app.ts"): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-web-compiler-"));
  directories.push(directory);
  const entry = resolve(directory, name);
  await writeFile(entry, source);
  return entry;
}

function deferredRouteApplicationSource(): string {
  return `
declare const deferred: unique symbol;
type Deferred<Value> = { readonly [deferred]: Value };
declare function Await<Value>(props: {
  value: Deferred<Value>;
  fallback?: unknown;
  error: (error: unknown) => unknown;
  children?: (value: Value) => unknown;
}): unknown;
declare namespace JSX {
  interface ElementChildrenAttribute { children: unknown }
  interface IntrinsicElements {}
}
type UI = { readonly Name: "web" };
type Environment = {
  readonly Name: "browser-main";
  readonly Platform: { readonly Name: "web"; readonly UI: UI };
  readonly UI: UI;
};
type Program<E, C extends object> = Readonly<C & { Environment: E }>;
type Feature<C> = unknown;
type Application<C> = unknown;
type Route = {
  Path: "activity";
  Cache: false;
  Metadata: {};
  ParamSchema: {};
  SearchSchema: {};
  Data: { title: string; activity: Deferred<string> };
  Deferred: { activity: true };
  Dependencies: { feed: { read(input: {}): Promise<string> } };
};
type Activity = {
  Programs: { browser: Program<Environment, { Routes: { activity: Route } }> };
};
type App = { Features: { activity: Activity } };
const activity = {
  programs: {
    browser: {
      routes: {
        activity: {
          async load({ dependencies }: {
            dependencies: { feed: { read(input: {}): Promise<string> } };
          }) {
            const title = await dependencies.feed.read({});
            return {
              data: {
                title,
                activity: async () => await dependencies.feed.read({}),
              },
            };
          },
          view({ data }: { data: Route["Data"] }) {
            return <Await value={data.activity} fallback="Loading" error={(error: unknown) => "Unavailable"}>
              {(activity: string) => <>{activity}</>}
            </Await>;
          },
        },
      },
    },
  },
} satisfies Feature<Activity>;
export default { features: { activity } } satisfies Application<App>;
`;
}

function routeApplicationSource(): string {
  return `
declare const validation: unique symbol;
type Validate<Value, Rules = {}> = { readonly [validation]?: { Value: Value; Rules: Rules } };
type UI = { readonly Name: "web" };
type Environment = {
  readonly Name: "browser-main";
  readonly Platform: { readonly Name: "web"; readonly UI: UI };
  readonly UI: UI;
};
type Program<E, C extends object> = Readonly<C & { Environment: E }>;
type Feature<C> = unknown;
type Application<C> = unknown;
type Route = {
  Path: ":id";
  Cache: { Scope: "private"; MaxAge: "5m" };
  Metadata: {
    Title: "Edit task";
    Description: "Task editor";
    Alternates: { sk: "/sk/admin" };
    Social: {
      Card: "summary_large_image";
      Images: readonly [{ URL: "/task.png"; Alt: "Task"; Width: 1200; Height: 630 }];
    };
    Icons: readonly [{ URL: "/icon.svg"; Rel: "icon"; Type: "image/svg+xml" }];
    StructuredData: readonly [{ "@context": "https://schema.org"; "@type": "WebPage" }];
    PriorityImage: { URL: "/task.png"; SourceSet: "/task.png 1x" };
  };
  ParamSchema: { id: Validate<string, { Format: "uuid" }> };
  SearchSchema: {
    page: Validate<number, { Integer: true; Minimum: 1; Default: 1 }>;
    tab?: Validate<"activity" | "details">;
  };
  Data: { title: string };
  Dependencies: { tasks: { get(input: { id: string }): Promise<{ title: string }> } };
};
type Tasks = {
  RoutePath: "admin";
  Programs: {
    browser: Program<
      Environment,
      {
        Routes: { edit: Route };
      }
    >;
  };
};
type App = { Features: { tasks: Tasks } };
const tasks = {
  routePath: "admin",
  programs: {
    browser: {
      routes: {
        edit: {
          async load({ dependencies, params }: {
            dependencies: { tasks: { get(input: { id: string }): Promise<{ title: string }> } };
            params: { id: string };
          }) {
            const task = await dependencies.tasks.get({ id: params.id });
            return { data: { title: task.title } };
          },
          view({ data }: { data: { title: string } }) { return data.title; },
        },
      },
    },
  },
} satisfies Feature<Tasks>;
const icons = [
  { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
  { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
];
export default {
  features: { tasks },
  web: {
    installation: {
      start: { to: "tasks.edit", params: { id: "start" } },
      icons,
      offline: { fallback: { to: "tasks.edit", params: { id: "offline" } } },
    },
  },
} satisfies Application<App>;
`;
}
