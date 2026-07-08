import type { AppDefinition } from "@poggers/app";
import { ChatScreen } from "ui/chat-screen";

export default {
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

  resources: {
    chat: {
      state: {
        messages: [],
        status: "idle",
        understanding: null,
        error: null,
      },

      presence: {
        typing: false,
        streamingText: null,
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
    ChatLayout({ derived, actions }) {
      return {
        BrandText: {
          children: derived.brandText,
        },
        PresetSwitch: {
          type: "button",
          onClick: actions.togglePreset,
          children: derived.presetSwitchLabel,
        },
        StatusText: {
          children: derived.statusText,
        },
        StatusMeta: {
          children: derived.statusMeta,
        },
        Understanding: {
          hidden: !derived.hasUnderstanding,
          children: `understanding: ${derived.understandingText}`,
        },
      };
    },
    ChatMessage({ derived }) {
      return {
        Root: {
          hidden: derived.hidden,
        },
        Role: {
          children: derived.roleLabel,
        },
        Content: {
          children: derived.contentText,
        },
      };
    },
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

  styles: {
    defaultPreset: "paper",
    presets: {
      paper: {
        ChatLayout: {
          Root: {
            height: "100dvh",
            display: "flex",
            flexDirection: "column",
            background: "#f5f1e8",
            color: "#22252a",
            fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
          },
          Topbar: {
            padding: "16px 22px",
            background: "#fffaf0",
            borderBottom: "1px solid #d7ccb8",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            boxShadow: "0 8px 28px rgb(74 48 18 / 0.08)",
          },
          Brand: {
            display: "flex",
            alignItems: "baseline",
            gap: 10,
          },
          BrandMark: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 38,
            minHeight: 32,
            padding: "0 8px",
            border: "1px solid #a63d2a",
            borderRadius: 999,
            color: "#a63d2a",
            background: "#fff3df",
            fontSize: 14,
            fontWeight: 800,
          },
          BrandText: {
            color: "#62574b",
            fontSize: 15,
            fontStyle: "italic",
          },
          PresetSwitch: {
            minHeight: 34,
            padding: "0 14px",
            border: "1px solid #2f6b4f",
            borderRadius: 999,
            background: "#eaf5ed",
            color: "#174732",
            font: "inherit",
            fontSize: 14,
            fontWeight: 700,
            cursor: "pointer",
            transition: "background 160ms ease, transform 160ms ease, color 160ms ease",
          },
          Messages: {
            flex: "1 1 auto",
            overflowY: "auto",
            padding: "24px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            background: "#f5f1e8",
          },
          Empty: {
            color: "#685f56",
            padding: 20,
            border: "1px dashed #cdbfa8",
            borderRadius: 8,
            background: "#fffaf0",
          },
          Status: {
            padding: "9px 22px",
            background: "#ece3d3",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
            borderTop: "1px solid #d7ccb8",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          },
          StatusText: {
            color: "#2f6b4f",
          },
          StatusMeta: {
            color: "#6b5e4c",
          },
          Understanding: {
            padding: "10px 22px",
            background: "#fff5dc",
            borderTop: "1px solid #d7ccb8",
            color: "#5c5148",
            fontSize: 13,
            maxHeight: 80,
            overflowY: "auto",
          },
          Composer: {
            padding: "14px 22px 20px",
            background: "#fffaf0",
            borderTop: "1px solid #d7ccb8",
          },
        },
        ChatMessage: {
          Root: {
            display: "flex",
            flexDirection: "column",
            gap: 7,
            maxWidth: 780,
            padding: "12px 14px",
            borderRadius: 8,
            background: "#fffaf0",
            border: "1px solid #ded3be",
            boxShadow: "0 4px 16px rgb(74 48 18 / 0.06)",
          },
          Role: {
            fontWeight: 700,
            fontSize: 13,
            color: "#a63d2a",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          },
          Content: {
            fontSize: 16,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            color: "#22252a",
          },
        },
        Composer: {
          Root: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 10,
            alignItems: "end",
          },
          Input: {
            width: "100%",
            resize: "vertical",
            minHeight: 86,
            border: "1px solid #bca98e",
            borderRadius: 8,
            padding: 12,
            background: "#fffdf7",
            color: "#22252a",
            font: "inherit",
            lineHeight: 1.45,
            boxShadow: "inset 0 1px 4px rgb(74 48 18 / 0.08)",
          },
          Send: {
            minHeight: 42,
            padding: "0 16px",
            border: "1px solid #2f6b4f",
            borderRadius: 8,
            background: "#2f6b4f",
            color: "#fffaf0",
            font: "inherit",
            fontWeight: 800,
          },
        },
        AIPart: {
          Root: {
            color: "#3f464d",
            lineHeight: 1.55,
            fontSize: 15,
          },
          Item: {
            paddingLeft: 12,
            lineHeight: 1.55,
          },
        },
      },
      terminal: {
        ChatLayout: {
          Root: {
            height: "100dvh",
            display: "flex",
            flexDirection: "column",
            background: "#07090c",
            color: "#d7ffe8",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          },
          Topbar: {
            padding: "10px 14px",
            background: "#0d1211",
            borderBottom: "1px solid #1f4a35",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            boxShadow: "none",
          },
          Brand: {
            display: "flex",
            alignItems: "center",
            gap: 10,
          },
          BrandMark: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 34,
            minHeight: 30,
            padding: "0 8px",
            border: "1px solid #34d17a",
            borderRadius: 3,
            color: "#07120d",
            background: "#34d17a",
            fontSize: 12,
            fontWeight: 900,
          },
          BrandText: {
            color: "#8cffbd",
            fontSize: 13,
            fontStyle: "normal",
          },
          PresetSwitch: {
            minHeight: 30,
            padding: "0 12px",
            border: "1px solid #f5c15c",
            borderRadius: 3,
            background: "#16130b",
            color: "#f5c15c",
            font: "inherit",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
            transition: "background 120ms ease, transform 120ms ease, color 120ms ease",
          },
          Messages: {
            flex: "1 1 auto",
            overflowY: "auto",
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "#07090c",
          },
          Empty: {
            color: "#7ee9a4",
            padding: 14,
            border: "1px solid #1f4a35",
            borderRadius: 3,
            background: "#0a100d",
          },
          Status: {
            padding: "7px 14px",
            background: "#0d1211",
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            fontSize: 12,
            borderTop: "1px solid #1f4a35",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          },
          StatusText: {
            color: "#34d17a",
          },
          StatusMeta: {
            color: "#f5c15c",
          },
          Understanding: {
            padding: "8px 14px",
            background: "#11140c",
            borderTop: "1px solid #3b331d",
            color: "#f5c15c",
            fontSize: 12,
            maxHeight: 72,
            overflowY: "auto",
          },
          Composer: {
            padding: "10px 14px 14px",
            background: "#0d1211",
            borderTop: "1px solid #1f4a35",
          },
        },
        ChatMessage: {
          Root: {
            display: "flex",
            flexDirection: "column",
            gap: 4,
            maxWidth: 980,
            padding: "8px 10px",
            borderRadius: 3,
            background: "#0a100d",
            border: "1px solid #1f4a35",
            boxShadow: "none",
          },
          Role: {
            fontWeight: 900,
            fontSize: 12,
            color: "#f5c15c",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          },
          Content: {
            fontSize: 13,
            lineHeight: 1.45,
            whiteSpace: "pre-wrap",
            color: "#d7ffe8",
          },
        },
        Composer: {
          Root: {
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            gap: 8,
            alignItems: "end",
          },
          Input: {
            width: "100%",
            resize: "vertical",
            minHeight: 64,
            border: "1px solid #2f7f4d",
            borderRadius: 3,
            padding: 10,
            background: "#050806",
            color: "#d7ffe8",
            font: "inherit",
            lineHeight: 1.4,
            boxShadow: "inset 0 0 0 1px rgb(52 209 122 / 0.12)",
          },
          Send: {
            minHeight: 36,
            padding: "0 12px",
            border: "1px solid #f5c15c",
            borderRadius: 3,
            background: "#16130b",
            color: "#f5c15c",
            font: "inherit",
            fontWeight: 900,
          },
        },
        AIPart: {
          Root: {
            color: "#a8f7c7",
            lineHeight: 1.45,
            fontSize: 13,
          },
          Item: {
            paddingLeft: 8,
            lineHeight: 1.45,
          },
        },
      },
    },
  },

  root: ChatScreen,
} satisfies AppDefinition;
