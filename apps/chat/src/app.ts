import type { AppDefinition } from "@poggers/app";
import { monoPreset, paperPreset, terminalPreset } from "src/presets";
import type { App } from "types";
import { ChatScreen } from "ui/chat-screen";

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
      derived({ input, preset }) {
        return {
          get brandText() {
            switch (preset) {
              case "paper":
                return "Paper desk";
              case "mono":
                return "Mono workspace";
              case "terminal":
                return "Terminal station";
            }
          },
          get presetSwitchLabel() {
            switch (preset) {
              case "paper":
                return "Mono";
              case "mono":
                return "Terminal";
              case "terminal":
                return "Paper";
            }
          },
          get statusText() {
            const label =
              input.status === "idle"
                ? "(idle)"
                : input.status === "generating"
                  ? "(generating)"
                  : "(error)";
            return input.error ? `${label} ${input.error}` : label;
          },
          get statusMeta() {
            return input.stale ? "reconnecting" : "connected";
          },
          get understandingText() {
            return input.understanding ?? "";
          },
          get hasUnderstanding() {
            return Boolean(input.understanding);
          },
        };
      },
      actions({ preset, setPreset }) {
        return {
          togglePreset() {
            switch (preset) {
              case "paper":
                setPreset("mono");
                return;
              case "mono":
                setPreset("terminal");
                return;
              case "terminal":
                setPreset("paper");
            }
          },
        };
      },
      bind({ derived, actions }) {
        return {
          BrandText: { children: derived.brandText },
          PresetSwitch: {
            type: "button",
            onClick: actions.togglePreset,
            children: derived.presetSwitchLabel,
          },
          StatusText: { children: derived.statusText },
          StatusMeta: { children: derived.statusMeta },
          Understanding: {
            hidden: !derived.hasUnderstanding,
            children: `understanding: ${derived.understandingText}`,
          },
        };
      },
    },
    ChatMessage: {
      derived({ input }) {
        return {
          get roleLabel() {
            return input.role === "user" ? "You" : "Assistant";
          },
          get contentText() {
            return input.content;
          },
          get hidden() {
            return input.hidden;
          },
        };
      },
      bind({ derived }) {
        return {
          Root: { hidden: derived.hidden },
          Role: { children: derived.roleLabel },
          Content: { children: derived.contentText },
        };
      },
    },
    Composer: {
      state: { value: "" },
      derived({ input, state }) {
        return {
          get busy() {
            return input.status === "generating";
          },
          get canSubmit() {
            return input.status === "idle" && state.value.trim().length > 0;
          },
        };
      },
      actions({ input, state }) {
        const submit = () => {
          if (input.status !== "idle") return;
          const text = state.value.trim();
          if (!text) return;
          input.sendMessage(text);
          state.value = "";
        };

        return {
          clear() {
            state.value = "";
          },
          change(value) {
            state.value = value;
          },
          submit,
          submitFromKeyboard(event) {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          },
        };
      },
      bind({ state, derived, actions }) {
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
            onKeyDown: actions.submitFromKeyboard,
          },
          Send: {
            type: "submit",
            disabled: !derived.canSubmit,
            children: "Send",
          },
        };
      },
    },
  },
  styles: {
    defaultPreset: "paper",
    presets: { paper: paperPreset, mono: monoPreset, terminal: terminalPreset },
  },
  root: ChatScreen,
} satisfies AppDefinition<App>;
