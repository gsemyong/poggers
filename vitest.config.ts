import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "#ui": resolve(import.meta.dirname, "src/ui") },
  },
});
