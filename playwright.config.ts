import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isCI = Boolean(process.env.CI);
const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3010";
/**
 * The suite reads and writes the local library. Pointing it at a dedicated
 * folder inside the temporary directory keeps a run isolated from real user
 * data and from any other agent working in this repository.
 */
process.env.RESUME_LIBRARY_ROOT = join(
  tmpdir(),
  `resume-changer-playwright-data-${e2ePort}`,
);
const e2eUrl = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  // The suite shares one local data folder, so the specs run in sequence.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  use: {
    baseURL: e2eUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node scripts/start-e2e-server.mjs",
    url: `${e2eUrl}/generate?source=demo`,
    reuseExistingServer: false,
    // The server builds the app before it starts, so the first run needs
    // longer than a plain start-up.
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 10_000,
    },
  },
});
