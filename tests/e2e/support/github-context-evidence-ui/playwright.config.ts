import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const port = process.env.PLAYWRIGHT_CONTEXT_EVIDENCE_PORT ?? "3011";
process.env.PLAYWRIGHT_PORT = port;
process.env.NEXT_DIST_DIR ??= ".next-test";
process.env.NEXT_TSCONFIG ??= "tsconfig.e2e.json";
process.env.RESUME_LIBRARY_ROOT = join(
  tmpdir(),
  `resume-changer-playwright-data-${port}`,
);

const baseURL = `http://127.0.0.1:${port}`;
const useExternalServer =
  process.env.PLAYWRIGHT_CONTEXT_EVIDENCE_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: resolve(process.cwd(), "tests/e2e"),
  testMatch: ["github-context-evidence-ui.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  ...(useExternalServer
    ? {}
    : {
        webServer: {
          command: "node scripts/start-e2e-server.mjs",
          cwd: process.cwd(),
          url: `${baseURL}/generate?source=demo`,
          reuseExistingServer: false,
          timeout: 900_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
          gracefulShutdown: {
            signal: "SIGTERM",
            timeout: 10_000,
          },
        },
      }),
});
