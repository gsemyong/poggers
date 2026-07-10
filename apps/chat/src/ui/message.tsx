import { createChatMessage, type ChatResource } from "@poggers/app";
import { PartList } from "ui/part-list";
import type { DisplayMessage } from "types";

export function Message({ message }: { message: DisplayMessage }) {
  const Message = createChatMessage({
    input: {
      role: message.role,
      streaming: false,
      content: message.content,
      hidden: false,
    },
    variants: { role: message.role, streaming: "no" },
  });

  return (
    <Message.Root>
      <Message.Role />
      {message.role === "assistant" && message.parts ? (
        <PartList parts={message.parts} />
      ) : (
        <Message.Content />
      )}
    </Message.Root>
  );
}

export function StreamingMessage({ chat }: { chat: ChatResource }) {
  const Message = createChatMessage({
    input: {
      role: "assistant",
      streaming: true,
      get content() {
        return chat.streamingText ?? "";
      },
      get hidden() {
        return !chat.streamingText;
      },
    },
    variants: { role: "assistant", streaming: "yes" },
  });

  return (
    <Message.Root>
      <Message.Role />
      <Message.Content />
    </Message.Root>
  );
}
