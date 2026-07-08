import { afterEach, describe, expect, it } from "bun:test";
import { defineApp } from "../src/app";
import { connect } from "../src/client";
import { serve } from "../src/server";
import { createMemoryWorkerDurabilityStore } from "../src/worker";
import { createMemoryClientStore, createMemoryStore } from "./helpers/memory-storage";
import { poll, wait } from "./helpers/wait";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatState = {
  messages: Message[];
  status: "idle" | "generating";
};

type Deps = {
  ai: {
    calls: Message[][];
    generate(messages: Message[]): Promise<string>;
  };
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
  Environments: {
    browser: {
      Deps: Deps;
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
  programs: {
    async browser({ events, signal }, deps) {
      for await (const { chat, event, view } of events("chat.messageSent", {
        id: "chat.generate",
        signal,
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

function fakeDeps(text: string): Deps {
  return {
    ai: {
      calls: [],
      async generate(messages) {
        this.calls.push(messages);
        return text;
      },
    },
  };
}

describe("e2e: environment programs", () => {
  let handle: ReturnType<typeof serve> | null = null;

  afterEach(() => {
    if (handle) {
      handle.stop();
      handle = null;
    }
  });

  function startServer(opts: {
    deps?: Deps;
    serverStorage?: ReturnType<typeof createMemoryStore>;
    programStore?: ReturnType<typeof createMemoryWorkerDurabilityStore>;
    withProgram?: boolean;
  }) {
    const serverStorage = opts.serverStorage ?? createMemoryStore();
    const programStore = opts.programStore ?? createMemoryWorkerDurabilityStore();
    const withProgram = opts.withProgram ?? true;
    handle = serve(api, {
      port: 0,
      storage: serverStorage,
      snapshotIntervalMs: 60000,
      programs:
        withProgram && opts.deps
          ? [
              {
                env: "browser",
                program: api.def.programs!.browser!,
                deps: opts.deps,
                programId: "test-program",
                actor: { id: "test-program" },
                store: programStore,
              },
            ]
          : undefined,
    });
    return { url: handle.url, serverStorage, programStore };
  }

  async function connectClient(url: URL) {
    const client = await connect(api, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-user",
      storage: createMemoryClientStore(),
      reconnectMs: 99999,
      persistIntervalMs: 99999,
    });
    const chat = client.chat({ sessionId: "test" });
    let synced = false;
    chat.subscribe(() => {
      synced = true;
    });
    await poll(() => synced);
    return { client, chat };
  }

  it("runs the app environment program in the server process", async () => {
    const deps = fakeDeps("hello from program");
    const { url } = startServer({ deps });
    const { client, chat } = await connectClient(url);

    await chat.sendMessage("hello");

    await poll(() => chat.messages.some((message) => message.role === "assistant"));
    expect(deps.ai.calls).toHaveLength(1);
    expect(chat.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hello from program" },
    ]);

    client.dispose();
  });

  it("processes events committed before the program was running", async () => {
    const deps = fakeDeps("caught up");
    const serverStorage = createMemoryStore();
    const programStore = createMemoryWorkerDurabilityStore();

    let started = startServer({
      serverStorage,
      programStore,
      withProgram: false,
    });
    let connected = await connectClient(started.url);

    await connected.chat.sendMessage("program was absent");
    await poll(() =>
      connected.chat.messages.some(
        (message) => message.role === "user" && message.content === "program was absent",
      ),
    );
    connected.client.dispose();
    handle?.stop();
    handle = null;

    started = startServer({ deps, serverStorage, programStore });
    connected = await connectClient(started.url);

    await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));

    expect(deps.ai.calls).toHaveLength(1);
    expect(connected.chat.messages).toMatchObject([
      { role: "user", content: "program was absent" },
      { role: "assistant", content: "caught up" },
    ]);

    connected.client.dispose();
  });

  it("does not duplicate a completed program effect after server restart", async () => {
    const deps = fakeDeps("only once");
    const serverStorage = createMemoryStore();
    const programStore = createMemoryWorkerDurabilityStore();

    let started = startServer({ deps, serverStorage, programStore });
    let connected = await connectClient(started.url);

    await connected.chat.sendMessage("hello");
    await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));
    connected.client.dispose();
    handle?.stop();
    handle = null;

    started = startServer({ deps, serverStorage, programStore });
    connected = await connectClient(started.url);
    await wait(100);

    expect(deps.ai.calls).toHaveLength(1);
    expect(connected.chat.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "only once" },
    ]);

    connected.client.dispose();
  });
});
