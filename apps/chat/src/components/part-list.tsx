import { createAIPart } from "@poggers/app";
import { For } from "@poggers/kit/ui";
import type { AIPart } from "../types";

export function parseParts(raw: string): AIPart[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.parts)) return parsed.parts as AIPart[];
  } catch {}
  return null;
}

export function PartList({ parts }: { parts: AIPart[] }) {
  return (
    <>
      <For each={parts}>
        {(part) => {
          if (part.type === "heading") {
            const Part = createAIPart({
              input: { kind: "heading" },
            });
            const prefix = part.level === 1 ? "=" : part.level === 2 ? "--" : "---";
            return (
              <Part.Root>
                {prefix} {part.content}
              </Part.Root>
            );
          }

          if (part.type === "text") {
            const Part = createAIPart({
              input: { kind: "text" },
            });
            return <Part.Root>{part.content}</Part.Root>;
          }

          if (part.type === "questions") {
            const Part = createAIPart({
              input: { kind: "questions" },
            });
            return (
              <Part.Root>
                <For each={part.items}>
                  {(question, questionIndex) => (
                    <Part.Item>
                      {questionIndex() + 1}. {question}
                    </Part.Item>
                  )}
                </For>
              </Part.Root>
            );
          }

          if (part.type === "summary") {
            const Part = createAIPart({
              input: { kind: "summary" },
            });
            return (
              <Part.Root>
                <Part.Item>* {part.title}</Part.Item>
                <For each={part.points}>{(point) => <Part.Item>. {point}</Part.Item>}</For>
              </Part.Root>
            );
          }

          if (part.type === "separator") {
            const Part = createAIPart({
              input: { kind: "separator" },
            });
            return <Part.Root>----------------------------------------</Part.Root>;
          }

          return null;
        }}
      </For>
    </>
  );
}
