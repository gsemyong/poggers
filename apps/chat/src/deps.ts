import { Output, gateway, streamText } from "ai";
import { z } from "zod/v4-mini";
import { env } from "@poggers/kit/env";
import type { DependencyConfig } from "@poggers/kit/deps";
import type { AIResponse, ChatProgramDeps } from "src/types";

const aiPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({
    type: z.literal("heading"),
    content: z.string(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  z.object({ type: z.literal("questions"), items: z.array(z.string()) }),
  z.object({
    type: z.literal("summary"),
    title: z.string(),
    points: z.array(z.string()),
  }),
  z.object({
    type: z.literal("clarification"),
    understanding: z.string(),
  }),
  z.object({ type: z.literal("separator") }),
]);

const aiResponseSchema = z.object({ parts: z.array(aiPartSchema) });

const systemPrompt = `You are a task clarification facilitator. Your job is to help the user articulate and refine their task description through a collaborative dialogue. You must NOT propose solutions, implementations, or specific technologies. Instead, your role is to:

1. Listen carefully to what the user describes about their task
2. Ask probing questions to uncover:
   - What the task involves at its core
   - Who the task serves and who the stakeholders are
   - What constraints or requirements exist
   - What done looks like and what success means
   - What is already known vs. what is uncertain
3. Reflect back what you've understood so the user can confirm or correct
4. Help structure the task, identify dependencies, and surface hidden assumptions
5. Guide towards clarity without pushing your own agenda

You are a facilitator, not a decision-maker. The user owns their task.

Respond using ONLY the structured JSON format specified. Use these part types intentionally:
- clarification: use this in every response to articulate your current understanding of the user's task.
- heading: introduce a new topic or section.
- text: general explanatory content, reflections, or guidance.
- questions: concise, actionable clarifying questions.
- summary: recap what you've understood so far.
- separator: visually separate sections.`;

const model = "deepseek/deepseek-v4-flash";
const defaultFakeResponse = "Fake worker response.";

export default {
  ai: {
    production: {
      async complete(messages, onChunk) {
        const result = streamText<AIResponse>({
          model: gateway(model),
          system: systemPrompt,
          messages,
          output: Output.object({ schema: aiResponseSchema }),
        });

        let accumulated = "";
        let lastFlush = 0;

        for await (const delta of result.textStream) {
          accumulated += delta;
          const now = Date.now();
          if (now - lastFlush >= 50) {
            lastFlush = now;
            await onChunk(accumulated);
          }
        }

        await onChunk(accumulated);

        const [text, output] = await Promise.all([result.text, result.output]);
        return { text, parsed: output ?? null };
      },
    },
    mock: {
      async complete(_messages, onChunk) {
        const text = env("POGGERS_FAKE_AI") ?? defaultFakeResponse;
        await onChunk(text);
        return { text, parsed: { parts: [{ type: "text", content: text }] } };
      },
    },
  },
  clock: {
    now: Date.now,
  },
  ids: {
    create(seed: string) {
      return `assistant:${seed}`;
    },
  },
} satisfies DependencyConfig<ChatProgramDeps>;
