import type { AppDef as AppDefinition } from "@poggers/kit";
import { For, Show } from "@poggers/kit/ui";
import { createPress } from "@poggers/kit/web";
import { monoPreset, paperPreset, terminalPreset } from "src/presets";
import type { AIPart, AIPartView, App } from "src/types";

export default {
  version: 1,
  app: { name: "Poggers Chat" },
  pwa: {
    name: "Poggers Chat",
    shortName: "Chat",
    description: "A local-first assistant for clarifying personal tasks.",
    themeColor: "oklch(26.35% 0.0103 260.7)",
    backgroundColor: "oklch(96.48% 0.0127 86.83)",
    display: "standalone",
  },
  resources: {
    chat: {
      state: {
        messages: [],
        status: "idle",
        understanding: null,
        error: null,
      },
      presence: { typing: false, streamingText: null },
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
        sendMessage(ctx, text) {
          if (!text.trim()) return ctx.error("empty");
          return ctx.event.messageSent({
            messageId: ctx.id(),
            timestamp: ctx.now(),
            text,
          });
        },
        completeGeneration(ctx, data) {
          if (ctx.state.messages.some((message) => message.id === data.messageId)) {
            return ctx.error("duplicate");
          }
          ctx.setPresence({ typing: false, streamingText: null });
          return ctx.event.generationCompleted(data);
        },
        failGeneration(ctx, message) {
          ctx.setPresence({ typing: false, streamingText: null });
          return ctx.event.generationError({ message });
        },
        startStreaming(ctx) {
          ctx.setPresence({ typing: true, streamingText: null });
        },
        streamChunk(ctx, text) {
          ctx.setPresence({ typing: false, streamingText: text });
        },
      },
    },
  },
  programs: {
    async server({ events, signal }, deps) {
      for await (const { chat, event, view } of events("chat.messageSent", {
        id: "chat.generate-response",
        signal,
      })) {
        await chat.startStreaming();
        try {
          const messages = view.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }));
          const result = await deps.ai.complete(messages, async (text) => {
            await chat.streamChunk(text);
          });
          await chat.completeGeneration({
            text: result.text,
            messageId: deps.ids.create(event.id),
            timestamp: deps.clock.now(),
            parsed: result.parsed,
          });
        } catch (error) {
          await chat.failGeneration(String(error));
        }
      }
    },
  },
  components: {
    ChatLayout: {
      derive({ appearance }) {
        switch (appearance.preset) {
          case "paper":
            return { brandText: "Paper desk", presetSwitchLabel: "Mono" };
          case "mono":
            return { brandText: "Mono workspace", presetSwitchLabel: "Terminal" };
          case "terminal":
            return { brandText: "Terminal station", presetSwitchLabel: "Paper" };
        }
      },
      initial: "active",
      states: {
        active: {
          on: {
            togglePreset: {
              perform: ({ appearance, setAppearance }) => {
                switch (appearance.preset) {
                  case "paper":
                    setAppearance({ preset: "mono", theme: "default" });
                    return;
                  case "mono":
                    setAppearance({ preset: "terminal", theme: "default" });
                    return;
                  case "terminal":
                    setAppearance({ preset: "paper", theme: "default" });
                }
              },
            },
          },
        },
      },
      render({
        events,
        components: { Composer, ChatMessage },
        values,
        resources,
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
        const chat = resources.chat({ sessionId: "default" });
        return (
          <Root>
            <Topbar>
              <Brand>
                <BrandMark>AI</BrandMark>
                <BrandText>{values.brandText}</BrandText>
              </Brand>
              <PresetSwitch type="button" {...createPress(events.togglePreset)}>
                {values.presetSwitchLabel}
              </PresetSwitch>
            </Topbar>

            <Messages id="messages">
              <For
                each={chat.messages}
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
                content={chat.streamingText ?? ""}
                hidden={!chat.streamingText}
                parts={null}
              />
            </Messages>

            <Status id="status">
              <StatusText>{chatStatusText(chat.status, chat.error)}</StatusText>
              <StatusMeta>{chat.sync.stale ? "reconnecting" : "connected"}</StatusMeta>
            </Status>
            <Understanding id="understanding" hidden={!chat.understanding}>
              {`understanding: ${chat.understanding ?? ""}`}
            </Understanding>
            <ComposerRegion id="input-area">
              <Composer
                status={chat.status}
                sendMessage={(text) => {
                  void chat.sendMessage(text);
                }}
              />
            </ComposerRegion>
          </Root>
        );
      },
    },
    ChatMessage: {
      derive({ input }) {
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
      render({ values, components: { AIPart }, parts: { Root, Role, Content } }) {
        return (
          <Root hidden={values.hidden}>
            <Role>{values.roleLabel}</Role>
            <Show when={values.hasParts}>
              <For each={values.parts} by={(part, index) => `${part.kind}:${index}`}>
                {(part) => <AIPart kind={part.kind} lines={part.lines} />}
              </For>
            </Show>
            <Show when={!values.hasParts}>
              <Content>{values.contentText}</Content>
            </Show>
          </Root>
        );
      },
    },
    AIPart: {
      derive({ input }) {
        return { lines: input.lines };
      },
      render({ values, parts: { Root, Item } }) {
        return (
          <Root>
            <For each={values.lines}>{(line) => <Item>{line}</Item>}</For>
          </Root>
        );
      },
    },
    Composer: {
      context: { value: "", submission: "" },
      derive({ input, context }) {
        return {
          busy: input.status === "generating",
          canSubmit: input.status === "idle" && context.value.trim().length > 0,
        };
      },
      initial: "active",
      states: {
        active: {
          on: {
            clear: { update: () => ({ value: "" }) },
            change: { update: (_scope, value) => ({ value }) },
            submit: {
              allow: ({ input, context }) =>
                input.status === "idle" && context.value.trim().length > 0,
              update: ({ context }) => ({ value: "", submission: context.value.trim() }),
              perform: ({ input, context }) => input.sendMessage(context.submission),
            },
          },
        },
      },
      render({ context, values, events, parts: { Root, Input, Send } }) {
        return (
          <Root
            onSubmit={(event) => {
              event.preventDefault();
              events.submit();
            }}
          >
            <Input
              id="input"
              value={context.value}
              disabled={values.busy}
              placeholder="Describe your task..."
              rows={3}
              onInput={(event) => events.change(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
                event.preventDefault();
                events.submit();
              }}
            />
            <Send type="button" disabled={!values.canSubmit} {...createPress(events.submit)}>
              Send
            </Send>
          </Root>
        );
      },
    },
  },
  styles: {
    defaultPreset: "paper",
    presets: { paper: paperPreset, mono: monoPreset, terminal: terminalPreset },
  },
  root: "ChatLayout",
} satisfies AppDefinition<App>;

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
