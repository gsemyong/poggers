import { describe, expect, test } from "vitest";

import type { Application, Feature, Program } from "../../../application";
import { createWebUIPlatformAdapter, type BrowserMainThread } from "../platform";

const createApplicationUI = createWebUIPlatformAdapter().component.createApplicationUI;

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
    const family = {};
    type AppearanceContract = Contract & { Presentations: "family" };
    const application = {
      features: { shell },
      presentations: { family },
    } satisfies Application<AppearanceContract>;
    const ui = createApplicationUI<AppearanceContract>({
      application,
      program: "browser",
      presentations: { presentations: { family } },
    });

    expect(ui.api.total).toBe(0);
    expect(ui.updatePresentations({ family })).toBe(true);
    expect(
      ui.updatePresentations({
        studio: {},
      }),
    ).toBe(false);

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
