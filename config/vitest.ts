import { resolve } from "node:path";

const root = process.cwd();

export const productionTestTag = {
  name: "production",
  description: "Builds and executes deployable System artifacts.",
} as const;

export const testDefaults = {
  clearMocks: true,
  restoreMocks: true,
  tags: [productionTestTag],
} as const;

export default {
  root,
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${resolve(root, "src")}/$1` }],
    conditions: ["source"],
  },
  test: {
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    ...testDefaults,
    tagsFilter: ["!production"],
  },
};
