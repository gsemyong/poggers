import { defineApp, type SessionData } from "#kernel/app";

export type TestActor = {
  id: string;
  name: string;
};

export type CounterState = {
  count: number;
};

export type CounterEvents = {
  incremented: { amount: number };
  decremented: { amount: number };
  reset: Record<string, never>;
};

export type CounterViews = {
  count: number;
  isPositive: boolean;
  sessions: SessionData<TestActor, TestPresence>[];
};

type TestPresence = { cursor?: { line: number; col: number }; status?: string };

export type CounterCommands = {
  increment: {
    Input: { amount: number };
    Event: "incremented";
    Error: never;
  };
  decrement: {
    Input: { amount: number };
    Event: "decremented";
    Error: never;
  };
  reset: {
    Input: {};
    Event: "reset";
    Error: never;
  };
  emitTwoEvents: {
    Input: {};
    Event: "incremented";
    Error: never;
  };
  throwError: {
    Input: {};
    Error: never;
  };
};

export type DocState = {
  title: string;
  body: string;
};

export type DocEvents = {
  titleChanged: { title: string };
  bodyChanged: { body: string };
  cleared: Record<string, never>;
};

export type DocViews = {
  title: string;
  body: string;
  sessions: SessionData<TestActor, TestPresence>[];
};

export type DocCommands = {
  changeTitle: {
    Input: { title: string };
    Event: "titleChanged";
    Error: never;
  };
  changeBody: {
    Input: { body: string };
    Event: "bodyChanged";
    Error: never;
  };
  clear: {
    Input: {};
    Event: "cleared";
    Error: never;
  };
};

export function createTestApp(token: string = "test-token") {
  return defineApp<{
    Actor: TestActor;
    Resources: {
      counter: {
        Key: { counterId: string };
        State: CounterState;
        Presence: TestPresence;
        Events: CounterEvents;
        Views: CounterViews;
        Commands: CounterCommands;
      };
      doc: {
        Key: { docId: string };
        State: DocState;
        Presence: TestPresence;
        Events: DocEvents;
        Views: DocViews;
        Commands: DocCommands;
      };
    };
  }>({
    version: 1,
    identify({ token: t }) {
      if (t === token) return { id: "test-user", name: "Test User" };
      return null;
    },
    resources: {
      counter: {
        state: { count: 0 },
        presence: {},
        events: {
          incremented({ state, payload }) {
            state.count += payload.amount;
          },
          decremented({ state, payload }) {
            state.count -= payload.amount;
          },
          reset({ state }) {
            state.count = 0;
          },
        },
        views: {
          count({ state }) {
            return state.count;
          },
          isPositive({ state }) {
            return state.count > 0;
          },
          sessions({ sessions }) {
            return sessions;
          },
        },
        commands: {
          increment(ctx, { amount }) {
            return ctx.event.incremented({ amount });
          },
          decrement(ctx, { amount }) {
            return ctx.event.decremented({ amount });
          },
          reset(ctx) {
            return ctx.event.reset({});
          },
          emitTwoEvents(ctx) {
            ctx.event.incremented({ amount: 1 });
            return ctx.event.incremented({ amount: 2 });
          },
          throwError() {
            throw new Error("test error");
          },
        },
      },
      doc: {
        state: { title: "", body: "" },
        presence: {},
        events: {
          titleChanged({ state, payload }) {
            state.title = payload.title;
          },
          bodyChanged({ state, payload }) {
            state.body = payload.body;
          },
          cleared({ state }) {
            state.title = "";
            state.body = "";
          },
        },
        views: {
          title({ state }) {
            return state.title;
          },
          body({ state }) {
            return state.body;
          },
          sessions({ sessions }) {
            return sessions;
          },
        },
        commands: {
          changeTitle(ctx, { title }) {
            return ctx.event.titleChanged({ title });
          },
          changeBody(ctx, { body }) {
            return ctx.event.bodyChanged({ body });
          },
          clear(ctx) {
            return ctx.event.cleared({});
          },
        },
      },
    },
  });
}
