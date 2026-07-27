import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { compileSystem, SystemDiagnostic } from "@/compiler/source";
import { webCompilerExtension } from "@/platforms/web/adapter/compiler";
import { webInterfaceCompilerIR, webProgramCompilerIR } from "@/platforms/web/adapter/lowering";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("web compiler extension", () => {
  test("owns mounted paths, rendering, cache, metadata, and validation meaning", async () => {
    const entry = await fixture(routeSystemSource());
    expect(() => compileSystem(entry)).toThrow(
      'Platform "web" has no registered compiler dialect.',
    );

    const ir = compileSystem(entry, [webCompilerExtension]);
    const webInterface = ir.interfaces.find(({ path }) => path === "product.web");
    const tasks = ir.features.find(({ path }) => path === "product.tasks");
    expect(webInterfaceCompilerIR(webInterface?.extensions?.web)).toEqual({
      version: 11,
      mounts: [{ feature: "tasks", path: "admin" }],
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
    expect(tasks?.extensions).toBeUndefined();
    const web = webProgramCompilerIR(ir.programs[0]?.contributions[0]?.extensions?.web);
    expect(web.routes).toEqual([
      expect.objectContaining({
        feature: "tasks",
        name: "edit",
        path: ":id",
        status: 200,
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
      routeSystemSource().replace(
        "          view({ data }: { data: { title: string } }) { return data.title; },",
        "",
      ),
    );
    expect(() => compileSystem(entry)).toThrow(
      'Platform "web" has no registered compiler dialect.',
    );
    expect(() => compileSystem(entry, [webCompilerExtension])).toThrow(/must implement view/);
  });

  test("allows a public loader whose type omits request authority", async () => {
    const entry = await fixture(routeSystemSource().replace('Scope: "private"', 'Scope: "public"'));
    expect(() => compileSystem(entry, [webCompilerExtension])).not.toThrow();
  });

  test("reads adapter-owned constants through Feature factory parameters", async () => {
    const ir = compileSystem(await fixture(parameterizedInterfaceSource()), [webCompilerExtension]);
    const interface_ = ir.interfaces.find(({ path }) => path === "operations.web");

    expect(webInterfaceCompilerIR(interface_?.extensions?.web).installation).toMatchObject({
      shortName: "Operations",
      start: { to: "home" },
      offline: { fallback: { to: "home" } },
    });
  });

  test("lowers deferred Route data and its sole reveal boundary", async () => {
    const entry = await fixture(deferredRouteSystemSource(), "system.tsx");
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
  const directory = await mkdtemp(resolve(tmpdir(), "kit-web-compiler-"));
  directories.push(directory);
  const entry = resolve(directory, name);
  await writeFile(entry, source);
  return entry;
}

function compositionSource(): string {
  return `
declare const featureContract: unique symbol;
declare const applicationContract: unique symbol;
declare const dependencyDefinition: unique symbol;
type Dependency<Definition extends { Operations: object }> = Readonly<
  Definition["Operations"] & { readonly [dependencyDefinition]?: Definition }
>;
type Feature<Contract> = Readonly<{ readonly [featureContract]?: Contract }>;
type Application<Contract> = Readonly<{
  readonly interfaces: object;
  readonly [applicationContract]?: {
    Application: Contract;
    Features: Contract extends { Features: infer Features } ? Features : {};
    Interfaces: Contract extends { Interfaces: infer Interfaces } ? Interfaces : {};
  };
}>;
function createFeature<Contract>(definition: object): Feature<Contract> {
  return definition as Feature<Contract>;
}
function createApplication<Contract>(definition: object): Application<Contract> {
  return definition as Application<Contract>;
}
function createInterface<Contract>(definition: object): Contract {
  return definition as Contract;
}
function createSystem(definition: object): object {
  return definition;
}
`;
}

function deferredRouteSystemSource(): string {
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
};
type Feed = Dependency<{ Operations: { read(input: {}): Promise<string> } }>;
type Activity = {
  Programs: {
    browser: Program<
      Environment,
      {
        Requires: { feed: Feed };
        Routes: { activity: Route };
      }
    >;
  };
};
type Web = { Interface: { Platform: { Name: "web" } } };
type Product = {
  Features: { activity: Activity };
  Interfaces: { web: Web };
};
const activity = createFeature<Activity>({
  programs: {
    browser: {
      routes: {
        activity: {
          async load({ dependencies }: {
            dependencies: { feed: Feed };
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
const web = createInterface<Web>({
  presentation: { parameters: {}, create() { return {}; } },
});
const product = createApplication<Product>({
  interfaces: { web },
});
export default createSystem({
  features: { activity },
  applications: { product },
});
`;
}

function routeSystemSource(): string {
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
};
type TaskService = Dependency<{
  Operations: { get(input: { id: string }): Promise<{ title: string }> };
}>;
type Tasks = {
  Programs: {
    browser: Program<
      Environment,
      {
        Requires: { tasks: TaskService };
        Routes: { edit: Route };
      }
    >;
  };
};
type Web = {
  Interface: {
    Platform: {
      Name: "web";
      Specification: { Mounts: { tasks: { Path: "admin" } } };
    };
  };
};
type Product = {
  Features: { tasks: Tasks };
  Interfaces: { web: Web };
};
type Root = { Features: { product: Product } };
const tasks = createFeature<Tasks>({
  programs: {
    browser: {
      routes: {
        edit: {
          async load({ dependencies, params }: {
            dependencies: { tasks: TaskService };
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
const web = createInterface<Web>({
  presentation: { parameters: {}, create() { return {}; } },
  installation: {
    start: { feature: "tasks", route: "edit", params: { id: "start" } },
    icons,
    offline: {
      fallback: { feature: "tasks", route: "edit", params: { id: "offline" } },
    },
  },
});
const product = createApplication<Product>({
  interfaces: { web },
});
export default createSystem({ features: { tasks }, applications: { product } });
`;
}

function parameterizedInterfaceSource(): string {
  return `
${compositionSource()}
type Web = { Interface: { Platform: { Name: "web" } } };
type Operations = { Features: {}; Interfaces: { web: Web } };
function createWeb(input: { shortName: string }): Web {
  return createInterface<Web>({
    presentation: { parameters: {}, create() { return {}; } },
    installation: {
      shortName: input.shortName,
      start: { route: "home" },
      icons: [
        { src: "/icon-192.svg", sizes: "192x192" },
        { src: "/icon-512.svg", sizes: "512x512" },
      ],
      offline: { fallback: { route: "home" } },
    },
  });
}
const web = createWeb({ shortName: "Operations" });
const operations = createApplication<Operations>({ interfaces: { web } });
export default createSystem({ applications: { operations } });
`;
}

function multiInterfaceRouteSource(collide: boolean): string {
  const extraContract = collide ? '; duplicate: Area<"duplicate">' : "";
  const extraMount = collide ? '; duplicate: { Path: "" }' : "";
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
type Area<Name extends string> = {
  Instance: Name;
  Programs: { browser: Program<Environment, { Routes: { home: Route } }> };
};
type OperationsWeb = {
  Interface: {
    Platform: {
      Name: "web";
      Specification: { Mounts: { primary: { Path: "" }${extraMount} } };
    };
  };
};
type CustomerWeb = {
  Interface: {
    Platform: {
      Name: "web";
      Specification: { Mounts: { primary: { Path: "" } } };
    };
  };
};
type Operations = {
  Features: { primary: Area<"primary">${extraContract} };
  Interfaces: { web: OperationsWeb };
};
type Customer = {
  Features: { primary: Area<"primary"> };
  Interfaces: { web: CustomerWeb };
};
const primary = createFeature<Area<"primary">>({
  programs: { browser: { routes: { home: { view() { return "Home"; } } } } },
});
const duplicate = createFeature<Area<"duplicate">>({
  programs: { browser: { routes: { home: { view() { return "Duplicate"; } } } } },
});
const operationsWeb = createInterface<OperationsWeb>({
  presentation: { parameters: {}, create() { return {}; } },
});
const customerWeb = createInterface<CustomerWeb>({
  presentation: { parameters: {}, create() { return {}; } },
});
const operations = createApplication<Operations>({
  interfaces: { web: operationsWeb },
});
const customer = createApplication<Customer>({
  interfaces: { web: customerWeb },
});
export default createSystem({
  features: { primary, duplicate },
  applications: { operations, customer },
});
`;
}
