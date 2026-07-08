import { defineApp } from "../../src/app";

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
  sessions: any[];
};

export type CounterCommands = {
  increment: {
    args: [amount: number];
    event: "incremented";
    error: never;
  };
  decrement: {
    args: [amount: number];
    event: "decremented";
    error: never;
  };
  reset: {
    args: [];
    event: "reset";
    error: never;
  };
  emitTwoEvents: {
    args: [];
    event: "incremented";
    error: never;
  };
  throwError: {
    args: [];
    error: never;
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
  sessions: any[];
};

export type DocCommands = {
  changeTitle: {
    args: [title: string];
    event: "titleChanged";
    error: never;
  };
  changeBody: {
    args: [body: string];
    event: "bodyChanged";
    error: never;
  };
  clear: {
    args: [];
    event: "cleared";
    error: never;
  };
  setStatus: {
    args: [status: string];
    error: never;
  };
  setStatusAndThrow: {
    args: [status: string];
    error: never;
  };
};

export function createTestApp(token: string = "test-token") {
  return defineApp<{
    Actor: TestActor;
    Resources: {
      counter: {
        Key: { counterId: string };
        State: CounterState;
        Presence: { cursor?: { line: number; col: number }; status?: string };
        Events: CounterEvents;
        Views: CounterViews;
        Commands: CounterCommands;
      };
      doc: {
        Key: { docId: string };
        State: DocState;
        Presence: { cursor?: { line: number; col: number }; status?: string };
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
          sessions({ sessions }: any) {
            return sessions;
          },
        },
        commands: {
          increment(ctx, amount) {
            return ctx.event.incremented({ amount });
          },
          decrement(ctx, amount) {
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
          sessions({ sessions }: any) {
            return sessions;
          },
        },
        commands: {
          changeTitle(ctx, title) {
            return ctx.event.titleChanged({ title });
          },
          changeBody(ctx, body) {
            return ctx.event.bodyChanged({ body });
          },
          clear(ctx) {
            return ctx.event.cleared({});
          },
          setStatus(ctx, status) {
            ctx.setPresence({ status });
          },
          setStatusAndThrow(ctx, status) {
            ctx.setPresence({ status });
            throw new Error("test presence throw");
          },
        },
      },
    },
  });
}
