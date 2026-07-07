import { defineApp } from "@poggers/kit";
import { ChatScreen } from "./components/screens/ChatScreen";
import { createServerDeps } from "./helpers/deps/createDeps";
import type { App, DisplayMessage } from "./types";

export default defineApp<App>({
  version: 1,

  app: {
    name: "Poggers Chat",
  },

  pwa: {
    name: "Poggers Chat",
    shortName: "Chat",
    description: "A local-first assistant for clarifying personal tasks.",
    themeColor: "#22252a",
    backgroundColor: "#f7f3ea",
    display: "standalone",
  },

  deps: {
    server: createServerDeps,
  },

  resources: {
    chat: {
      state: {
        messages: [] as DisplayMessage[],
        status: "idle" as const,
        understanding: null as string | null,
        error: null as string | null,
      },

      presence: {
        typing: false,
        streamingText: null as string | null,
      },

      events: {
        messageSent({ state, payload }) {
          if (state.messages.some((m) => m.id === payload.messageId)) return;
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
          if (state.messages.some((m) => m.id === payload.messageId)) return;
          for (const part of payload.parsed?.parts ?? []) {
            if (part.type === "clarification") {
              state.understanding = part.understanding;
            }
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
          const worker = sessions.find((s) => s.presence.streamingText);
          return worker?.presence.streamingText ?? null;
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
          if (ctx.state.messages.some((m) => m.id === data.messageId))
            return ctx.error("duplicate");
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
    Composer({ state, derived, actions }) {
      return {
        Root: {
          onSubmit(event) {
            event.preventDefault();
            actions.submit();
          },
        },
        Input: {
          value: state.value,
          disabled: derived.busy,
          onInput(event) {
            actions.change(event.currentTarget.value);
          },
        },
        Send: {
          type: "submit",
          disabled: !derived.canSubmit,
        },
      };
    },
  },

  ui() {
    return <ChatScreen />;
  },
});
