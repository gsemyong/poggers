import { createChatLayout, createComposer, setPreset, useChat, usePreset } from "@poggers/app";
import { For } from "@poggers/kit/ui";
import { Message, StreamingMessage } from "../ai/Message";
import type { DisplayMessage } from "../../types";

export function ChatScreen() {
  const chat = useChat({ sessionId: "default" });
  const Layout = createChatLayout();
  const Composer = createComposer({
    state: { value: "" },
    derived({ state }) {
      return {
        get busy() {
          return chat.status() === "generating";
        },
        get canSubmit() {
          return chat.status() === "idle" && state.value.trim().length > 0;
        },
      };
    },
    actions({ state }) {
      return {
        clear() {
          state.value = "";
        },
        change(value) {
          state.value = value;
        },
        submit() {
          if (chat.status() !== "idle") return;
          const nextText = state.value.trim();
          if (!nextText) return;
          void chat.sendMessage(nextText);
          state.value = "";
        },
      };
    },
  });

  function togglePreset() {
    setPreset(usePreset() === "paper" ? "terminal" : "paper");
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    Composer.submit();
  }

  return (
    <Layout.Root>
      <Layout.Topbar>
        <Layout.Brand>
          <Layout.BrandMark>NA</Layout.BrandMark>
          <Layout.BrandText>
            {() => (usePreset() === "paper" ? "Paper desk" : "Terminal station")}
          </Layout.BrandText>
        </Layout.Brand>
        <Layout.PresetSwitch type="button" onClick={togglePreset}>
          {() => (usePreset() === "paper" ? "Terminal" : "Paper")}
        </Layout.PresetSwitch>
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
          {(message) => <Message message={message as DisplayMessage} />}
        </For>
        {() => {
          const streamingText = chat.streamingText();
          return streamingText ? <StreamingMessage streamingText={streamingText} /> : null;
        }}
      </Layout.Messages>

      <Layout.Status id="status">
        <Layout.StatusText id="status-text">
          {() =>
            chat.status() === "idle"
              ? "(idle)"
              : chat.status() === "generating"
                ? "(generating)"
                : "x"
          }
          {() => chat.error()}
        </Layout.StatusText>
        <Layout.StatusMeta>
          {() => (chat.sync().stale ? "reconnecting" : "connected")}
        </Layout.StatusMeta>
      </Layout.Status>

      {() =>
        chat.understanding() ? (
          <Layout.Understanding id="understanding">
            <strong>understanding:</strong> <span>{() => chat.understanding() ?? ""}</span>
          </Layout.Understanding>
        ) : null
      }

      <Layout.Composer id="input-area">
        <Composer.Root>
          <Composer.Input
            id="input"
            placeholder="Describe your task..."
            rows={3}
            onKeyDown={handleKeyDown}
          />
          <Composer.Send>Send</Composer.Send>
        </Composer.Root>
      </Layout.Composer>
    </Layout.Root>
  );
}
