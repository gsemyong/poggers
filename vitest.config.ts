import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { transformPresentationSource } from "./src/core/compiler/presentation";

export default defineConfig({
  plugins: [
    {
      name: "poggers-presentation-test-transform",
      enforce: "pre",
      transform(source, id) {
        const file = id.split("?", 1)[0]!;
        if (!file.includes("/examples/") || !file.endsWith("/presentation.ts")) return;
        return { code: transformPresentationSource(source, file), map: null };
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: /^@poggers\/kit\/web\/presentation$/,
        replacement: resolve(import.meta.dirname, "src/adapters/web/presentation/index.ts"),
      },
      {
        find: /^@poggers\/kit\/web$/,
        replacement: resolve(import.meta.dirname, "src/adapters/web/public.ts"),
      },
      {
        find: /^@poggers\/kit\/jsx-dev-runtime$/,
        replacement: resolve(import.meta.dirname, "src/core/jsx/development.ts"),
      },
      {
        find: /^@poggers\/kit\/jsx-runtime$/,
        replacement: resolve(import.meta.dirname, "src/core/jsx/runtime.ts"),
      },
      {
        find: /^@poggers\/kit$/,
        replacement: resolve(import.meta.dirname, "src/index.ts"),
      },
    ],
    conditions: ["poggers-source"],
  },
  test: {
    clearMocks: true,
    include: ["src/**/*.spec.ts", "examples/**/*.spec.ts"],
    restoreMocks: true,
  },
});
