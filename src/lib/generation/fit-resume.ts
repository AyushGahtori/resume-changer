import type { ResumeLibrary } from "../schemas/resume-data";
import type { AchievementSelectionInput } from "../ai/contracts";
import { assessRequirementCoverage } from "../ai/requirement-coverage";
import { buildSkillEvidence } from "../ai/evidence";
import { buildEvidenceSummary, enrichSourceText } from "../ai/draft-quality";
import { compileLatexToPdf, PdfCompileError } from "../pdf/compile-service";
import { analyzePdfLayout, type PdfLayout } from "../pdf/layout-analysis";
import {
  createManualGeneration,
  type ManualGenerationRequest,
  type ManualGenerationResult,
} from "./manual-generation";

type Compile = (latex: string) => Promise<{ pdf: Buffer; pageCount: number }>;
type Measure = (
  pdf: Uint8Array,
) => Promise<{ layout: PdfLayout; text: string }>;
type Decision = { stage: string; message: string; data?: unknown };

export async function fitResumeToPage(args: {
  library: ResumeLibrary;
  request: ManualGenerationRequest;
  input: AchievementSelectionInput;
  scores: Map<string, number>;
  compile?: Compile;
  measure?: Measure;
  onDiagnostic?: (event: Decision) => void;
}): Promise<{ generation: ManualGenerationResult; pdf: Buffer }> {
  const compile = args.compile ?? compileLatexToPdf;
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
  let best:
    | { generation: ManualGenerationResult; pdf: Buffer; distance: number }
    | undefined;
  let lastError: unknown;
  let attempts = 0;
  const log = (message: string, data?: unknown) => {
    decisions.push(message);
    args.onDiagnostic?.({ stage: "auto-tailor.page-fit", message, data });
  };
  for (; attempts < 6; attempts++) {
    const selectedSourceIds = new Set(request.selectedAchievementIds);
    request.selectedSkillIds = buildSkillEvidence(args.library)
      .filter(
        (skill) =>
          skill.isListedOnCurrentResume ||
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
        generation.metadata.fitting = {
          attempts: attempts + 1,
          decisions: [
            ...decisions,
            error instanceof Error
              ? error.message
              : "Layout measurement failed.",
          ],
          status: "measurement-unavailable",
        };
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
      if (
        compiled.pageCount !== 1 ||
        measured.layout.pageCount !== 1 ||
        measured.layout.clipped
      )
        throw new PdfCompileError(
          "Resume content crosses the approved margins.",
          "PAGE_LIMIT_EXCEEDED",
        );
      const distance = Math.abs(0.975 - measured.layout.utilization);
      if (!best || distance < best.distance)
        best = { generation, pdf: compiled.pdf, distance };
      if (measured.layout.utilization >= 0.95) {
        generation.metadata.fitting = {
          attempts: attempts + 1,
          decisions,
          status: "filled",
        };
        return { generation, pdf: compiled.pdf };
      }
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
      if (
        !(error instanceof PdfCompileError) ||
        error.code !== "PAGE_LIMIT_EXCEEDED"
      )
        throw error;
      const groups = new Map<string, number>();
      for (const bullet of generation.metadata.generatedBullets) {
        const point = evidence.get(bullet.achievementId)!;
        groups.set(point.groupId, (groups.get(point.groupId) ?? 0) + 1);
      }
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
    attempts: Math.min(6, attempts + 1),
    decisions,
    status:
      best.generation.metadata.layout &&
      best.generation.metadata.layout.utilization >= 0.95
        ? "filled"
        : "underfilled",
  };
  return { generation: best.generation, pdf: best.pdf };
}
