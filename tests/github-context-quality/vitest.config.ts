import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/github-context-quality/**/*.test.ts"],
    testTimeout: 15_000,
    setupFiles: ["tests/github-context-quality/offline.setup.ts"],
  },
});
