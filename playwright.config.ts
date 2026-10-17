import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.RESUME_LIBRARY_ROOT = join(
  tmpdir(),
  "resume-changer-playwright-data",
);
const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3010";
const e2eUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: e2eUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    url: e2eUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
