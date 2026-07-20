import { describe, expect, test } from "vitest";

import type { Application, Feature, Program } from "../../../../core/application";
import type { PresentationAdapterInstance } from "../../../../core/presentation";
import type { BrowserMainThread } from "../../platform";
import { createWebUIAdapter } from "../adapter";
import type { WebPresentationLanguage } from "../presentation/language";
import { createPresentationGraph } from "./adapter";

const createApplicationUI = createWebUIAdapter().component.createApplicationUI;
const boundary = {} as Element;

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

type Contract = { Features: { shell: Shell } };

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
  test("composes isolated child APIs into a parent UI contribution", async () => {
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
    const application: Application<Contract> = { features: { shell } };
    const ui = createApplicationUI({
      application,
      program: "browser",
      presentations: { presentations: {} },
      boundary,
    });
    const increment = ui.api.increment as (input: {
      feature: "first" | "second";
      by: number;
    }) => number;

    expect(ui.api.total).toBe(0);
    expect(increment({ feature: "first", by: 2 })).toBe(3);
    expect(ui.api.total).toBe(13);

    await ui.dispose();
    expect(() => increment({ feature: "first", by: 1 })).toThrow("disposed");
  });

  test("requires exactly one root for a UI Program", () => {
    const application = {
      features: {
        empty: {
          programs: { browser: { components: {} } },
        },
      },
    } as unknown as Application<Contract>;

    expect(() =>
      createApplicationUI({
        application,
        program: "browser",
        presentations: { presentations: {} },
        boundary,
      }),
    ).toThrow("exactly one root");
  });

  test("updates authored Presentations in place when their public names are stable", async () => {
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
    type AppearanceContract = Contract & { Presentations: "family" };
    const application = {
      features: { shell },
      presentations: { family },
    } satisfies Application<AppearanceContract>;
    const ui = createApplicationUI<AppearanceContract>({
      application,
      program: "browser",
      presentations: { presentations: { family } },
      boundary,
    });

    expect(ui.api.total).toBe(0);
    expect(ui.updatePresentations({ family })).toBe(true);
    expect(
      ui.updatePresentations({
        studio: family,
      }),
    ).toBe(false);

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
    type AppearanceContract = Contract & { Presentations: "family" };
    const application = {
      features: { shell },
      presentations: { family },
    } satisfies Application<AppearanceContract>;
    const ui = createApplicationUI<AppearanceContract>({
      application,
      program: "browser",
      presentations: { presentations: { family } },
      boundary,
    });

    expect(environments).toHaveLength(0);
    expect(ui.updatePresentations({ family })).toBe(true);
    expect(environments).toHaveLength(0);
    await ui.dispose();
  });

  test("rejects multiple roots for a composed UI Program", () => {
    const application = {
      features: {
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
      },
    } as unknown as Application<Contract>;

    expect(() =>
      createApplicationUI({
        application,
        program: "browser",
        presentations: { presentations: {} },
        boundary,
      }),
    ).toThrow("found 2");
  });

  test("binds child-provided Capabilities into its parent contribution", async () => {
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
    type App = { Features: { consumer: Consumer } };
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
          start({ actions, capabilities }) {
            actions.receive({ value: capabilities.reader.read() });
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
    const application: Application<App> = { features: { consumer } };
    const ui = createApplicationUI({
      application,
      program: "browser",
      presentations: { presentations: {} },
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
    const application: Application<Contract> = { features: { shell } };
    const hotState = {};
    const first = createApplicationUI({
      application,
      program: "browser",
      presentations: { presentations: {} },
      hotState,
      boundary,
    });
    (first.api.increment as (input: { feature: "first"; by: number }) => number)({
      feature: "first",
      by: 4,
    });
    first.captureHotState();
    await first.dispose();

    const second = createApplicationUI({
      application,
      program: "browser",
      presentations: { presentations: {} },
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

test("evaluates each Application and Feature Presentation scope once per root frame", () => {
  let applicationEvaluations = 0;
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
  const graph = createPresentationGraph({
    application: {
      features: {
        dashboard: {
          programs: {
            browser: { components: { First: {}, Second: {} } },
          },
        },
      },
    },
    program: "browser",
    presentations: {
      clean: {
        parameters: {},
        create: () => {
          applicationEvaluations += 1;
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
      },
    },
    presentationRevision: () => 0,
    presentation: () => "clean",
    adapter,
    boundary,
    featureAPIs: { dashboard: {} },
    featureEvents: { dashboard: {} },
    eventRevision: () => 0,
    rootComponents: [],
  });

  graph.mount();
  expect(applicationEvaluations).toBe(1);
  expect(featureEvaluations).toBe(1);
  expect(graph.component("@feature/dashboard/component/First")?.({} as never)).toEqual({
    Root: { paint: { opacity: 0.4 } },
  });
  expect(graph.component("@feature/dashboard/component/Second")?.({} as never)).toEqual({
    Root: { paint: { opacity: 0.4 } },
  });
  expect(graph.scopes("@feature/dashboard/component/First")).toHaveLength(2);
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
  const first = "@feature/dashboard/component/First";
  const second = "@feature/dashboard/component/Second";
  const graph = createPresentationGraph({
    application: {
      features: {
        dashboard: {
          programs: { browser: { components: { First: {}, Second: {} } } },
        },
      },
    },
    program: "browser",
    presentations: {
      clean: {
        parameters: {},
        create: () => ({ Dashboard: () => ({ First: () => ({}), Second: () => ({}) }) }),
      },
    },
    presentationRevision: () => 0,
    presentation: () => "clean",
    adapter,
    boundary,
    featureAPIs: { dashboard: {} },
    featureEvents: { dashboard: {} },
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
  const component = "@feature/dashboard/component/Panel";
  const graph = createPresentationGraph({
    application: {
      features: {
        dashboard: { programs: { browser: { components: { Panel: {} } } } },
      },
    },
    program: "browser",
    presentations: {
      clean: { parameters: {}, create: () => ({ Dashboard: () => ({ Panel: () => ({}) }) }) },
    },
    presentationRevision: () => 0,
    presentation: () => "clean",
    adapter,
    boundary,
    featureAPIs: { dashboard: {} },
    featureEvents: { dashboard: {} },
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
  const dashboard = "@feature/dashboard/component/First";
  let dashboardEvaluations = 0;
  let analyticsEvaluations = 0;
  const graph = createPresentationGraph({
    application: {
      features: {
        dashboard: { programs: { browser: { components: { First: {} } } } },
        analytics: { programs: { browser: { components: { Report: {} } } } },
      },
    },
    program: "browser",
    presentations: {
      clean: {
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
      },
    },
    presentationRevision: () => 0,
    presentation: () => "clean",
    adapter,
    boundary,
    featureAPIs: { dashboard: {}, analytics: {} },
    featureEvents: { dashboard: {}, analytics: {} },
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
