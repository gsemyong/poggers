import { resolve } from "node:path";

const root = process.cwd();

export default {
  root,
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${resolve(root, "src")}/$1` }],
    conditions: ["source"],
  },
  test: {
    clearMocks: true,
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    passWithNoTests: true,
    restoreMocks: true,
    tags: [
      {
        name: "production",
        description: "Builds and executes deployable System artifacts.",
      },
    ],
    tagsFilter: ["!production"],
  },
};
