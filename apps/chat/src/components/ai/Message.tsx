import { createChatMessage } from "@poggers/app";
import { PartList, parseParts } from "./PartList";
import type { DisplayMessage } from "../../types";

export function Message({ message }: { message: DisplayMessage }) {
  const Message = createChatMessage({
    input: { role: message.role, streaming: false },
  });

  return (
    <Message.Root>
      <Message.Role>{message.role === "user" ? "You" : "NA"}</Message.Role>
      {message.role === "assistant" && message.parts ? (
        <PartList parts={message.parts} />
      ) : (
        <Message.Content>{message.content}</Message.Content>
      )}
    </Message.Root>
  );
}

export function StreamingMessage({ streamingText }: { streamingText: string }) {
  const streamParts = parseParts(streamingText);
  const Message = createChatMessage({
    input: { role: "assistant", streaming: true },
  });

  return (
    <Message.Root>
      <Message.Role>NA</Message.Role>
      {streamParts ? (
        <PartList parts={streamParts} />
      ) : (
        <Message.Content>{streamingText}</Message.Content>
      )}
    </Message.Root>
  );
}
