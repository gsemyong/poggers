import { createChatLayout, createComposer, setPreset, useChat } from "@poggers/app";
import { For } from "@poggers/kit/ui";
import { Message, StreamingMessage } from "ui/message";

export function ChatScreen() {
  const chat = useChat({ sessionId: "default" });
  const Layout = createChatLayout({
    derived(ctx) {
      return {
        get brandText() {
          return ctx.preset === "paper" ? "Paper desk" : "Terminal station";
        },
        get presetSwitchLabel() {
          return ctx.preset === "paper" ? "Terminal" : "Paper";
        },
        get statusText() {
          const status = chat.status;
          const label =
            status === "idle" ? "(idle)" : status === "generating" ? "(generating)" : "x";
          const error = chat.error;
          return error ? `${label} ${error}` : label;
        },
        get statusMeta() {
          return chat.sync.stale ? "reconnecting" : "connected";
        },
        get understandingText() {
          return chat.understanding ?? "";
        },
        get hasUnderstanding() {
          return Boolean(chat.understanding);
        },
      };
    },
    actions(ctx) {
      return {
        togglePreset() {
          setPreset(ctx.preset === "paper" ? "terminal" : "paper");
        },
      };
    },
  });
  const Composer = createComposer({
    state: { value: "" },
    derived({ state }) {
      return {
        get busy() {
          return chat.status === "generating";
        },
        get canSubmit() {
          return chat.status === "idle" && state.value.trim().length > 0;
        },
      };
    },
    actions({ state }) {
      const submit = () => {
        if (chat.status !== "idle") return;
        const nextText = state.value.trim();
        if (!nextText) return;
        void chat.sendMessage(nextText);
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
  });

  return (
    <Layout.Root>
      <Layout.Topbar>
        <Layout.Brand>
          <Layout.BrandMark>NA</Layout.BrandMark>
          <Layout.BrandText />
        </Layout.Brand>
        <Layout.PresetSwitch />
      </Layout.Topbar>

      <Layout.Messages id="messages">
        <For
          each={chat.messages}
          fallback={
            <Layout.Empty>
              Describe your lol, piece kek. NA will ask clarifying questions to help you refine it.
            </Layout.Empty>
          }
        >
          {(message) => <Message message={message} />}
        </For>
        <StreamingMessage chat={chat} />
      </Layout.Messages>

      <Layout.Status id="status">
        <Layout.StatusText id="status-text" />
        <Layout.StatusMeta />
      </Layout.Status>

      <Layout.Understanding id="understanding" />

      <Layout.Composer id="input-area">
        <Composer.Root>
          <Composer.Input id="input" placeholder="Describe your task..." rows={3} />
          <Composer.Send />
        </Composer.Root>
      </Layout.Composer>
    </Layout.Root>
  );
}
