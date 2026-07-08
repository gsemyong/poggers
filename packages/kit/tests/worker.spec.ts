import { describe, expect, it } from "bun:test";
import { defineApp, type App } from "../src/app";
import { scopeId } from "../src/protocol";
import {
  createMemoryWorkerDurabilityStore,
  createMemoryWorkerStore,
  defineWorker,
  startProgramRuntime,
  testWorker,
  type WorkerRuntimeEvent,
} from "../src/worker";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatState = {
  messages: Message[];
  status: "idle" | "generating";
};

const api = defineApp<{
  Resources: {
    chat: {
      Key: { sessionId: string };
      State: ChatState;
      Events: {
        messageSent: { messageId: string; text: string };
        generationCompleted: { messageId: string; text: string };
      };
      Views: {
        messages: Message[];
        status: ChatState["status"];
      };
      Commands: {
        sendMessage: {
          args: [text: string];
          event: "messageSent";
          error: "empty";
        };
        completeGeneration: {
          args: [data: { messageId: string; text: string }];
          event: "generationCompleted";
          error: "duplicate";
        };
      };
    };
  };
}>({
  version: 1,
  resources: {
    chat: {
      state: {
        messages: [],
        status: "idle",
      },
      events: {
        messageSent({ state, payload }) {
          state.messages.push({
            id: payload.messageId,
            role: "user",
            content: payload.text,
          });
          state.status = "generating";
        },
        generationCompleted({ state, payload }) {
          if (state.messages.some((message) => message.id === payload.messageId)) return;
          state.messages.push({
            id: payload.messageId,
            role: "assistant",
            content: payload.text,
          });
          state.status = "idle";
        },
      },
      views: {
        messages({ state }) {
          return state.messages;
        },
        status({ state }) {
          return state.status;
        },
      },
      commands: {
        sendMessage(ctx, text) {
          if (!text.trim()) return ctx.error("empty");
          return ctx.event.messageSent({
            messageId: ctx.id(),
            text,
          });
        },
        completeGeneration(ctx, data) {
          if (ctx.state.messages.some((message) => message.id === data.messageId)) {
            return ctx.error("duplicate");
          }
          return ctx.event.generationCompleted(data);
        },
      },
    },
  },
});

type Deps = {
  ai: {
    generate(messages: Message[]): Promise<string>;
    calls: Message[][];
  };
};

const worker = defineWorker(api)<Deps>(({ useChat, on }, deps) => {
  const chat = useChat({ sessionId: "test" });

  on(chat.events.messageSent, { id: "chat.generate" }, async ({ event, view }) => {
    const text = await deps.ai.generate(view.messages);
    await chat.completeGeneration({
      messageId: `assistant:${event.id}`,
      text,
    });
  });
});

type ApiSpec = typeof api extends App<infer Spec> ? Spec : never;

type ProgramSpec = ApiSpec & {
  Environments: {
    browser: {
      Deps: Deps;
    };
  };
};

const programApi = defineApp<ProgramSpec>({
  version: api.def.version,
  resources: api.def.resources as never,
  programs: {
    async browser({ events }, deps) {
      for await (const { chat, event, view } of events("chat.messageSent", {
        id: "chat.generate",
      })) {
        const text = await deps.ai.generate(view.messages);
        await chat.completeGeneration({
          messageId: `assistant:${event.id}`,
          text,
        });
      }
    },
  },
});

const multiConsumerProgramApi = defineApp<ProgramSpec>({
  version: api.def.version,
  resources: api.def.resources as never,
  programs: {
    async browser({ events }, deps) {
      await Promise.all([
        (async () => {
          for await (const { chat, event, view } of events("chat.messageSent", {
            id: "chat.generate.first",
          })) {
            const text = await deps.ai.generate(view.messages);
            await chat.completeGeneration({
              messageId: `assistant:first:${event.id}`,
              text,
            });
          }
        })(),
        (async () => {
          for await (const { chat, event, view } of events("chat.messageSent", {
            id: "chat.generate.second",
          })) {
            const text = await deps.ai.generate(view.messages);
            await chat.completeGeneration({
              messageId: `assistant:second:${event.id}`,
              text,
            });
          }
        })(),
      ]);
    },
  },
});

function fakeAI(text: string): Deps["ai"] {
  return {
    calls: [],
    async generate(messages) {
      this.calls.push(messages);
      return text;
    },
  };
}

function createProgramHarness(
  app: App<ProgramSpec>,
  deps: Deps,
  opts: {
    store?: ReturnType<typeof createMemoryWorkerDurabilityStore>;
    events?: WorkerRuntimeEvent<ProgramSpec>[];
  } = {},
) {
  const actor = { id: "program-test" };
  const states = new Map<string, any>();
  const seqs = new Map<string, number>();
  const events: WorkerRuntimeEvent<ProgramSpec>[] = [];
  const store = opts.store ?? createMemoryWorkerDurabilityStore();

  let runtime!: ReturnType<typeof startProgramRuntime<ProgramSpec, "browser">>;

  function getState(resource: "chat", key: { sessionId: string }) {
    const id = scopeId(resource, key);
    let state = states.get(id);
    if (!state) {
      state = app.createState(resource);
      states.set(id, state);
      seqs.set(id, 0);
    }
    return state;
  }

  function readViews(resource: "chat", key: { sessionId: string }) {
    const state = getState(resource, key);
    return {
      messages: app.def.resources.chat.views!.messages({
        state,
        actor,
        sessions: [],
        key,
      }),
      status: app.def.resources.chat.views!.status({
        state,
        actor,
        sessions: [],
        key,
      }),
    };
  }

  async function command(
    resource: "chat",
    key: { sessionId: string },
    commandName: keyof ProgramSpec["Resources"]["chat"]["Commands"] & string,
    args: any[],
    _commandId: string,
  ) {
    const id = scopeId(resource, key);
    const state = getState(resource, key);
    const collected: Array<{
      id: string;
      seq: number;
      at: number;
      actor: { id: string };
      name: string;
      payload: unknown;
    }> = [];
    const commandResult: { error?: string; data?: unknown } = {};

    app.runCommand(
      resource,
      state,
      actor,
      key,
      commandName,
      args,
      (event) => collected.push(event),
      () => {},
      (error, data) => {
        commandResult.error = error;
        commandResult.data = data;
      },
    );

    if (commandResult.error) {
      return { ok: false as const, error: commandResult.error, data: commandResult.data };
    }

    let cursor = seqs.get(id) ?? 0;
    const committed: WorkerRuntimeEvent<ProgramSpec>[] = [];
    for (const event of collected) {
      cursor += 1;
      const stored: WorkerRuntimeEvent<ProgramSpec> = {
        resource,
        key,
        event: {
          id: event.id,
          seq: cursor,
          at: event.at,
          version: app.def.version,
          actor,
          name: event.name,
          payload: event.payload,
        },
      };
      app.applyEvent(
        resource,
        state,
        {
          id: stored.event.id,
          seq: stored.event.seq,
          at: stored.event.at,
          actor,
          name: stored.event.name,
          payload: stored.event.payload,
        },
        stored.event.version,
      );
      events.push(stored);
      committed.push(stored);
    }
    seqs.set(id, cursor);
    if (committed.length > 0) runtime.enqueue(committed);

    return { ok: true as const, cursor };
  }

  for (const stored of opts.events ?? []) {
    const state = getState(stored.resource, stored.key as { sessionId: string });
    app.applyEvent(
      stored.resource,
      state,
      {
        id: stored.event.id,
        seq: stored.event.seq,
        at: stored.event.at,
        actor: stored.event.actor,
        name: stored.event.name,
        payload: stored.event.payload,
      },
      stored.event.version,
    );
    events.push(stored);
    seqs.set(
      scopeId(stored.resource, stored.key),
      Math.max(seqs.get(scopeId(stored.resource, stored.key)) ?? 0, stored.event.seq),
    );
  }

  runtime = startProgramRuntime(app, app.def.programs!.browser!, {
    env: "browser",
    deps,
    programId: "program-test",
    actor,
    store,
    readViews: readViews as never,
    command: command as never,
  });

  return {
    events,
    runtime,
    store,
    chat: {
      async sendMessage(text: string) {
        return command("chat", { sessionId: "test" }, "sendMessage", [text], crypto.randomUUID());
      },
      get view() {
        return readViews("chat", { sessionId: "test" });
      },
    },
    replay() {
      runtime.enqueue(events);
    },
  };
}

describe("defineWorker", () => {
  it("runs worker handlers with injected dependencies", async () => {
    const ai = fakeAI("hello back");
    const runtime = testWorker(api, worker, { deps: { ai } });
    const chat = runtime.resource("chat", { sessionId: "test" });

    await chat.sendMessage("hello");
    await runtime.drain();

    expect(ai.calls).toHaveLength(1);
    expect(chat.view.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hello back" },
    ]);
    expect(chat.view.status).toBe("idle");
  });

  it("replays missed events and skips completed handlers after restart", async () => {
    const store = createMemoryWorkerStore<ApiSpec>();
    const ai = fakeAI("once");

    const firstRuntime = testWorker(api, worker, { deps: { ai }, store });
    const firstChat = firstRuntime.resource("chat", { sessionId: "test" });

    await firstChat.sendMessage("hello");
    await firstRuntime.drain();
    await firstRuntime.stop();

    const secondRuntime = testWorker(api, worker, { deps: { ai }, store });
    const secondChat = secondRuntime.resource("chat", { sessionId: "test" });
    await secondRuntime.drain();

    expect(ai.calls).toHaveLength(1);
    expect(secondChat.view.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "once" },
    ]);
  });

  it("upcasts old missed events before matching worker handlers", async () => {
    type V1State = { messages: string[] };
    const v1 = defineApp<{
      Resources: {
        chat: {
          Key: { sessionId: string };
          State: V1State;
          Events: {
            sent: { text: string };
          };
          Views: {
            messages: string[];
          };
          Commands: {};
        };
      };
    }>({
      version: 1,
      resources: {
        chat: {
          state: { messages: [] },
          events: {
            sent({ state, payload }) {
              state.messages.push(payload.text);
            },
          },
          views: {
            messages({ state }) {
              return state.messages;
            },
          },
        },
      },
    });

    const v2 = defineApp<
      {
        Resources: {
          chat: {
            Key: { sessionId: string };
            State: V1State;
            Events: {
              messageSent: { text: string; source: "user" };
            };
            Views: {
              messages: string[];
            };
            Commands: {};
          };
        };
      },
      typeof v1
    >({
      version: 2,
      previous: v1,
      migrate: {
        event: {
          chat(name, payload) {
            if (name === "sent") {
              return {
                name: "messageSent",
                payload: { ...payload, source: "user" },
              };
            }
            return { name, payload };
          },
        },
      },
      resources: {
        chat: {
          state: { messages: [] },
          events: {
            messageSent({ state, payload }) {
              state.messages.push(`${payload.source}:${payload.text}`);
            },
          },
          views: {
            messages({ state }) {
              return state.messages;
            },
          },
        },
      },
    });

    const seen: Array<{ text: string; source: "user" }> = [];
    const migratedWorker = defineWorker(v2)<{ seen: typeof seen }>(({ useChat, on }, deps) => {
      const chat = useChat({ sessionId: "old" });
      on(chat.events.messageSent, ({ event }) => {
        deps.seen.push(event.payload);
      });
    });
    const store = createMemoryWorkerStore<typeof v2 extends App<infer Spec> ? Spec : never>();
    store.events.push({
      resource: "chat",
      key: { sessionId: "old" },
      event: {
        id: "evt-old",
        seq: 1,
        at: 100,
        version: 1,
        actor: { id: "old-user" },
        name: "sent",
        payload: { text: "hello from v1" },
      },
    });

    const runtime = testWorker(v2, migratedWorker, { deps: { seen }, store });
    const chat = runtime.resource("chat", { sessionId: "old" });
    await runtime.drain();

    expect(seen).toEqual([{ text: "hello from v1", source: "user" }]);
    expect(chat.view.messages).toEqual(["user:hello from v1"]);
  });
});

describe("environment programs", () => {
  it("streams live events into a persistent program", async () => {
    const ai = fakeAI("hello from program");
    const harness = createProgramHarness(programApi, { ai });

    await harness.chat.sendMessage("hello");
    await harness.runtime.drain();

    expect(ai.calls).toHaveLength(1);
    expect(harness.chat.view.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hello from program" },
    ]);

    await harness.runtime.stop();
  });

  it("does not duplicate a completed program effect after restart", async () => {
    const ai = fakeAI("only once");
    const store = createMemoryWorkerDurabilityStore();
    const first = createProgramHarness(programApi, { ai }, { store });

    await first.chat.sendMessage("hello");
    await first.runtime.drain();
    await first.runtime.stop();

    const second = createProgramHarness(programApi, { ai }, { store, events: first.events });
    second.replay();
    await second.runtime.drain();

    expect(ai.calls).toHaveLength(1);
    expect(second.chat.view.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "only once" },
    ]);

    await second.runtime.stop();
  });

  it("keeps durable consumers independent for the same event", async () => {
    const ai = fakeAI("two consumers");
    const harness = createProgramHarness(multiConsumerProgramApi, { ai });

    await harness.chat.sendMessage("hello");
    await harness.runtime.drain();

    expect(ai.calls).toHaveLength(2);
    expect(harness.chat.view.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "two consumers" },
      { role: "assistant", content: "two consumers" },
    ]);

    await harness.runtime.stop();
  });
});
