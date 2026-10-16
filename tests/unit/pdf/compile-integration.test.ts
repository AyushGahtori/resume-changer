import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import {
  buildAchievementSelectionInput,
  recommendAchievements,
} from "../../../src/lib/ai/achievement-selection";
import type { JobAnalysisResult } from "../../../src/lib/ai/contracts";
import { createManualGeneration } from "../../../src/lib/generation/manual-generation";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { describe, expect, it } from "vitest";
import { analyzePdfLayout } from "../../../src/lib/pdf/layout-analysis";
import { compileLatexToPdf } from "../../../src/lib/pdf/compile-service";

const library = sampleLibrary as ResumeLibrary;
const firstAchievementId = library.jobs[0]?.points[0]?.id;

function isExecutableAvailable(executable: string, args: string[]): boolean {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  return !result.error && result.status === 0;
}

const tectonic = process.env.TECTONIC_BINARY ?? "tectonic";
const pdfInfo = process.env.PDFINFO_BINARY ?? "pdfinfo";
const hasLocalToolchain =
  isExecutableAvailable(tectonic, ["--version"]) &&
  isExecutableAvailable(pdfInfo, ["-v"]);
const toolchainRequired = process.env.PDF_TOOLCHAIN_REQUIRED === "1";

if (toolchainRequired && !hasLocalToolchain) {
  throw new Error(
    "The required real PDF integration test needs Tectonic and pdfinfo. Install both or set TECTONIC_BINARY and PDFINFO_BINARY.",
  );
}

async function warmTectonicCache(latex: string) {
  if (process.env.PDF_TOOLCHAIN_WARM_CACHE !== "1") return;

  const directory = await mkdtemp(
    path.join(tmpdir(), "resume-tectonic-warmup-"),
  );
  const texPath = path.join(directory, "resume.tex");
  try {
    await writeFile(texPath, latex, "utf8");
    const result = spawnSync(
      tectonic,
      ["--untrusted", "--keep-logs", "--outdir", directory, texPath],
      {
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
        env: { ...process.env, TECTONIC_UNTRUSTED_MODE: "1" },
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        `Tectonic could not prepare the local package cache. ${result.stderr || result.stdout || result.error?.message || "Unknown compiler error."}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe.skipIf(!hasLocalToolchain)("real local PDF toolchain", () => {
  it("compiles the deterministic resume template to a verified one-page PDF", async () => {
    expect(firstAchievementId).toBeTruthy();
    const resumeLatex = renderResumeLatex({
      library,
      selectedAchievementIds: [firstAchievementId!],
    });

    await warmTectonicCache(resumeLatex);
    const result = await compileLatexToPdf(resumeLatex);

    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.pageCount).toBe(1);
    const analysis = await analyzePdfLayout(result.pdf);
    expect(analysis.layout.pageCount).toBe(1);
    expect(analysis.layout.visibleWordCount).toBeGreaterThan(40);
    expect(analysis.layout.utilization).toBeGreaterThan(0);
    expect(analysis.text).toContain("Jordan Example");
  }, 60_000);

  it("compiles a dense skill library with only two skill rows", async () => {
    const resumeLatex = renderResumeLatex({
      library,
      selectedAchievementIds: [
        "achievement-service-capacity-design",
        "achievement-cloud-deployment-platform",
        "achievement-fieldnotes-geospatial-search",
      ],
      selectedSkillIds: [
        ...library.skills
          .filter((skill) => skill.isListedOnCurrentResume)
          .map((skill) => skill.id),
        "skill-python",
      ],
      jobDescription:
        "Build AWS platform infrastructure and Python services with reliable deployments.",
    });
    expect(resumeLatex.match(/\\ResumeSkillGroup\{/g)).toHaveLength(2);

    await warmTectonicCache(resumeLatex);
    const result = await compileLatexToPdf(resumeLatex);
    expect(result.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.pageCount).toBe(1);
  }, 60_000);

  it("selects evidence across fictional jobs and a project, then compiles the generated resume", async () => {
    const jobDescription =
      "Build AWS cloud deployments, order workflows, and idempotent queue processing.";
    const analysis: JobAnalysisResult = {
      targetTitle: "Platform Engineer",
      seniority: "Entry level",
      requiredQualifications: [
        "AWS environment provisioning",
        "idempotency keys",
      ],
      responsibilities: ["order workflows"],
      preferredQualifications: [],
      toolsAndPlatforms: ["AWS"],
      domainConcepts: ["queue processing"],
      atsTerms: [],
      inferredContext: [],
      terminology: [],
    };
    const input = buildAchievementSelectionInput({
      library,
      jobDescription,
      analysis,
    });
    const recommendation = await recommendAchievements({
      input,
      selectWithAi: async () => ({
        selections: [
          "achievement-cloud-deployment-platform",
          "achievement-orders-api",
          "achievement-queueboard-worker-model",
        ].map((id) => ({
          achievementId: id,
          section: input.achievements.find((point) => point.id === id)!.section,
          confidence: 0.9,
          rationale: "Direct evidence in the fictional library.",
        })),
        requirementCoverage: [],
        skillRecommendations: [],
        confidence: 0.9,
        summary: "Matched fictional platform experience.",
      }),
    });
    const selectedIds = recommendation.recommendations.selections.map(
      (item) => item.achievementId,
    );
    expect(selectedIds).toEqual(
      expect.arrayContaining([
        "achievement-cloud-deployment-platform",
        "achievement-orders-api",
        "achievement-queueboard-worker-model",
      ]),
    );
    expect(recommendation.budget.usedLines).toBeLessThanOrEqual(
      input.contentBudgetLines,
    );

    const generated = createManualGeneration(library, {
      dataSource: "demo",
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobUrl: "",
      jobDescription,
      selectedAchievementIds: selectedIds,
    });
    expect(generated.latex.match(/\\ResumeSkillGroup\{/g)).toHaveLength(2);
    await warmTectonicCache(generated.latex);
    const pdf = await compileLatexToPdf(generated.latex);
    expect(pdf.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.pageCount).toBe(1);
  }, 60_000);

  it("rejects a real two-page document with the one-page diagnostic", async () => {
    const longResume = renderResumeLatex({
      library: {
        ...library,
        jobs: library.jobs.map((job) => ({
          ...job,
          points: job.points.map((point) => ({
            ...point,
            // Keep this comfortably beyond one page even if template spacing changes.
            text: Array.from({ length: 24 }, () => point.text).join(" "),
          })),
        })),
      },
      selectedAchievementIds: library.jobs.flatMap((job) =>
        job.points.map((point) => point.id),
      ),
    });
    await expect(compileLatexToPdf(longResume)).rejects.toMatchObject({
      code: "PAGE_LIMIT_EXCEEDED",
      status: 422,
      diagnostics: expect.stringMatching(
        /^Compiled page count: [2-9]\d*\. Reduce or reprioritize content; template typography and spacing are fixed\.$/,
      ),
    });
  }, 60_000);

  it("returns a useful error for invalid LaTeX from the real compiler", async () => {
    const malformedCommand = renderResumeLatex({
      library,
      selectedAchievementIds: [],
    }).replace("Jordan Example", String.raw`Jordan\definitelyNotALatexCommand`);
    await expect(compileLatexToPdf(malformedCommand)).rejects.toMatchObject({
      code: "LATEX_ERROR",
      status: 422,
    });
  }, 60_000);
});

if (!hasLocalToolchain) {
  console.info(
    "Skipping real PDF toolchain tests: install Tectonic and pdfinfo, or set TECTONIC_BINARY and PDFINFO_BINARY.",
  );
}
