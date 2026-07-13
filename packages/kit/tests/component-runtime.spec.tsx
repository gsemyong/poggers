import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { SimulatedClock } from "xstate";
import { defineApp } from "../src/app";
import { createComponentActor, type StatechartScope } from "../src/component-machine";
import { createHooks, type ComponentRuntimeParts } from "../src/component-runtime";
import { render } from "../src/ui";

type RuntimeApp = {
  Resources: {
    counter: {
      Key: { id: string };
      State: { count: number };
      Events: { incremented: { by: number } };
      Views: { count: number };
      Commands: { increment: { args: [by?: number]; event: "incremented"; error: never } };
    };
  };
  Components: {
    Button: {
      Input: { label: string; disabled: boolean };
      Values: { label: string };
      Parts: { Root: "button"; Label: "span" };
    };
    Disclosure: {
      Context: { open: boolean };
      States: "active";
      Values: { label: string };
      Events: { toggle(): void };
      Parts: { Root: "section"; Trigger: "button"; Panel: "div" };
    };
    Worker: {
      States: "running";
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
        increment(ctx, by = 1) {
          return ctx.event.incremented({ by });
        },
      },
    },
  },
  components: {
    Button: {
      derive({ input }) {
        return { label: input.label };
      },
      render({ input, parts: { Root, Label } }) {
        return (
          <Root type="button" disabled={input.disabled}>
            <Label>{input.label}</Label>
          </Root>
        );
      },
    },
    Disclosure: {
      context: { open: false },
      initial: "active",
      states: {
        active: {
          on: {
            toggle: { update: ({ context }) => ({ open: !context.open }) },
          },
        },
      },
      derive({ context }) {
        return { label: context.open ? "Close details" : "Open details" };
      },
      render({ context, values, events, parts: { Root, Trigger, Panel } }) {
        return (
          <Root data-open={context.open}>
            <Trigger type="button" aria-expanded={context.open} onClick={events.toggle}>
              {values.label}
            </Trigger>
            <Panel hidden={!context.open} />
          </Root>
        );
      },
    },
    Worker: {
      initial: "running",
      states: {
        running: { task: { run: "wait", input: () => undefined } },
      },
      tasks: {
        wait() {},
      },
      render() {
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
    await counter.increment(2);
    expect(counter.count).toBe(2);

    expect(typeof hooks.components.Disclosure).toBe("function");
    expect(hooks.components.Disclosure).toBe(hooks.components.Disclosure);
  });

  it("starts state-bound tasks only while the component is mounted and aborts on disposal", async () => {
    const signals: AbortSignal[] = [];
    const lifecycleApp = defineApp<{
      Resources: {};
      Components: {
        Worker: {
          States: "running";
          Tasks: { wait: { Input: undefined; Output: void; Error: never } };
          Parts: { Root: "div" };
        };
      };
    }>({
      version: 1,
      resources: {},
      components: {
        Worker: {
          initial: "running",
          states: { running: { task: { run: "wait", input: () => undefined } } },
          tasks: {
            wait({ signal }) {
              signals.push(signal);
              return new Promise<void>(() => {});
            },
          },
          render() {
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
});

describe("component statecharts", () => {
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
    const performed: number[] = [];
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
                    perform: ({ context }) => performed.push(Number(context.count)),
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
    expect(performed).toEqual([3]);
    actor.send("finish");
    expect(actor.getSnapshot().status).toBe("done");
    expect(actor.getSnapshot().output).toBe(3);
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
      services: {
        setAppearance() {
          throw new Error("task must not receive presentation services");
        },
        navigation: { home() {} },
      },
      tasks: {
        search(scope) {
          const { value, signal } = scope;
          expect(value).toBe("query");
          expect("setAppearance" in scope).toBe(false);
          expect("navigation" in scope).toBe(false);
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
