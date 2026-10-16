import { describe, expect, it, vi } from "vitest";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import sampleJson from "../../../examples/sample-resume-library.json";
import { fitResumeToPage } from "../../../src/lib/generation/fit-resume";
import { buildAchievementSelectionInput } from "../../../src/lib/ai/achievement-selection";
import { PdfCompileError } from "../../../src/lib/pdf/compile-service";
import type { PdfLayout } from "../../../src/lib/pdf/layout-analysis";

const sample = sampleJson as ResumeLibrary;
const analysis = {
  targetTitle: "Engineer",
  seniority: "Early",
  requiredQualifications: ["AWS"],
  preferredQualifications: [],
  responsibilities: [],
  toolsAndPlatforms: [],
  domainConcepts: [],
  atsTerms: [],
  inferredContext: [],
  terminology: [],
};
const input = buildAchievementSelectionInput({
  library: sample,
  analysis,
  jobDescription: "Build AWS services.",
});
const ids = input.achievements.map((point) => point.id);
const request = {
  dataSource: "demo" as const,
  company: "Example",
  roleTitle: "Engineer",
  jobUrl: "",
  jobDescription: "Build AWS services.",
  selectedAchievementIds: [ids[0]],
};
const layout = (utilization: number): PdfLayout => ({
  utilization,
  visibleWordCount: 500,
  pageCount: 1,
  pageWidth: 612,
  pageHeight: 792,
  contentTop: 35,
  contentBottom: 740,
  usableHeight: 727.2,
  bottomGap: 19.6,
  clipped: false,
});

describe("bounded measured resume fitting", () => {
  it("adds relevant source evidence until measured fill is sufficient and returns final coverage", async () => {
    const compile = vi.fn(async () => ({
      pdf: Buffer.from("%PDF-test"),
      pageCount: 1,
    }));
    const measure = vi
      .fn()
      .mockResolvedValueOnce({ layout: layout(0.7), text: "" })
      .mockResolvedValue({ layout: layout(0.96), text: "" });
    const result = await fitResumeToPage({
      library: sample,
      request,
      input,
      scores: new Map(ids.map((id) => [id, 1])),
      compile,
      measure,
    });
    expect(compile).toHaveBeenCalledTimes(2);
    expect(result.generation.metadata.selectedAchievementIds).toHaveLength(2);
    expect(result.generation.metadata.fitting?.status).toBe("filled");
    expect(result.generation.metadata.finalCoverage).toHaveLength(1);
    expect(result.generation.metadata.visibleWordCount).toBe(500);
  });
  it("removes a whole low-value bullet after overflow while retaining one-page evidence", async () => {
    const compile = vi
      .fn()
      .mockRejectedValueOnce(
        new PdfCompileError("Overflow", "PAGE_LIMIT_EXCEEDED"),
      )
      .mockResolvedValue({ pdf: Buffer.from("%PDF-test"), pageCount: 1 });
    const result = await fitResumeToPage({
      library: sample,
      request: { ...request, selectedAchievementIds: ids.slice(0, 4) },
      input,
      scores: new Map(ids.map((id) => [id, 1])),
      compile,
      measure: async () => ({ layout: layout(0.97), text: "" }),
    });
    expect(result.generation.metadata.selectedAchievementIds).toHaveLength(3);
    expect(result.generation.metadata.fitting?.decisions.join(" ")).toContain(
      "overflow",
    );
  });
  it("removes unsupported unlisted skills when fitting removes their source", async () => {
    const library = structuredClone(sample);
    const candidate = library.jobs[0].points[0];
    library.skills.push({
      id: "skill-exclusive",
      name: "Exclusive Tool",
      aliases: [],
      sources: ["direct-user"],
      isListedOnCurrentResume: false,
      evidenceAchievementIds: [candidate.id],
    });
    const localInput = buildAchievementSelectionInput({
      library,
      analysis,
      jobDescription: "Build AWS services.",
    });
    const compile = vi
      .fn()
      .mockRejectedValueOnce(
        new PdfCompileError("Overflow", "PAGE_LIMIT_EXCEEDED"),
      )
      .mockResolvedValue({ pdf: Buffer.from("%PDF-test"), pageCount: 1 });
    const result = await fitResumeToPage({
      library,
      input: localInput,
      request: {
        ...request,
        selectedAchievementIds: ids.slice(0, 4),
        selectedSkillIds: ["skill-exclusive"],
      },
      scores: new Map([
        [candidate.id, 0],
        ...ids.slice(1).map((id) => [id, 2] as [string, number]),
      ]),
      compile,
      measure: async () => ({ layout: layout(0.97), text: "" }),
    });
    expect(result.generation.metadata.selectedAchievementIds).not.toContain(
      candidate.id,
    );
    expect(result.generation.metadata.selectedSkillIds).not.toContain(
      "skill-exclusive",
    );
  });

  it("reports exhausted evidence and unavailable measurement without pretending the page is full", async () => {
    const compile = async () => ({
      pdf: Buffer.from("%PDF-test"),
      pageCount: 1,
    });
    const underfilled = await fitResumeToPage({
      library: sample,
      request,
      input,
      scores: new Map(),
      compile,
      measure: async () => ({ layout: layout(0.5), text: "" }),
    });
    expect(underfilled.generation.metadata.fitting?.status).toBe("underfilled");
    const unavailable = await fitResumeToPage({
      library: sample,
      request,
      input,
      scores: new Map(),
      compile,
      measure: async () => {
        throw new Error("No readable text");
      },
    });
    expect(unavailable.generation.metadata.fitting?.status).toBe(
      "measurement-unavailable",
    );
  });
  it("caps fitting at six compilations and propagates actual compiler failures", async () => {
    const compile = vi.fn(async () => ({
      pdf: Buffer.from("%PDF-test"),
      pageCount: 1,
    }));
    const result = await fitResumeToPage({
      library: sample,
      request,
      input,
      scores: new Map(ids.map((id) => [id, 1])),
      compile,
      measure: async () => ({ layout: layout(0.6), text: "" }),
    });
    expect(compile).toHaveBeenCalledTimes(6);
    expect(result.generation.metadata.fitting?.status).toBe("underfilled");
    await expect(
      fitResumeToPage({
        library: sample,
        request,
        input,
        scores: new Map(),
        compile: async () => {
          throw new PdfCompileError("Broken toolchain", "COMPILER_NOT_FOUND");
        },
      }),
    ).rejects.toThrow("Broken toolchain");
  });
});
