import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAiProvider } from "../../../src/lib/ai/provider-factory";

const repositoryRoot = process.cwd();
const read = (relativePath: string) =>
  readFile(join(repositoryRoot, relativePath), "utf8");

/**
 * The setup guide is only useful while it matches the code. These checks fail
 * when an environment variable, provider value, or error code changes without
 * the documentation being updated.
 */
describe("setup guide documentation", () => {
  it("documents every environment variable the application reads", async () => {
    const [guide, envExample, localSetup] = await Promise.all([
      read("docs/setup-guide.md"),
      read(".env.example"),
      read("docs/local-setup.md"),
    ]);

    const variables = [
      "AI_PROVIDER",
      "GEMINI_API_KEY",
      "GEMINI_MODEL",
      "RESUME_LIBRARY_ROOT",
      "TECTONIC_BINARY",
      "PDFINFO_BINARY",
    ];

    for (const variable of variables) {
      expect(guide, `${variable} must appear in the setup guide`).toContain(
        variable,
      );
      expect(envExample, `${variable} must appear in .env.example`).toContain(
        variable,
      );
    }

    // The shorter developer guide must point at the complete reference.
    expect(localSetup).toContain("setup-guide.md");
  });

  it("keeps the sample environment file free of real credentials", async () => {
    const envExample = await read(".env.example");

    expect(envExample).toContain("AI_PROVIDER=gemini");
    expect(envExample).toContain("GEMINI_API_KEY=replace-with-");

    // No value in the tracked file may look like a real credential.
    expect(envExample).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(envExample).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    expect(envExample).not.toMatch(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}/);

    // A secret-bearing variable must carry a placeholder, never a literal.
    const secretVariables = [
      "GEMINI_API_KEY",
      "DEEPSEEK_API_KEY",
      "OPENAI_API_KEY",
    ];
    for (const variable of secretVariables) {
      const match = new RegExp(`^${variable}=(.*)$`, "m").exec(envExample);
      if (!match) continue;
      expect(
        match[1].startsWith("replace-with-") || match[1] === "",
        `${variable} must use a placeholder value in .env.example`,
      ).toBe(true);
    }
  });

  it("documents only provider values the factory accepts", async () => {
    const guide = await read("docs/setup-guide.md");
    const envExample = await read(".env.example");

    for (const provider of ["gemini", "mock"]) {
      expect(guide).toContain(`\`${provider}\``);
      expect(envExample).toContain(provider);
    }
    expect(guide).not.toMatch(/AI_PROVIDER=deepseek/);
  });

  it("documents the provider error codes the application can report", async () => {
    const guide = await read("docs/setup-guide.md");

    for (const code of [
      "MISSING_API_KEY",
      "AUTHENTICATION_FAILED",
      "RATE_LIMITED",
      "REQUEST_TIMEOUT",
      "INVALID_RESPONSE",
      "INPUT_TOO_LARGE",
      "COMPILER_NOT_FOUND",
      "PDF_INFO_NOT_FOUND",
      "LATEX_ERROR",
      "LATEX_VALIDATION_ERROR",
      "PAGE_LIMIT_EXCEEDED",
      "COMPILE_TIMEOUT",
    ]) {
      expect(guide, `${code} must be documented`).toContain(code);
    }
  });

  it("points the reader at the tracked example and the ignored data directory", async () => {
    const guide = await read("docs/setup-guide.md");

    expect(guide).toContain("examples/sample-resume-library.json");
    expect(guide).toContain("data/resume-library.json");
    expect(guide).toContain(".env.local");
  });

  it("explains the provider interface without inventing a second contract", async () => {
    const guide = await read("docs/setup-guide.md");

    expect(guide).toContain("src/lib/ai/provider.ts");
    expect(guide).toContain("src/lib/ai/provider-factory.ts");
    expect(guide).toContain("src/lib/ai/contracts.ts");
    expect(guide).toContain("analyzeJobDescription");
    expect(guide).toContain("selectAchievements");
    expect(guide).toContain("draftResume");
    expect(guide).toContain("repairLatexContent");
  });
});

describe("documented provider values", () => {
  it("accepts the mock provider without a key, as the guide states", () => {
    expect(createAiProvider({ AI_PROVIDER: "mock" }).name).toBe("mock");
  });

  it("rejects a provider value the guide does not list", () => {
    expect(() => createAiProvider({ AI_PROVIDER: "deepseek" })).toThrow(
      expect.objectContaining({ code: "REQUEST_FAILED" }),
    );
  });
});
