import { describe, expect, it } from "bun:test";
import { defineApp } from "../src/app";
import { testApp } from "../src/testing";

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
          args: [amount: number];
          event: "incremented";
          error: "negative";
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
        increment(ctx, amount) {
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

    await counter.increment(3);

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

    const receipt = await counter.increment(-1);

    expect(receipt).toEqual({ ok: false, error: "negative", data: undefined });
    expect(counter.count).toBe(0);
  });
});
