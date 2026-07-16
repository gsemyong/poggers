import { describe, expect, it } from "bun:test";

import { defineApp, type Submission, type FeatureDef } from "#kernel/app";
import { testApp, testFeature } from "#testing/application";

type CounterState = {
  count: number;
};

const api = defineApp<{
  Resources: {
    counter: {
      Key: { id: string };
      State: CounterState;
      Events: {
        incremented: { amount: number };
      };
      Views: {
        count: number;
      };
      Commands: {
        increment: {
          Input: { amount: number };
          Event: "incremented";
          Error: "negative";
        };
      };
    };
  };
}>({
  version: 1,
  resources: {
    counter: {
      state: { count: 0 },
      events: {
        incremented({ state, payload }) {
          state.count += payload.amount;
        },
      },
      views: {
        count({ state }) {
          return state.count;
        },
      },
      commands: {
        increment(ctx, { amount }) {
          if (amount < 0) return ctx.error("negative");
          return ctx.event.incremented({ amount });
        },
      },
    },
  },
});

describe("testApp", () => {
  it("runs command/event/view assertions without a server", async () => {
    const runtime = testApp(api);
    const counter = runtime.resource("counter", { id: "local" });

    await counter.increment({ amount: 3 });

    expect(counter.count).toBe(3);
    expect(counter.view.count).toBe(3);
    expect(counter.events()).toMatchObject([
      {
        resource: "counter",
        event: {
          version: 1,
          name: "incremented",
          payload: { amount: 3 },
        },
      },
    ]);
  });

  it("returns typed command errors", async () => {
    const runtime = testApp(api);
    const counter = runtime.resource("counter", { id: "local" });

    const receipt = await counter.increment({ amount: -1 });

    expect(receipt).toEqual({ ok: false, error: "negative", data: undefined });
    expect(counter.count).toBe(0);
  });

  it("enforces the same Resource authorization contract as the live runtime", async () => {
    const secured = defineApp<{
      Actor: { id: string };
      Resources: {
        secret: {
          Key: string;
          State: { value: string };
          Events: { changed: { value: string } };
          Views: { value: string };
          Commands: { change: { Input: { value: string }; Event: "changed" } };
        };
      };
    }>({
      version: 1,
      resources: {
        secret: {
          state: { value: "classified" },
          authorize: ({ actor, key }) => actor.id === key,
          events: {
            changed({ state, payload }) {
              state.value = payload.value;
            },
          },
          views: { value: ({ state }) => state.value },
          commands: {
            change(context, { value }) {
              context.event.changed({ value });
            },
          },
        },
      },
    });
    const owner = testApp(secured, { actor: { id: "owner" } }).resource("secret", "owner");
    expect(await owner.change({ value: "updated" })).toEqual({ ok: true, cursor: 1 });
    expect(owner.value).toBe("updated");

    const intruder = testApp(secured, { actor: { id: "intruder" } }).resource("secret", "owner");
    expect(await intruder.change({ value: "stolen" })).toEqual({ ok: false, error: "forbidden" });
    expect(() => intruder.value).toThrow("Read is forbidden");
  });
});

describe("testFeature", () => {
  it("tests a nested Feature exclusively through its curated semantic API", async () => {
    type CounterFeature = {
      Resources: {
        counter: {
          Key: string;
          State: { count: number };
          Events: { incremented: { amount: number } };
          Views: { count: number };
          Commands: { increment: { Input: { amount: number }; Event: "incremented" } };
        };
      };
      Components: {};
      API: {
        readonly counter: (key: string) => {
          readonly count: number;
          readonly increment: (input: { amount: number }) => Submission;
        };
        readonly observe: (key: string, observer: (count: number) => void) => () => void;
      };
    };
    type FeatureApp = { Resources: {}; Features: { counters: CounterFeature } };
    const counters = {
      resources: {
        counter: {
          state: { count: 0 },
          events: {
            incremented: ({ state, payload }) => void (state.count += payload.amount),
          },
          views: { count: ({ state }) => state.count },
          commands: {
            increment: (context, { amount }) => context.event.incremented({ amount }),
          },
        },
      },
      features: {},
      api: ({ resources }) => ({
        counter: resources.counter,
        observe: (key, observer) =>
          resources.counter(key).subscribe(({ count }) => observer(count)),
      }),
      components: {},
    } satisfies FeatureDef<FeatureApp, CounterFeature>;
    const app = defineApp<FeatureApp>({
      version: 1,
      resources: {},
      features: { counters },
    });

    const feature = await testFeature(app, "counters");
    const counter = feature.api.counter("one");
    const observed: number[] = [];
    const subscribed: number[] = [];
    const events: string[] = [];
    const stopEvents = feature.observeEvents(({ event }) => events.push(event.name));
    const stop = feature.observe(
      (semantic) => semantic.counter("one").count,
      (count) => observed.push(count),
    );
    const stopSubscribed = feature.api.observe("one", (count) => subscribed.push(count));
    expect(await counter.increment({ amount: 4 })).toEqual({ ok: true, cursor: 1 });
    expect(counter.count).toBe(4);
    expect(observed).toEqual([0, 4]);
    expect(subscribed).toEqual([0, 4]);
    expect(events).toEqual(["incremented"]);
    stop();
    stopSubscribed();
    stopEvents();
    await counter.increment({ amount: 1 });
    expect(observed).toEqual([0, 4]);
    expect(subscribed).toEqual([0, 4]);
    expect(events).toEqual(["incremented"]);
    expect(feature).not.toHaveProperty("resources");
    await feature.dispose();
    expect(() =>
      feature.observe(
        () => 0,
        () => undefined,
      ),
    ).toThrow("disposed");
  });

  it("runs nested Programs with their owner-scoped dependencies", async () => {
    type WorkerFeature = {
      Resources: {
        jobs: {
          Key: string;
          State: { input: number; output: number | null };
          Events: { requested: { input: number }; completed: { output: number } };
          Views: { output: number | null };
          Commands: {
            request: { Input: { input: number }; Event: "requested" };
            complete: { Input: { output: number }; Event: "completed" };
          };
        };
      };
      Components: {};
      Dependencies: { server: { math: { double(value: number): number } } };
      Programs: {
        server: {
          double: { Events: readonly ["jobs.requested"] };
        };
      };
      API: {
        job(id: string): {
          readonly output: number | null;
          request(input: { input: number }): Submission;
        };
      };
    };
    type ParentFeature = {
      Resources: {};
      Components: {};
      Features: { worker: WorkerFeature };
      API: WorkerFeature["API"];
    };
    type NestedApp = { Resources: {}; Features: { parent: ParentFeature } };
    const worker = {
      resources: {
        jobs: {
          state: { input: 0, output: null },
          events: {
            requested: ({ state, payload }) => {
              state.input = payload.input;
              state.output = null;
            },
            completed: ({ state, payload }) => void (state.output = payload.output),
          },
          views: { output: ({ state }) => state.output },
          commands: {
            request: (context, { input }) => context.event.requested({ input }),
            complete: (context, { output }) => context.event.completed({ output }),
          },
        },
      },
      features: {},
      dependencies: { server: { math: { double: (value) => value * 2 } } },
      programs: {
        server: {
          double: {
            source: {
              events: ["jobs.requested"],
              replay: "all",
              version: 1,
              keyBy: "resource",
            },
            async handle({ event, jobs }, { math }) {
              await jobs.complete.identified(`complete:${event.id}`, {
                output: math.double(event.payload.input),
              });
            },
          },
        },
      },
      api: ({ resources }) => ({ job: resources.jobs }),
      components: {},
    } satisfies FeatureDef<NestedApp, WorkerFeature>;
    const parent = {
      resources: {},
      features: { worker },
      api: ({ features }) => features.worker,
      components: {},
    } satisfies FeatureDef<NestedApp, ParentFeature>;
    const app = defineApp<NestedApp>({ version: 1, resources: {}, features: { parent } });
    const feature = await testFeature(app, "parent");

    const job = feature.api.job("one");
    await job.request({ input: 21 });
    await feature.drain();
    expect(job.output).toBe(42);
    await feature.restart();
    await feature.drain();
    expect(job.output).toBe(42);

    for (const phase of ["before", "after"] as const) {
      const interrupted = feature.api.job(`interrupted-${phase}`);
      feature.interruptNextProgramCommand({
        phase,
        command: "complete",
      });
      await interrupted.request({ input: 21 });
      await expect(feature.drain()).rejects.toThrow(
        new RegExp(`Interrupted .*\\.complete ${phase} the command decision\\.`),
      );
      await feature.restart();

      expect(interrupted.output).toBe(42);
      expect(
        feature
          .events()
          .filter(({ key, event }) => key === `interrupted-${phase}` && event.name === "completed"),
      ).toHaveLength(1);
    }
    await feature.dispose();
  });

  it("replaces Feature dependencies before normal lifecycle startup", async () => {
    type Clock = { now(): number };
    type ClockFeature = {
      Resources: {};
      Components: {};
      Dependencies: { server: { clock: Clock } };
      API: {};
    };
    type ClockApp = { Resources: {}; Features: { clock: ClockFeature } };
    let normalStarts = 0;
    const clock = {
      resources: {},
      features: {},
      dependencies: {
        server: {
          clock: {
            kind: "dependency",
            start() {
              normalStarts += 1;
              return { now: () => 1 };
            },
          },
        },
      },
      api: () => ({}),
      components: {},
    } satisfies FeatureDef<ClockApp, ClockFeature>;
    const app = defineApp<ClockApp>({ version: 1, resources: {}, features: { clock } });

    const feature = await testFeature(app, "clock", {
      dependencies: { server: { clock: { now: () => 42 } } },
    });

    expect(normalStarts).toBe(0);
    expect(feature.dependencies.server.clock.now()).toBe(42);
    await feature.dispose();
  });
});
