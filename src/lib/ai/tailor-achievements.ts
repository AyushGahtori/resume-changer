import { z } from "zod";
import {
  buildAchievementEvidence,
  buildProfileEvidence,
  buildSkillEvidence,
  evidenceText,
} from "./evidence";
import {
  assessRequirementCoverage,
  semanticMatchScore,
} from "./requirement-coverage";
import {
  preserveMetrics,
  preserveSubstance,
  canSynthesize,
  enrichSourceText,
  buildEvidenceSummary,
  misattributedMetrics,
} from "./draft-quality";
import {
  AchievementSelectionResponseSchema,
  JobAnalysisResultSchema,
  ResumeDraftHandoffSchema,
  ResumeDraftInputSchema,
  ResumeDraftResultSchema,
  ResumeDraftJobRequestSchema,
  TailorAchievementsResponseSchema,
  type AchievementEvidence,
  type JobAnalysisResult,
  type ResumeDraftInput,
  type ResumeDraftResult,
  type ResumeDraftHandoff,
  type TailorAchievementsResponse,
} from "./contracts";
import { MAX_JD_CHARACTERS } from "../jd-draft";
import { estimateAchievementContentBudget } from "./achievement-selection";
import { createJobContextId } from "./job-context";
import { supportedTerminologyTargets } from "./prompt-builder";
import { StableIdSchema } from "../schemas/resume-data";
import type { ResumeLibrary } from "../schemas/resume-data";

export const TailorAchievementsRequestSchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]).default("personal"),
    jobDescription: z.string().trim().min(1).max(MAX_JD_CHARACTERS),
    analysis: JobAnalysisResultSchema,
    job: ResumeDraftJobRequestSchema,
    selectionContext: AchievementSelectionResponseSchema.optional(),
    achievementIds: z.array(StableIdSchema).min(1).max(100),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      new Set(request.achievementIds).size !== request.achievementIds.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["achievementIds"],
        message: "Each achievement can be tailored only once.",
      });
    }
  });

export type TailorAchievementsRequest = z.infer<
  typeof TailorAchievementsRequestSchema
>;

export class AchievementTailoringError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_SELECTION" | "INVALID_AI_OUTPUT" | "STALE_CONTEXT",
  ) {
    super(message);
    this.name = "AchievementTailoringError";
  }
}

function getEvidence(library: ResumeLibrary): AchievementEvidence[] {
  return buildAchievementEvidence(library);
}

function getRequirementDefinitions(analysis: JobAnalysisResult) {
  const groups = [
    ["required", analysis.requiredQualifications],
    ["responsibility", analysis.responsibilities],
    ["preferred", analysis.preferredQualifications],
    [
      "context",
      [
        ...analysis.toolsAndPlatforms,
        ...analysis.domainConcepts,
        ...analysis.atsTerms,
        ...analysis.terminology.flatMap(({ term, alternatives }) => [
          term,
          ...alternatives,
        ]),
      ],
    ],
  ] as const;
  const seen = new Set<string>();
  return groups.flatMap(([category, values]) =>
    values.flatMap((text) => {
      const key = `${category}:${normalizeTerm(text)}`;
      if (!normalizeTerm(text) || seen.has(key)) return [];
      seen.add(key);
      return [{ id: `requirement-${category}-${seen.size}`, category, text }];
    }),
  );
}

function buildDraftHandoff(args: {
  library: ResumeLibrary;
  request: TailorAchievementsRequest;
  achievements: AchievementEvidence[];
  allEvidence: AchievementEvidence[];
}): ResumeDraftHandoff {
  const evidenceById = new Map(args.allEvidence.map((item) => [item.id, item]));
  const confidenceById = new Map(
    args.request.selectionContext?.recommendations.selections.map((item) => [
      item.achievementId,
      item.confidence,
    ]) ?? [],
  );
  const definitions = getRequirementDefinitions(args.request.analysis);
  const assessments = assessRequirementCoverage(
    {
      jobDescription: args.request.jobDescription,
      analysis: args.request.analysis,
      achievements: args.allEvidence,
      skills: buildSkillEvidence(args.library),
      profile: buildProfileEvidence(args.library),
      contentBudgetLines: estimateAchievementContentBudget(args.library),
    },
    args.request.achievementIds,
    { requirements: definitions.map((item) => item.text) },
  );
  const requirements = definitions.map((definition, index) => {
    const assessment = assessments[index];
    return {
      ...definition,
      status: assessment.status,
      availableAchievementIds: assessment.availableAchievementIds,
      selectedAchievementIds: assessment.coveredByAchievementIds,
      evidence: assessment.evidence,
      reason: assessment.reason,
    };
  });
  const toSource = (
    evidence: AchievementEvidence,
    supportedRequirementIds: string[],
  ) => ({
    achievementId: evidence.id,
    text: evidence.text,
    section: evidence.section,
    groupId: evidence.groupId,
    groupTitle: evidence.groupTitle,
    ...(evidence.groupSubtitle
      ? { groupSubtitle: evidence.groupSubtitle }
      : {}),
    linkedSkills: evidence.supportedSkills ?? [],
    metrics: evidence.metrics,
    context: evidence.context,
    inferredSkills: evidence.inferredSkills,
    supportedRequirementIds,
    ...(confidenceById.has(evidence.id)
      ? { selectionConfidence: confidenceById.get(evidence.id) }
      : {}),
  });
  const selectedAchievements = args.achievements.map((evidence) =>
    toSource(
      evidence,
      requirements
        .filter((requirement) =>
          requirement.selectedAchievementIds.includes(evidence.id),
        )
        .map((requirement) => requirement.id),
    ),
  );
  const selectedIds = new Set(args.request.achievementIds);
  const suggestedEvidence = requirements
    .filter((requirement) => requirement.status === "evidence-not-selected")
    .flatMap((requirement) =>
      requirement.availableAchievementIds
        .filter((id) => !selectedIds.has(id))
        .map((id) => ({ id, requirementId: requirement.id })),
    )
    .reduce<Array<{ id: string; requirementIds: string[] }>>((items, item) => {
      const existing = items.find((candidate) => candidate.id === item.id);
      if (existing) existing.requirementIds.push(item.requirementId);
      else if (items.length < 30) {
        items.push({ id: item.id, requirementIds: [item.requirementId] });
      }
      return items;
    }, [])
    .flatMap(({ id, requirementIds }) => {
      const evidence = evidenceById.get(id);
      return evidence ? [toSource(evidence, requirementIds)] : [];
    });
  const contextId = args.request.job.contextId;
  return ResumeDraftHandoffSchema.parse({
    job: { ...args.request.job, contextId },
    requirements,
    selectedAchievements,
    suggestedEvidence,
    contentBudgetLines:
      args.request.selectionContext?.budget.availableLines ??
      estimateAchievementContentBudget(args.library),
  });
}

export async function buildResumeDraftInput(
  library: ResumeLibrary,
  request: TailorAchievementsRequest,
): Promise<ResumeDraftInput> {
  const expectedContextId = await createJobContextId({
    ...request.job,
    jobDescription: request.jobDescription,
    analysis: request.analysis,
  });
  if (expectedContextId !== request.job.contextId) {
    throw new AchievementTailoringError(
      "The job description or analysis changed. Reanalyze the active job before drafting.",
      "STALE_CONTEXT",
    );
  }
  const allEvidence = getEvidence(library);
  const evidenceById = new Map(
    allEvidence.map((evidence) => [evidence.id, evidence]),
  );
  const pointById = new Map(
    [...library.jobs, ...library.projects]
      .flatMap((group) => group.points)
      .map((point) => [point.id, point]),
  );
  const achievements = request.achievementIds.map((id) => {
    const point = pointById.get(id);
    if (!point) {
      throw new AchievementTailoringError(
        `Achievement ${id} is unavailable in this library.`,
        "INVALID_SELECTION",
      );
    }
    if (!point.enabled) {
      throw new AchievementTailoringError(
        `Achievement ${id} is disabled and cannot be tailored.`,
        "INVALID_SELECTION",
      );
    }
    const evidence = evidenceById.get(id);
    if (!evidence) {
      throw new AchievementTailoringError(
        `Achievement ${id} is unavailable in this library.`,
        "INVALID_SELECTION",
      );
    }
    return evidence;
  });

  const handoff = buildDraftHandoff({
    library,
    request,
    achievements,
    allEvidence,
  });
  return ResumeDraftInputSchema.parse({
    jobDescription: request.jobDescription,
    analysis: request.analysis,
    achievements,
    handoff,
    skills: buildSkillEvidence(library),
    profile: buildProfileEvidence(library),
  });
}

function normalizeTerm(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

function containsTerm(text: string, term: string): boolean {
  const normalizedText = normalizeTerm(text);
  const normalizedTerm = normalizeTerm(term);
  return (
    normalizedTerm.length > 0 &&
    ` ${normalizedText} `.includes(` ${normalizedTerm} `)
  );
}

function getAnalyzedTerms(analysis: JobAnalysisResult): string[] {
  return [
    ...analysis.requiredQualifications,
    ...analysis.preferredQualifications,
    ...analysis.responsibilities,
    ...analysis.toolsAndPlatforms,
    ...analysis.domainConcepts,
    ...analysis.atsTerms,
    ...analysis.terminology.flatMap(({ term, alternatives }) => [
      term,
      ...alternatives,
    ]),
  ].filter((term, index, all) => {
    const normalized = normalizeTerm(term);
    return (
      normalized.length > 0 &&
      all.findIndex((candidate) => normalizeTerm(candidate) === normalized) ===
        index
    );
  });
}

const NUMBER_WORD_VALUES: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function numericClaims(text: string): Set<string> {
  const tens = Object.keys(NUMBER_WORD_VALUES).filter(
    (word) => NUMBER_WORD_VALUES[word] >= 20,
  );
  const units = Object.keys(NUMBER_WORD_VALUES).filter(
    (word) => NUMBER_WORD_VALUES[word] > 0 && NUMBER_WORD_VALUES[word] < 10,
  );
  let normalized = text
    .toLocaleLowerCase()
    .replace(/\b(\d+(?:\.\d+)?)k\+?(?=\W|$)/g, (_, value: string) =>
      String(Number(value) * 1000),
    )
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, (number) =>
      number.replace(/,/g, ""),
    )
    .replace(/\b(\d+(?:[.,]\d+)?)\s+%/g, "$1%");
  const compoundNumber = new RegExp(
    `\\b(${tens.join("|")})[\\s-]+(${units.join("|")})\\b`,
    "g",
  );
  normalized = normalized.replace(
    compoundNumber,
    (_, tensWord: string, unitWord: string) =>
      String(NUMBER_WORD_VALUES[tensWord] + NUMBER_WORD_VALUES[unitWord]),
  );
  normalized = normalized.replace(
    new RegExp(
      `\\b(${Object.keys(NUMBER_WORD_VALUES).join("|")})\\s+percent\\b`,
      "g",
    ),
    (_, word: string) => `${NUMBER_WORD_VALUES[word]}%`,
  );
  const tokens =
    normalized.match(
      /\b\d+(?:[.,]\d+)?\s?%?|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
    ) ?? [];
  return new Set(
    tokens.map((token) => {
      const value = token.trim().replace(/\s/g, "");
      if (value.endsWith("%")) {
        const number = value.slice(0, -1);
        return `${NUMBER_WORD_VALUES[number] ?? Number(number)}%`;
      }
      return String(NUMBER_WORD_VALUES[value] ?? Number(value));
    }),
  );
}

export function createTailoringResponse(args: {
  input: ResumeDraftInput;
  result: ResumeDraftResult;
  repairInvalid?: boolean;
}): TailorAchievementsResponse {
  const result = ResumeDraftResultSchema.parse(args.result);
  const sourceById = new Map(
    args.input.achievements.map((achievement) => [achievement.id, achievement]),
  );
  const usedIds = new Set<string>();
  const generatedById = new Map<
    string,
    ResumeDraftResult["achievementText"][number]
  >();
  for (const item of result.achievementText) {
    const ids = item.sourceAchievementIds ?? [item.achievementId];
    if (
      !sourceById.has(item.achievementId) ||
      generatedById.has(item.achievementId) ||
      !ids.includes(item.achievementId) ||
      ids.some((id) => !sourceById.has(id) || usedIds.has(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new AchievementTailoringError(
        "The AI response included an unknown or duplicate achievement.",
        "INVALID_AI_OUTPUT",
      );
    }
    const sources = ids.map((id) => sourceById.get(id)!);
    if (!canSynthesize(sources))
      throw new AchievementTailoringError(
        "Synthesis must stay within related work in the same source group.",
        "INVALID_AI_OUTPUT",
      );
    ids.forEach((id) => usedIds.add(id));
    generatedById.set(item.achievementId, item);
  }
  if (usedIds.size !== sourceById.size)
    throw new AchievementTailoringError(
      "The AI response did not return wording for every selected achievement.",
      "INVALID_AI_OUTPUT",
    );
  const terms = getAnalyzedTerms(args.input.analysis);
  const validationTerms = [
    ...new Set([
      ...terms,
      ...(args.input.skills ?? []).flatMap((skill) => [
        skill.name,
        ...skill.aliases,
      ]),
    ]),
  ];
  const allNotes: string[] = [];
  const proposals = [...generatedById.values()].map((generated) => {
    const ids = generated.sourceAchievementIds ?? [generated.achievementId];
    const sources = ids.map((id) => sourceById.get(id)!);
    const originalText = sources.map((source) => source.text).join("\n");
    const sourceEvidence = sources.map(evidenceText).join(" ");
    const sourceNumbers = numericClaims(sourceEvidence);
    const inferred = sources.flatMap((source) => source.inferredSkills ?? []);
    const addedTerms = terms.filter(
      (term) =>
        containsTerm(generated.text, term) && !containsTerm(originalText, term),
    );
    const unsupportedTerms = validationTerms.filter(
      (term) =>
        containsTerm(generated.text, term) &&
        !containsTerm(sourceEvidence, term) &&
        semanticMatchScore(sourceEvidence, term) < 0.75 &&
        !inferred.some((skill) => containsTerm(skill.name, term)),
    );
    const unsupportedNumbers = [...numericClaims(generated.text)].filter(
      (value) => !sourceNumbers.has(value),
    );
    let proposedText = generated.text;
    const notes: string[] = [];
    if (
      unsupportedNumbers.length ||
      unsupportedTerms.length ||
      misattributedMetrics(generated.text, sources).length
    ) {
      if (!args.repairInvalid)
        throw new AchievementTailoringError(
          unsupportedNumbers.length ||
            misattributedMetrics(generated.text, sources).length
            ? `The AI added an unsupported number to achievement ${generated.achievementId}.`
            : `The AI added unsupported job terms to achievement ${generated.achievementId}.`,
          "INVALID_AI_OUTPUT",
        );
      proposedText = sources.map(enrichSourceText).join(" ");
      notes.push(
        "Unsupported additions were replaced with the complete source evidence.",
      );
    }
    const substantive = preserveSubstance(proposedText, sources);
    proposedText = substantive.text;
    if (substantive.restored)
      notes.push(
        "Restored source specificity lost in an overly compressed rewrite.",
      );
    const missingSourceNumbers = [...numericClaims(originalText)].some(
      (value) => !numericClaims(proposedText).has(value),
    );
    if (missingSourceNumbers) {
      proposedText = sources.map((source) => source.text).join(" ");
      notes.push("Restored a numeric source fact omitted by the rewrite.");
    }
    const preserved = preserveMetrics(proposedText, sources);
    if (preserved.restoredMetricIds.length)
      notes.push("Restored structured metrics omitted by the model.");
    proposedText = preserved.text;
    const omittedTargets = supportedTerminologyTargets(args.input)
      .filter((target) => ids.includes(target.achievementId))
      .flatMap((target) => target.terms)
      .filter((term) => !containsTerm(proposedText, term));
    if (omittedTargets.length)
      notes.push(
        `Supported JD phrases still absent after drafting: ${[...new Set(omittedTargets)].join(", ")}. Review this wording.`,
      );
    const inferredTerms = inferred
      .filter(
        (skill) =>
          containsTerm(proposedText, skill.name) &&
          !containsTerm(sourceEvidence, skill.name),
      )
      .map((skill) => skill.name);
    if (inferredTerms.length)
      notes.push(
        `Inferred framework usage: ${inferredTerms.join(", ")}. Review this assumption; it is not directly recorded project history.`,
      );
    allNotes.push(...notes);
    return {
      achievementId: generated.achievementId,
      sourceAchievementIds: ids,
      originalText,
      proposedText,
      rationale:
        generated.rationale ||
        "Aligned the source evidence to the active job while preserving its outcomes.",
      addedTerms: terms.filter(
        (term) =>
          containsTerm(proposedText, term) && !containsTerm(originalText, term),
      ),
      inferredTerms,
      retainedMetricIds: sources
        .flatMap((source) => source.metrics ?? [])
        .map((metric) => metric.id),
      qualityNotes: notes,
    };
  });
  const summaryEvidence =
    args.input.achievements.map(evidenceText).join(" ") +
    " " +
    (args.input.skills ?? [])
      .flatMap((skill) => [skill.name, ...skill.aliases])
      .join(" ");
  let resumeSummary = result.resumeSummary || buildEvidenceSummary(args.input);
  const badSummaryNumber = [...numericClaims(resumeSummary)].some(
    (value) => !numericClaims(summaryEvidence).has(value),
  );
  const badSummaryTerm = terms.some(
    (term) =>
      containsTerm(resumeSummary, term) && !containsTerm(summaryEvidence, term),
  );
  const unsupportedTraining =
    /\btrain(?:ed|ing)?\b/i.test(resumeSummary) &&
    !/\btrain(?:ed|ing)?\b/i.test(summaryEvidence);
  const unsupportedYears =
    /\b\d+(?:\.\d+)?\+?\s+years?\b/i.test(resumeSummary) &&
    !/\b\d+(?:\.\d+)?\+?\s+years?\b/i.test(summaryEvidence);
  if (
    badSummaryNumber ||
    badSummaryTerm ||
    unsupportedTraining ||
    unsupportedYears ||
    misattributedMetrics(resumeSummary, args.input.achievements).length
  ) {
    resumeSummary = buildEvidenceSummary(args.input);
    allNotes.push(
      "Replaced an unsupported summary with an evidence-backed accomplishment summary.",
    );
  }
  return TailorAchievementsResponseSchema.parse({
    proposals,
    analyzedTerms: terms,
    mode: "ai",
    handoff: args.input.handoff,
    summary:
      result.summary || "Drafted the selected evidence for the active job.",
    resumeSummary,
    qualityNotes: [...new Set(allNotes)].slice(0, 100),
  });
}

export function createOriginalsFallbackResponse(args: {
  input: ResumeDraftInput;
  notice: string;
}): TailorAchievementsResponse {
  return TailorAchievementsResponseSchema.parse({
    proposals: args.input.achievements.map((achievement) => ({
      achievementId: achievement.id,
      originalText: achievement.text,
      proposedText: enrichSourceText(achievement),
      sourceAchievementIds: [achievement.id],
      retainedMetricIds: (achievement.metrics ?? []).map((metric) => metric.id),
      rationale: "The original source wording is preserved without AI edits.",
      addedTerms: [],
    })),
    summary:
      "The resume draft uses selected source points. No AI wording changes were applied.",
    resumeSummary: buildEvidenceSummary(args.input),
    analyzedTerms: getAnalyzedTerms(args.input.analysis),
    mode: "originals-fallback",
    handoff: args.input.handoff,
    notice: args.notice,
  });
}
