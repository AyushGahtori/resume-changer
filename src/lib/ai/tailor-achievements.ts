import { z } from "zod";
import {
  JobAnalysisResultSchema,
  ResumeDraftInputSchema,
  ResumeDraftResultSchema,
  TailorAchievementsResponseSchema,
  type AchievementEvidence,
  type JobAnalysisResult,
  type ResumeDraftInput,
  type ResumeDraftResult,
  type TailorAchievementsResponse,
} from "./contracts";
import { MAX_JD_CHARACTERS } from "../jd-draft";
import { StableIdSchema } from "../schemas/resume-data";
import type { ResumeLibrary } from "../schemas/resume-data";

export const TailorAchievementsRequestSchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]).default("personal"),
    jobDescription: z.string().trim().min(1).max(MAX_JD_CHARACTERS),
    analysis: JobAnalysisResultSchema,
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
    readonly code: "INVALID_SELECTION" | "INVALID_AI_OUTPUT",
  ) {
    super(message);
    this.name = "AchievementTailoringError";
  }
}

function getEvidence(library: ResumeLibrary): AchievementEvidence[] {
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
      job.points.map((point) => ({
        id: point.id,
        text: point.text,
        tags: point.tags,
        skillIds: point.skillIds,
        supportedSkills: skillsByAchievementId.get(point.id) ?? [],
        section: "experience" as const,
        groupId: job.id,
        groupTitle: job.title,
        groupSubtitle: job.company,
      })),
    ),
    ...library.projects.flatMap((project) =>
      project.points.map((point) => ({
        id: point.id,
        text: point.text,
        tags: point.tags,
        skillIds: point.skillIds,
        supportedSkills: skillsByAchievementId.get(point.id) ?? [],
        section: "projects" as const,
        groupId: project.id,
        groupTitle: project.name,
        groupSubtitle: project.role,
      })),
    ),
  ];
}

export function buildResumeDraftInput(
  library: ResumeLibrary,
  request: TailorAchievementsRequest,
): ResumeDraftInput {
  const evidenceById = new Map(
    getEvidence(library).map((evidence) => [evidence.id, evidence]),
  );
  const pointById = new Map(
    [...library.jobs, ...library.projects]
      .flatMap((group) => group.points)
      .map((point) => [point.id, point]),
  );
  const achievements = request.achievementIds.map((id) => {
    const evidence = evidenceById.get(id);
    const point = pointById.get(id);
    if (!evidence || !point) {
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
    return evidence;
  });

  return ResumeDraftInputSchema.parse({
    jobDescription: request.jobDescription,
    analysis: request.analysis,
    achievements,
  });
}

function normalizeTerm(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9+#.]+/g, " ")
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

function ensureSupportedTerms(
  proposedText: string,
  source: AchievementEvidence,
  analyzedTerms: string[],
): { text: string; addedTerms: string[] } {
  const linkedSkills = new Set(
    (source.supportedSkills ?? []).map(normalizeTerm),
  );
  const missingTerms = analyzedTerms
    .filter((term) => {
      const normalized = normalizeTerm(term);
      const wordCount = normalized.split(" ").filter(Boolean).length;
      const supported =
        containsTerm(source.text, term) || linkedSkills.has(normalized);
      return supported && wordCount <= 6 && !containsTerm(proposedText, term);
    })
    .slice(0, 2);

  if (missingTerms.length === 0) {
    return { text: proposedText, addedTerms: [] };
  }

  const trimmed = proposedText.trim().replace(/[.!?]+$/, "");
  return {
    text: `${trimmed}, with experience in ${missingTerms.join(" and ")}.`,
    addedTerms: missingTerms,
  };
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
    const { text: proposedText, addedTerms: guaranteedTerms } =
      ensureSupportedTerms(generated.text, source, terms);
    const addedTerms = terms.filter(
      (term) =>
        containsTerm(proposedText, term) && !containsTerm(source.text, term),
    );
    for (const term of guaranteedTerms) {
      if (!addedTerms.includes(term)) addedTerms.push(term);
    }

    return {
      achievementId: source.id,
      originalText: source.text,
      proposedText,
      rationale: guaranteedTerms.length
        ? "Any added JD terms are supported by skills linked to this source achievement."
        : generated.rationale ||
          "Review the source wording above to confirm this job-aligned phrasing is accurate.",
      addedTerms,
    };
  });

  return TailorAchievementsResponseSchema.parse({
    proposals,
    analyzedTerms: terms,
    summary:
      result.summary ||
      "Review each proposal and approve only wording that accurately describes your experience.",
  });
}
