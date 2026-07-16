import { describe, expect, it } from "bun:test";

import fc from "fast-check";
import { SimulatedClock } from "xstate";

import { defineApp, type FeatureDef } from "#kernel/app";
import { createSubmission } from "#substrate/submission";
import { createComponentActor, type StatechartScope } from "#ui/machine.xstate";
import { createHooks, type ComponentRuntimeParts } from "#ui/web/component";
import { render, signal } from "#ui/web/runtime";

type RuntimeApp = {
  Resources: {
    counter: {
      Key: { id: string };
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: { increment: { Input: { by?: number }; Event: "incremented"; Error: never } };
    };
  };
  Components: {
    Button: {
      Input: { label: string; disabled: boolean };
      State: { label: string };
      Parts: { Root: "button"; Label: "span" };
    };
    Disclosure: {
      Context: { open: boolean };
      Phases: "active";
      State: { open: boolean; label: string };
      Actions: { toggle(): void };
      Parts: { Root: "section"; Trigger: "button"; Panel: "div" };
    };
    Worker: {
      Phases: "running";
      Tasks: { wait: { Input: undefined; Output: void; Error: never } };
      Parts: { Root: "div" };
    };
  };
};

const app = defineApp<RuntimeApp>({
  version: 1,
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.by;
        },
      },
      views: {
        count({ state }) {
          return state.count;
        },
      },
      commands: {
        increment(ctx, { by = 1 }) {
          return ctx.event.incremented({ by });
        },
      },
    },
  },
  components: {
    Button: {
      state({ input }) {
        return { label: input.label };
      },
      view({ state, parts: { Root, Label } }) {
        return (
          <Root type="button">
            <Label>{state.label}</Label>
          </Root>
        );
      },
    },
    Disclosure: {
      machine: {
        context: { open: false },
        initial: "active",
        phases: {
          active: {
            on: {
              toggle: { update: ({ context }) => ({ open: !context.open }) },
            },
          },
        },
      },
      state({ context }) {
        return {
          open: context.open,
          label: context.open ? "Close details" : "Open details",
        };
      },
      view({ state, actions, parts: { Root, Trigger, Panel } }) {
        return (
          <Root data-open={state.open}>
            <Trigger type="button" aria-expanded={state.open} onClick={actions.toggle}>
              {state.label}
            </Trigger>
            <Panel hidden={!state.open} />
          </Root>
        );
      },
    },
    Worker: {
      machine: {
        initial: "running",
        phases: {
          running: { task: { run: "wait", input: () => undefined } },
        },
        tasks: {
          wait() {},
        },
      },
      view() {
        return null;
      },
    },
  },
});

const components = {
  Button: { parts: { Root: "button", Label: "span" } },
  Disclosure: { parts: { Root: "section", Trigger: "button", Panel: "div" } },
  Worker: { parts: { Root: "div" } },
} as const satisfies ComponentRuntimeParts<RuntimeApp>;

describe("component integration", () => {
  it("shares resource data and exposes stable direct component renderers", async () => {
    const hooks = createHooks({ app, styles: { presets: { default: {} } }, components });
    const counter = hooks.useCounter({ id: "main" });
    expect(counter.count).toBe(0);
    await counter.increment({ by: 2 });
    expect(counter.count).toBe(2);

    expect(typeof hooks.components.Disclosure).toBe("function");
    expect(hooks.components.Disclosure).toBe(hooks.components.Disclosure);
  });

  it("projects only the owning Feature semantic API into its component", () => {
    type FeatureApp = {
      Resources: {};
      Components: { Host: { Parts: {} } };
      Features: {
        counter: {
          Resources: {
            state: {
              Key: string;
              State: { count: number };
              Events: {};
              Views: { count: number };
              Commands: {};
            };
          };
          Components: { Counter: { State: { count: number }; Parts: { Root: "output" } } };
          API: { readonly count: number };
        };
      };
    };

    let observed: unknown;
    const counter = {
      resources: {
        state: {
          state: { count: 4 },
          events: {},
          views: { count: ({ state }) => state.count },
          commands: {},
        },
      },
      features: {},
      api({ resources }) {
        return { count: resources.state("main").count };
      },
      components: {
        Counter: {
          state: ({ api }) => ({ count: api.count }),
          view({ state }) {
            observed = state;
            return null;
          },
        },
      },
    } satisfies FeatureDef<FeatureApp, FeatureApp["Features"]["counter"]>;
    const featureApp = defineApp<FeatureApp>({
      version: 1,
      resources: {},
      features: { counter },
      components: {
        Host: {
          view({ features: { counter } }) {
            return counter.Counter();
          },
        },
      },
      root: "Host",
    });
    const hooks = createHooks({ app: featureApp, styles: { presets: { default: {} } } });
    const cleanup = render(() => hooks.renderRoot(), {
      replaceChildren() {},
    } as unknown as Element);

    expect(observed).toEqual({ count: 4 });
    expect(observed).not.toHaveProperty("resources");
    cleanup();
  });

  it("runs nested Feature component statecharts and updates derived values reactively", () => {
    type FeatureApp = {
      Resources: {};
      Components: { Host: { Parts: {} } };
      Features: {
        editor: {
          Resources: {};
          Components: {
            Composer: {
              Context: { value: string };
              Phases: "active";
              State: { value: string; canSubmit: boolean };
              Actions: { change(value: string): void };
              Parts: {};
            };
          };
          API: {};
        };
      };
    };

    let change: ((value: string) => void) | undefined;
    let readContext: (() => string) | undefined;
    let readCanSubmit: (() => boolean) | undefined;
    const editor = {
      resources: {},
      features: {},
      api: () => ({}),
      components: {
        Composer: {
          machine: {
            context: { value: "" },
            initial: "active",
            phases: {
              active: {
                on: { change: { update: (_scope, value) => ({ value }) } },
              },
            },
          },
          state: ({ context }) => ({
            value: context.value,
            canSubmit: context.value.trim().length > 0,
          }),
          view({ state, actions }) {
            change = actions.change;
            readContext = () => state.value;
            readCanSubmit = () => state.canSubmit;
            return null;
          },
        },
      },
    } satisfies FeatureDef<FeatureApp, FeatureApp["Features"]["editor"]>;
    const featureApp = defineApp<FeatureApp>({
      version: 1,
      resources: {},
      features: { editor },
      components: {
        Host: { view: ({ features: { editor } }) => editor.Composer() },
      },
      root: "Host",
    });
    const hooks = createHooks({ app: featureApp, styles: { presets: { default: {} } } });
    const cleanup = render(() => hooks.renderRoot(), {
      replaceChildren() {},
    } as unknown as Element);

    expect(readContext?.()).toBe("");
    expect(readCanSubmit?.()).toBe(false);
    change?.("hello");
    expect(readContext?.()).toBe("hello");
    expect(readCanSubmit?.()).toBe(true);
    cleanup();
  });

  it("projects only the owning Feature browser dependencies into its tasks", async () => {
    type DependencyApp = {
      Resources: {};
      Components: { Host: { Parts: {} } };
      Features: {
        clock: {
          Resources: {};
          Components: {
            Time: {
              Phases: "reading" | "done";
              Tasks: { read: { Input: undefined; Output: number; Error: never } };
              Parts: {};
            };
          };
          Dependencies: { browser: { clock: { readonly now: () => number } } };
          API: {};
        };
      };
    };

    let observed = 0;
    const clock = {
      resources: {},
      features: {},
      dependencies: { browser: { clock: { now: () => 42 } } },
      api: () => ({}),
      components: {
        Time: {
          machine: {
            initial: "reading",
            phases: {
              reading: { task: { run: "read", input: () => undefined, done: "done" } },
              done: {},
            },
            tasks: {
              read({ dependencies }) {
                observed = dependencies.clock.now();
                return observed;
              },
            },
          },
          view: () => null,
        },
      },
    } satisfies FeatureDef<DependencyApp, DependencyApp["Features"]["clock"]>;
    const dependencyApp = defineApp<DependencyApp>({
      version: 1,
      resources: {},
      features: { clock },
      components: {
        Host: { view: ({ features: { clock } }) => clock.Time() },
      },
      root: "Host",
    });
    const hooks = createHooks({
      app: dependencyApp,
      styles: { presets: { default: {} } },
      dependencyGroups: { clock: { clock: { now: () => 42 } } },
    });
    const cleanup = render(() => hooks.renderRoot(), {
      replaceChildren() {},
    } as unknown as Element);

    await Bun.sleep(0);
    expect(observed).toBe(42);
    cleanup();
  });

  it("maps semantic Feature navigation independently for repeated mounts", () => {
    type SelectedScreen = { readonly name: string; readonly params: Record<string, string> } | null;
    type NavigableFeature = {
      Resources: {};
      Components: {
        Panel: {
          State: { screen: SelectedScreen };
          Phases: "navigating" | "done";
          Tasks: { navigate: { Input: undefined; Output: void; Error: never } };
          Parts: { Root: "section" };
        };
      };
      Navigation: { open: { id: string } };
      API: {};
    };
    type NavigationApp = {
      Resources: {};
      Components: {
        Host: {
          Input: { feature: "first" | "second" };
          State: { feature: "first" | "second" };
          Parts: {};
        };
      };
      Features: { first: NavigableFeature; second: NavigableFeature };
      Navigation: { first: { id: string }; second: { id: string } };
    };

    const observed: Record<string, unknown[]> = { first: [], second: [] };
    const first = {
      resources: {},
      features: {},
      navigation: { open: "first" },
      api: () => ({}),
      components: {
        Panel: {
          state: ({ screen }) => ({ screen }),
          machine: {
            initial: "navigating",
            phases: {
              navigating: { task: { run: "navigate", input: () => undefined, done: "done" } },
              done: {},
            },
            tasks: {
              navigate({ state, navigation }) {
                observed.first?.push(
                  state.screen
                    ? { name: state.screen.name, params: { ...state.screen.params } }
                    : null,
                );
                navigation.open({ id: "first" });
              },
            },
          },
          view: () => null,
        },
      },
    } satisfies FeatureDef<NavigationApp, NavigableFeature>;
    const second = {
      resources: {},
      features: {},
      navigation: { open: "second" },
      api: () => ({}),
      components: {
        Panel: {
          state: ({ screen }) => ({ screen }),
          machine: {
            initial: "navigating",
            phases: {
              navigating: { task: { run: "navigate", input: () => undefined, done: "done" } },
              done: {},
            },
            tasks: {
              navigate({ state, navigation }) {
                observed.second?.push(
                  state.screen
                    ? { name: state.screen.name, params: { ...state.screen.params } }
                    : null,
                );
                navigation.open({ id: "second" });
              },
            },
          },
          view: () => null,
        },
      },
    } satisfies FeatureDef<NavigationApp, NavigableFeature>;
    const navigationApp = defineApp<NavigationApp>({
      version: 1,
      navigation: { first: "/first/:id", second: "/second/:id" },
      resources: {},
      features: { first, second },
      components: {
        Host: {
          state: ({ input }) => ({ feature: input.feature }),
          view({ state, features: { first, second } }) {
            return state.feature === "first" ? first.Panel() : second.Panel();
          },
        },
      },
    });
    const hooks = createHooks({ app: navigationApp, styles: { presets: { default: {} } } });
    const root = { replaceChildren() {} } as unknown as Element;

    render(() => hooks.components.Host({ feature: "first" }), root)();
    render(() => hooks.components.Host({ feature: "second" }), root)();
    render(() => hooks.components.Host({ feature: "second" }), root)();

    expect(observed.first).toEqual([{ name: "open", params: {} }]);
    expect(observed.second).toEqual([null, { name: "open", params: { id: "second" } }]);
  });

  it("starts state-bound tasks only while the component is mounted and aborts on disposal", async () => {
    const signals: AbortSignal[] = [];
    const lifecycleApp = defineApp<{
      Resources: {};
      Components: {
        Worker: {
          Phases: "running";
          Tasks: { wait: { Input: undefined; Output: void; Error: never } };
          Parts: { Root: "div" };
        };
      };
    }>({
      version: 1,
      resources: {},
      components: {
        Worker: {
          machine: {
            initial: "running",
            phases: { running: { task: { run: "wait", input: () => undefined } } },
            tasks: {
              wait({ signal }) {
                signals.push(signal);
                return new Promise<void>(() => {});
              },
            },
          },
          view() {
            return null;
          },
        },
      },
    });
    const hooks = createHooks({
      app: lifecycleApp,
      styles: { presets: { default: {} } },
      components: { Worker: { parts: { Root: "div" } } },
    });
    const Worker = hooks.components.Worker;

    await Bun.sleep(0);
    expect(signals).toHaveLength(0);
    const cleanup = render(() => Worker(), { replaceChildren() {} } as unknown as Element);
    await Bun.sleep(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    cleanup();
    await Bun.sleep(0);
    expect(signals[0]!.aborted).toBe(true);
  });

  it("projects mounted task completion into reactive component state and context", async () => {
    let readState: (() => boolean) | undefined;
    let readResult: (() => string | null) | undefined;
    const taskApp = defineApp<{
      Resources: {};
      Components: {
        Account: {
          Context: { result: string | null };
          State: { ready: boolean; result: string | null };
          Phases: "loading" | "ready";
          Tasks: { load: { Input: undefined; Output: string; Error: Error } };
          Parts: {};
        };
      };
    }>({
      version: 1,
      resources: {},
      components: {
        Account: {
          machine: {
            context: { result: null },
            initial: "loading",
            phases: {
              loading: {
                task: {
                  run: "load",
                  input: () => undefined,
                  done: {
                    target: "ready",
                    update: (_scope, result) => ({ result }),
                  },
                  fail: "ready",
                },
              },
              ready: {},
            },
            tasks: { load: async () => "loaded" },
          },
          state: ({ context, phase }) => ({
            ready: phase === "ready",
            result: context.result,
          }),
          view({ state }) {
            readState = () => state.ready;
            readResult = () => state.result;
            return null;
          },
        },
      },
    });
    const hooks = createHooks({ app: taskApp, styles: { presets: { default: {} } } });
    const cleanup = render(() => hooks.components.Account(), {
      replaceChildren() {},
    } as unknown as Element);

    await Bun.sleep(0);
    expect(readState?.()).toBe(true);
    expect(readResult?.()).toBe("loaded");
    cleanup();
  });

  it("keeps Submission tasks active through uncertainty and projects their lifecycle", async () => {
    const controller = createSubmission<"conflict">();
    let readPhase: (() => string) | undefined;
    let readStatus: (() => string) | undefined;
    const submissionApp = defineApp<{
      Resources: {};
      API: { readonly save: typeof controller.submission };
      Components: {
        Form: {
          Phases: "submitting" | "saved" | "failed";
          State: {
            submission:
              | "preparing"
              | "queued"
              | "submitted"
              | "uncertain"
              | "committed"
              | "rejected";
            status: "submitting" | "saved" | "failed";
          };
          Tasks: { save: { Input: undefined; Output: unknown; Error: unknown } };
          Parts: {};
        };
      };
    }>({
      version: 1,
      resources: {},
      api: () => ({ save: controller.submission }),
      components: {
        Form: {
          machine: {
            initial: "submitting",
            phases: {
              submitting: {
                task: {
                  run: "save",
                  input: () => undefined,
                  done: "saved",
                  fail: "failed",
                },
              },
              saved: {},
              failed: {},
            },
            tasks: { save: ({ api }) => api.save },
          },
          state: ({ api, phase }) => ({
            submission: api.save.phase,
            status: phase === "saved" ? "saved" : phase === "failed" ? "failed" : "submitting",
          }),
          view({ state }) {
            readPhase = () => state.submission;
            readStatus = () => state.status;
            return null;
          },
        },
      },
    });
    const hooks = createHooks({
      app: submissionApp,
      styles: { presets: { default: {} } },
      components: {
        Form: { parts: {}, state: [{ name: "submission" }, { name: "status" }] },
      },
    });
    const cleanup = render(() => hooks.components.Form(), {
      replaceChildren() {},
    } as unknown as Element);

    await Bun.sleep(0);
    expect(readPhase?.()).toBe("preparing");
    expect(readStatus?.()).toBe("submitting");
    controller.setPhase("queued");
    expect(readPhase?.()).toBe("queued");
    controller.setPhase("uncertain");
    await Bun.sleep(0);
    expect(readPhase?.()).toBe("uncertain");
    expect(readStatus?.()).toBe("submitting");
    controller.settle({ ok: true, cursor: 3 });
    await Bun.sleep(0);
    expect(readPhase?.()).toBe("committed");
    expect(readStatus?.()).toBe("saved");
    cleanup();
  });

  it("reevaluates eventless transitions when semantic State dependencies change", async () => {
    type ReactiveApp = {
      Resources: {};
      API: { readonly ready: boolean };
      Components: {
        Probe: {
          Phases: "waiting" | "ready";
          State: { ready: boolean; phase: "waiting" | "ready" };
          Parts: {};
        };
      };
    };
    const ready = signal(false);
    let firstState: unknown;
    let latestState: unknown;
    let readReady: (() => boolean) | undefined;
    let readPhase: (() => "waiting" | "ready") | undefined;
    const reactiveApp = defineApp<ReactiveApp>({
      version: 1,
      resources: {},
      api: () => ({
        get ready() {
          return ready();
        },
      }),
      components: {
        Probe: {
          machine: {
            initial: "waiting",
            phases: {
              waiting: {
                always: { allow: ({ state }) => state.ready, target: "ready" },
              },
              ready: {},
            },
          },
          state: ({ api, phase }) => ({
            ready: api.ready,
            phase: phase === "ready" ? "ready" : "waiting",
          }),
          view({ state }) {
            firstState ??= state;
            latestState = state;
            readReady = () => state.ready;
            readPhase = () => state.phase;
            return null;
          },
        },
      },
    });
    const hooks = createHooks({
      app: reactiveApp,
      styles: { presets: { default: {} } },
      components: { Probe: { parts: {}, state: [{ name: "ready" }, { name: "phase" }] } },
    });
    const cleanup = render(() => hooks.components.Probe(), {
      replaceChildren() {},
    } as unknown as Element);

    expect(readReady?.()).toBe(false);
    expect(readPhase?.()).toBe("waiting");
    ready(true);
    await Bun.sleep(0);
    expect(readReady?.()).toBe(true);
    expect(readPhase?.()).toBe("ready");
    expect(latestState).toBe(firstState);
    cleanup();

    ready(false);
    await Bun.sleep(0);
    expect(readPhase?.()).toBe("ready");
  });
});

describe("component statecharts", () => {
  it("routes rejected Submissions through the task failure transition", async () => {
    const controller = createSubmission<"conflict">();
    const actor = createComponentActor({
      id: "submission-failure",
      input: {},
      context: {},
      definition: {
        initial: "submitting",
        states: {
          submitting: {
            task: {
              run: "save",
              input: () => undefined,
              done: "saved",
              fail: "failed",
            },
          },
          saved: {},
          failed: {},
        },
      },
      tasks: { save: () => controller.submission },
    });

    actor.start();
    controller.setPhase("uncertain");
    await Bun.sleep(0);
    expect(actor.getSnapshot().matches("submitting")).toBe(true);
    controller.settle({ ok: false, error: "conflict" });
    await Bun.sleep(0);
    expect(actor.getSnapshot().matches("failed")).toBe(true);
    actor.stop();
  });

  it("coordinates cancellable visual settlement and completion targets", async () => {
    let finish: (() => void) | undefined;
    const phases: Array<{ phase: "enter" | "exit"; state: string; signal: AbortSignal }> = [];
    const actor = createComponentActor({
      id: "Settled",
      input: {},
      context: {},
      settle({ phase, state, signal }) {
        phases.push({ phase, state, signal });
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      definition: {
        initial: "opening",
        states: {
          opening: { settle: { phase: "enter", done: "open" }, on: { close: "closed" } },
          open: {},
          closed: {},
        },
      },
    });

    actor.start();
    await Bun.sleep(0);
    expect(phases.map(({ phase, state }) => ({ phase, state }))).toEqual([
      { phase: "enter", state: "opening" },
    ]);
    expect(actor.getSnapshot().matches("opening")).toBe(true);
    finish?.();
    await Bun.sleep(0);
    expect(actor.getSnapshot().matches("open")).toBe(true);

    const interrupted = createComponentActor({
      id: "Interrupted",
      input: {},
      context: {},
      settle({ phase, state, signal }) {
        phases.push({ phase, state, signal });
        return new Promise<void>(() => {});
      },
      definition: {
        initial: "opening",
        states: {
          opening: { settle: { phase: "enter", done: "open" }, on: { close: "closed" } },
          open: {},
          closed: {},
        },
      },
    });
    interrupted.start();
    await Bun.sleep(0);
    interrupted.send("close");
    expect(phases.at(-1)?.signal.aborted).toBe(true);
    expect(interrupted.getSnapshot().matches("closed")).toBe(true);
  });

  it("settles exit exactly once and aborts it when the state is reentered", async () => {
    const signals: AbortSignal[] = [];
    let finish: (() => void) | undefined;
    const actor = createComponentActor({
      id: "ExitSettlement",
      input: {},
      context: {},
      settle({ signal }) {
        signals.push(signal);
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      definition: {
        initial: "open",
        states: {
          open: { on: { close: "closing" } },
          closing: {
            settle: { phase: "exit", done: "closed", cancelled: "open" },
            on: { reopen: "open" },
          },
          closed: {},
        },
      },
    });

    actor.start();
    actor.send("close");
    await Bun.sleep(0);
    expect(signals).toHaveLength(1);
    expect(actor.getSnapshot().matches("closing")).toBe(true);
    actor.send("reopen");
    expect(signals[0]!.aborted).toBe(true);
    expect(actor.getSnapshot().matches("open")).toBe(true);
    finish?.();
    await Bun.sleep(0);
    expect(actor.getSnapshot().matches("open")).toBe(true);
  });

  it("executes hierarchy, inline guards, context patches, completion, and output", () => {
    const actor = createComponentActor({
      id: "Counter",
      input: { maximum: 3 },
      context: { count: 0 },
      definition: {
        initial: "idle",
        output: ({ context }: StatechartScope) => context.count,
        states: {
          idle: { on: { start: { target: "active.ready", update: () => ({ count: 1 }) } } },
          active: {
            initial: "active.ready",
            states: {
              ready: {
                on: {
                  add: {
                    allow: ({ input, context }, amount) =>
                      Number(context.count) + Number(amount) <= Number(input.maximum),
                    update: ({ context }, amount) => ({
                      count: Number(context.count) + Number(amount),
                    }),
                  },
                  finish: "active.complete",
                },
              },
              complete: { type: "final" },
            },
            done: "finished",
          },
          finished: { type: "final" },
        },
      },
    });

    actor.start();
    actor.send("start");
    expect(actor.getSnapshot().matches("active.ready")).toBe(true);
    expect(actor.getSnapshot().can("add", 2)).toBe(true);
    expect(actor.getSnapshot().can("add", 3)).toBe(false);
    actor.send("add", 2);
    expect(actor.getSnapshot().context.count).toBe(3);
    actor.send("finish");
    expect(actor.getSnapshot().status).toBe("done");
    expect(actor.getSnapshot().output).toBe(3);
  });

  it("runs state-bound tasks through the machine lifecycle", () => {
    const warnings: unknown[][] = [];
    const previousWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    let nested: ReturnType<typeof createComponentActor> | undefined;

    try {
      const actor = createComponentActor({
        id: "Parent",
        input: {},
        context: {},
        tasks: {
          mount() {
            nested = createComponentActor({
              id: "Nested",
              input: {},
              context: { mounted: false },
              definition: {
                initial: "idle",
                states: {
                  idle: { on: { activate: { update: () => ({ mounted: true }) } } },
                },
              },
            });
          },
        },
        definition: {
          initial: "ready",
          states: {
            ready: {
              on: { mount: "mounting" },
            },
            mounting: { task: { run: "mount", input: () => undefined, done: "ready" } },
          },
        },
      });

      actor.start();
      actor.send("mount");
      expect(nested).toBeDefined();
      expect(warnings).toEqual([]);
    } finally {
      nested?.stop();
      console.warn = previousWarn;
    }
  });

  it("cancels inline delayed transitions when their state exits", () => {
    const clock = new SimulatedClock();
    const actor = createComponentActor({
      id: "Delay",
      input: {},
      context: {},
      clock,
      definition: {
        initial: "idle",
        states: {
          idle: { on: { begin: "waiting" } },
          waiting: { after: { wait: 100, target: "fired" }, on: { cancel: "idle" } },
          fired: {},
        },
      },
    });

    actor.start();
    actor.send("begin");
    clock.increment(50);
    actor.send("cancel");
    clock.increment(100);
    expect(actor.getSnapshot().matches("idle")).toBe(true);
    actor.send("begin");
    clock.increment(100);
    expect(actor.getSnapshot().matches("fired")).toBe(true);
  });

  it("aborts tasks on exit and ignores late completion", async () => {
    const pending: Array<{ resolve(value: string): void; signal: AbortSignal }> = [];
    const actor = createComponentActor({
      id: "Task",
      input: {},
      context: { result: undefined },
      taskServices: {
        setAppearance() {
          return undefined;
        },
        navigation: { home() {} },
        api: { actorId: "test" },
        dependencies: { search: { source: "fixture" } },
      },
      tasks: {
        search(scope) {
          const { value, signal } = scope;
          expect(value).toBe("query");
          expect(scope.api).toEqual({ actorId: "test" });
          expect(scope.dependencies).toEqual({ search: { source: "fixture" } });
          expect("setAppearance" in scope).toBe(true);
          expect("navigation" in scope).toBe(true);
          return new Promise<string>((resolve) => pending.push({ resolve, signal }));
        },
      },
      definition: {
        initial: "idle",
        states: {
          idle: { on: { run: "searching" } },
          searching: {
            task: {
              run: "search",
              input: () => "query",
              done: { target: "success", update: (_scope, result) => ({ result }) },
              fail: "failure",
            },
            on: { cancel: "idle" },
          },
          success: {},
          failure: {},
        },
      },
    });

    actor.start();
    actor.send("run");
    actor.send("cancel");
    expect(pending[0]!.signal.aborted).toBe(true);
    pending[0]!.resolve("late");
    await Bun.sleep(0);
    expect(actor.getSnapshot().matches("idle")).toBe(true);
    expect(actor.getSnapshot().context.result).toBeUndefined();

    actor.send("run");
    pending[1]!.resolve("accepted");
    await Bun.sleep(0);
    expect(actor.getSnapshot().matches("success")).toBe(true);
    expect(actor.getSnapshot().context.result).toBe("accepted");
  });

  it("restores compatible refresh snapshots and rejects incompatible topology", () => {
    const definition = {
      initial: "idle",
      states: {
        idle: { on: { open: "open" } },
        open: { on: { rename: { update: (_scope: unknown, name: unknown) => ({ name }) } } },
      },
    } as const;
    const first = createComponentActor({
      id: "Refresh",
      input: {},
      context: { name: "initial" },
      definition,
    });
    first.start();
    first.send("open");
    first.send("rename", "restored");
    const refreshSnapshot = first.getRefreshSnapshot();
    first.stop();

    const restored = createComponentActor({
      id: "Refresh",
      input: {},
      context: { name: "ignored" },
      definition,
      refreshSnapshot,
    });
    restored.start();
    expect(restored.getSnapshot().matches("open")).toBe(true);
    expect(restored.getSnapshot().context.name).toBe("restored");
    restored.stop();

    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...values) => warnings.push(values);
    try {
      const incompatible = createComponentActor({
        id: "Refresh",
        input: {},
        context: { name: "fresh" },
        definition: { initial: "ready", states: { ready: {} } },
        refreshSnapshot,
      });
      incompatible.start();
      expect(incompatible.getSnapshot().matches("ready")).toBe(true);
      expect(incompatible.getSnapshot().context.name).toBe("fresh");
      incompatible.stop();
    } finally {
      console.warn = warn;
    }
    expect(warnings).toHaveLength(1);
  });

  it("coordinates parallel query and gesture lifecycles with velocity preservation", async () => {
    const clock = new SimulatedClock();
    const pending: Array<{
      query: string;
      resolve(results: readonly string[]): void;
      signal: AbortSignal;
    }> = [];
    const actor = createComponentActor({
      id: "AdaptiveCommandSurface",
      input: {},
      context: { query: "", results: [], dragOffset: 0, releaseVelocity: 0 },
      clock,
      tasks: {
        search({ value, signal }) {
          return new Promise<readonly string[]>((resolve) => {
            pending.push({ query: String(value), resolve, signal });
          });
        },
      },
      definition: {
        initial: "closed",
        states: {
          closed: { on: { open: "open" } },
          open: {
            type: "parallel",
            on: { close: "closed" },
            states: {
              query: {
                initial: "open.query.ready",
                on: {
                  query: {
                    target: "open.query.debouncing",
                    reenter: true,
                    update: (_scope, query) => ({ query, results: [] }),
                  },
                },
                states: {
                  ready: {},
                  debouncing: { after: { wait: 80, target: "open.query.searching" } },
                  searching: {
                    task: {
                      run: "search",
                      input: ({ context }) => context.query,
                      done: {
                        target: "open.query.ready",
                        update: (_scope, results) => ({ results }),
                      },
                      fail: "open.query.error",
                    },
                  },
                  error: {},
                },
              },
              gesture: {
                initial: "open.gesture.idle",
                states: {
                  idle: { on: { dragStart: "open.gesture.dragging" } },
                  dragging: {
                    on: {
                      drag: {
                        update: (_scope, offset, velocity) => ({
                          dragOffset: offset,
                          releaseVelocity: velocity,
                        }),
                      },
                      dragFinish: {
                        target: "open.gesture.settling",
                        update: (_scope, velocity) => ({ releaseVelocity: velocity }),
                      },
                    },
                  },
                  settling: { after: { wait: 180, target: "open.gesture.idle" } },
                },
              },
            },
          },
        },
      },
    });

    actor.start();
    actor.send("open");
    actor.send("query", "first");
    actor.send("dragStart");
    actor.send("drag", 56, 0.72);
    actor.send("dragFinish", 1.18);
    expect(actor.getSnapshot().matches("open.query.debouncing")).toBe(true);
    expect(actor.getSnapshot().matches("open.gesture.settling")).toBe(true);
    expect(actor.getSnapshot().context.releaseVelocity).toBe(1.18);

    clock.increment(80);
    actor.send("query", "second");
    expect(pending[0]!.signal.aborted).toBe(true);
    clock.increment(80);
    actor.send("close");
    expect(pending[1]!.signal.aborted).toBe(true);
    pending[0]!.resolve(["stale-first"]);
    pending[1]!.resolve(["stale-second"]);
    await Bun.sleep(0);
    expect(actor.getSnapshot().context.results).toEqual([]);

    actor.send("open");
    actor.send("query", "accepted");
    clock.increment(80);
    pending[2]!.resolve(["accepted-result"]);
    await Bun.sleep(0);
    expect(actor.getSnapshot().matches("open.query.ready")).toBe(true);
    expect(actor.getSnapshot().matches("open.gesture.idle")).toBe(true);
    expect(actor.getSnapshot().context.results).toEqual(["accepted-result"]);
  });

  it("replays ten thousand transitions deterministically", () => {
    const run = () => {
      const trace: number[] = [];
      const actor = createComponentActor({
        id: "Determinism",
        input: {},
        context: { count: 0 },
        definition: {
          initial: "running",
          states: {
            running: {
              on: {
                tick: {
                  update: ({ context }, amount) => ({
                    count: Number(context.count) + Number(amount),
                  }),
                },
              },
            },
          },
        },
      });
      actor.subscribe((snapshot) => trace.push(Number(snapshot.context.count)));
      actor.start();
      for (let index = 0; index < 10_000; index++) actor.send("tick", (index % 5) + 1);
      const snapshot = actor.getSnapshot();
      actor.stop();
      return { count: snapshot.context.count, trace };
    };

    const first = run();
    expect(first.count).toBe(30_000);
    expect(run()).toEqual(first);
  });

  it("reads the active preset parameters atomically with each event", () => {
    let dismissDistance = 0.35;
    const services = Object.defineProperty({}, "parameters", {
      enumerable: true,
      get: () => ({ dismissDistance }),
    });
    const actor = createComponentActor({
      id: "PresetPolicy",
      input: {},
      context: {},
      services,
      definition: {
        initial: "closed",
        states: {
          closed: { on: { open: "dragging" } },
          dragging: {
            on: {
              releaseDragging: [
                {
                  allow: (scope, progress) =>
                    Number(progress) >=
                    Number((scope.parameters as { dismissDistance: number }).dismissDistance),
                  target: "closed",
                },
                { target: "settling" },
              ],
            },
          },
          settling: { on: { reset: "closed" } },
        },
      },
    });
    actor.start();
    actor.send("open");
    actor.send("releaseDragging", 0.4);
    expect(actor.getSnapshot().matches("closed")).toBe(true);

    dismissDistance = 0.8;
    actor.send("open");
    actor.send("releaseDragging", 0.4);
    expect(actor.getSnapshot().matches("settling")).toBe(true);
    actor.stop();
  });

  it("preserves lifecycle invariants across arbitrary interaction sequences", () => {
    const event = fc.record({
      type: fc.constantFrom(
        "open",
        "close",
        "startDragging",
        "sampleDragging",
        "releaseDragging",
        "cancelDragging",
        "finishSettling",
      ),
      value: fc.integer({ min: -1200, max: 1200 }),
    });

    const run = (events: readonly { readonly type: string; readonly value: number }[]) => {
      let continuousOffset = 0;
      const parameters = { dismissDistance: 0.35, dismissVelocity: 0.62 };
      const actor = createComponentActor({
        id: "LifecycleModel",
        input: {},
        context: {},
        services: { parameters },
        definition: {
          initial: "closed",
          states: {
            closed: { on: { open: "open.idle" } },
            open: {
              on: { close: "closed" },
              initial: "open.idle",
              states: {
                idle: { on: { startDragging: "open.dragging" } },
                dragging: {
                  on: {
                    releaseDragging: [
                      {
                        allow: (scope, progress, velocity) => {
                          const policy = scope.parameters as typeof parameters;
                          return (
                            Number(progress) >= policy.dismissDistance ||
                            Number(velocity) >= policy.dismissVelocity
                          );
                        },
                        target: "closed",
                      },
                      { target: "open.settling" },
                    ],
                    cancelDragging: "open.idle",
                  },
                },
                settling: {
                  on: {
                    startDragging: "open.dragging",
                    finishSettling: "open.idle",
                  },
                },
              },
            },
          },
        },
      });
      actor.start();
      for (const next of events) {
        if (next.type === "sampleDragging") {
          continuousOffset = next.value;
        } else if (next.type === "releaseDragging") {
          actor.send(next.type, Math.abs(next.value % 101) / 100, next.value / 1000);
        } else {
          actor.send(next.type);
        }
        const snapshot = actor.getSnapshot();
        expect(snapshot.status).toBe("active");
        expect(snapshot.matches("closed") || snapshot.matches("open")).toBe(true);
        if (snapshot.matches("open.dragging") || snapshot.matches("open.settling")) {
          expect(snapshot.matches("open")).toBe(true);
        }
        expect(Number.isFinite(continuousOffset)).toBe(true);
      }
      const result = {
        value: actor.getSnapshot().value,
        offset: continuousOffset,
      };
      actor.stop();
      return result;
    };

    fc.assert(
      fc.property(fc.array(event, { maxLength: 40 }), (events) => {
        expect(run(events)).toEqual(run(events));
      }),
      { numRuns: 10_000 },
    );
  });
});
