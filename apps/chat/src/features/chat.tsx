import type {
  FeatureDef,
  Submission,
  SubmissionFailure,
  SubmissionSuccess,
  SyncMeta,
} from "@poggers/kit";
import { For, Show, createPress } from "@poggers/kit/ui";
import type { App } from "src/app";

export type AIPart =
  | { type: "text"; content: string }
  | { type: "heading"; content: string; level: 1 | 2 | 3 }
  | { type: "questions"; items: string[] }
  | { type: "summary"; title: string; points: string[] }
  | { type: "clarification"; understanding: string }
  | { type: "separator" };

export type AIResponse = { parts: AIPart[] };

export type AIPartKind = "heading" | "text" | "questions" | "summary" | "separator";

export type AIPartView = {
  kind: AIPartKind;
  lines: readonly string[];
};

export type DisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: AIPart[] | null;
  timestamp: number;
};

export type AIMessage = { role: "user" | "assistant"; content: string };

export type ChatProgramDeps = {
  ai: {
    complete(
      messages: AIMessage[],
      onChunk: (text: string) => Promise<void> | void,
    ): Promise<{ text: string; parsed: AIResponse | null }>;
  };
  clock: { now(): number };
  ids: { create(seed: string): string };
};

export type ChatState = {
  messages: DisplayMessage[];
  status: "idle" | "generating" | "error";
  understanding: string | null;
  error: string | null;
};

export type ChatEvents = {
  messageSent: { messageId: string; timestamp: number; text: string };
  generationCompleted: {
    text: string;
    messageId: string;
    timestamp: number;
    parsed: AIResponse | null;
  };
  generationError: { message: string };
};

export type ChatViews = {
  messages: DisplayMessage[];
  status: ChatState["status"];
  understanding: ChatState["understanding"];
  error: ChatState["error"];
  streamingText: string | null;
};

export type ChatCommands = {
  sendMessage: {
    Input: { text: string };
    Event: "messageSent";
    Error: "empty" | "unauthorized";
  };
  completeGeneration: {
    Input: ChatEvents["generationCompleted"];
    Event: "generationCompleted";
    Error: "duplicate" | "unauthorized";
  };
  failGeneration: {
    Input: { message: string };
    Event: "generationError";
    Error: "unauthorized";
  };
};

export type ChatSession = ChatViews & {
  readonly sync: SyncMeta;
  sendMessage(input: { text: string }): Submission<"empty" | "unauthorized">;
  completeGeneration(
    input: ChatCommands["completeGeneration"]["Input"],
  ): Submission<"duplicate" | "unauthorized">;
  failGeneration(input: { message: string }): Submission<"unauthorized">;
  beginStreaming(): void;
  updateStreaming(text: string): void;
  endStreaming(): void;
};

export type ChatFeature = {
  Resources: {
    chat: {
      Key: { ownerId: string; sessionId: string };
      State: ChatState;
      Presence: { typing: boolean; streamingText: string | null };
      Events: ChatEvents;
      Views: ChatViews;
      Commands: ChatCommands;
    };
  };
  Dependencies: { server: ChatProgramDeps };
  Programs: {
    server: {
      generateResponse: { Events: readonly ["chat.messageSent"] };
    };
  };
  Components: {
    ChatLayout: {
      State: ChatViews & {
        readonly syncStale: boolean;
        readonly preset: "paper" | "mono" | "terminal";
        readonly brandText: string;
        readonly presetSwitchLabel: string;
      };
      Phases: "active" | "switching";
      Tasks: {
        togglePreset: {
          Input: "paper" | "mono" | "terminal";
          Output: void;
          Error: never;
        };
      };
      Actions: { togglePreset(): void };
      Parts: {
        Root: "div";
        Topbar: "header";
        Brand: "div";
        BrandMark: "strong";
        BrandText: "span";
        PresetSwitch: "button";
        Messages: "main";
        Empty: "div";
        Status: "div";
        StatusText: "span";
        StatusMeta: "span";
        Understanding: "div";
        Composer: "div";
      };
    };
    ChatMessage: {
      Input: {
        role: "user" | "assistant";
        streaming: boolean;
        content: string;
        hidden: boolean;
        parts: readonly AIPart[] | null;
      };
      State: {
        role: "user" | "assistant";
        streaming: boolean;
        roleLabel: string;
        contentText: string;
        hidden: boolean;
        parts: readonly AIPartView[];
        hasParts: boolean;
      };
      Parts: { Root: "div"; Role: "div"; Content: "div" };
    };
    AIPart: {
      Input: { kind: AIPartKind; lines: readonly string[] };
      State: { lines: readonly string[] };
      Parts: { Root: "div"; Item: "div" };
    };
    Composer: {
      Input: { status: ChatState["status"] };
      Context: { value: string; submission: string };
      Phases: "active" | "sending";
      Tasks: {
        send: {
          Input: string;
          Output: SubmissionSuccess;
          Error: SubmissionFailure<"empty" | "unauthorized">;
        };
      };
      State: { value: string; canSubmit: boolean; busy: boolean };
      Actions: {
        clear(): void;
        change(value: string): void;
        submit(): void;
      };
      Parts: { Root: "form"; Input: "textarea"; Send: "button" };
    };
  };
  API: {
    readonly session: ChatSession;
  };
};

export const chatFeature = {
  resources: {
    chat: {
      state: {
        messages: [],
        status: "idle",
        understanding: null,
        error: null,
      },
      presence: { typing: false, streamingText: null },
      authorize({ actor, key }) {
        return actor.id === key.ownerId;
      },
      events: {
        messageSent({ state, payload }) {
          if (state.messages.some((message) => message.id === payload.messageId)) return;
          state.messages.push({
            id: payload.messageId,
            role: "user",
            content: payload.text,
            parts: null,
            timestamp: payload.timestamp,
          });
          state.status = "generating";
          state.error = null;
        },
        generationCompleted({ state, payload }) {
          if (state.messages.some((message) => message.id === payload.messageId)) return;
          for (const part of payload.parsed?.parts ?? []) {
            if (part.type === "clarification") state.understanding = part.understanding;
          }
          state.messages.push({
            id: payload.messageId,
            role: "assistant",
            content: payload.text,
            parts: payload.parsed?.parts ?? null,
            timestamp: payload.timestamp,
          });
          state.status = "idle";
        },
        generationError({ state, payload }) {
          state.error = payload.message;
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
        understanding({ state }) {
          return state.understanding;
        },
        error({ state }) {
          return state.error;
        },
        streamingText({ sessions }) {
          return (
            sessions.find((session) => session.presence.streamingText)?.presence.streamingText ??
            null
          );
        },
      },
      commands: {
        sendMessage(ctx, { text }) {
          if (ctx.actor.id !== ctx.key.ownerId) return ctx.error("unauthorized");
          if (!text.trim()) return ctx.error("empty");
          return ctx.event.messageSent({
            messageId: ctx.id(),
            timestamp: ctx.now(),
            text,
          });
        },
        completeGeneration(ctx, data) {
          if (ctx.actor.id !== ctx.key.ownerId) return ctx.error("unauthorized");
          if (ctx.state.messages.some((message) => message.id === data.messageId)) {
            return ctx.error("duplicate");
          }
          return ctx.event.generationCompleted(data);
        },
        failGeneration(ctx, { message }) {
          if (ctx.actor.id !== ctx.key.ownerId) return ctx.error("unauthorized");
          return ctx.event.generationError({ message });
        },
      },
    },
  },
  dependencies: {
    server: {
      ai: {
        kind: "dependency",
        async start() {
          if (!Bun.env.AI_GATEWAY_API_KEY) {
            return {
              async complete(messages, onChunk) {
                const request = messages.at(-1)?.content ?? "the task";
                const text = `I understand that you want to clarify: ${request}`;
                const parsed: AIResponse = {
                  parts: [
                    { type: "heading", level: 2, content: "Current understanding" },
                    { type: "text", content: text },
                    {
                      type: "questions",
                      items: [
                        "What outcome would make this complete?",
                        "Which constraint matters most?",
                      ],
                    },
                    { type: "clarification", understanding: request },
                  ],
                };
                await onChunk(text);
                return { text, parsed };
              },
            };
          }
          const [{ Output, gateway, streamText }, { z }] = await Promise.all([
            import("ai"),
            import("zod/v4-mini"),
          ]);
          const part = z.discriminatedUnion("type", [
            z.object({ type: z.literal("text"), content: z.string() }),
            z.object({
              type: z.literal("heading"),
              content: z.string(),
              level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
            }),
            z.object({ type: z.literal("questions"), items: z.array(z.string()) }),
            z.object({
              type: z.literal("summary"),
              title: z.string(),
              points: z.array(z.string()),
            }),
            z.object({ type: z.literal("clarification"), understanding: z.string() }),
            z.object({ type: z.literal("separator") }),
          ]);
          const schema = z.object({ parts: z.array(part) });
          const system = `You are a task clarification facilitator. Help the user articulate and refine a task through collaborative dialogue. Do not propose solutions or choose technologies. Listen, ask focused questions about goals, stakeholders, constraints, success, and uncertainty, reflect the current understanding, and guide toward clarity. Respond only with the structured schema. Include a clarification part in every response.`;
          return {
            async complete(messages, onChunk) {
              const result = streamText({
                model: gateway("deepseek/deepseek-v4-flash"),
                system,
                messages,
                output: Output.object({ schema }),
              });

              let accumulated = "";
              let lastFlush = 0;
              for await (const delta of result.textStream) {
                accumulated += delta;
                const now = Date.now();
                if (now - lastFlush >= 50) {
                  lastFlush = now;
                  await onChunk(accumulated);
                }
              }

              await onChunk(accumulated);
              const [text, output] = await Promise.all([result.text, result.output]);
              return { text, parsed: (output ?? null) as AIResponse | null };
            },
          };
        },
      },
      clock: { now: Date.now },
      ids: { create: (seed) => `assistant:${seed}` },
    },
  },
  programs: {
    server: {
      generateResponse: {
        source: {
          events: ["chat.messageSent"],
          replay: "all",
          version: 1,
          keyBy: "resource",
        },
        async handle({ chat, event, view }, deps) {
          chat.setPresence({ typing: true, streamingText: null });
          try {
            const messages = view.messages.map((message) => ({
              role: message.role,
              content: message.content,
            }));
            const result = await deps.ai.complete(messages, async (text) => {
              chat.setPresence({ typing: false, streamingText: text });
            });
            await chat.completeGeneration({
              text: result.text,
              messageId: deps.ids.create(event.id),
              timestamp: deps.clock.now(),
              parsed: result.parsed,
            });
          } catch (error) {
            await chat.failGeneration({ message: String(error) });
          } finally {
            chat.setPresence({ typing: false, streamingText: null });
          }
        },
      },
    },
  },
  components: {
    ChatLayout: {
      state({ api, appearance }) {
        const preset = appearance.preset;
        return {
          messages: api.session.messages,
          status: api.session.status,
          understanding: api.session.understanding,
          error: api.session.error,
          streamingText: api.session.streamingText,
          syncStale: api.session.sync.stale,
          preset,
          brandText:
            preset === "paper"
              ? "Paper desk"
              : preset === "mono"
                ? "Mono workspace"
                : "Terminal station",
          presetSwitchLabel: preset === "paper" ? "Mono" : preset === "mono" ? "Terminal" : "Paper",
        };
      },
      machine: {
        initial: "active",
        phases: {
          active: {
            on: { togglePreset: "switching" },
          },
          switching: {
            task: {
              run: "togglePreset",
              input: ({ state }) => state.preset,
              done: "active",
            },
          },
        },
        tasks: {
          togglePreset({ setAppearance, value }) {
            const preset = value === "paper" ? "mono" : value === "mono" ? "terminal" : "paper";
            setAppearance({ preset, theme: "default" });
          },
        },
      },
      view({
        state,
        actions,
        components: { Composer, ChatMessage },
        parts: {
          Root,
          Topbar,
          Brand,
          BrandMark,
          BrandText,
          PresetSwitch,
          Messages,
          Empty,
          Status,
          StatusText,
          StatusMeta,
          Understanding,
          Composer: ComposerRegion,
        },
      }) {
        return (
          <Root>
            <Topbar>
              <Brand>
                <BrandMark>AI</BrandMark>
                <BrandText>{state.brandText}</BrandText>
              </Brand>
              <PresetSwitch type="button" {...createPress(actions.togglePreset)}>
                {state.presetSwitchLabel}
              </PresetSwitch>
            </Topbar>

            <Messages id="messages">
              <For
                each={state.messages}
                by="id"
                fallback={
                  <Empty>
                    Describe what you want to clarify. The assistant will ask focused questions and
                    refine it with you.
                  </Empty>
                }
              >
                {(message) => (
                  <ChatMessage
                    role={message.role}
                    streaming={false}
                    content={message.content}
                    hidden={false}
                    parts={message.parts}
                  />
                )}
              </For>
              <ChatMessage
                role="assistant"
                streaming
                content={state.streamingText ?? ""}
                hidden={!state.streamingText}
                parts={null}
              />
            </Messages>

            <Status id="status">
              <StatusText>{chatStatusText(state.status, state.error)}</StatusText>
              <StatusMeta>{state.syncStale ? "reconnecting" : "connected"}</StatusMeta>
            </Status>
            <Understanding id="understanding" hidden={!state.understanding}>
              {`understanding: ${state.understanding ?? ""}`}
            </Understanding>
            <ComposerRegion id="input-area">
              <Composer status={state.status} />
            </ComposerRegion>
          </Root>
        );
      },
    },
    ChatMessage: {
      state({ input }) {
        const parts = (input.parts ?? []).flatMap((part) => {
          const view = toAIPartView(part);
          return view ? [view] : [];
        });
        return {
          role: input.role,
          streaming: input.streaming,
          roleLabel: input.role === "user" ? "You" : "Assistant",
          contentText: input.content,
          hidden: input.hidden,
          parts,
          hasParts: parts.length > 0,
        };
      },
      view({ state, components: { AIPart }, parts: { Root, Role, Content } }) {
        return (
          <Root hidden={state.hidden}>
            <Role>{state.roleLabel}</Role>
            <Show when={state.hasParts}>
              <For each={state.parts} by={(part, index) => `${part.kind}:${index}`}>
                {(part) => <AIPart kind={part.kind} lines={part.lines} />}
              </For>
            </Show>
            <Show when={!state.hasParts}>
              <Content>{state.contentText}</Content>
            </Show>
          </Root>
        );
      },
    },
    AIPart: {
      state({ input }) {
        return { lines: input.lines };
      },
      view({ state, parts: { Root, Item } }) {
        return (
          <Root>
            <For each={state.lines}>{(line) => <Item>{line}</Item>}</For>
          </Root>
        );
      },
    },
    Composer: {
      state({ input, context, phase }) {
        const busy = input.status === "generating" || phase === "sending";
        return {
          value: context.value,
          busy,
          canSubmit: !busy && input.status === "idle" && context.value.trim().length > 0,
        };
      },
      machine: {
        context: { value: "", submission: "" },
        initial: "active",
        phases: {
          active: {
            on: {
              clear: { update: () => ({ value: "" }) },
              change: { update: (_scope, value) => ({ value }) },
              submit: {
                allow: ({ input, context }) =>
                  input.status === "idle" && context.value.trim().length > 0,
                update: ({ context }) => ({ value: "", submission: context.value.trim() }),
                target: "sending",
              },
            },
          },
          sending: {
            task: {
              run: "send",
              input: ({ context }) => context.submission,
              done: "active",
              fail: "active",
            },
          },
        },
        tasks: {
          send({ api, value }) {
            return api.session.sendMessage({ text: value });
          },
        },
      },
      view({ state, actions, parts: { Root, Input, Send } }) {
        return (
          <Root
            onSubmit={(event) => {
              event.preventDefault();
              actions.submit();
            }}
          >
            <Input
              id="input"
              value={state.value}
              disabled={state.busy}
              placeholder="Describe your task..."
              rows={3}
              onInput={(event) => actions.change(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
                event.preventDefault();
                actions.submit();
              }}
            />
            <Send type="button" disabled={!state.canSubmit} {...createPress(actions.submit)}>
              Send
            </Send>
          </Root>
        );
      },
    },
  },
  api: ({ actor, resources }) => {
    const chat = resources.chat({ ownerId: actor.id, sessionId: "reference" });
    return {
      session: {
        get messages() {
          return chat.messages;
        },
        get status() {
          return chat.status;
        },
        get understanding() {
          return chat.understanding;
        },
        get error() {
          return chat.error;
        },
        get streamingText() {
          return chat.streamingText;
        },
        sync: chat.sync,
        sendMessage: chat.sendMessage,
        completeGeneration: chat.completeGeneration,
        failGeneration: chat.failGeneration,
        beginStreaming() {
          chat.setPresence({ typing: true, streamingText: null });
        },
        updateStreaming(text) {
          chat.setPresence({ typing: false, streamingText: text });
        },
        endStreaming() {
          chat.setPresence({ typing: false, streamingText: null });
        },
      },
    };
  },
} satisfies FeatureDef<App, ChatFeature>;

function chatStatusText(status: "idle" | "generating" | "error", error: string | null): string {
  const label = status === "idle" ? "(idle)" : status === "generating" ? "(generating)" : "(error)";
  return error ? `${label} ${error}` : label;
}

function toAIPartView(part: AIPart): AIPartView | undefined {
  switch (part.type) {
    case "heading": {
      const prefix = part.level === 1 ? "=" : part.level === 2 ? "--" : "---";
      return { kind: "heading", lines: [`${prefix} ${part.content}`] };
    }
    case "text":
      return { kind: "text", lines: [part.content] };
    case "questions":
      return {
        kind: "questions",
        lines: part.items.map((question, index) => `${index + 1}. ${question}`),
      };
    case "summary":
      return {
        kind: "summary",
        lines: [`* ${part.title}`, ...part.points.map((point) => `. ${point}`)],
      };
    case "separator":
      return { kind: "separator", lines: ["----------------------------------------"] };
    case "clarification":
      return undefined;
  }
}
