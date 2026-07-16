import { afterEach, describe, expect, it } from "bun:test";

import { serve } from "#host/server";
import { createWebSocketSyncTransport } from "#host/sync.websocket";
import { defineApp, type App } from "#kernel/app";
import { sourceSplit } from "#substrate/adapter";
import { createSingleNodeSubstrate, programAssignmentProgressId } from "#substrate/adapter.memory";
import { connect } from "#substrate/client";
import { createMemoryJournal, type Journal, type JournalAppend } from "#substrate/journal";
import {
  createJournalProgramProgressStore,
  createMemoryProgramProgressStore,
  ProgramConsumerDefinitionError,
  startProgram,
  type ProgramEventRecord,
} from "#substrate/program";
import { scopeId } from "#substrate/protocol";
import { createMemoryClientReplica } from "#testing/replica";
import { poll } from "#testing/wait";

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
    sequences: number[];
    generate(messages: Message[], idempotencyKey: string): Promise<string>;
  };
};

type TestApp = {
  Actor: { id: string };
  Resources: {
    chat: {
      Key: { ownerId: string; sessionId: string };
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
          Input: { text: string };
          Event: "messageSent";
          Error: "empty" | "unauthorized";
        };
        completeGeneration: {
          Input: { data: { messageId: string; text: string } };
          Event: "generationCompleted";
          Error: "duplicate" | "unauthorized";
        };
      };
    };
  };
  Dependencies: { browser: Deps };
  Programs: {
    browser: {
      generate: { Events: readonly ["chat.messageSent"] };
    };
  };
};

const api = defineApp<TestApp>({
  version: 1,
  resources: {
    chat: {
      state: {
        messages: [],
        status: "idle",
      },
      authorize({ actor, key }) {
        return actor.id === key.ownerId;
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
        sendMessage(ctx, { text }) {
          if (ctx.actor.id !== ctx.key.ownerId) return ctx.error("unauthorized");
          if (!text.trim()) return ctx.error("empty");
          return ctx.event.messageSent({
            messageId: ctx.id(),
            text,
          });
        },
        completeGeneration(ctx, { data }) {
          if (ctx.actor.id !== ctx.key.ownerId) return ctx.error("unauthorized");
          if (ctx.state.messages.some((message) => message.id === data.messageId)) {
            return ctx.error("duplicate");
          }
          return ctx.event.generationCompleted(data);
        },
      },
    },
  },
  dependencies: { browser: fakeDeps("normal") },
  programs: {
    browser: {
      generate: {
        source: {
          events: ["chat.messageSent"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ chat, createIdempotencyKey, event, view }, deps) {
          deps.ai.sequences.push(event.seq);
          const text = await deps.ai.generate(
            view.messages,
            createIdempotencyKey("generate-response"),
          );
          await chat.completeGeneration({
            data: {
              messageId: `assistant:${event.id}`,
              text,
            },
          });
        },
      },
    },
  },
});

type UpgradedTestApp = Omit<TestApp, "Programs"> & {
  Programs: {
    browser: {
      generate: { Events: readonly ["chat.messageSent"] };
      audit: { Events: readonly ["chat.messageSent"] };
    };
  };
};

const generateProgress = programAssignmentProgressId({
  program: "application/program/browser/generate",
  split: sourceSplit("commits/0"),
  keyGroup: 0,
});
const auditProgress = programAssignmentProgressId({
  program: "application/program/browser/audit",
  split: sourceSplit("commits/0"),
  keyGroup: 0,
});

function createUpgradedApi(audited: string[]): App<UpgradedTestApp> {
  return defineApp<UpgradedTestApp>({
    version: 1,
    resources: { chat: api.def.resources.chat },
    dependencies: { browser: fakeDeps("normal") },
    programs: {
      browser: {
        generate: {
          source: {
            events: ["chat.messageSent"],
            replay: "all",
            version: 1,
            keyBy: "resource",
          },
          async handle({ chat, createIdempotencyKey, event, view }, deps) {
            deps.ai.sequences.push(event.seq);
            const text = await deps.ai.generate(
              view.messages,
              createIdempotencyKey("generate-response"),
            );
            await chat.completeGeneration({
              data: { messageId: `assistant:${event.id}`, text },
            });
          },
        },
        audit: {
          source: {
            events: ["chat.messageSent"],
            replay: "all",
            version: 1,
            keyBy: "resource",
          },
          handle({ event }) {
            audited.push(event.id);
          },
        },
      },
    },
  });
}

function fakeDeps(text: string): Deps {
  return {
    ai: {
      calls: [],
      sequences: [],
      async generate(messages) {
        this.calls.push(messages);
        return text;
      },
    },
  };
}

describe("Program progress", () => {
  it("persists fenced attempts, uncertainty, atomic checkpoints, and source progress", async () => {
    const journal = createMemoryJournal();
    const progress = createJournalProgramProgressStore(journal, "mail");
    const cursor = { position: 8, index: 0 } as const;
    await progress.registerConsumer({
      consumerId: "consumer",
      definition: {
        events: ["mail.sent"],
        startAt: "origin",
        partition: "resource",
        version: 1,
      },
      initialSourcePosition: 0,
    });
    const first = await progress.claim({
      key: "effect:1",
      consumerId: "consumer",
      scopeId: "thread:1",
      cursor,
    });
    expect(first).toEqual({
      status: "running",
      invocation: {
        key: "effect:1",
        cursor,
        attempt: 1,
        epoch: 1,
        status: "running",
        uncertainAttempts: [],
      },
    });

    const competing = createJournalProgramProgressStore(journal, "mail");
    const second = await competing.claim({
      key: "effect:1",
      consumerId: "consumer",
      scopeId: "thread:1",
      cursor,
    });
    expect(second).toMatchObject({
      status: "running",
      invocation: { attempt: 2, epoch: 2, uncertainAttempts: [1] },
    });
    expect(
      await progress.complete({
        key: "effect:1",
        consumerId: "consumer",
        scopeId: "thread:1",
        cursor,
        epoch: 1,
      }),
    ).toBe("stale");
    expect(
      await competing.complete({
        key: "effect:1",
        consumerId: "consumer",
        scopeId: "thread:1",
        cursor,
        epoch: 2,
      }),
    ).toBe("completed");
    await progress.setSourcePosition("consumer", 12);
    await progress.setSourcePosition("consumer", 7);

    const restored = createJournalProgramProgressStore(journal, "mail");
    expect(
      await restored.claim({
        key: "effect:1",
        consumerId: "consumer",
        scopeId: "thread:1",
        cursor,
      }),
    ).toEqual({ status: "completed" });
    expect(await restored.getCheckpoint("consumer", "thread:1")).toEqual(cursor);
    expect(await restored.getInvocation("consumer", "thread:1")).toMatchObject({
      key: "effect:1",
      attempt: 2,
      epoch: 2,
      status: "completed",
      uncertainAttempts: [1],
    });
    expect(await restored.getSourcePosition("consumer")).toBe(12);
  });
});

describe("Program consumption", () => {
  it("processes every matching event emitted at one Journal position", async () => {
    const consumed: string[] = [];
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "same-position",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: ({ event }) => void consumed.push(event.payload.messageId),
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );
    const first = messageRecord("first", 1, "a");
    const second: ProgramEventRecord<TestApp> = {
      ...first,
      event: {
        ...first.event,
        id: "message:1:2",
        seq: 2,
        index: 1,
        payload: { messageId: "message:1:2", text: "second" },
      },
    };

    await runtime.enqueue([first, second]);
    await runtime.advanceSource(1);
    await runtime.drain();

    expect(consumed).toEqual(["message:1", "message:1:2"]);
    await runtime.stop();
  });

  it("does not repeat a completed delivery when the source enqueues it again", async () => {
    const consumed: string[] = [];
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "duplicate-source-delivery",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: ({ event }) => void consumed.push(event.id),
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );
    const record = messageRecord("duplicate", 1, "a");

    await runtime.enqueue(record);
    await runtime.advanceSource(1);
    await runtime.drain();
    await runtime.enqueue(record);
    await runtime.drain();

    expect(consumed).toEqual(["message:1"]);
    expect(await runtime.sourcePosition()).toBe(1);
    await runtime.stop();
  });

  it("resumes at the exact event after failure inside a multi-event record", async () => {
    const progress = createMemoryProgramProgressStore();
    const attempts: string[] = [];
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = async ({
      consume,
    }) => {
      await consume({
        id: "multi-event-restart",
        events: ["chat.messageSent"],
        startAt: "origin",
        run({ delivery, event }) {
          attempts.push(`${event.id}:${delivery.attempt}`);
          if (event.id === "message:1" && delivery.attempt === 1) {
            throw new Error("interrupt between events");
          }
        },
      });
    };
    const options = {
      env: "browser" as const,
      deps: fakeDeps("unused"),
      progress,
      readViews: () => ({ messages: [], status: "idle" }) as never,
      command: async () => ({ ok: true }) as const,
    };
    const first = messageRecord("first", 1, "a");
    const second: ProgramEventRecord<TestApp> = {
      ...first,
      event: {
        ...first.event,
        id: "message:1:2",
        seq: 2,
        index: 1,
        payload: { messageId: "message:1:2", text: "second" },
      },
    };

    let runtime = startProgram(api, program, options);
    await runtime.enqueue([first, second]);
    await runtime.advanceSource(1);
    await expect(runtime.drain()).rejects.toThrow("interrupt between events");
    expect(await runtime.sourcePosition()).toBe(0);
    await runtime.stop();

    runtime = startProgram(api, program, options);
    await runtime.enqueue([first, second]);
    await runtime.advanceSource(1);
    await runtime.drain();

    expect(attempts).toEqual(["message:1:1", "message:1:2", "message:1:2:1"]);
    expect(await runtime.sourcePosition()).toBe(1);
    await runtime.stop();
  });

  it("rejects invalid runtime consumer configuration before registration", async () => {
    const runtime = startProgram(
      api,
      ({ consume }) => {
        void consume({
          id: "invalid-concurrency",
          events: ["chat.messageSent"],
          startAt: "origin",
          concurrency: 0,
          run: () => undefined,
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    await expect(runtime.drain()).rejects.toThrow("positive integer");
    await runtime.stop();
  });

  it("rejects malformed and out-of-order source input before routing", async () => {
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "source-order",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: () => undefined,
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );
    const first = messageRecord("first", 1, "a");
    const second = messageRecord("second", 2, "a");

    await expect(runtime.enqueue([second, first])).rejects.toThrow("strict source order");
    await expect(runtime.advanceSource(-1)).rejects.toThrow("non-negative integer");
    await expect(
      runtime.enqueue({
        ...first,
        event: { ...first.event, index: -1 },
      }),
    ).rejects.toThrow("positive position and index");
    await runtime.stop();
  });

  it("observes one Resource scope through the Program lifecycle", async () => {
    const values = new Map<string, ChatState>([
      ["a", { messages: [], status: "idle" }],
      ["b", { messages: [], status: "idle" }],
    ]);
    const observed: ChatState["status"][] = [];
    let stop: () => void = () => undefined;
    const runtime = startProgram(
      api,
      ({ resources }) => {
        stop = resources.chat({ ownerId: "test-user", sessionId: "a" }).subscribe(({ status }) => {
          observed.push(status);
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: (_resource, key) => values.get(key.sessionId) as never,
        command: async () => ({ ok: true }),
      },
    );

    values.set("b", { messages: [], status: "generating" });
    await runtime.enqueue(messageRecord("unrelated", 1, "b"));
    values.set("a", { messages: [], status: "generating" });
    await runtime.enqueue(messageRecord("matching", 2, "a"));
    expect(observed).toEqual(["idle", "generating"]);

    stop();
    values.set("a", { messages: [], status: "idle" });
    await runtime.enqueue(messageRecord("stopped", 3, "a"));
    expect(observed).toEqual(["idle", "generating"]);
    await runtime.stop();
  });

  it("owns multiple declarative subscriptions after Program setup returns", async () => {
    const consumed: string[] = [];
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await Promise.all([
          consume({
            id: "first",
            events: ["chat.messageSent"],
            startAt: "origin",
            run: ({ event }) => void consumed.push(`first:${event.payload.text}`),
          }),
          consume({
            id: "second",
            events: ["chat.messageSent"],
            startAt: "origin",
            run: ({ event }) => void consumed.push(`second:${event.payload.text}`),
          }),
        ]);
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    await runtime.enqueue(messageRecord("message", 1, "a"));
    await runtime.advanceSource(1);
    await runtime.drain();

    expect(consumed.sort()).toEqual(["first:message", "second:message"]);
    await runtime.stop();
  });

  it("stops an aborting handler without failing and reclaims it as uncertain", async () => {
    const progress = createMemoryProgramProgressStore();
    const failures: unknown[] = [];
    const attempts: Array<readonly number[]> = [];
    const started = Promise.withResolvers<void>();
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = async ({
      consume,
      signal,
    }) => {
      await consume({
        id: "cooperative-stop",
        events: ["chat.messageSent"],
        startAt: "origin",
        async run({ delivery }) {
          attempts.push(delivery.uncertainAttempts);
          if (delivery.attempt > 1) return;
          started.resolve();
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      });
    };
    const start = () =>
      startProgram(api, program, {
        env: "browser",
        deps: fakeDeps("unused"),
        progress,
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
        onError: (error) => failures.push(error),
      });
    const event = messageRecord("interrupted", 1, "a");

    let runtime = start();
    await runtime.enqueue(event);
    await runtime.advanceSource(1);
    await started.promise;
    await runtime.stop();

    expect(failures).toEqual([]);
    expect(await progress.getSourcePosition("cooperative-stop")).toBe(0);

    runtime = start();
    await runtime.enqueue(event);
    await runtime.advanceSource(1);
    await runtime.drain();

    expect(attempts).toEqual([[], [1]]);
    expect(failures).toEqual([]);
    expect(await runtime.sourcePosition()).toBe(1);
    await runtime.stop();
  });

  it("backpressures source delivery at configured pending-record and byte bounds", async () => {
    const gate = Promise.withResolvers<void>();
    const firstStarted = Promise.withResolvers<void>();
    const consumed: string[] = [];
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "bounded",
          events: ["chat.messageSent"],
          startAt: "origin",
          async run({ event }) {
            consumed.push(event.payload.text);
            if (event.payload.text === "first") {
              firstStarted.resolve();
              await gate.promise;
            }
          },
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        maxPendingEvents: 2,
        maxPendingBytes: 1,
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    await runtime.enqueue(messageRecord("first", 1, "a"));
    await runtime.advanceSource(1);
    await firstStarted.promise;
    let secondAccepted = false;
    const second = runtime.enqueue(messageRecord("second", 2, "b")).then(() => {
      secondAccepted = true;
    });
    await Promise.resolve();
    expect(secondAccepted).toBe(false);

    gate.resolve();
    await second;
    await runtime.advanceSource(2);
    await runtime.drain();

    expect(secondAccepted).toBe(true);
    expect(consumed).toEqual(["first", "second"]);
    await runtime.stop();
  });

  it("coalesces a same-turn source burst into one durable replay cursor", async () => {
    const journal = createMemoryJournal();
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "source-burst",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: () => undefined,
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createJournalProgramProgressStore(journal, "source-burst"),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    for (let position = 1; position <= 100; position += 1) {
      await runtime.enqueue(messageRecord(`message-${position}`, position, "a"));
      await runtime.advanceSource(position);
    }
    await runtime.drain();
    expect(await runtime.sourcePosition()).toBe(100);

    let sourceRecords = 0;
    for await (const record of journal.scan(0)) {
      if (record.address.resource === "$poggers.program-source") sourceRecords += 1;
    }
    expect(sourceRecords).toBe(2);
    await runtime.stop();
    await journal.close();
  });

  it("advances source progress across reverse completion without crossing a pending gap", async () => {
    const gates = new Map<number, ReturnType<typeof Promise.withResolvers<void>>>();
    const progress = createMemoryProgramProgressStore();
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "reverse-completion",
          events: ["chat.messageSent"],
          startAt: "origin",
          concurrency: 256,
          async run({ event }) {
            const gate = Promise.withResolvers<void>();
            gates.set(event.seq, gate);
            await gate.promise;
          },
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress,
        maxPendingEvents: 256,
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    await runtime.enqueue(
      Array.from({ length: 256 }, (_, index) =>
        messageRecord(`message-${index + 1}`, index + 1, `scope-${index + 1}`),
      ),
    );
    await runtime.advanceSource(256);
    await poll(() => gates.size === 256, { intervalMs: 0 });
    for (let position = 256; position > 1; position -= 1) gates.get(position)!.resolve();
    await poll(async () => (await progress.getSourcePosition("reverse-completion")) === 0, {
      intervalMs: 0,
    });
    expect(await runtime.sourcePosition()).toBe(0);

    gates.get(1)!.resolve();
    await runtime.drain();
    expect(await runtime.sourcePosition()).toBe(256);
    await runtime.stop();
  });

  it("allows ordinary handler no-ops while advancing durable source progress", async () => {
    const consumed: string[] = [];
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = async ({
      consume,
    }) => {
      await consume({
        id: "filtered",
        events: ["chat.messageSent"],
        startAt: "origin",
        run({ event }) {
          if (event.payload.text === "skip") return;
          consumed.push(event.payload.text);
        },
      });
    };
    const progress = createMemoryProgramProgressStore();
    const runtime = startProgram(api, program, {
      env: "browser",
      deps: fakeDeps("unused"),
      progress,
      readViews: () => ({ messages: [], status: "idle" }) as never,
      command: async () => ({ ok: true }),
    });

    await runtime.enqueue(messageRecord("skip", 1, "a"));
    await runtime.advanceSource(1);
    await runtime.enqueue(messageRecord("keep", 2, "a"));
    await runtime.advanceSource(2);
    await runtime.drain();

    expect(consumed).toEqual(["keep"]);
    expect(await runtime.sourcePosition()).toBe(2);
    expect(
      await progress.getInvocation(
        "filtered",
        scopeId("chat", { ownerId: "test-user", sessionId: "a" }),
      ),
    ).toMatchObject({ attempt: 1, status: "completed" });
    await runtime.stop();
  });

  it("keeps identified command identities stable when replay skips positional commands", async () => {
    const commandIds: string[] = [];
    const progress = createMemoryProgramProgressStore();
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = async ({
      consume,
    }) => {
      await consume({
        id: "stable-command",
        events: ["chat.messageSent"],
        startAt: "origin",
        async run({ chat, delivery }) {
          if (delivery.attempt === 1) {
            await chat.completeGeneration({ data: { messageId: "positional", text: "first" } });
          }
          await chat.completeGeneration.identified("finish", {
            data: {
              messageId: "identified",
              text: "stable",
            },
          });
          if (delivery.attempt === 1) throw new Error("interrupt after commands");
        },
      });
    };
    const start = () =>
      startProgram(api, program, {
        env: "browser",
        deps: fakeDeps("unused"),
        progress,
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async (_resource, _key, _command, _args, commandId) => {
          commandIds.push(commandId);
          return { ok: true };
        },
      });
    let runtime = start();
    const event = messageRecord("retry", 1, "a");

    await runtime.enqueue(event);
    await runtime.advanceSource(1);
    await expect(runtime.drain()).rejects.toThrow("interrupt after commands");
    expect(await runtime.sourcePosition()).toBe(0);
    await runtime.stop();

    runtime = start();
    await runtime.enqueue(event);
    await runtime.advanceSource(1);
    await runtime.drain();

    expect(commandIds).toHaveLength(3);
    expect(commandIds[1]).toBe(commandIds[2]);
    expect(commandIds[1]).toContain(':completeGeneration:identified:"finish"');
    await runtime.stop();
  });

  it("exposes stable idempotency keys while external effects remain at least once", async () => {
    const progress = createMemoryProgramProgressStore();
    const keys: string[] = [];
    let externalEffects = 0;
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = async ({
      consume,
    }) => {
      await consume({
        id: "external-effect",
        events: ["chat.messageSent"],
        startAt: "origin",
        async run({ createIdempotencyKey, delivery }) {
          keys.push(createIdempotencyKey("send"));
          externalEffects += 1;
          if (delivery.attempt === 1) throw new Error("uncertain external effect");
        },
      });
    };
    const runtime = startProgram(api, program, {
      env: "browser",
      deps: fakeDeps("unused"),
      progress,
      restartPolicy: { initialDelayMs: 0, maximumDelayMs: 0, jitter: 0 },
      readViews: () => ({ messages: [], status: "idle" }) as never,
      command: async () => ({ ok: true }),
    });
    const event = messageRecord("effect", 1, "effect");

    await runtime.enqueue(event);
    await runtime.advanceSource(1);
    await expect(runtime.drain()).rejects.toThrow("uncertain external effect");
    await Promise.all([runtime.restart(), runtime.restart(), runtime.restart()]);
    await runtime.enqueue(event);
    await runtime.advanceSource(1);
    await runtime.drain();

    expect(externalEffects).toBe(2);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(await runtime.sourcePosition()).toBe(1);
    await runtime.stop();
  });

  it("runs resource scopes concurrently while preserving order within each scope", async () => {
    const trace: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = async ({
      consume,
    }) => {
      await consume({
        id: "concurrent",
        events: ["chat.messageSent"],
        startAt: "origin",
        concurrency: 2,
        async run({ event }) {
          const label = `${event.key.sessionId}:${event.seq}`;
          trace.push(`start:${label}`);
          if (label === "a:1") await firstBlocked;
          trace.push(`end:${label}`);
        },
      });
    };
    const runtime = startProgram(api, program, {
      env: "browser",
      deps: fakeDeps("unused"),
      progress: createMemoryProgramProgressStore(),
      readViews: () => ({ messages: [], status: "idle" }) as never,
      command: async () => ({ ok: true }),
    });
    const record = (
      id: string,
      position: number,
      sessionId: string,
      seq: number,
    ): ProgramEventRecord<TestApp> => ({
      resource: "chat",
      key: { ownerId: "test-user", sessionId },
      event: {
        id,
        seq,
        position,
        index: 0,
        at: position,
        version: 1,
        actor: { id: "test-user" },
        name: "messageSent",
        payload: { messageId: id, text: id },
      },
    });

    await runtime.enqueue(record("a1", 1, "a", 1));
    await runtime.advanceSource(1);
    await runtime.enqueue(record("b1", 2, "b", 1));
    await runtime.advanceSource(2);
    await runtime.enqueue(record("a2", 3, "a", 2));
    await runtime.advanceSource(3);
    await poll(() => trace.includes("end:b:1"));

    expect(trace).toEqual(["start:a:1", "start:b:1", "end:b:1"]);
    expect(await runtime.sourcePosition()).toBe(0);

    releaseFirst();
    await runtime.drain();
    expect(trace).toEqual(["start:a:1", "start:b:1", "end:b:1", "end:a:1", "start:a:2", "end:a:2"]);
    expect(await runtime.sourcePosition()).toBe(3);
    await runtime.stop();
  });

  it("uses source positions when one partition contains multiple resource keys", async () => {
    const consumed: string[] = [];
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = async ({
      consume,
    }) => {
      await consume({
        id: "owner-partition",
        events: ["chat.messageSent"],
        startAt: "origin",
        partitionRevision: 1,
        partitionBy: ({ event }) => event.key.ownerId,
        run({ event }) {
          consumed.push(event.payload.messageId);
        },
      });
    };
    const runtime = startProgram(api, program, {
      env: "browser",
      deps: fakeDeps("unused"),
      progress: createMemoryProgramProgressStore(),
      readViews: () => ({ messages: [], status: "idle" }) as never,
      command: async () => ({ ok: true }),
    });
    const record = (
      id: string,
      position: number,
      sessionId: string,
    ): ProgramEventRecord<TestApp> => ({
      resource: "chat",
      key: { ownerId: "test-user", sessionId },
      event: {
        id,
        seq: 1,
        position,
        index: 0,
        at: position,
        version: 1,
        actor: { id: "test-user" },
        name: "messageSent",
        payload: { messageId: id, text: id },
      },
    });

    await runtime.enqueue(record("first", 1, "a"));
    await runtime.advanceSource(1);
    await runtime.enqueue(record("second", 2, "b"));
    await runtime.advanceSource(2);
    await runtime.drain();

    expect(consumed).toEqual(["first", "second"]);
    await runtime.stop();
  });

  it("starts a new now consumer at the captured source high-water position", async () => {
    const consumed: string[] = [];
    const progress = createMemoryProgramProgressStore();
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "current-only",
          events: ["chat.messageSent"],
          startAt: "now",
          run: ({ event }) => void consumed.push(event.id),
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress,
        sourcePosition: () => 10,
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    expect(await runtime.sourcePosition()).toBe(10);
    await runtime.enqueue(messageRecord("new", 11, "a"));
    await runtime.advanceSource(11);
    await runtime.drain();
    expect(consumed).toEqual(["message:11"]);
    await runtime.stop();

    const restarted = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "current-only",
          events: ["chat.messageSent"],
          startAt: "now",
          run: () => undefined,
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress,
        sourcePosition: () => 99,
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );
    expect(await restarted.sourcePosition()).toBe(11);
    await restarted.stop();
  });

  it("rejects duplicate and incompatible durable consumer definitions", async () => {
    const progress = createMemoryProgramProgressStore();
    const options = {
      env: "browser" as const,
      deps: fakeDeps("unused"),
      progress,
      readViews: () => ({ messages: [], status: "idle" }) as never,
      command: async () => ({ ok: true }) as const,
    };
    const duplicate = startProgram(
      api,
      async ({ consume }) => {
        await Promise.all([
          consume({
            id: "same",
            events: ["chat.messageSent"],
            startAt: "origin",
            run: () => undefined,
          }),
          consume({
            id: "same",
            events: ["chat.messageSent"],
            startAt: "origin",
            run: () => undefined,
          }),
        ]);
      },
      options,
    );
    await expect(duplicate.drain()).rejects.toThrow("repeated");
    await duplicate.stop();

    const initial = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "definition",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: () => undefined,
        });
      },
      options,
    );
    await initial.drain();
    await initial.stop();

    const incompatible = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "definition",
          events: ["chat.generationCompleted"],
          startAt: "origin",
          run: () => undefined,
        });
      },
      options,
    );
    await expect(incompatible.drain()).rejects.toBeInstanceOf(ProgramConsumerDefinitionError);
    await incompatible.stop();

    const partitioned = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "partition",
          events: ["chat.messageSent"],
          startAt: "origin",
          partitionRevision: 1,
          partitionBy: ({ event }) => event.key.ownerId,
          run: () => undefined,
        });
      },
      options,
    );
    await partitioned.drain();
    await partitioned.stop();

    const repartitioned = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "partition",
          events: ["chat.messageSent"],
          startAt: "origin",
          partitionRevision: 2,
          partitionBy: ({ event }) => event.key.ownerId,
          run: () => undefined,
        });
      },
      options,
    );
    await expect(repartitioned.drain()).rejects.toBeInstanceOf(ProgramConsumerDefinitionError);
    await repartitioned.stop();
  });

  it("registers consumers after arbitrary awaits and catches subsequent source events", async () => {
    const gate = Promise.withResolvers<void>();
    const consumed: string[] = [];
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await gate.promise;
        await consume({
          id: "late",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: ({ event }) => void consumed.push(event.id),
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    expect(await runtime.sourcePosition()).toBe(Number.POSITIVE_INFINITY);
    gate.resolve();
    await poll(async () => (await runtime.sourcePosition()) === 0, { intervalMs: 0 });
    await runtime.enqueue(messageRecord("late", 1, "a"));
    await runtime.advanceSource(1);
    await runtime.drain();
    expect(consumed).toEqual(["message:1"]);
    await runtime.stop();
  });

  it("notifies source coordination when a dynamic consumer opens and closes", async () => {
    const registered = Promise.withResolvers<{ close(): void }>();
    let changes = 0;
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        registered.resolve(
          await consume({
            id: "dynamic-lifetime",
            events: ["chat.messageSent"],
            startAt: "origin",
            run: () => undefined,
          }),
        );
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
        onConsumersChanged: () => {
          changes += 1;
        },
      },
    );

    const subscription = await registered.promise;
    expect(changes).toBe(1);
    expect(await runtime.sourcePosition()).toBe(0);
    subscription.close();
    subscription.close();
    expect(changes).toBe(2);
    expect(await runtime.sourcePosition()).toBe(Number.POSITIVE_INFINITY);
    await runtime.stop();
  });

  it("runs cleanup exactly once and never overlaps restarted generations", async () => {
    let active = 0;
    let cleanups = 0;
    const failures: unknown[] = [];
    const program: NonNullable<NonNullable<typeof api.def.programs>["browser"]> = ({ consume }) => {
      active += 1;
      void consume({
        id: "lifecycle",
        events: ["chat.messageSent"],
        startAt: "origin",
        run: () => {
          throw new Error("restart lifecycle");
        },
      });
      return async () => {
        await Promise.resolve();
        active -= 1;
        cleanups += 1;
      };
    };
    const runtime = startProgram(api, program, {
      env: "browser",
      deps: fakeDeps("unused"),
      progress: createMemoryProgramProgressStore(),
      readViews: () => ({ messages: [], status: "idle" }) as never,
      command: async () => ({ ok: true }),
      onError: (error) => failures.push(error),
    });

    await runtime.enqueue(messageRecord("fail", 1, "a"));
    await expect(runtime.drain()).rejects.toThrow("restart lifecycle");
    await Promise.all([runtime.restart(), runtime.restart(), runtime.restart()]);
    expect(active).toBe(1);
    expect(cleanups).toBe(1);
    expect(failures).toHaveLength(1);
    await runtime.stop();
    await runtime.stop();
    expect(active).toBe(0);
    expect(cleanups).toBe(2);
  });

  it("aborts and cleans the Program exactly once when its parent lifetime ends", async () => {
    const parent = new AbortController();
    let cleanups = 0;
    let cleanupObservedAbort = false;
    const runtime = startProgram(
      api,
      ({ consume, signal }) => {
        void consume({
          id: "parent-lifetime",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: () => undefined,
        });
        return () => {
          cleanups += 1;
          cleanupObservedAbort = signal.aborted;
        };
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        signal: parent.signal,
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    expect(await runtime.sourcePosition()).toBe(0);
    parent.abort("parent stopped");
    await poll(() => cleanups === 1, { intervalMs: 0 });
    expect(cleanupObservedAbort).toBe(true);
    expect(runtime.health().status).toBe("stopped");
    await runtime.stop();
    expect(cleanups).toBe(1);
  });

  it("aggregates cleanup failure without losing the originating Program failure", async () => {
    const reports: unknown[] = [];
    const runtime = startProgram(
      api,
      ({ consume }) => {
        void consume({
          id: "cleanup-failure",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: () => {
            throw new Error("originating failure");
          },
        });
        return () => {
          throw new Error("cleanup failure");
        };
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
        onError: (error) => reports.push(error),
      },
    );

    await runtime.enqueue(messageRecord("fail", 1, "cleanup"));
    let aggregate: unknown;
    try {
      await runtime.drain();
    } catch (error) {
      aggregate = error;
    }
    expect(aggregate).toBeInstanceOf(AggregateError);
    expect((aggregate as AggregateError).errors).toEqual([
      expect.objectContaining({ message: "originating failure" }),
      expect.objectContaining({ message: "cleanup failure" }),
    ]);
    expect(reports).toHaveLength(2);
    expect(reports[1]).toBe(aggregate);
    await expect(runtime.stop()).rejects.toBe(aggregate);
  });

  it("stops sibling consumers when one consumer fails", async () => {
    let siblingEffects = 0;
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await Promise.all([
          consume({
            id: "failing-sibling",
            events: ["chat.messageSent"],
            startAt: "origin",
            run({ event }) {
              if (event.payload.text === "fail") throw new Error("generation failed");
            },
          }),
          consume({
            id: "stopped-sibling",
            events: ["chat.messageSent"],
            startAt: "origin",
            run({ event }) {
              if (event.payload.text === "after") siblingEffects += 1;
            },
          }),
        ]);
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    await runtime.enqueue(messageRecord("fail", 1, "siblings"));
    await runtime.advanceSource(1);
    await expect(runtime.drain()).rejects.toThrow("generation failed");
    await runtime.enqueue(messageRecord("after", 2, "siblings"));
    await runtime.advanceSource(2);
    expect(siblingEffects).toBe(0);
    expect(await runtime.sourcePosition()).toBe(0);
    await runtime.stop();
  });

  it("runs arbitrary asynchronous Program setup without a consumer schema", async () => {
    let initialized = false;
    let cleaned = false;
    const runtime = startProgram(
      api,
      async () => {
        await Promise.resolve();
        initialized = true;
        return () => {
          cleaned = true;
        };
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
      },
    );

    await poll(() => initialized, { intervalMs: 0 });
    expect(await runtime.sourcePosition()).toBe(Number.POSITIVE_INFINITY);
    await runtime.stop();
    expect(cleaned).toBe(true);
  });

  it("backs off repeated failures and reports each lifecycle state", async () => {
    const delays: number[] = [];
    let now = 1_000;
    const runtime = startProgram(
      api,
      async ({ consume }) => {
        await consume({
          id: "health",
          events: ["chat.messageSent"],
          startAt: "origin",
          run: () => {
            throw new Error("poison");
          },
        });
      },
      {
        env: "browser",
        deps: fakeDeps("unused"),
        progress: createMemoryProgramProgressStore(),
        readViews: () => ({ messages: [], status: "idle" }) as never,
        command: async () => ({ ok: true }),
        restartPolicy: {
          initialDelayMs: 10,
          maximumDelayMs: 25,
          factor: 2,
          jitter: 0,
          healthyAfterMs: 1_000,
          now: () => now,
          random: () => 0.5,
          async sleep(delay) {
            delays.push(delay);
            now += delay;
          },
        },
      },
    );

    expect(runtime.health()).toMatchObject({ status: "running", generation: 1 });
    await runtime.enqueue(messageRecord("first", 1, "health"));
    await expect(runtime.drain()).rejects.toThrow("poison");
    expect(runtime.health()).toMatchObject({
      status: "failed",
      generation: 1,
      consecutiveFailures: 1,
    });
    await runtime.restart();
    expect(delays).toEqual([10]);
    expect(runtime.health()).toMatchObject({ status: "running", generation: 2 });

    await runtime.enqueue(messageRecord("second", 1, "health"));
    await expect(runtime.drain()).rejects.toThrow("poison");
    await runtime.restart();
    expect(delays).toEqual([10, 20]);
    expect(runtime.health()).toMatchObject({ status: "running", generation: 3 });

    now += 1_000;
    await runtime.enqueue(messageRecord("healthy-reset", 1, "health"));
    await expect(runtime.drain()).rejects.toThrow("poison");
    expect(runtime.health().consecutiveFailures).toBe(1);
    await runtime.restart();
    expect(delays).toEqual([10, 20, 10]);
    expect(runtime.health()).toMatchObject({ status: "running", generation: 4 });
    await runtime.stop();
    expect(runtime.health().status).toBe("stopped");
  });
});

function messageRecord(
  text: string,
  position: number,
  sessionId: string,
): ProgramEventRecord<TestApp> {
  return {
    resource: "chat",
    key: { ownerId: "test-user", sessionId },
    event: {
      id: `message:${position}`,
      seq: position,
      position,
      index: 0,
      at: position,
      version: 1,
      actor: { id: "test-user" },
      name: "messageSent",
      payload: { messageId: `message:${position}`, text },
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
    app?: App<UpgradedTestApp>;
    deps?: Deps;
    journal?: Journal;
    withProgram?: boolean;
  }) {
    const journal = opts.journal ?? createMemoryJournal();
    const withProgram = opts.withProgram ?? true;
    const programs =
      withProgram && opts.deps
        ? [
            {
              env: "browser" as const,
              deps: opts.deps,
              programId: "test-program",
              actor: { id: "test-program" },
            },
          ]
        : undefined;
    const serverOptions = {
      port: 0,
      substrate: createSingleNodeSubstrate(journal),
      snapshotIntervalMs: 60000,
      programs,
    };
    handle = opts.app ? serve(opts.app, serverOptions) : serve(api, serverOptions);
    return { url: handle.url, journal };
  }

  async function connectClient(url: URL) {
    const client = await connect(api, {
      wsUrl: `${url.origin.replace("http", "ws")}/ws`,
      token: "test-user",
      replica: createMemoryClientReplica(),
      transport: createWebSocketSyncTransport,
      reconnectMs: 99999,
    });
    const chat = client.chat({ ownerId: "test-user", sessionId: "test" });
    let synced = false;
    chat.subscribe(() => {
      synced = true;
    });
    await poll(() => synced);
    return { client, chat };
  }

  it("rejects unsupported Program source topology before serving traffic", async () => {
    const substrate = createSingleNodeSubstrate(createMemoryJournal());
    const unsupported = {
      ...substrate,
      events: {
        ...substrate.events,
        async topology() {
          return {
            version: "split/1",
            splits: [
              { id: sourceSplit("commits/left"), predecessors: [] },
              { id: sourceSplit("commits/right"), predecessors: [] },
            ],
          };
        },
      },
    };
    handle = serve(api, {
      port: 0,
      substrate: unsupported,
      programs: [
        {
          env: "browser",
          deps: fakeDeps("unused"),
          programId: "unsupported-topology",
          actor: { id: "unsupported-topology" },
        },
      ],
    });
    await expect(handle.ready).rejects.toThrow("exactly one committed-event source split");
  });

  it("runs the app environment program in the server process", async () => {
    const deps = fakeDeps("hello from program");
    const { url } = startServer({ deps });
    const { client, chat } = await connectClient(url);

    await chat.sendMessage({ text: "hello" });

    await poll(() => chat.messages.some((message) => message.role === "assistant"));
    expect(deps.ai.calls).toHaveLength(1);
    expect(deps.ai.sequences).toEqual([1]);
    expect(chat.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hello from program" },
    ]);

    client.dispose();
  });

  it("processes events committed before the program was running", async () => {
    const deps = fakeDeps("caught up");
    const journal = createMemoryJournal();

    let started = startServer({
      journal,
      withProgram: false,
    });
    let connected = await connectClient(started.url);

    await connected.chat.sendMessage({ text: "program was absent" });
    await poll(() =>
      connected.chat.messages.some(
        (message) => message.role === "user" && message.content === "program was absent",
      ),
    );
    connected.client.dispose();
    await handle?.stop();
    handle = null;

    started = startServer({ deps, journal });
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
    const journal = createMemoryJournal();
    const subscriptionStarts: number[] = [];
    const subscribe = journal.subscribe.bind(journal);
    journal.subscribe = (after, receive) => {
      subscriptionStarts.push(after);
      return subscribe(after, receive);
    };

    let started = startServer({ deps, journal });
    let connected = await connectClient(started.url);

    await connected.chat.sendMessage({ text: "hello" });
    await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));
    connected.client.dispose();
    await handle?.stop();
    handle = null;
    subscriptionStarts.length = 0;

    started = startServer({ deps, journal });
    await poll(() => subscriptionStarts.length > 0);
    connected = await connectClient(started.url);
    await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));

    expect(deps.ai.calls).toHaveLength(1);
    expect(subscriptionStarts[0]).toBeGreaterThan(0);
    expect(connected.chat.messages).toMatchObject([
      { role: "user", content: "hello" },
      { role: "assistant", content: "only once" },
    ]);

    connected.client.dispose();
  });

  it("replays history for a newly added consumer without repeating established effects", async () => {
    const deps = fakeDeps("already completed");
    const journal = createMemoryJournal();
    let started = startServer({ deps, journal });
    let connected = await connectClient(started.url);

    await connected.chat.sendMessage({ text: "before consumer upgrade" });
    await poll(() => connected.chat.messages.some((message) => message.role === "assistant"));
    expect(deps.ai.calls).toHaveLength(1);
    connected.client.dispose();
    await handle?.stop();
    handle = null;

    const audited: string[] = [];
    started = startServer({ app: createUpgradedApi(audited), deps, journal });
    await poll(() => audited.length === 1);

    expect(deps.ai.calls).toHaveLength(1);
    const progress = createJournalProgramProgressStore(journal, "substrate");
    await poll(async () => ((await progress.getSourcePosition(auditProgress)) ?? 0) > 0);
    expect(await progress.getSourcePosition(auditProgress)).toBe(
      await progress.getSourcePosition(generateProgress),
    );
  });

  it("reclaims a crashed effect boundary without advancing or duplicating the source", async () => {
    const results = new Map<string, string>();
    const keys: string[] = [];
    let effects = 0;
    let interrupt = true;
    const deps: Deps = {
      ai: {
        calls: [],
        sequences: [],
        async generate(messages, idempotencyKey) {
          this.calls.push(messages);
          keys.push(idempotencyKey);
          let result = results.get(idempotencyKey);
          if (!result) {
            effects++;
            result = "recovered once";
            results.set(idempotencyKey, result);
          }
          if (interrupt) {
            interrupt = false;
            throw new Error("crash after external effect");
          }
          return result;
        },
      },
    };
    const { url, journal } = startServer({ deps });
    const { client, chat } = await connectClient(url);
    const key = { ownerId: "test-user", sessionId: "test" };

    await chat.sendMessage({ text: "recover me" });
    await poll(() => chat.messages.some((message) => message.content === "recovered once"));

    expect(effects).toBe(1);
    expect(deps.ai.calls).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    const progress = createJournalProgramProgressStore(journal, "substrate");
    expect(await progress.getInvocation(generateProgress, scopeId("chat", key))).toMatchObject({
      attempt: 2,
      epoch: 2,
      status: "completed",
      uncertainAttempts: [1],
    });
    await poll(async () => ((await progress.getSourcePosition(generateProgress)) ?? 0) > 0);
    expect(await progress.getSourcePosition(generateProgress)).toBeGreaterThan(0);

    client.dispose();
  });

  for (const phase of ["before", "after"] as const) {
    it(`retries an infrastructure failure ${phase} the Program command append`, async () => {
      const results = new Map<string, string>();
      let effects = 0;
      const deps: Deps = {
        ai: {
          calls: [],
          sequences: [],
          async generate(messages, idempotencyKey) {
            this.calls.push(messages);
            let result = results.get(idempotencyKey);
            if (!result) {
              effects++;
              result = `command recovered ${phase}`;
              results.set(idempotencyKey, result);
            }
            return result;
          },
        },
      };
      const journal = createMemoryJournal();
      const { url } = startServer({
        deps,
        journal: failProgramCommandAppend(journal, phase),
      });
      const { client, chat } = await connectClient(url);

      await chat.sendMessage({ text: `fail ${phase}` });
      await poll(() =>
        chat.messages.some((message) => message.content === `command recovered ${phase}`),
      );

      expect(effects).toBe(1);
      expect(deps.ai.calls).toHaveLength(2);
      expect(chat.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
      const progress = createJournalProgramProgressStore(journal, "substrate");
      expect(
        await progress.getInvocation(
          generateProgress,
          scopeId("chat", { ownerId: "test-user", sessionId: "test" }),
        ),
      ).toMatchObject({
        attempt: 2,
        status: "completed",
        uncertainAttempts: [1],
      });

      client.dispose();
    });
  }
});

function failProgramCommandAppend(journal: Journal, phase: "before" | "after"): Journal {
  let pending = true;
  return new Proxy(journal, {
    get(target, property) {
      if (property !== "append") {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (input: JournalAppend) => {
        const value = input.record.intent.value as { readonly name?: unknown };
        if (!pending || value.name !== "completeGeneration") return target.append(input);
        pending = false;
        if (phase === "before") throw new Error("injected Program command failure before append");
        await target.append(input);
        throw new Error("injected Program command failure after append");
      };
    },
  });
}
