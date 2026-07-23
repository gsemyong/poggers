import { afterEach, describe, expect, test, vi } from "vitest";

import type { WebRouteIR } from "@/adapters/web/routing";
import { createWebUIAdapter } from "@/adapters/web/ui/adapter";
import {
  createPresentationGraph,
  ownedPresentationTargets,
} from "@/adapters/web/ui/component/adapter";
import { readScoped } from "@/adapters/web/ui/component/runtime";
import { createWebPresentationAdapter } from "@/adapters/web/ui/presentation/adapter";
import type { PresentationAdapterInstance } from "@/contracts/platform";
import type { Feature } from "@/core/feature";
import type { Program } from "@/core/program";
import type { System } from "@/core/system";
import type { BrowserMainThread } from "@/platforms/web/platform";
import type { WebPresentationLanguage } from "@/platforms/web/presentation";

const createInterfaceUI = createWebUIAdapter(createWebPresentationAdapter()).component
  .createInterfaceUI;
const boundary = {} as Element;
const emptyPresentation = Object.freeze({
  parameters: Object.freeze({}),
  create: () => Object.freeze({}),
});

function testSystem(features: Readonly<Record<string, unknown>>): System {
  return {
    features: {
      web: {
        features,
        presentation: emptyPresentation,
      },
    },
  } as unknown as System;
}

function componentMetadata(...components: readonly string[]) {
  return Object.fromEntries(
    components.map((component) => {
      const separator = component.lastIndexOf(".");
      return [
        `@feature/${component.slice(0, separator)}/component/${component.slice(separator + 1)}`,
        { elements: {} },
      ];
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

type Counter = {
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        State: { count: number };
        Actions: { increment(input: { by: number }): number };
      }
    >;
  };
};

type Shell = {
  Features: { first: Counter; second: Counter };
  Programs: {
    browser: Program<
      BrowserMainThread,
      {
        State: { total: number };
        Actions: {
          increment(input: { feature: "first" | "second"; by: number }): number;
        };
        Components: { Root: { Elements: { Root: "main" } } };
      }
    >;
  };
};

const counter = (count: number): Feature<Counter> => ({
  programs: {
    browser: {
      state: { count },
      actions: {
        increment({ state }, { by }) {
          state.count += by;
          return state.count;
        },
      },
    },
  },
});

describe("Program UI composition", () => {
  test("cancels stale Route loads and subscribes before resolving initial redirects", async () => {
    vi.stubGlobal("Element", class {});
    vi.stubGlobal("document", {
      title: "",
      documentElement: { dataset: {}, lang: "" },
      head: { querySelectorAll: () => [], append() {} },
      createElement: () => ({ setAttribute() {}, textContent: "" }),
      getElementById: () => null,
    });
    const subscribers = new Set<(location: URL) => void>();
    let location = new URL("https://example.test/start");
    const navigation = {
      current: () => location,
      navigate(destination: Readonly<{ to: PropertyKey }>) {
        location = new URL(destination.to === "finish" ? "/finish" : "/slow", location);
        for (const receive of subscribers) receive(location);
      },
      subscribe(receive: (location: URL) => void): Disposable {
        subscribers.add(receive);
        return { [Symbol.dispose]: () => subscribers.delete(receive) };
      },
    };
    const slowSignals: AbortSignal[] = [];
    let resolveSlow: (() => void) | undefined;
    let finishViews = 0;
    const system = testSystem({
      routes: {
        programs: {
          browser: {
            routes: {
              start: {
                load: () => ({ redirect: { to: "finish" } }),
                view: () => "start",
              },
              finish: {
                view: () => {
                  finishViews += 1;
                  return "finish";
                },
              },
              slow: {
                load: ({ signal }: { signal: AbortSignal }) => {
                  slowSignals.push(signal);
                  return new Promise((resolve) => {
                    resolveSlow = () => resolve({ data: "late" });
                  });
                },
                view: ({ data }: { data: unknown }) => String(data),
              },
            },
          },
        },
      },
    });
    const routes: WebRouteIR[] = [
      route("start", "/start", "Start"),
      route("finish", "/finish", "Finish"),
      route("slow", "/slow", "Slow"),
    ];
    const ui = await createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      presentation: emptyPresentation,
      dependencies: { navigation },
      programManifest: {
        name: "web.browser",
        contributions: [{ feature: "web.routes", requires: ["navigation"], provides: [] }],
      },
      routes,
      boundary,
    });
    await Promise.resolve();
    const initialRoute = ui.renderRoot();
    expect(finishViews).toBe(0);
    expect(readScoped(initialRoute)).toBe("finish");
    expect(finishViews).toBe(1);
    expect(document.title).toBe("Finish");

    navigation.navigate({ to: "slow" });
    await vi.waitFor(() => expect(slowSignals).toHaveLength(1));
    expect(readScoped(ui.renderRoot())).toBe("finish");
    expect(document.title).toBe("Finish");
    expect(slowSignals[0]?.aborted).toBe(false);
    navigation.navigate({ to: "finish" });
    expect(slowSignals[0]?.aborted).toBe(true);
    resolveSlow?.();
    await Promise.resolve();
    expect(readScoped(ui.renderRoot())).toBe("finish");

    navigation.navigate({ to: "slow" });
    await vi.waitFor(() => expect(slowSignals).toHaveLength(2));
    await ui.dispose();
    expect(slowSignals[1]?.aborted).toBe(true);
    expect(subscribers.size).toBe(0);
  });

  test("awaits a navigation that supersedes initial Route resolution", async () => {
    vi.stubGlobal("Element", class {});
    let hydrationAvailable = true;
    vi.stubGlobal("document", {
      title: "",
      documentElement: { dataset: {}, lang: "" },
      head: { querySelectorAll: () => [], append() {} },
      createElement: () => ({ setAttribute() {}, textContent: "" }),
      getElementById: (id: string) =>
        id === "poggers-hydration" && hydrationAvailable
          ? {
              textContent: JSON.stringify({
                version: 1,
                route: { feature: "web.routes", name: "start" },
                location: "/start",
                params: {},
                search: {},
                loader: false,
                metadata: { title: "Start" },
              }),
              remove() {
                hydrationAvailable = false;
              },
            }
          : null,
    });
    let rendering = "hydrate";
    const routeBoundary = {
      getAttribute(name: string) {
        return name === "data-poggers-rendering" ? rendering : null;
      },
      setAttribute(name: string, value: string) {
        if (name === "data-poggers-rendering") rendering = value;
      },
    } as unknown as Element;
    const subscribers = new Set<(location: URL) => void>();
    let location = new URL("https://example.test/start");
    const navigation = {
      current: () => location,
      navigate(destination: Readonly<{ to: PropertyKey }>) {
        location = new URL(destination.to === "finish" ? "/finish" : "/start", location);
        for (const receive of subscribers) receive(location);
      },
      subscribe(receive: (location: URL) => void): Disposable {
        subscribers.add(receive);
        return { [Symbol.dispose]: () => subscribers.delete(receive) };
      },
    };
    type RouteDefinition = Readonly<{
      view(input: Readonly<{ data: unknown }>): string;
    }>;
    let resolveStart: ((value: RouteDefinition) => void) | undefined;
    let resolveFinish: ((value: RouteDefinition) => void) | undefined;
    const system = testSystem({
      routes: {
        programs: {
          browser: {
            routes: {
              start: {
                view: ({ data }: { data: unknown }) => String(data),
              },
              finish: {
                view: ({ data }: { data: unknown }) => String(data),
              },
            },
          },
        },
      },
    });
    const creating = createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      presentation: emptyPresentation,
      dependencies: { navigation },
      programManifest: {
        name: "web.browser",
        contributions: [{ feature: "web.routes", requires: ["navigation"], provides: [] }],
      },
      routes: [route("start", "/start", "Start"), route("finish", "/finish", "Finish")],
      loadRoute: (current: WebRouteIR) =>
        new Promise<RouteDefinition>((resolve) => {
          if (current.name === "start") resolveStart = resolve;
          else resolveFinish = resolve;
        }),
      boundary: routeBoundary,
    });
    await vi.waitFor(() => expect(resolveStart).toBeTypeOf("function"));
    navigation.navigate({ to: "finish" });
    await vi.waitFor(() => expect(resolveFinish).toBeTypeOf("function"));
    let created = false;
    void creating.then(() => {
      created = true;
    });

    resolveStart?.({ view: () => "start" });
    await Promise.resolve();
    expect(created).toBe(false);
    expect(rendering).toBe("client");

    resolveFinish?.({ view: () => "finish" });
    const ui = await creating;
    expect(readScoped(ui.renderRoot())).toBe("finish");
    expect(document.title).toBe("Finish");
    await ui.dispose();
  });

  test("keeps detached but owned Elements available to Presentation", () => {
    const detached = { isConnected: false } as unknown as Element;
    const fallback = { isConnected: true } as unknown as Element;

    expect(ownedPresentationTargets(new Set([detached]), fallback)).toEqual([detached]);
    expect(ownedPresentationTargets(undefined, fallback)).toEqual([fallback]);
    expect(ownedPresentationTargets(new Set(), null)).toEqual([]);
  });

  test("composes isolated child APIs into a parent UI contribution", async () => {
    vi.stubGlobal("Element", class {});
    let renderedChildren: readonly number[] = [];
    const shell: Feature<Shell> = {
      features: { first: counter(1), second: counter(10) },
      programs: {
        browser: {
          state: { total: 0 },
          actions: {
            increment({ state, features }, { feature, by }) {
              const count = features[feature].increment({ by });
              state.total = features.first.count + features.second.count;
              return count;
            },
          },
          components: {
            Root: {
              view({ features }) {
                renderedChildren = [features.first.count, features.second.count];
                return null;
              },
            },
          },
          root: "Root",
        },
      },
    };
    const system = testSystem({ shell });
    const ui = await createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      presentation: emptyPresentation,
      components: componentMetadata("web.shell.Root"),
      boundary,
    });
    const increment = ui.api.increment as (input: {
      feature: "first" | "second";
      by: number;
    }) => number;

    expect(ui.api.total).toBe(0);
    expect(increment({ feature: "first", by: 2 })).toBe(3);
    expect(ui.api.total).toBe(13);
    ui.renderRoot();
    await Promise.resolve();
    expect(renderedChildren).toEqual([3, 10]);

    await ui.dispose();
    expect(() => increment({ feature: "first", by: 1 })).toThrow("disposed");
  });

  test("requires exactly one root for a UI Program", async () => {
    const system = testSystem({
      empty: {
        programs: { browser: { components: {} } },
      },
    });

    await expect(
      createInterfaceUI({
        system,
        interface: "web",
        program: "web.browser",
        logicalProgram: "browser",
        presentation: emptyPresentation,
        boundary,
      }),
    ).rejects.toThrow("exactly one root");
  });

  test("updates the interface Presentation without rebuilding Program state", async () => {
    const shell: Feature<Shell> = {
      features: { first: counter(1), second: counter(10) },
      programs: {
        browser: {
          state: { total: 0 },
          actions: {
            increment({ state }, { by }) {
              state.total += by;
              return state.total;
            },
          },
          components: { Root: { view: () => null } },
          root: "Root",
        },
      },
    };
    const family = { parameters: {}, create: () => ({}) };
    const studio = { parameters: {}, create: () => ({}) };
    const system = testSystem({ shell });
    const ui = await createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      presentation: family,
      components: componentMetadata("web.shell.Root"),
      boundary,
    });

    expect(ui.api.total).toBe(0);
    ui.updatePresentation(studio);
    expect(ui.api.total).toBe(0);

    await ui.dispose();
  });

  test("evaluates Presentation meaning only inside mounted adapter frames", async () => {
    const shell: Feature<Shell> = {
      features: { first: counter(1), second: counter(10) },
      programs: {
        browser: {
          state: { total: 0 },
          actions: {
            increment({ state }, { by }) {
              state.total += by;
              return state.total;
            },
          },
          components: { Root: { view: () => null } },
          root: "Root",
        },
      },
    };
    const environments: object[] = [];
    const family = {
      parameters: {},
      create: ({ environment }: { environment: object }) => {
        environments.push(environment);
        return {};
      },
    };
    const system = testSystem({ shell });
    const ui = await createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      presentation: family,
      components: componentMetadata("web.shell.Root"),
      boundary,
    });

    expect(environments).toHaveLength(0);
    ui.updatePresentation(family);
    expect(environments).toHaveLength(0);
    await ui.dispose();
  });

  test("rejects multiple roots for a composed UI Program", async () => {
    const system = testSystem({
      first: {
        programs: {
          browser: {
            components: { Root: { view: () => null } },
            root: "Root",
          },
        },
      },
      second: {
        programs: {
          browser: {
            components: { Root: { view: () => null } },
            root: "Root",
          },
        },
      },
    });

    await expect(
      createInterfaceUI({
        system,
        interface: "web",
        program: "web.browser",
        logicalProgram: "browser",
        presentation: emptyPresentation,
        boundary,
      }),
    ).rejects.toThrow("found 2");
  });

  test("binds child-provided Dependencies into its parent contribution", async () => {
    type Provider = {
      Programs: {
        browser: Program<BrowserMainThread, { Provides: { reader: { read(): string } } }>;
      };
    };
    type Consumer = {
      Features: { provider: Provider };
      Programs: {
        browser: Program<
          BrowserMainThread,
          {
            Requires: { reader: { read(): string } };
            State: { value: string };
            Actions: { receive(input: { value: string }): void };
            Components: { Root: { Elements: { Root: "main" } } };
          }
        >;
      };
    };
    const provider: Feature<Provider> = {
      programs: {
        browser: {
          start: () => ({ reader: { read: () => "provided" } }),
        },
      },
    };
    const consumer: Feature<Consumer> = {
      features: { provider },
      programs: {
        browser: {
          start({ actions, dependencies }) {
            actions.receive({ value: dependencies.reader.read() });
          },
          state: { value: "" },
          actions: {
            receive({ state }, { value }) {
              state.value = value;
            },
          },
          components: { Root: { view: () => null } },
          root: "Root",
        },
      },
    };
    const system = testSystem({ consumer });
    const ui = await createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      programManifest: {
        name: "web.browser",
        contributions: [
          { feature: "web.consumer", requires: ["reader"], provides: [] },
          { feature: "web.consumer.provider", requires: [], provides: ["reader"] },
        ],
      },
      presentation: emptyPresentation,
      components: componentMetadata("web.consumer.Root"),
      boundary,
    });

    expect(ui.api.value).toBe("provided");
    await ui.dispose();
  });

  test("captures and restores Program UI state by Feature identity", async () => {
    const shell: Feature<Shell> = {
      features: { first: counter(1), second: counter(10) },
      programs: {
        browser: {
          state: { total: 0 },
          actions: {
            increment({ state, features }, { feature, by }) {
              const count = features[feature].increment({ by });
              state.total = features.first.count + features.second.count;
              return count;
            },
          },
          components: { Root: { view: () => null } },
          root: "Root",
        },
      },
    };
    const system = testSystem({ shell });
    const hotState = {};
    const first = await createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      presentation: emptyPresentation,
      components: componentMetadata("web.shell.Root"),
      hotState,
      boundary,
    });
    (first.api.increment as (input: { feature: "first"; by: number }) => number)({
      feature: "first",
      by: 4,
    });
    first.captureHotState();
    await first.dispose();

    const second = await createInterfaceUI({
      system,
      interface: "web",
      program: "web.browser",
      logicalProgram: "browser",
      presentation: emptyPresentation,
      components: componentMetadata("web.shell.Root"),
      hotState,
      boundary,
    });
    expect(second.api.total).toBe(15);
    expect(
      (second.api.increment as (input: { feature: "second"; by: number }) => number)({
        feature: "second",
        by: 1,
      }),
    ).toBe(11);
    expect(second.api.total).toBe(16);
    await second.dispose();
  });
});

function route(name: string, path: string, title?: string): WebRouteIR {
  return {
    feature: "web.routes",
    name,
    path,
    document: "shell",
    cache: false,
    metadata: title ? { title } : {},
    params: [],
    search: [],
    deferred: [],
  };
}

test("evaluates each interface and child Feature Presentation scope once per root frame", () => {
  let interfaceEvaluations = 0;
  let featureEvaluations = 0;
  const adapter = {
    environment: {} as WebPresentationLanguage["Environment"],
    create(options: { readonly scopes?: readonly object[] }) {
      return {
        render(
          frame: (input: {
            elements: Record<string, never>;
            scopes: readonly { evaluate<Value>(read: () => Value): Value }[];
          }) => unknown,
        ) {
          frame({
            elements: {},
            scopes: (options.scopes ?? []).map(() => ({
              evaluate: <Value>(read: () => Value) => read(),
            })),
          });
        },
        reconfigure() {},
        dispose() {},
      };
    },
    dispose() {},
  } as unknown as PresentationAdapterInstance<WebPresentationLanguage, Element>;
  const presentation = {
    parameters: {},
    create: () => {
      interfaceEvaluations += 1;
      return {
        Dashboard: () => {
          featureEvaluations += 1;
          return {
            First: () => ({ Root: { paint: { opacity: 0.4 } } }),
            Second: () => ({ Root: { paint: { opacity: 0.4 } } }),
          };
        },
      };
    },
  };
  const graph = createPresentationGraph({
    system: testSystem({
      dashboard: {
        programs: {
          browser: { components: { First: {}, Second: {} } },
        },
      },
    }),
    interface: "web",
    program: "browser",
    presentationRevision: () => 0,
    presentation: () => presentation,
    adapter,
    boundary,
    featureAPIs: { "web.dashboard": {} },
    featureEvents: { "web.dashboard": {} },
    eventRevision: () => 0,
    rootComponents: [],
  });

  graph.mount();
  expect(interfaceEvaluations).toBe(1);
  expect(featureEvaluations).toBe(1);
  expect(graph.component("@feature/web.dashboard/component/First")?.({} as never)).toEqual({
    Root: { paint: { opacity: 0.4 } },
  });
  expect(graph.component("@feature/web.dashboard/component/Second")?.({} as never)).toEqual({
    Root: { paint: { opacity: 0.4 } },
  });
  expect(graph.scopes("@feature/web.dashboard/component/First")).toHaveLength(2);
  expect(featureEvaluations).toBe(1);
  graph.dispose();
});

test("invalidates only compiler-identified consumers of shared Presentation motion", async () => {
  const adapter = {
    environment: {} as WebPresentationLanguage["Environment"],
    create(options: { readonly scopes?: readonly object[] }) {
      return {
        render(
          frame: (input: {
            elements: Record<string, never>;
            scopes: readonly { evaluate<Value>(read: () => Value): Value }[];
          }) => unknown,
        ) {
          frame({
            elements: {},
            scopes: (options.scopes ?? []).map(() => ({
              evaluate: <Value>(read: () => Value) => read(),
            })),
          });
        },
        reconfigure() {},
        dispose() {},
      };
    },
    dispose() {},
  } as unknown as PresentationAdapterInstance<WebPresentationLanguage, Element>;
  const first = "@feature/web.dashboard/component/First";
  const second = "@feature/web.dashboard/component/Second";
  const presentation = {
    parameters: {},
    create: () => ({ Dashboard: () => ({ First: () => ({}), Second: () => ({}) }) }),
  };
  const graph = createPresentationGraph({
    system: testSystem({
      dashboard: {
        programs: { browser: { components: { First: {}, Second: {} } } },
      },
    }),
    interface: "web",
    program: "browser",
    presentationRevision: () => 0,
    presentation: () => presentation,
    adapter,
    boundary,
    featureAPIs: { "web.dashboard": {} },
    featureEvents: { "web.dashboard": {} },
    eventRevision: () => 0,
    rootComponents: [],
    dependencies: {
      [first]: [
        {
          destination: "Dashboard/First/Root/paint/opacity",
          animations: [{ id: "Presentation/Dashboard::shared", scope: "Presentation/Dashboard" }],
        },
      ],
    },
  });

  expect(graph.dynamic(first)).toBe(true);
  expect(graph.dynamic(second)).toBe(false);
  expect(graph.revision(first)).toBe(0);
  expect(graph.revision(second)).toBe(0);
  graph.mount();
  await Promise.resolve();
  await Promise.resolve();
  expect(graph.revision(first)).toBe(1);
  expect(graph.revision(second)).toBe(0);
  graph.dispose();
});

test("coalesces shared-scope invalidation when the consumer already rendered that generation", async () => {
  let replay: (() => void) | undefined;
  const adapter = {
    environment: {} as WebPresentationLanguage["Environment"],
    create(options: { readonly scopes?: readonly object[] }) {
      return {
        render(
          frame: (input: {
            elements: Record<string, never>;
            scopes: readonly { evaluate<Value>(read: () => Value): Value }[];
          }) => unknown,
        ) {
          replay = () =>
            frame({
              elements: {},
              scopes: (options.scopes ?? []).map(() => ({
                evaluate: <Value>(read: () => Value) => read(),
              })),
            });
          replay();
        },
        reconfigure() {},
        dispose() {},
      };
    },
    dispose() {},
  } as unknown as PresentationAdapterInstance<WebPresentationLanguage, Element>;
  const component = "@feature/web.dashboard/component/Panel";
  const presentation = {
    parameters: {},
    create: () => ({ Dashboard: () => ({ Panel: () => ({}) }) }),
  };
  const graph = createPresentationGraph({
    system: testSystem({
      dashboard: { programs: { browser: { components: { Panel: {} } } } },
    }),
    interface: "web",
    program: "browser",
    presentationRevision: () => 0,
    presentation: () => presentation,
    adapter,
    boundary,
    featureAPIs: { "web.dashboard": {} },
    featureEvents: { "web.dashboard": {} },
    eventRevision: () => 0,
    rootComponents: [],
    dependencies: {
      [component]: [
        {
          destination: "Dashboard/Panel/Root/paint/opacity",
          animations: [{ id: "Presentation/Dashboard::shared", scope: "Presentation/Dashboard" }],
        },
      ],
    },
  });

  graph.mount();
  graph.acknowledge(component);
  await Promise.resolve();
  await Promise.resolve();
  expect(graph.revision(component)).toBe(0);

  replay?.();
  queueMicrotask(() => graph.acknowledge(component));
  await Promise.resolve();
  await Promise.resolve();
  expect(graph.revision(component)).toBe(0);

  replay?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(graph.revision(component)).toBe(1);
  graph.dispose();
});

test("does not reevaluate unrelated Feature Presentation scopes on adapter-owned frames", () => {
  let replay: (() => void) | undefined;
  const adapter = {
    environment: {} as WebPresentationLanguage["Environment"],
    create(options: { readonly scopes?: readonly object[] }) {
      return {
        render(
          frame: (input: {
            elements: Record<string, never>;
            scopes: readonly { evaluate<Value>(read: () => Value): Value }[];
          }) => unknown,
        ) {
          const run = () =>
            frame({
              elements: {},
              scopes: (options.scopes ?? []).map(() => ({
                evaluate: <Value>(read: () => Value) => read(),
              })),
            });
          replay = run;
          run();
        },
        reconfigure() {},
        dispose() {},
      };
    },
    dispose() {},
  } as unknown as PresentationAdapterInstance<WebPresentationLanguage, Element>;
  const dashboard = "@feature/web.dashboard/component/First";
  let dashboardEvaluations = 0;
  let analyticsEvaluations = 0;
  const presentation = {
    parameters: {},
    create: () => ({
      Dashboard: () => {
        dashboardEvaluations += 1;
        return { First: () => ({}) };
      },
      Analytics: () => {
        analyticsEvaluations += 1;
        return { Report: () => ({}) };
      },
    }),
  };
  const graph = createPresentationGraph({
    system: testSystem({
      dashboard: { programs: { browser: { components: { First: {} } } } },
      analytics: { programs: { browser: { components: { Report: {} } } } },
    }),
    interface: "web",
    program: "browser",
    presentationRevision: () => 0,
    presentation: () => presentation,
    adapter,
    boundary,
    featureAPIs: { "web.dashboard": {}, "web.analytics": {} },
    featureEvents: { "web.dashboard": {}, "web.analytics": {} },
    eventRevision: () => 0,
    rootComponents: [],
    dependencies: {
      [dashboard]: [
        {
          destination: "Dashboard/First/Root/paint/opacity",
          animations: [{ id: "Presentation/Dashboard::shared", scope: "Presentation/Dashboard" }],
        },
      ],
    },
  });

  graph.mount();
  expect([dashboardEvaluations, analyticsEvaluations]).toEqual([1, 1]);
  replay?.();
  expect([dashboardEvaluations, analyticsEvaluations]).toEqual([2, 1]);
  graph.dispose();
});
