import { createChatMessage, type ChatResource } from "@poggers/app";
import { PartList } from "./part-list";
import type { DisplayMessage } from "../types";

export function Message({ message }: { message: DisplayMessage }) {
  const Message = createChatMessage({
    input: { role: message.role, streaming: false },
    derived({ input }) {
      return {
        get roleLabel() {
          return input.role === "user" ? "You" : "NA";
        },
        get contentText() {
          return message.content;
        },
        get hidden() {
          return false;
        },
      };
    },
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
    input: { role: "assistant", streaming: true },
    derived() {
      return {
        get roleLabel() {
          return "NA";
        },
        get contentText() {
          return chat.streamingText ?? "";
        },
        get hidden() {
          return !chat.streamingText;
        },
      };
    },
  });

  return (
    <Message.Root>
      <Message.Role />
      <Message.Content />
    </Message.Root>
  );
}
