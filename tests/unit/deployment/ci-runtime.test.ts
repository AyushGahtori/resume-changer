import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const quality = readFileSync(".github/workflows/quality.yml", "utf8");
const live = readFileSync(".github/workflows/live-integrations.yml", "utf8");
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

describe("CI runtime contracts", () => {
  it.each(["account-security", "browser-regressions", "github-import-journey"])(
    "%s uses browsers matching the locked Playwright package without apt installation",
    (name) => {
      const job = quality.split(`  ${name}:`)[1].split(/\n  [a-z][a-z-]+:/)[0];
      const version = lock.packages["node_modules/@playwright/test"].version;
      expect(job).toContain(
        `image: mcr.microsoft.com/playwright:v${version}-noble`,
      );
      expect(job).not.toContain("playwright install");
      expect(job).not.toContain("continue-on-error");
      expect(job).toContain("npm ci");
    },
  );
  it("retains the security, sharded browser and import test gates", () => {
    expect(quality).toContain("run: npm run test:security");
    expect(quality).toContain(
      "npm run test:e2e -- --shard=${{ matrix.shard }}/4",
    );
    expect(quality).toContain("run: npm run test:github-journey");
  });
  it("checks for preinstalled pdfinfo and keeps the real PDF verification", () => {
    expect(live).toContain("if ! command -v pdfinfo");
    expect(live).toContain("Acquire::Retries=5");
    expect(live).toContain("run: npm run test:pdf-live");
  });
  it("lets every live test outlast the provider's ten-minute request budget", () => {
    const tests = readFileSync("tests/unit/ai/gemini-live.test.ts", "utf8");
    const provider = readFileSync("src/lib/ai/gemini-provider-core.ts", "utf8");
    const budget = Number(
      provider
        .match(/TOTAL_REQUEST_BUDGET_MS = ([\d_]+)/)![1]
        .replaceAll("_", ""),
    );
    const timeout = Number(
      tests.match(/LIVE_TEST_TIMEOUT_MS = ([\d_]+)/)![1].replaceAll("_", ""),
    );
    expect(timeout).toBeGreaterThan(budget);
    expect(live).toContain("timeout-minutes: 40");
    expect(live).toContain("npm run test:ai-live");
  });
});
