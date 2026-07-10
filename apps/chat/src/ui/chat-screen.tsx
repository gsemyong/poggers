import { createChatLayout, createComposer, useChat } from "@poggers/app";
import { For } from "@poggers/kit/ui";
import { Message, StreamingMessage } from "ui/message";

export function ChatScreen() {
  const chat = useChat({ sessionId: "default" });
  const Layout = createChatLayout({
    input: {
      get status() {
        return chat.status;
      },
      get error() {
        return chat.error;
      },
      get stale() {
        return chat.sync.stale;
      },
      get understanding() {
        return chat.understanding;
      },
    },
  });
  const Composer = createComposer({
    input: {
      get status() {
        return chat.status;
      },
      sendMessage(text) {
        void chat.sendMessage(text);
      },
    },
  });

  return (
    <Layout.Root>
      <Layout.Topbar>
        <Layout.Brand>
          <Layout.BrandMark>AI</Layout.BrandMark>
          <Layout.BrandText />
        </Layout.Brand>
        <Layout.PresetSwitch />
      </Layout.Topbar>

      <Layout.Messages id="messages">
        <For
          each={chat.messages}
          fallback={
            <Layout.Empty>
              Describe what you want to clarify. The assistant will ask focused questions and refine
              it with you.
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
