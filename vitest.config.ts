import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { transformPresentationSource } from "./src/compiler/presentation";
import { packageSourceAliases } from "./src/package";

export default defineConfig({
  plugins: [
    {
      name: "kit-presentation-test-transform",
      enforce: "pre",
      transform(source, id) {
        const file = id.split("?", 1)[0]!;
        if (
          (!file.includes("/examples/") && !file.includes("/playground/")) ||
          !file.includes("/presentations/")
        ) {
          return;
        }
        if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) return;
        return { code: transformPresentationSource(source, file), map: null };
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: `${resolve(import.meta.dirname, "src")}/$1`,
      },
      ...packageSourceAliases(resolve(import.meta.dirname, "src"), ".ts"),
    ],
    conditions: ["source"],
  },
  test: {
    clearMocks: true,
    include: ["src/**/*.spec.ts", "examples/**/*.spec.ts", "playground/**/*.spec.ts"],
    maxWorkers: 2,
    restoreMocks: true,
    tags: [
      {
        name: "compiler",
        description: "Compiles or executes generated Programs through a production backend.",
      },
      {
        name: "provider",
        description: "Runs TypeScript conformance against production Dependency providers.",
      },
      {
        name: "production",
        description: "Builds and executes deployable System artifacts.",
      },
    ],
  },
});
