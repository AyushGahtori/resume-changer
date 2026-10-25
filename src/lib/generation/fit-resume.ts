import type {
  LatexRepairInput,
  LatexRepairResult,
  AchievementSelectionInput,
} from "../ai/contracts";
import { assessRequirementCoverage } from "../ai/requirement-coverage";
import { coverageUtility } from "../ai/achievement-selection";
import { buildSkillEvidence } from "../ai/evidence";
import { buildEvidenceSummary, enrichSourceText } from "../ai/draft-quality";
import { compileLatexToPdf, PdfCompileError } from "../pdf/compile-service";
import { analyzePdfLayout, type PdfLayout } from "../pdf/layout-analysis";
import {
  createManualGeneration,
  type ManualGenerationRequest,
  type ManualGenerationResult,
} from "./manual-generation";
import type { ResumeLibrary } from "../schemas/resume-data";
import { assessResumeQuality } from "./resume-quality";

export const MAX_AI_REPAIR_OVERFLOW_WORDS = 40;
const MAX_AI_REPAIR_ATTEMPTS = 1;
const MAX_FIT_ATTEMPTS = 6;

type Compile = (latex: string) => Promise<{ pdf: Buffer; pageCount: number }>;
type Measure = (pdf: Uint8Array) => Promise<{
  layout: PdfLayout;
  text: string;
  firstPageText?: string;
  topThirdText?: string;
  overflowText?: string;
  overflowWordCount?: number;
}>;
function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function currentRepairContent(
  generation: ManualGenerationResult,
): LatexRepairResult {
  return {
    summary: "Shorten the selected resume content to fit the approved page.",
    ...(generation.metadata.resumeSummary
      ? { resumeSummary: generation.metadata.resumeSummary }
      : {}),
    achievementText: generation.metadata.generatedBullets.map((bullet) => ({
      achievementId: bullet.achievementId,
      sourceAchievementIds: bullet.sourceAchievementIds,
      text: bullet.text,
    })),
  };
}

function hasSameEvidence(
  current: LatexRepairResult,
  repaired: LatexRepairResult,
): boolean {
  if (current.achievementText.length !== repaired.achievementText.length)
    return false;
  const repairedById = new Map(
    repaired.achievementText.map((item) => [item.achievementId, item]),
  );
  return current.achievementText.every((item) => {
    const returned = repairedById.get(item.achievementId);
    const originalIds = [...(item.sourceAchievementIds ?? [item.achievementId])]
      .sort()
      .join("\0");
    const returnedIds = returned
      ? [...(returned.sourceAchievementIds ?? [returned.achievementId])]
          .sort()
          .join("\0")
      : "";
    return Boolean(returned && originalIds === returnedIds);
  });
}

function repairDiagnostics(values: string[]): string[] {
  const diagnostics = values
    .flatMap((value) => value.split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-10)
    .map((line) => line.slice(0, 500));
  return diagnostics.length
    ? diagnostics
    : ["Resume content needs a bounded wording repair to pass validation."];
}

export async function fitResumeToPage(args: {
  library: ResumeLibrary;
  request: ManualGenerationRequest;
  input: AchievementSelectionInput;
  scores: Map<string, number>;
  compile?: Compile;
  measure?: Measure;
  repairContent?: (input: LatexRepairInput) => Promise<LatexRepairResult>;
}): Promise<{ generation: ManualGenerationResult; pdf: Buffer }> {
  const compile =
    args.compile ??
    ((latex: string) => compileLatexToPdf(latex, { allowPageOverflow: true }));
  const measure = args.measure ?? analyzePdfLayout;
  const request = structuredClone(args.request);
  const evidence = new Map(
    args.input.achievements.map((point) => [point.id, point]),
  );
  const reserve = args.input.achievements
    .filter(
      (point) =>
        !request.selectedAchievementIds.includes(point.id) &&
        (args.scores.get(point.id) ?? 0) > 0,
    )
    .sort(
      (a, b) => (args.scores.get(b.id) ?? 0) - (args.scores.get(a.id) ?? 0),
    );
  const decisions: string[] = [];
  const explicitlySelectedSkillIds = new Set(
    args.request.selectedSkillIds ?? [],
  );
  let best:
    | { generation: ManualGenerationResult; pdf: Buffer; distance: number }
    | undefined;
  let lastError: unknown;
  let attempts = 0;
  let repairAttempts = 0;
  const log = (message: string, _data?: unknown) => {
    decisions.push(message);
  };

  const tryRepair = async (
    generation: ManualGenerationResult,
    diagnostics: string[],
    options: {
      firstPageText?: string;
      overflowText?: string;
      overflowWordCount?: number;
      requireShorter: boolean;
    },
  ): Promise<boolean> => {
    if (!args.repairContent || repairAttempts >= MAX_AI_REPAIR_ATTEMPTS)
      return false;
    repairAttempts += 1;
    const currentContent = currentRepairContent(generation);
    log("Requested a bounded AI repair of structured resume wording.", {
      repairAttempt: repairAttempts,
      diagnostics,
      overflowWordCount: options.overflowWordCount,
    });
    let repaired: LatexRepairResult;
    try {
      repaired = await args.repairContent({
        currentContent,
        diagnostics: repairDiagnostics(diagnostics),
        ...(options.firstPageText
          ? { firstPageText: options.firstPageText.slice(0, 20_000) }
          : {}),
        ...(options.overflowText
          ? { overflowText: options.overflowText.slice(0, 20_000) }
          : {}),
        ...(options.overflowWordCount !== undefined
          ? { overflowWordCount: options.overflowWordCount }
          : {}),
      });
    } catch (error) {
      log(
        "AI resume-content repair failed; deterministic fitting will continue.",
        {
          error:
            error instanceof Error ? error.message : "Unknown repair error.",
        },
      );
      return false;
    }

    if (!hasSameEvidence(currentContent, repaired)) {
      log("Rejected AI repair because it changed selected source evidence.");
      return false;
    }

    const currentText = [
      currentContent.resumeSummary ?? "",
      ...currentContent.achievementText.map((item) => item.text),
    ].join(" ");
    const repairedText = [
      repaired.resumeSummary ?? currentContent.resumeSummary ?? "",
      ...repaired.achievementText.map((item) => item.text),
    ].join(" ");
    if (
      options.requireShorter &&
      wordCount(repairedText) >= wordCount(currentText)
    ) {
      log(
        "AI repair did not reduce the rendered word count; deterministic fitting will continue.",
        {
          before: wordCount(currentText),
          after: wordCount(repairedText),
        },
      );
      return false;
    }

    const repairedById = new Map(
      repaired.achievementText.map((item) => [item.achievementId, item]),
    );
    request.achievementTextOverrides = generation.metadata.generatedBullets.map(
      (bullet) => ({
        achievementId: bullet.achievementId,
        sourceAchievementIds: bullet.sourceAchievementIds,
        ...(bullet.inferredTerms
          ? { inferredTerms: bullet.inferredTerms }
          : {}),
        text: repairedById.get(bullet.achievementId)!.text,
      }),
    );
    if (repaired.resumeSummary?.trim())
      request.summaryOverride = repaired.resumeSummary;
    log(
      "Applied evidence-validated AI wording repair without changing source selection.",
      {
        repairAttempt: repairAttempts,
        beforeWords: wordCount(currentText),
        afterWords: wordCount(repairedText),
      },
    );
    return true;
  };

  for (; attempts < MAX_FIT_ATTEMPTS; attempts++) {
    const selectedSourceIds = new Set(request.selectedAchievementIds);
    request.selectedSkillIds = buildSkillEvidence(args.library)
      .filter(
        (skill) =>
          skill.isListedOnCurrentResume ||
          explicitlySelectedSkillIds.has(skill.id) ||
          skill.evidenceAchievementIds.some((id) => selectedSourceIds.has(id)),
      )
      .map((skill) => skill.id);
    const generation = createManualGeneration(args.library, request, {
      analysis: args.input.analysis,
    });
    log(`Measured fitting attempt ${attempts + 1}.`, {
      selected: request.selectedAchievementIds,
      estimatedVisibleWords: generation.metadata.visibleWordCount,
    });
    try {
      const compiled = await compile(generation.latex);
      let measured: Awaited<ReturnType<Measure>>;
      try {
        measured = await measure(compiled.pdf);
      } catch (error) {
        if (compiled.pageCount !== 1)
          throw new PdfCompileError(
            "The PDF exceeded one page and its overflow could not be measured.",
            "PAGE_LIMIT_EXCEEDED",
            error instanceof Error
              ? error.message
              : "Layout measurement failed.",
          );
        generation.metadata.fitting = {
          attempts: attempts + 1,
          repairAttempts,
          decisions: [
            ...decisions,
            error instanceof Error
              ? error.message
              : "Layout measurement failed.",
          ],
          status: "measurement-unavailable",
        };
        generation.metadata.qualityReport = assessResumeQuality({
          library: args.library,
          input: args.input,
          metadata: generation.metadata,
        });
        return { generation, pdf: compiled.pdf };
      }
      generation.metadata.layout = measured.layout;
      generation.metadata.visibleWordCount = measured.layout.visibleWordCount;
      const texts = new Map(
        generation.metadata.generatedBullets.flatMap((bullet) =>
          bullet.sourceAchievementIds.map((id) => [id, bullet.text] as const),
        ),
      );
      generation.metadata.finalCoverage = assessRequirementCoverage(
        args.input,
        request.selectedAchievementIds,
        {
          renderedSkillIds: generation.metadata.renderedSkillIds,
          renderedTexts: texts,
          summary: generation.metadata.resumeSummary,
          inferredTermsById: new Map(
            generation.metadata.generatedBullets.flatMap((bullet) =>
              bullet.sourceAchievementIds.map(
                (id) => [id, bullet.inferredTerms ?? []] as const,
              ),
            ),
          ),
        },
      );
      generation.metadata.qualityReport = assessResumeQuality({
        library: args.library,
        input: args.input,
        metadata: generation.metadata,
        pdfText: measured.firstPageText ?? measured.text,
        topThirdText: measured.topThirdText,
        layout: measured.layout,
      });
      const overflows =
        compiled.pageCount !== 1 ||
        measured.layout.pageCount !== 1 ||
        measured.layout.clipped;
      if (overflows) {
        const overflowWordCount =
          measured.overflowWordCount ?? wordCount(measured.overflowText ?? "");
        if (
          overflowWordCount > 0 &&
          overflowWordCount <= MAX_AI_REPAIR_OVERFLOW_WORDS &&
          (measured.overflowText?.trim() ?? "")
        ) {
          const repaired = await tryRepair(
            generation,
            [
              `The resume is over the one-page limit by ${overflowWordCount} words.`,
              "Content visible on page one:",
              measured.firstPageText ?? measured.text,
              "Content that flowed to page two or later:",
              measured.overflowText!,
            ],
            {
              firstPageText: measured.firstPageText ?? measured.text,
              overflowText: measured.overflowText,
              overflowWordCount,
              requireShorter: true,
            },
          );
          if (repaired) continue;
        }
        const reason =
          overflowWordCount > MAX_AI_REPAIR_OVERFLOW_WORDS
            ? `Overflow was ${overflowWordCount} words, above the ${MAX_AI_REPAIR_OVERFLOW_WORDS}-word AI repair limit.`
            : "The overflow was too small to measure reliably or could not be repaired.";
        log(reason, {
          overflowWordCount,
          aiRepairLimit: MAX_AI_REPAIR_OVERFLOW_WORDS,
        });
        throw new PdfCompileError(
          "Resume content exceeds the approved one-page limit.",
          "PAGE_LIMIT_EXCEEDED",
          reason,
        );
      }

      const distance = Math.abs(0.975 - measured.layout.utilization);
      if (!best || distance < best.distance)
        best = { generation, pdf: compiled.pdf, distance };
      if (measured.layout.utilization >= 0.95) {
        generation.metadata.fitting = {
          attempts: attempts + 1,
          repairAttempts,
          decisions,
          status: "filled",
        };
        return { generation, pdf: compiled.pdf };
      }
      const presentValue = coverageUtility(
        args.input,
        request.selectedAchievementIds,
      );
      reserve.sort((a, b) => {
        const value = (point: typeof a) => {
          const gain =
            coverageUtility(args.input, [
              ...request.selectedAchievementIds,
              point.id,
            ]) - presentValue;
          const estimatedLines = Math.max(
            1,
            wordCount(enrichSourceText(point)) / 19,
          );
          return (
            gain / estimatedLines + (args.scores.get(point.id) ?? 0) * 0.01
          );
        };
        return value(b) - value(a);
      });
      const next = reserve.shift();
      if (!next) {
        log(
          "No additional relevant source remains; kept the strongest one-page result without padding.",
        );
        break;
      }
      request.selectedAchievementIds.push(next.id);
      request.achievementTextOverrides = [
        ...(request.achievementTextOverrides ?? []),
        {
          achievementId: next.id,
          sourceAchievementIds: [next.id],
          text: enrichSourceText(next),
        },
      ];
      log("Added a relevant reserve achievement to use available page space.", {
        achievementId: next.id,
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof PdfCompileError)) throw error;
      if (
        error.code === "LATEX_VALIDATION_ERROR" ||
        error.code === "LATEX_ERROR"
      ) {
        const repaired = await tryRepair(
          generation,
          [error.message, error.diagnostics],
          { requireShorter: false },
        );
        if (repaired) continue;
        throw error;
      }
      if (error.code !== "PAGE_LIMIT_EXCEEDED") throw error;

      const groups = new Map<string, number>();
      for (const bullet of generation.metadata.generatedBullets) {
        const point = evidence.get(bullet.achievementId)!;
        groups.set(point.groupId, (groups.get(point.groupId) ?? 0) + 1);
      }
      const coverageOptions = {
        renderedTexts: new Map(
          generation.metadata.generatedBullets.flatMap((bullet) =>
            bullet.sourceAchievementIds.map((id) => [id, bullet.text] as const),
          ),
        ),
        renderedSkillIds: generation.metadata.renderedSkillIds,
        summary: generation.metadata.resumeSummary,
      };
      const currentValue = coverageUtility(
        args.input,
        request.selectedAchievementIds,
        coverageOptions,
      );
      const coverageLossPerLine = (
        bullet: (typeof generation.metadata.generatedBullets)[number],
      ) => {
        const without = request.selectedAchievementIds.filter(
          (id) => !bullet.sourceAchievementIds.includes(id),
        );
        return (
          (currentValue -
            coverageUtility(args.input, without, coverageOptions)) /
          Math.max(1, wordCount(bullet.text) / 19)
        );
      };
      const sorted = [...generation.metadata.generatedBullets].sort((a, b) => {
        const left = evidence.get(a.achievementId)!,
          right = evidence.get(b.achievementId)!;
        const leftProtected =
          (groups.get(left.groupId) ?? 0) <=
          (left.section === "experience" ? 3 : 1);
        const rightProtected =
          (groups.get(right.groupId) ?? 0) <=
          (right.section === "experience" ? 3 : 1);
        return (
          Number(leftProtected) - Number(rightProtected) ||
          coverageLossPerLine(a) - coverageLossPerLine(b) ||
          (args.scores.get(a.achievementId) ?? 0) -
            (args.scores.get(b.achievementId) ?? 0)
        );
      });
      const remove = sorted[0];
      if (!remove || sorted.length <= 1) break;
      const excluded = new Set(remove.sourceAchievementIds);
      request.selectedAchievementIds = request.selectedAchievementIds.filter(
        (id) => !excluded.has(id),
      );
      request.achievementTextOverrides =
        request.achievementTextOverrides?.filter(
          (item) => !excluded.has(item.achievementId),
        );
      request.summaryOverride = buildEvidenceSummary({
        achievements: request.selectedAchievementIds.map((id) =>
          evidence.get(id)!,
        ),
        analysis: args.input.analysis,
        skills: args.input.skills,
        profile: args.input.profile,
      });
      log(
        "Removed the lowest-value eligible bullet after measured overflow; its source facts remain in the library.",
        { sourceAchievementIds: remove.sourceAchievementIds },
      );
    }
  }
  if (!best)
    throw (
      lastError ??
      new PdfCompileError(
        "No one-page content arrangement could be verified.",
        "PAGE_LIMIT_EXCEEDED",
      )
    );
  best.generation.metadata.fitting = {
    attempts: Math.min(MAX_FIT_ATTEMPTS, attempts + 1),
    repairAttempts,
    decisions,
    status:
      best.generation.metadata.layout &&
      best.generation.metadata.layout.utilization >= 0.95
        ? "filled"
        : "underfilled",
  };
  return { generation: best.generation, pdf: best.pdf };
}
