import { afterEach, describe, expect, it } from "bun:test";
import { defineApp } from "infra/app";
import { connect } from "infra/client";
import { scopeId } from "infra/protocol";
import { serve } from "infra/server";
import { createSingleNodeAdapter } from "infra/store/single-node";
import { createMemoryWorkerDurabilityStore, defineWorker } from "infra/worker";
import { createMemoryClientStore, createMemoryStore } from "tests/helpers/memory-storage";
import { poll, wait } from "tests/helpers/wait";

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
    calls: Message[][];
    generate(messages: Message[]): Promise<string>;
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

type CrashyDeps = {
  calls: number;
  fail: boolean;
};

const crashyWorker = defineWorker(api)<CrashyDeps>(({ useChat, on }, deps) => {
  const chat = useChat({ sessionId: "test" });

  on(chat.events.messageSent, { id: "chat.crashy-generate" }, async ({ event }) => {
    deps.calls++;
    if (deps.fail) throw new Error("worker unavailable");
    await chat.completeGeneration({
      messageId: `assistant:${event.id}`,
      text: "recovered",
    });
  });
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

describe("e2e: worker runtime", () => {
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
    workerStore?: ReturnType<typeof createMemoryWorkerDurabilityStore>;
    withWorker?: boolean;
    snapshotIntervalMs?: number;
  }) {
    const serverStorage = opts.serverStorage ?? createMemoryStore();
    const workerStore = opts.workerStore ?? createMemoryWorkerDurabilityStore();
    const withWorker = opts.withWorker ?? true;
    handle = serve(api, {
      port: 0,
      adapter: createSingleNodeAdapter(serverStorage),
      snapshotIntervalMs: opts.snapshotIntervalMs ?? 60000,
      workers:
        withWorker && opts.deps
          ? [
              {
                worker,
                deps: opts.deps,
                workerId: "test-worker",
                actor: { id: "test-worker" },
                store: workerStore,
              },
            ]
          : undefined,
    });
    return { url: handle.url, serverStorage, workerStore };
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

  it("runs a dependency-injected worker in the server process", async () => {
    const deps = fakeDeps("hello from worker");
    const { url } = startServer({ deps });
    const { client, chat } = await connectClient(url);

    await chat.sendMessage("hello");

    await poll(() => chat.messages.some((message) => message.role === "assistant"));
    expect(deps.ai.calls).toHaveLength(1);
    expect(chat.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hello from worker" },
    ]);

    client.dispose();
  });

  it("processes events committed before the worker was running", async () => {
    const deps = fakeDeps("caught up");
    const serverStorage = createMemoryStore();
    const workerStore = createMemoryWorkerDurabilityStore();

    let started = startServer({
      serverStorage,
      workerStore,
      withWorker: false,
    });
    let connected = await connectClient(started.url);

    await connected.chat.sendMessage("worker was absent");
    await poll(() =>
      connected.chat.messages.some(
        (message) => message.role === "user" && message.content === "worker was absent",
      ),
    );
    connected.client.dispose();
    handle?.stop();
    handle = null;

    started = startServer({ deps, serverStorage, workerStore });
    connected = await connectClient(started.url);

    await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));

    expect(deps.ai.calls).toHaveLength(1);
    expect(connected.chat.messages).toMatchObject([
      { role: "user", content: "worker was absent" },
      { role: "assistant", content: "caught up" },
    ]);

    connected.client.dispose();
  });

  it("does not duplicate a completed worker effect after server restart", async () => {
    const deps = fakeDeps("only once");
    const serverStorage = createMemoryStore();
    const workerStore = createMemoryWorkerDurabilityStore();

    let started = startServer({ deps, serverStorage, workerStore });
    let connected = await connectClient(started.url);

    await connected.chat.sendMessage("hello");
    await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));
    connected.client.dispose();
    handle?.stop();
    handle = null;

    started = startServer({ deps, serverStorage, workerStore });
    connected = await connectClient(started.url);
    await wait(100);

    expect(deps.ai.calls).toHaveLength(1);
    expect(connected.chat.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "only once" },
    ]);

    connected.client.dispose();
  });

  it("keeps events until a configured worker checkpoint catches up", async () => {
    const serverStorage = createMemoryStore();
    const workerStore = createMemoryWorkerDurabilityStore();
    const deps: CrashyDeps = { calls: 0, fail: true };
    const chatScopeId = scopeId("chat", { sessionId: "test" });
    const origError = console.error;
    console.error = () => {};

    try {
      handle = serve(api, {
        port: 0,
        adapter: createSingleNodeAdapter(serverStorage),
        snapshotIntervalMs: 50,
        workers: [
          {
            worker: crashyWorker,
            deps,
            workerId: "crashy-worker",
            actor: { id: "crashy-worker" },
            store: workerStore,
          },
        ],
      });

      let connected = await connectClient(handle.url);
      await connected.chat.sendMessage("worker will crash");
      await poll(() =>
        connected.chat.messages.some(
          (message) => message.role === "user" && message.content === "worker will crash",
        ),
      );
      await poll(() => deps.calls >= 1);
      await wait(200);

      expect(serverStorage.loadSnapshot(chatScopeId)?.seq).toBeGreaterThanOrEqual(1);
      expect(serverStorage.getEvents(chatScopeId).length).toBeGreaterThanOrEqual(1);

      connected.client.dispose();
      handle.stop();
      handle = null;

      deps.fail = false;
      handle = serve(api, {
        port: 0,
        adapter: createSingleNodeAdapter(serverStorage),
        snapshotIntervalMs: 50,
        workers: [
          {
            worker: crashyWorker,
            deps,
            workerId: "crashy-worker",
            actor: { id: "crashy-worker" },
            store: workerStore,
          },
        ],
      });

      connected = await connectClient(handle.url);
      await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));

      expect(deps.calls).toBeGreaterThanOrEqual(2);
      expect(connected.chat.messages).toMatchObject([
        { role: "user", content: "worker will crash" },
        { role: "assistant", content: "recovered" },
      ]);

      connected.client.dispose();
    } finally {
      console.error = origError;
    }
  });
});
