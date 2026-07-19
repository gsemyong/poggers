import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    include: ["src/**/*.spec.ts"],
    restoreMocks: true,
  },
});
