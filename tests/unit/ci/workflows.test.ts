import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The CI pipeline is the contract that protects every pull request, so its
 * shape is asserted here rather than being discovered from a red build.
 */

const repositoryRoot = join(__dirname, "..", "..", "..");
const workflowsDirectory = join(repositoryRoot, ".github", "workflows");

function readWorkflow(name: string): string {
  return readFileSync(join(workflowsDirectory, name), "utf8");
}

const quality = readWorkflow("quality.yml");
const liveIntegrations = readWorkflow("live-integrations.yml");

describe("quality workflow", () => {
  it("runs every quality gate on pull requests and on main", () => {
    expect(quality).toContain("pull_request:");
    expect(quality).toContain("push:");
    expect(quality).toContain("branches: [main]");
  });

  it("installs dependencies before running any check", () => {
    expect(quality).toContain("npm ci");
    expect(quality.indexOf("npm ci")).toBeLessThan(
      quality.indexOf("npm run format:check"),
    );
  });

  it("checks formatting, lint, types, tests, build, and browser tests", () => {
    expect(quality).toContain("npm run format:check");
    expect(quality).toContain("npm run lint");
    expect(quality).toContain("npm run typecheck");
    expect(quality).toContain("npm test");
    expect(quality).toContain("npm run build");
    expect(quality).toContain("npm run test:e2e");
  });

  it("keeps the quality job name stable for branch protection", () => {
    expect(quality).toContain("name: local-quality");
  });

  it("does not depend on any secret", () => {
    expect(quality).not.toContain("secrets.");
  });

  it("caches npm dependencies through setup-node", () => {
    expect(quality).toContain("cache: npm");
  });
});

describe("live integration workflow", () => {
  it("runs the Gemini and PDF toolchain checks on pull requests", () => {
    expect(liveIntegrations).toContain("pull_request:");
    expect(liveIntegrations).toContain("name: Gemini live API");
    expect(liveIntegrations).toContain("name: Real Tectonic and PDF toolchain");
  });

  it("uses the repository secret for the Gemini live check", () => {
    expect(liveIntegrations).toContain(
      "GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}",
    );
    expect(liveIntegrations).toContain("npm run test:ai-live");
  });

  it("fails instead of skipping when the Gemini secret is missing", () => {
    expect(liveIntegrations).toContain("GEMINI_API_KEY is not configured");
    expect(liveIntegrations).toContain("exit 1");
  });

  it("installs and verifies the real PDF toolchain", () => {
    expect(liveIntegrations).toContain("poppler-utils");
    expect(liveIntegrations).toContain("pdfinfo -v");
    expect(liveIntegrations).toContain("tectonic --version");
    expect(liveIntegrations).toContain("npm run test:pdf-live");
  });

  it("does not skip the PDF toolchain when a binary is absent", () => {
    // The live PDF script sets PDF_TOOLCHAIN_REQUIRED, which turns a missing
    // binary into a hard failure instead of a skipped test.
    expect(liveIntegrations).not.toContain("continue-on-error");
  });
});

describe("package scripts", () => {
  const packageJson = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  it("exposes the commands the CI workflow calls", () => {
    for (const script of [
      "format:check",
      "lint",
      "typecheck",
      "test",
      "build",
      "test:e2e",
      "test:ai-live",
      "test:pdf-live",
    ]) {
      expect(packageJson.scripts[script]).toBeTruthy();
    }
  });

  it("checks formatting across sources, tests, scripts, docs, and workflows", () => {
    const formatCheck = packageJson.scripts["format:check"];
    expect(formatCheck).toContain("src/");
    expect(formatCheck).toContain("tests/");
    expect(formatCheck).toContain("scripts/");
    expect(formatCheck).toContain("docs/");
    expect(formatCheck).toContain(".github/");
  });
});

describe("prettier configuration", () => {
  it("keeps the line-ending rule out of the way of the checkout", () => {
    const prettierConfig = JSON.parse(
      readFileSync(join(repositoryRoot, ".prettierrc.json"), "utf8"),
    ) as { endOfLine?: string };
    // "auto" keeps the formatting check meaningful on Windows checkouts, which
    // use CRLF, without weakening it on the LF-only Linux CI runner.
    expect(prettierConfig.endOfLine).toBe("auto");
  });
});
