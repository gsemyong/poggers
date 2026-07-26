import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

import { transformPresentationSource } from "./src/compiler/presentation";
import { packageSources } from "./src/package";

export default defineConfig({
  plugins: [
    {
      name: "kit-owned-source-alias",
      enforce: "pre",
      resolveId(id, importer) {
        const example = importer?.split("?", 1)[0]?.match(/^(.*\/examples\/[^/]+)\//)?.[1];
        const packageSource = packageSources[id as keyof typeof packageSources];
        if (packageSource) {
          const source = example ? "dist/source" : "src";
          return resolve(import.meta.dirname, source, `${packageSource}.ts`);
        }
        if (!id.startsWith("@/")) return;
        const source = example ? resolve(example, "src") : resolve(import.meta.dirname, "src");
        return this.resolve(resolve(source, id.slice(2)), importer, { skipSelf: true });
      },
    },
    {
      name: "kit-presentation-test-transform",
      enforce: "pre",
      transform(source, id) {
        const file = id.split("?", 1)[0]!;
        if (!file.includes("/examples/") || !file.includes("/presentations/")) {
          return;
        }
        if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) return;
        return { code: transformPresentationSource(source, file), map: null };
      },
    },
  ],
  resolve: {
    conditions: ["source"],
  },
  test: {
    clearMocks: true,
    include: ["src/**/*.spec.ts", "examples/**/*.spec.ts"],
    maxWorkers: 2,
    restoreMocks: true,
    tags: [
      {
        name: "compiler",
        description: "Compiles or executes generated Programs through a production backend.",
      },
      {
        name: "package",
        description: "Exercises built package boundaries and example consumers.",
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
