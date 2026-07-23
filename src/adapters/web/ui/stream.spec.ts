import fc from "fast-check";
import { describe, expect, test } from "vitest";

import { readWebJSONLines } from "@/adapters/web/ui/stream";

describe("web deferred stream framing", () => {
  test("decodes records independently of byte chunk boundaries", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.jsonValue(), { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 1, max: 19 }), { minLength: 1, maxLength: 30 }),
        async (records, widths) => {
          const bytes = new TextEncoder().encode(
            `${records.map((value) => JSON.stringify(value)).join("\n")}\n`,
          );
          const chunks: Uint8Array[] = [];
          let offset = 0;
          let index = 0;
          while (offset < bytes.length) {
            const width = widths[index++ % widths.length]!;
            chunks.push(bytes.slice(offset, offset + width));
            offset += width;
          }
          const actual: unknown[] = [];
          for await (const value of readWebJSONLines(byteStream(chunks))) actual.push(value);
          const canonical = JSON.parse(JSON.stringify(records)) as unknown;
          expect(actual).toEqual(canonical);
        },
      ),
      { numRuns: 100 },
    );
  });

  test("rejects malformed and truncated JSON records", async () => {
    const values = readWebJSONLines(byteStream([new TextEncoder().encode('{"broken":\n')]));
    await expect(collect(values)).rejects.toThrow("malformed JSON");
  });
});

function byteStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(values: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const value of values) result.push(value);
  return result;
}
