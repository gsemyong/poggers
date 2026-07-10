export const Output: {
  object(options: { schema: unknown }): unknown;
};

export function gateway(model: string): unknown;

export function streamText<OutputValue = unknown>(options: {
  model: unknown;
  system: string;
  messages: unknown[];
  output?: unknown;
}): {
  textStream: AsyncIterable<string>;
  text: Promise<string>;
  output: Promise<OutputValue | null>;
};
