import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/account/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
