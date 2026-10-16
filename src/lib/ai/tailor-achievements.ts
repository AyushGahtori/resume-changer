import { z } from "zod";
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
import {
  estimateAchievementContentBudget,
  requirementMatchScore,
} from "./achievement-selection";
import { createJobContextId } from "./job-context";
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
  const skillById = new Map(library.skills.map((skill) => [skill.id, skill]));
  const skillsByAchievementId = new Map<string, string[]>();
  for (const skill of library.skills) {
    for (const achievementId of skill.evidenceAchievementIds) {
      skillsByAchievementId.set(achievementId, [
        ...(skillsByAchievementId.get(achievementId) ?? []),
        skill.name,
        ...skill.aliases,
      ]);
    }
  }

  return [
    ...library.jobs.flatMap((job) =>
      job.points
        .filter((point) => point.enabled)
        .map((point) => ({
          id: point.id,
          text: point.text,
          tags: point.tags,
          skillIds: point.skillIds,
          supportedSkills: [
            ...new Set([
              ...(skillsByAchievementId.get(point.id) ?? []),
              ...point.skillIds.flatMap((id) => {
                const skill = skillById.get(id);
                return skill ? [skill.name, ...skill.aliases] : [];
              }),
            ]),
          ],
          section: "experience" as const,
          groupId: job.id,
          groupTitle: job.title,
          groupSubtitle: job.company,
        })),
    ),
    ...library.projects.flatMap((project) =>
      project.points
        .filter((point) => point.enabled)
        .map((point) => ({
          id: point.id,
          text: point.text,
          tags: point.tags,
          skillIds: point.skillIds,
          supportedSkills: [
            ...new Set([
              ...(skillsByAchievementId.get(point.id) ?? []),
              ...point.skillIds.flatMap((id) => {
                const skill = skillById.get(id);
                return skill ? [skill.name, ...skill.aliases] : [];
              }),
            ]),
          ],
          section: "projects" as const,
          groupId: project.id,
          groupTitle: project.name,
          groupSubtitle: project.role,
        })),
    ),
  ];
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
  return groups
    .flatMap(([category, values]) =>
      values.flatMap((text) => {
        const key = `${category}:${normalizeTerm(text)}`;
        if (!normalizeTerm(text) || seen.has(key)) return [];
        seen.add(key);
        return [{ id: `requirement-${category}-${seen.size}`, category, text }];
      }),
    )
    .slice(0, 100);
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
  const requirements = definitions.map((requirement) => {
    const matches = args.allEvidence
      .map((evidence) => ({
        id: evidence.id,
        score: requirementMatchScore(
          [
            evidence.text,
            ...evidence.tags,
            ...(evidence.supportedSkills ?? []),
          ].join(" "),
          requirement.text,
        ),
      }))
      .filter((item) => item.score > 0);
    const selectedMatches = matches.filter((item) =>
      args.request.achievementIds.includes(item.id),
    );
    const status = selectedMatches.length
      ? selectedMatches.some((item) => item.score >= 0.75)
        ? "supported"
        : "uncertain"
      : matches.length
        ? "evidence-not-selected"
        : "no-evidence-found";
    const reason =
      status === "supported"
        ? "Selected source evidence directly supports this requirement."
        : status === "uncertain"
          ? "Selected evidence may be related; review it before relying on this match."
          : status === "evidence-not-selected"
            ? "Potential source evidence exists in the library but was not selected."
            : "No matching source evidence was identified in the enabled library.";
    return {
      ...requirement,
      status,
      availableAchievementIds: matches.map((item) => item.id),
      selectedAchievementIds: selectedMatches.map((item) => item.id),
      reason,
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
  ]
    .filter((term, index, all) => {
      const normalized = normalizeTerm(term);
      return (
        normalized.length > 0 &&
        all.findIndex(
          (candidate) => normalizeTerm(candidate) === normalized,
        ) === index
      );
    })
    .slice(0, 100);
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
}): TailorAchievementsResponse {
  const result = ResumeDraftResultSchema.parse(args.result);
  const sourceById = new Map(
    args.input.achievements.map((achievement) => [achievement.id, achievement]),
  );
  const generatedById = new Map<
    string,
    ResumeDraftResult["achievementText"][number]
  >();

  for (const item of result.achievementText) {
    if (
      !sourceById.has(item.achievementId) ||
      generatedById.has(item.achievementId)
    ) {
      throw new AchievementTailoringError(
        "The AI response included an unknown or duplicate achievement.",
        "INVALID_AI_OUTPUT",
      );
    }
    generatedById.set(item.achievementId, item);
  }

  if (generatedById.size !== sourceById.size) {
    throw new AchievementTailoringError(
      "The AI response did not return wording for every selected achievement.",
      "INVALID_AI_OUTPUT",
    );
  }

  const terms = getAnalyzedTerms(args.input.analysis);
  const proposals = args.input.achievements.map((source) => {
    const generated = generatedById.get(source.id)!;
    const sourceNumbers = numericClaims(source.text);
    if (
      [...numericClaims(generated.text)].some(
        (value) => !sourceNumbers.has(value),
      )
    ) {
      throw new AchievementTailoringError(
        `The AI added an unsupported number to achievement ${source.id}.`,
        "INVALID_AI_OUTPUT",
      );
    }
    const sourceEvidence = [
      source.text,
      ...source.tags,
      ...(source.supportedSkills ?? []),
    ].join(" ");
    const addedTerms = terms.filter(
      (term) =>
        containsTerm(generated.text, term) && !containsTerm(source.text, term),
    );
    const unsupportedTerms = addedTerms.filter(
      (term) => !containsTerm(sourceEvidence, term),
    );
    if (unsupportedTerms.length > 0) {
      throw new AchievementTailoringError(
        `The AI added unsupported job terms to achievement ${source.id}.`,
        "INVALID_AI_OUTPUT",
      );
    }

    return {
      achievementId: source.id,
      originalText: source.text,
      proposedText: generated.text,
      rationale:
        generated.rationale ||
        "Review the source wording above to confirm this job-aligned phrasing is accurate.",
      addedTerms,
    };
  });

  return TailorAchievementsResponseSchema.parse({
    proposals,
    analyzedTerms: terms,
    mode: "ai",
    handoff: args.input.handoff,
    summary:
      result.summary ||
      "Review each proposal and approve only wording that accurately describes your experience.",
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
      proposedText: achievement.text,
      rationale: "The original source wording is preserved without AI edits.",
      addedTerms: [],
    })),
    summary:
      "The resume draft uses selected source points. No AI wording changes were applied.",
    analyzedTerms: getAnalyzedTerms(args.input.analysis),
    mode: "originals-fallback",
    handoff: args.input.handoff,
    notice: args.notice,
  });
}
