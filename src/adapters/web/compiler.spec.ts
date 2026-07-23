import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { webCompilerExtension } from "@/adapters/web/compiler";
import { webFeatureCompilerIR, webProgramCompilerIR } from "@/adapters/web/routing";
import { compileSystem, SystemDiagnostic } from "@/compiler/source";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("web compiler extension", () => {
  test("owns mounted paths, rendering, cache, metadata, and validation meaning", async () => {
    const entry = await fixture(routeApplicationSource());
    const generic = compileSystem(entry);
    expect(generic.features[0]?.extensions).toBeUndefined();
    expect(generic.programs[0]?.contributions[0]?.extensions).toBeUndefined();

    const ir = compileSystem(entry, [webCompilerExtension]);
    const webInterface = ir.features.find(({ path }) => path === "product.web");
    const tasks = ir.features.find(({ path }) => path === "product.web.tasks");
    expect(webFeatureCompilerIR(webInterface?.extensions?.web)).toEqual({
      version: 8,
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
    expect(webFeatureCompilerIR(tasks?.extensions?.web)).toEqual({
      version: 8,
      routePath: "admin",
    });
    const web = webProgramCompilerIR(ir.programs[0]?.contributions[0]?.extensions?.web);
    expect(web.routes).toEqual([
      expect.objectContaining({
        feature: "product.web.tasks",
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
    expect(() => compileSystem(entry)).not.toThrow();
    expect(() => compileSystem(entry, [webCompilerExtension])).toThrow(/must implement view/);
  });

  test("allows a public loader whose type omits request authority", async () => {
    const entry = await fixture(
      routeApplicationSource().replace('Scope: "private"', 'Scope: "public"'),
    );
    expect(() => compileSystem(entry, [webCompilerExtension])).not.toThrow();
  });

  test("lowers deferred Route data and its sole reveal boundary", async () => {
    const entry = await fixture(deferredRouteApplicationSource(), "system.tsx");
    const ir = compileSystem(entry, [webCompilerExtension]);
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

  test("isolates equivalent Routes by interface and locates collisions within one interface", async () => {
    const isolated = compileSystem(await fixture(multiInterfaceRouteSource(false)), [
      webCompilerExtension,
    ]);

    expect(isolated.interfaces.map(({ id, programs }) => [id, programs])).toEqual([
      ["interface/customer.web", ["program/customer.web.browser"]],
      ["interface/operations.web", ["program/operations.web.browser"]],
    ]);

    const entry = await fixture(multiInterfaceRouteSource(true));
    let failure: unknown;
    try {
      compileSystem(entry, [webCompilerExtension]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SystemDiagnostic);
    expect(String(failure)).toMatch(/system\.ts:\d+:\d+: Web Routes .* are ambiguous/);
  });
});

async function fixture(source: string, name = "system.ts"): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "poggers-web-compiler-"));
  directories.push(directory);
  const entry = resolve(directory, name);
  await writeFile(entry, source);
  return entry;
}

function compositionSource(): string {
  return `
declare const featureContract: unique symbol;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createSystem(definition: object): object {
  return definition;
}
`;
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
${compositionSource()}
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
type Web = {
  Interface: { Platform: { Name: "web" } };
  Features: { activity: Activity };
};
type Product = { App: true; Features: { web: Web } };
const activity = createFeature<Activity>({
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
});
const web = createFeature<Web>({
  features: { activity },
  presentation: { parameters: {}, create() { return {}; } },
});
const product = createFeature<Product>({ features: { web } });
export default createSystem({ features: { product } });
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
${compositionSource()}
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
type Web = {
  Interface: { Platform: { Name: "web" } };
  Features: { tasks: Tasks };
};
type Product = { App: true; Features: { web: Web } };
type Root = { Features: { product: Product } };
const tasks = createFeature<Tasks>({
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
});
const icons = [
  { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
  { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
];
const web = createFeature<Web>({
  features: { tasks },
  presentation: { parameters: {}, create() { return {}; } },
  installation: {
    start: { to: "tasks.edit", params: { id: "start" } },
    icons,
    offline: { fallback: { to: "tasks.edit", params: { id: "offline" } } },
  },
});
const product = createFeature<Product>({ features: { web } });
export default createSystem({
  features: { product },
});
`;
}

function multiInterfaceRouteSource(collide: boolean): string {
  const extraContract = collide ? "; duplicate: Area" : "";
  const extraValue = collide ? ", duplicate" : "";
  return `
type UI = { readonly Name: "web" };
type Environment = {
  readonly Name: "browser-main";
  readonly Platform: { readonly Name: "web"; readonly UI: UI };
  readonly UI: UI;
};
type Program<E, C extends object> = Readonly<C & { Environment: E }>;
${compositionSource()}
type Route = {
  Path: "";
  Cache: false;
  Metadata: {};
  ParamSchema: {};
  SearchSchema: {};
  Data: {};
  Dependencies: {};
};
type Area = {
  Programs: { browser: Program<Environment, { Routes: { home: Route } }> };
};
type OperationsWeb = {
  Interface: { Platform: { Name: "web" } };
  Features: { primary: Area${extraContract} };
};
type CustomerWeb = {
  Interface: { Platform: { Name: "web" } };
  Features: { primary: Area };
};
type Operations = { App: true; Features: { web: OperationsWeb } };
type Customer = { App: true; Features: { web: CustomerWeb } };
const primary = createFeature<Area>({
  programs: { browser: { routes: { home: { view() { return "Home"; } } } } },
});
const duplicate = createFeature<Area>({
  programs: { browser: { routes: { home: { view() { return "Duplicate"; } } } } },
});
const operationsWeb = createFeature<OperationsWeb>({
  features: { primary${extraValue} },
  presentation: { parameters: {}, create() { return {}; } },
});
const customerWeb = createFeature<CustomerWeb>({
  features: { primary },
  presentation: { parameters: {}, create() { return {}; } },
});
const operations = createFeature<Operations>({ features: { web: operationsWeb } });
const customer = createFeature<Customer>({ features: { web: customerWeb } });
export default createSystem({ features: { operations, customer } });
`;
}
