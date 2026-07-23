import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { transformPresentationSource } from "./src/compiler/presentation";

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
      {
        find: /^@duction\/kit\/adapter$/,
        replacement: resolve(import.meta.dirname, "src/contracts/platform.ts"),
      },
      {
        find: /^@duction\/kit\/adapters\/server$/,
        replacement: resolve(import.meta.dirname, "src/adapters/server/adapter.ts"),
      },
      {
        find: /^@duction\/kit\/adapters\/web$/,
        replacement: resolve(import.meta.dirname, "src/adapters/web/adapter.ts"),
      },
      {
        find: /^@duction\/kit\/server$/,
        replacement: resolve(import.meta.dirname, "src/platforms/server/platform.ts"),
      },
      {
        find: /^@duction\/kit\/testing$/,
        replacement: resolve(import.meta.dirname, "src/testing.ts"),
      },
      {
        find: /^@duction\/kit\/web$/,
        replacement: resolve(import.meta.dirname, "src/platforms/web/platform.ts"),
      },
      {
        find: /^@duction\/kit\/ui$/,
        replacement: resolve(import.meta.dirname, "src/ui.ts"),
      },
      {
        find: /^@duction\/kit\/jsx-dev-runtime$/,
        replacement: resolve(import.meta.dirname, "src/jsx/development.ts"),
      },
      {
        find: /^@duction\/kit\/jsx-runtime$/,
        replacement: resolve(import.meta.dirname, "src/jsx/runtime.ts"),
      },
      {
        find: /^@duction\/kit$/,
        replacement: resolve(import.meta.dirname, "src/index.ts"),
      },
    ],
    conditions: ["source"],
  },
  test: {
    clearMocks: true,
    include: ["src/**/*.spec.ts", "examples/**/*.spec.ts", "playground/**/*.spec.ts"],
    restoreMocks: true,
  },
});
