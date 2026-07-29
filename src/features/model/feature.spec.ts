import { createServer } from "node:http";
import { resolve } from "node:path";

import { expect } from "vitest";

import type { TypeSchema } from "@/core/intrinsic";
import { vercelAiGateway, type LanguageModel } from "@/features/model";
import { rustServerDependencyTarget } from "@/platforms/server/adapter/rust/testing";
import { defineDependencyConformance, dependencyImplementationTarget } from "@/testing/dependency";

const gatewayProvider = vercelAiGateway.providers!.server.model;

const languageModelConformance = defineDependencyConformance<LanguageModel>({
  name: "LanguageModel",
  scenarios: [
    {
      name: "generates text and usage through the semantic contract",
      async verify({ api }) {
        await expect(
          api.generate({
            messages: [{ role: "user", content: "Be concise." }],
            maxTokens: 32,
          }),
        ).resolves.toEqual({
          text: "A focused response.",
          finishReason: "stop",
          usage: {
            inputTokens: 12,
            outputTokens: 4,
          },
        });
      },
    },
    {
      name: "constrains and validates a structured semantic result",
      async verify({ api }) {
        await expect(
          api.generate({
            messages: [{ role: "user", content: "Make a decision." }],
            output: {
              name: "decision",
              schema: {
                kind: "record",
                fields: [
                  {
                    name: "answer",
                    optional: false,
                    type: {
                      kind: "union",
                      variants: [
                        { kind: "literal", value: "proceed" },
                        { kind: "literal", value: "reconsider" },
                      ],
                    },
                  },
                  {
                    name: "reasons",
                    optional: false,
                    type: { kind: "array", element: { kind: "primitive", name: "string" } },
                  },
                ],
              } as TypeSchema,
            },
          }),
        ).resolves.toEqual({
          text: '{"answer":"proceed","reasons":["evidence"]}',
          value: { answer: "proceed", reasons: ["evidence"] },
          finishReason: "stop",
          usage: {
            inputTokens: 12,
            outputTokens: 4,
          },
        });
      },
    },
  ],
});

languageModelConformance.test(
  dependencyImplementationTarget("Vercel Gateway TypeScript", async () => {
    const gateway = await startGateway();
    const implementation = await gatewayProvider.development({
      appName: "model-conformance",
      configuration: {
        apiKey: "test-key",
        gateway: gateway.url,
        model: "poolside/laguna-s-2.1",
      },
      origin: "http://localhost",
      allowedOrigins: [],
      sqlite() {
        throw new Error("The model provider does not use SQLite.");
      },
    });
    return Object.assign(implementation, {
      [Symbol.asyncDispose]: () => gateway.close(),
    });
  }),
);

languageModelConformance.test(
  rustServerDependencyTarget({
    name: "Vercel Gateway Rust",
    provider: {
      name: "model",
      dependency: "model",
      ...gatewayProvider.production,
      crate: {
        ...gatewayProvider.production.crate,
        directory: resolve(import.meta.dirname, "providers/server/rust"),
      },
    },
    async configuration() {
      const gateway = await startGateway();
      return {
        values: {
          apiKey: "test-key",
          gateway: gateway.url,
          model: "poolside/laguna-s-2.1",
        },
        dispose: () => gateway.close(),
      };
    },
  }),
);

async function startGateway(): Promise<
  Readonly<{
    url: string;
    close(): Promise<void>;
  }>
> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        response_format?: object;
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  body.response_format === undefined
                    ? "A focused response."
                    : '{"answer":"proceed","reasons":["evidence"]}',
              },
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Gateway fixture has no TCP address.");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
