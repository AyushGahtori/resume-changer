import { describe, expect, it } from "vitest";
import type { ManualGenerationResult } from "../../../src/lib/generation/manual-generation";
import {
  HISTORY_SAVED_NOTICE,
  analysisCoverageSentence,
  disabledAchievementPointsCopy,
  createHistoryRequest,
  generateResponseApplies,
  generationStepChip,
  historyNoticeFromResponse,
  historyOutputReady,
  historyUnreachableNotice,
  isSavedHistoryRecord,
  previewCompileControl,
  restoredGenerationSelection,
  savedAnalysisDraftDiffers,
  skillIdsForCoverage,
} from "../../../src/components/resume-generator";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

describe("resume builder audit helpers", () => {
  it("moves the step chip when LaTeX and a PDF exist", () => {
    expect(generationStepChip({ hasLatex: false, hasPdf: false })).toBe(
      "02 / 04",
    );
    expect(generationStepChip({ hasLatex: true, hasPdf: false })).toBe(
      "03 / 04",
    );
    expect(generationStepChip({ hasLatex: true, hasPdf: true })).toBe(
      "04 / 04",
    );
  });

  it("uses rendered skills only after a resume exists", () => {
    expect(skillIdsForCoverage(undefined, ["skill-a"])).toEqual(["skill-a"]);
    expect(skillIdsForCoverage(null, null)).toBeUndefined();
    expect(
      skillIdsForCoverage(["skill-shown"], ["skill-a", "skill-b"]),
    ).toEqual(["skill-shown"]);
  });

  it("does not point at coverage until that list is rendered", () => {
    expect(analysisCoverageSentence(false)).toBe(
      "Suggest points to see how selected evidence supports each one.",
    );
    expect(analysisCoverageSentence(false)).not.toContain("coverage below");
    expect(analysisCoverageSentence(true)).toContain("coverage below");
  });

  it("counts disabled points without calling the library empty", () => {
    expect(disabledAchievementPointsCopy(1)).toBe(
      "1 achievement point is turned off.",
    );
    expect(disabledAchievementPointsCopy(13)).toBe(
      "13 achievement points are turned off.",
    );
    expect(disabledAchievementPointsCopy(13)).not.toContain(
      "no achievement points",
    );
  });

  it("notices a same-role draft whose description was not analyzed", () => {
    expect(
      savedAnalysisDraftDiffers(
        {
          company: "Contoso",
          roleTitle: "Engineer",
          jobDescription: "Original role.",
        },
        {
          company: "Contoso",
          roleTitle: "Engineer",
          jobDescription: "Original role. Also GraphQL.",
        },
      ),
    ).toBe(true);
    expect(
      savedAnalysisDraftDiffers(
        {
          company: "Contoso",
          roleTitle: "Engineer",
          jobDescription: "Original role.",
        },
        {
          company: "Fabrikam",
          roleTitle: "Engineer",
          jobDescription: "Different company.",
        },
      ),
    ).toBe(false);
  });

  it("requires a history id before reporting a save", async () => {
    expect(isSavedHistoryRecord({ entry: { id: "gen-1" } })).toBe(true);
    expect(isSavedHistoryRecord({ id: "gen-1" })).toBe(true);
    expect(isSavedHistoryRecord({})).toBe(false);
    expect(isSavedHistoryRecord({ ok: true })).toBe(false);
    expect(isSavedHistoryRecord(null)).toBe(false);

    await expect(
      historyNoticeFromResponse(jsonResponse({ entry: { id: "gen-1" } }), true),
    ).resolves.toBe(HISTORY_SAVED_NOTICE);
    await expect(
      historyNoticeFromResponse(
        {
          ok: true,
          json: async () => {
            throw new SyntaxError("Unexpected end of JSON input");
          },
        },
        true,
      ),
    ).resolves.toBe(
      "Resume output is ready, but it could not be saved to history. Try again from the History page.",
    );
    const failed = await historyNoticeFromResponse(
      {
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      },
      historyOutputReady("failed"),
    );
    expect(failed).not.toContain("output is ready");
    expect(historyUnreachableNotice(false)).not.toContain("output is ready");
  });

  it("blocks recompile while Studio edits or the selection are unapplied", () => {
    expect(
      previewCompileControl({
        isCompiling: false,
        isGenerating: false,
        hasPdf: true,
        studioPending: true,
        selectionStale: false,
      }),
    ).toEqual({
      disabled: true,
      label: "Recompile last applied version",
    });
    expect(
      previewCompileControl({
        isCompiling: false,
        isGenerating: false,
        hasPdf: true,
        studioPending: false,
        selectionStale: true,
      }),
    ).toEqual({
      disabled: true,
      label: "Recompile last applied version",
    });
    expect(
      previewCompileControl({
        isCompiling: false,
        isGenerating: false,
        hasPdf: true,
        studioPending: false,
        selectionStale: false,
      }).label,
    ).toBe("Recompile");
  });

  it("ignores a generate response after the selection or job changes", () => {
    expect(
      generateResponseApplies({
        requestedJobId: "job-a",
        currentJobId: "job-a",
        submittedAchievementIds: ["a", "b"],
        currentAchievementIds: ["b", "a"],
        submittedSkillIds: null,
        currentSkillIds: null,
        aborted: false,
      }),
    ).toBe(true);
    expect(
      generateResponseApplies({
        requestedJobId: "job-a",
        currentJobId: "job-b",
        submittedAchievementIds: ["a"],
        currentAchievementIds: ["a"],
        submittedSkillIds: null,
        currentSkillIds: null,
        aborted: false,
      }),
    ).toBe(false);
    expect(
      generateResponseApplies({
        requestedJobId: "job-a",
        currentJobId: "job-a",
        submittedAchievementIds: ["a"],
        currentAchievementIds: ["a", "c"],
        submittedSkillIds: ["skill"],
        currentSkillIds: ["skill"],
        aborted: false,
      }),
    ).toBe(false);
  });

  it("sends the generation data source on the history body", () => {
    const withSource = {
      latex: "\\documentclass{article}",
      metadata: {
        id: "gen_123",
        generatedAt: "2026-11-09T12:00:00.000Z",
        company: "Contoso",
        roleTitle: "Engineer",
        dataSource: "demo",
        selectedAchievementIds: ["achievement-1"],
        generatedBullets: [],
        sourceProvenance: [],
        aiProvider: null,
      },
    } as unknown as ManualGenerationResult;
    expect(createHistoryRequest(withSource, "drafted").dataSource).toBe("demo");
    const personal = {
      ...withSource,
      metadata: { ...withSource.metadata, dataSource: undefined },
    } as unknown as ManualGenerationResult;
    expect(createHistoryRequest(personal, "drafted")).not.toHaveProperty(
      "dataSource",
    );
  });

  it("restores the achievement ids stored with the resume", () => {
    expect(
      restoredGenerationSelection({
        selectedAchievementIds: ["one", "two"],
        selectedSkillIds: ["skill"],
      }),
    ).toEqual({
      selectedIds: ["one", "two"],
      selectedSkillIds: ["skill"],
    });
  });
});
