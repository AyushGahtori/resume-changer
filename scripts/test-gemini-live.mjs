import nextEnv from "@next/env";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

if (!process.env.GEMINI_API_KEY) {
  console.error("Set GEMINI_API_KEY in .env.local before running this test.");
  process.exit(1);
}

process.env.GEMINI_LIVE_TEST = "1";
const vitestPath = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [vitestPath, "run", "tests/unit/ai/gemini-live.test.ts"],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  console.error("Could not start the Gemini live test.");
  process.exit(1);
}
process.exit(result.status ?? 1);
