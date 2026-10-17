import { describe, expect, it, vi } from "vitest";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import sampleJson from "../../../examples/sample-resume-library.json";
import {
  fitResumeToPage,
  MAX_AI_REPAIR_OVERFLOW_WORDS,
} from "../../../src/lib/generation/fit-resume";
import { buildAchievementSelectionInput } from "../../../src/lib/ai/achievement-selection";
import type {
  LatexRepairInput,
  LatexRepairResult,
} from "../../../src/lib/ai/contracts";
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
  it("preserves an explicitly selected skill when fitting removes its source bullet", async () => {
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
    expect(result.generation.metadata.selectedSkillIds).toContain(
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

  it.each([10, MAX_AI_REPAIR_OVERFLOW_WORDS])(
    "repairs a measurable %i-word overflow without changing selected evidence",
    async (overflowWordCount) => {
      const selectedIds = ids.slice(0, 2);
      const overflowText = Array.from(
        { length: overflowWordCount },
        () => "overflow",
      ).join(" ");
      const compile = vi
        .fn()
        .mockResolvedValueOnce({
          pdf: Buffer.from("%PDF-overflow"),
          pageCount: 2,
        })
        .mockResolvedValueOnce({
          pdf: Buffer.from("%PDF-one-page"),
          pageCount: 1,
        });
      const measure = vi
        .fn()
        .mockResolvedValueOnce({
          layout: { ...layout(1), pageCount: 2 },
          text: "Visible first-page text overflowing wording",
          firstPageText: "Visible first-page text",
          overflowText,
          overflowWordCount,
        })
        .mockResolvedValueOnce({
          layout: layout(0.96),
          text: "Shorter repaired output",
        });
      const repairContent = vi.fn(
        async (repairInput: LatexRepairInput): Promise<LatexRepairResult> => ({
          ...repairInput.currentContent,
          achievementText: repairInput.currentContent.achievementText.map(
            (item) => ({
              ...item,
              text: "Built reliable AWS services.",
            }),
          ),
        }),
      );

      const result = await fitResumeToPage({
        library: sample,
        request: { ...request, selectedAchievementIds: selectedIds },
        input,
        scores: new Map(ids.map((id) => [id, 1])),
        compile,
        measure,
        repairContent,
      });

      expect(repairContent).toHaveBeenCalledTimes(1);
      expect(repairContent).toHaveBeenCalledWith(
        expect.objectContaining({
          firstPageText: "Visible first-page text",
          overflowText,
          overflowWordCount,
        }),
      );
      expect(result.generation.metadata.selectedAchievementIds).toEqual(
        selectedIds,
      );
      expect(result.generation.metadata.fitting).toMatchObject({
        attempts: 2,
        repairAttempts: 1,
        status: "filled",
      });
    },
  );

  it("skips AI rewriting for large overflow and prunes the lowest-value point", async () => {
    const selectedIds = ids.slice(0, 4);
    const compile = vi
      .fn()
      .mockResolvedValueOnce({
        pdf: Buffer.from("%PDF-overflow"),
        pageCount: 2,
      })
      .mockResolvedValueOnce({
        pdf: Buffer.from("%PDF-one-page"),
        pageCount: 1,
      });
    const measure = vi
      .fn()
      .mockResolvedValueOnce({
        layout: { ...layout(1), pageCount: 2 },
        text: "First page plus substantial overflow",
        firstPageText: "First page",
        overflowText: Array.from({ length: 41 }, () => "overflow").join(" "),
        overflowWordCount: 41,
      })
      .mockResolvedValueOnce({ layout: layout(0.96), text: "One-page output" });
    const repairContent = vi.fn(
      async (_repairInput: LatexRepairInput): Promise<LatexRepairResult> => {
        throw new Error("A 41-word overflow must skip wording repair.");
      },
    );

    const result = await fitResumeToPage({
      library: sample,
      request: { ...request, selectedAchievementIds: selectedIds },
      input,
      scores: new Map(selectedIds.map((id, index) => [id, index])),
      compile,
      measure,
      repairContent,
    });

    expect(repairContent).not.toHaveBeenCalled();
    expect(result.generation.metadata.selectedAchievementIds).toHaveLength(3);
    expect(result.generation.metadata.selectedAchievementIds).not.toContain(
      selectedIds[0],
    );
    expect(result.generation.metadata.fitting?.repairAttempts).toBe(0);
    expect(result.generation.metadata.fitting?.decisions.join(" ")).toContain(
      "above the 40-word AI repair limit",
    );
  });

  it("rejects a repair that drops a selected point and falls back to priority pruning", async () => {
    const selectedIds = ids.slice(0, 4);
    const compile = vi
      .fn()
      .mockResolvedValueOnce({
        pdf: Buffer.from("%PDF-overflow"),
        pageCount: 2,
      })
      .mockResolvedValueOnce({
        pdf: Buffer.from("%PDF-one-page"),
        pageCount: 1,
      });
    const measure = vi
      .fn()
      .mockResolvedValueOnce({
        layout: { ...layout(1), pageCount: 2 },
        text: "First page with a small overflow",
        firstPageText: "First page",
        overflowText: "A short sentence flowed to page two.",
        overflowWordCount: 8,
      })
      .mockResolvedValueOnce({ layout: layout(0.96), text: "One-page output" });
    const repairContent = vi.fn(
      async (repairInput: LatexRepairInput): Promise<LatexRepairResult> => ({
        ...repairInput.currentContent,
        achievementText: repairInput.currentContent.achievementText.slice(1),
      }),
    );

    const result = await fitResumeToPage({
      library: sample,
      request: { ...request, selectedAchievementIds: selectedIds },
      input,
      scores: new Map(selectedIds.map((id, index) => [id, index])),
      compile,
      measure,
      repairContent,
    });

    expect(repairContent).toHaveBeenCalledTimes(1);
    expect(result.generation.metadata.selectedAchievementIds).toHaveLength(3);
    expect(result.generation.metadata.selectedAchievementIds).not.toContain(
      selectedIds[0],
    );
    expect(result.generation.metadata.fitting?.repairAttempts).toBe(1);
    expect(result.generation.metadata.fitting?.decisions.join(" ")).toContain(
      "Rejected AI repair because it changed selected source evidence",
    );
  });

  it.each(["LATEX_VALIDATION_ERROR", "LATEX_ERROR"] as const)(
    "attempts one structured content repair after %s and never loops indefinitely",
    async (code) => {
      const compileError = new PdfCompileError(
        "The generated content failed LaTeX checks.",
        code,
        "Diagnostic from the validator/compiler",
      );
      const compile = vi.fn(async () => {
        throw compileError;
      });
      const repairContent = vi.fn(
        async (repairInput: LatexRepairInput): Promise<LatexRepairResult> =>
          repairInput.currentContent,
      );

      await expect(
        fitResumeToPage({
          library: sample,
          request,
          input,
          scores: new Map(),
          compile,
          repairContent,
        }),
      ).rejects.toBe(compileError);

      expect(repairContent).toHaveBeenCalledTimes(1);
      expect(compile).toHaveBeenCalledTimes(2);
      expect(repairContent.mock.calls[0][0].diagnostics).toContain(
        "Diagnostic from the validator/compiler",
      );
    },
  );
});
