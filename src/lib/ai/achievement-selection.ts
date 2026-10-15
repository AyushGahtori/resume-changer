import {
  AchievementSelectionInputSchema,
  AchievementSelectionResultSchema,
  type AchievementEvidence,
  type AchievementSelectionInput,
  type AchievementSelectionResult,
  type JobAnalysisResult,
  type SkillEvidence,
} from "./contracts";
import { AiProviderError } from "./provider";
import type { ResumeLibrary } from "../schemas/resume-data";

const PAGE_LINE_ESTIMATE = 58;
const CHARACTERS_PER_LINE_ESTIMATE = 105;
const MAX_SKILL_EVIDENCE = 500;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

type Candidate = {
  evidence: AchievementEvidence;
  text: string;
};

export type SelectionBudget = {
  availableLines: number;
  usedLines: number;
};

export type SelectionRecommendation = {
  recommendations: AchievementSelectionResult;
  mode: "ai" | "local-fallback";
  budget: SelectionBudget;
  notice?: string;
};

function getFallbackNotice(error: unknown): string {
  if (!(error instanceof AiProviderError)) {
    return "AI recommendations returned an invalid response; showing local matches instead. Review these lower-confidence matches before using them.";
  }

  switch (error.code) {
    case "MISSING_API_KEY":
      return "Gemini is not configured. Set GEMINI_API_KEY to enable AI recommendations; showing local matches meanwhile.";
    case "AUTHENTICATION_FAILED":
      return "Gemini rejected the configured API key or its permissions; showing local matches meanwhile.";
    case "RATE_LIMITED":
      return "Gemini's request limit was reached. Wait and retry AI recommendations; showing local matches meanwhile.";
    case "REQUEST_TIMEOUT":
      return "Gemini did not respond in time. Retry AI recommendations; showing local matches meanwhile.";
    case "SERVICE_UNAVAILABLE":
      return "Gemini is temporarily unavailable. Retry AI recommendations shortly; showing local matches meanwhile.";
    case "INPUT_TOO_LARGE":
      return "The resume library is too large for one AI request. Reduce the library context and retry; showing local matches meanwhile.";
    case "INVALID_REQUEST":
      return "Gemini rejected the recommendation request. Check the configured model and request schema; showing local matches meanwhile.";
    case "INVALID_RESPONSE":
      return "Gemini returned recommendations in an unexpected format. Retry; showing local matches meanwhile.";
    default:
      return "The Gemini request failed. Check the server log code and retry; showing local matches meanwhile.";
  }
}

function wrappedLines(text: string) {
  return Math.ceil(text.trim().length / CHARACTERS_PER_LINE_ESTIMATE);
}

export function estimateAchievementContentBudget(
  library: ResumeLibrary,
): number {
  const fixedLines = 3 + wrappedLines(library.profile.summary ?? "");
  const educationLines = library.profile.education.reduce(
    (total, item) => total + 2 + wrappedLines(item.description ?? ""),
    library.profile.education.length > 0 ? 1 : 0,
  );
  const listedSkills = library.skills.filter(
    (skill) => skill.isListedOnCurrentResume,
  );
  const skillGroups = new Map<string, string[]>();
  for (const skill of listedSkills) {
    const category = skill.category?.trim() || "Other";
    skillGroups.set(category, [
      ...(skillGroups.get(category) ?? []),
      skill.name,
      ...skill.aliases.slice(0, 1),
    ]);
  }
  const skillsLines =
    skillGroups.size > 0
      ? 1 +
        [...skillGroups.values()].reduce(
          (total, names) => total + Math.max(1, wrappedLines(names.join(", "))),
          0,
        )
      : 0;
  const credentialLines =
    library.credentials.length > 0 ? 1 + library.credentials.length : 0;
  const fixed = fixedLines + educationLines + skillsLines + credentialLines;

  return Math.max(0, PAGE_LINE_ESTIMATE - fixed - 2);
}

export function buildAchievementSelectionInput(args: {
  library: ResumeLibrary;
  jobDescription: string;
  analysis: JobAnalysisResult;
}): AchievementSelectionInput {
  const achievements: AchievementEvidence[] = [
    ...args.library.jobs.flatMap((job) =>
      job.points
        .filter((point) => point.enabled)
        .map((point) => ({
          id: point.id,
          text: point.text,
          tags: point.tags,
          skillIds: point.skillIds,
          section: "experience" as const,
          groupId: job.id,
          groupTitle: job.title,
          groupSubtitle: job.company,
        })),
    ),
    ...args.library.projects.flatMap((project) =>
      project.points
        .filter((point) => point.enabled)
        .map((point) => ({
          id: point.id,
          text: point.text,
          tags: point.tags,
          skillIds: point.skillIds,
          section: "projects" as const,
          groupId: project.id,
          groupTitle: project.name,
          groupSubtitle: project.role,
        })),
    ),
  ];
  const enabledAchievementIds = new Set(
    achievements.map((achievement) => achievement.id),
  );
  const skills: SkillEvidence[] = args.library.skills
    .slice(0, MAX_SKILL_EVIDENCE)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      aliases: skill.aliases,
      isListedOnCurrentResume: skill.isListedOnCurrentResume,
      evidenceAchievementIds: skill.evidenceAchievementIds.filter((id) =>
        enabledAchievementIds.has(id),
      ),
    }));

  return AchievementSelectionInputSchema.parse({
    jobDescription: args.jobDescription,
    analysis: args.analysis,
    achievements,
    skills,
    contentBudgetLines: estimateAchievementContentBudget(args.library),
  });
}

function normalizedTokens(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function requirementMatchScore(evidence: string, requirement: string) {
  const normalizedEvidence = evidence.toLocaleLowerCase();
  const normalizedRequirement = requirement.toLocaleLowerCase().trim();
  if (
    normalizedRequirement &&
    normalizedEvidence.includes(normalizedRequirement)
  ) {
    return 1;
  }

  const tokens = [...new Set(normalizedTokens(requirement))];
  if (tokens.length === 0) return 0;
  const evidenceTokens = new Set(normalizedTokens(evidence));
  const matched = tokens.filter((token) => evidenceTokens.has(token)).length;
  const ratio = matched / tokens.length;
  return ratio >= (tokens.length <= 2 ? 1 : 0.5) ? ratio : 0;
}

function getRequirements(analysis: JobAnalysisResult) {
  return [
    ...analysis.requiredQualifications,
    ...analysis.responsibilities,
    ...analysis.preferredQualifications,
  ].filter((requirement, index, all) => all.indexOf(requirement) === index);
}

function buildCandidates(input: AchievementSelectionInput): Candidate[] {
  const skillById = new Map(input.skills.map((skill) => [skill.id, skill]));
  return input.achievements.map((evidence) => {
    const linkedSkills = evidence.skillIds
      .map((id) => skillById.get(id))
      .filter((skill): skill is SkillEvidence => skill !== undefined)
      .flatMap((skill) => [skill.name, ...skill.aliases]);
    return {
      evidence,
      text: [
        evidence.text,
        ...evidence.tags,
        evidence.groupTitle,
        evidence.groupSubtitle ?? "",
        ...linkedSkills,
      ].join(" "),
    };
  });
}

function pointLineCost(candidate: Candidate) {
  return 1 + Math.max(1, wrappedLines(candidate.evidence.text));
}

function budgetCost(candidates: Candidate[]) {
  const groups = new Set<string>();
  const sections = new Set<string>();
  let lines = 0;
  for (const candidate of candidates) {
    const { evidence } = candidate;
    const groupKey = `${evidence.section}:${evidence.groupId}`;
    if (!groups.has(groupKey)) {
      groups.add(groupKey);
      lines += 2;
    }
    if (!sections.has(evidence.section)) {
      sections.add(evidence.section);
      lines += 2;
    }
    lines += pointLineCost(candidate);
  }
  return lines;
}

function scoredCandidates(input: AchievementSelectionInput) {
  const required = input.analysis.requiredQualifications;
  const responsibilities = input.analysis.responsibilities;
  const preferred = input.analysis.preferredQualifications;
  const other = [
    ...input.analysis.toolsAndPlatforms,
    ...input.analysis.domainConcepts,
    ...input.analysis.atsTerms,
    ...input.analysis.terminology.flatMap(({ term, alternatives }) => [
      term,
      ...alternatives,
    ]),
  ];

  return buildCandidates(input)
    .map((candidate) => {
      const matches = new Map<string, number>();
      for (const requirement of required) {
        const score = requirementMatchScore(candidate.text, requirement);
        if (score) matches.set(requirement, score * 4);
      }
      for (const requirement of responsibilities) {
        const score = requirementMatchScore(candidate.text, requirement);
        if (score) matches.set(requirement, score * 3);
      }
      for (const requirement of preferred) {
        const score = requirementMatchScore(candidate.text, requirement);
        if (score) matches.set(requirement, score * 2);
      }
      for (const requirement of other) {
        const score = requirementMatchScore(candidate.text, requirement);
        if (score)
          matches.set(
            requirement,
            Math.max(matches.get(requirement) ?? 0, score),
          );
      }
      const score = [...matches.values()].reduce(
        (total, value) => total + value,
        0,
      );
      return { candidate, matches, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}

function emptyResult(summary: string): AchievementSelectionResult {
  return {
    selections: [],
    requirementCoverage: [],
    skillRecommendations: [],
    confidence: 0,
    summary,
  };
}

function selectWithinBudget(
  candidates: Candidate[],
  availableLines: number,
  initialSelected: Candidate[] = [],
): Candidate[] {
  const selected = [...initialSelected];
  const added: Candidate[] = [];
  for (const candidate of candidates) {
    if (
      selected.some(({ evidence }) => evidence.id === candidate.evidence.id)
    ) {
      continue;
    }
    const next = [...selected, candidate];
    if (budgetCost(next) <= availableLines) {
      selected.push(candidate);
      added.push(candidate);
    }
  }
  return added;
}

function makeFallbackResult(
  input: AchievementSelectionInput,
): AchievementSelectionResult {
  const ranked = scoredCandidates(input);
  const selected = selectWithinBudget(
    ranked.map(({ candidate }) => candidate),
    input.contentBudgetLines,
  );
  const selectedIds = new Set(selected.map(({ evidence }) => evidence.id));
  const coverageRequirements = getRequirements(input.analysis);

  return {
    selections: selected.map((candidate) => {
      const matches = coverageRequirements.filter((requirement) =>
        requirementMatchScore(candidate.text, requirement),
      );
      const rationale = matches[0]
        ? `Evidence in this point matches: ${matches[0]}`
        : "Matches terminology from the job analysis.";
      return {
        achievementId: candidate.evidence.id,
        section: candidate.evidence.section,
        confidence: 0.35,
        rationale,
      };
    }),
    requirementCoverage: coverageRequirements.map((requirement) => ({
      requirement,
      coveredByAchievementIds: selected
        .filter((candidate) =>
          requirementMatchScore(candidate.text, requirement),
        )
        .map(({ evidence }) => evidence.id),
    })),
    skillRecommendations: input.skills
      .filter((skill) => !skill.isListedOnCurrentResume)
      .flatMap((skill) => {
        const supportingAchievementIds = skill.evidenceAchievementIds.filter(
          (id) => selectedIds.has(id),
        );
        return supportingAchievementIds.length
          ? [
              {
                skillId: skill.id,
                rationale:
                  "This skill is supported by the linked selected resume evidence.",
                supportingAchievementIds,
              },
            ]
          : [];
      }),
    confidence: selected.length > 0 ? 0.35 : 0,
    summary:
      selected.length > 0
        ? "Local matching found resume evidence for some job signals. Review each suggestion before using it."
        : "No enabled resume points fit the estimated one-page content budget and analyzed job signals.",
  };
}

function normalizeAiResult(
  input: AchievementSelectionInput,
  result: AchievementSelectionResult,
): AchievementSelectionResult {
  const rankedCandidates = scoredCandidates(input);
  const candidates = buildCandidates(input);
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.evidence.id, candidate]),
  );
  const uniqueSelections = new Map<string, Candidate>();
  for (const selection of result.selections) {
    const candidate = candidateById.get(selection.achievementId);
    if (
      candidate &&
      candidate.evidence.section === selection.section &&
      !uniqueSelections.has(selection.achievementId)
    ) {
      uniqueSelections.set(selection.achievementId, candidate);
    }
  }

  const allowedRequirements = new Set(getRequirements(input.analysis));
  const selectionIds = new Set(uniqueSelections.keys());
  const aiCoverage = new Map<string, Set<string>>();
  for (const coverage of result.requirementCoverage) {
    if (!allowedRequirements.has(coverage.requirement)) continue;
    const ids = new Set(
      coverage.coveredByAchievementIds.filter((id) => selectionIds.has(id)),
    );
    aiCoverage.set(coverage.requirement, ids);
  }

  const rank = (candidate: Candidate) => {
    let coverageScore = 0;
    for (const requirement of input.analysis.requiredQualifications) {
      if (aiCoverage.get(requirement)?.has(candidate.evidence.id)) {
        coverageScore += 8;
      }
    }
    for (const requirement of input.analysis.responsibilities) {
      if (aiCoverage.get(requirement)?.has(candidate.evidence.id)) {
        coverageScore += 4;
      }
    }
    for (const requirement of input.analysis.preferredQualifications) {
      if (aiCoverage.get(requirement)?.has(candidate.evidence.id)) {
        coverageScore += 2;
      }
    }
    const modelConfidence =
      result.selections.find(
        (item) => item.achievementId === candidate.evidence.id,
      )?.confidence ?? 0;
    return coverageScore + modelConfidence;
  };

  const aiRanked = [...uniqueSelections.values()].sort(
    (left, right) => rank(right) - rank(left),
  );
  const selected = selectWithinBudget(aiRanked, input.contentBudgetLines);
  const selectedIds = new Set(selected.map(({ evidence }) => evidence.id));
  const matchedSelectionIds = new Set(
    result.selections
      .filter(
        (item) =>
          selectedIds.has(item.achievementId) &&
          candidateById.get(item.achievementId)?.evidence.section ===
            item.section,
      )
      .map((item) => item.achievementId),
  );

  const fallbackRanked = rankedCandidates
    .filter(({ candidate }) => !selectedIds.has(candidate.evidence.id))
    .map(({ candidate, score, matches }) => {
      let coverageGain = 0;
      for (const [requirement, matchScore] of matches) {
        if (
          input.analysis.requiredQualifications.includes(requirement) &&
          !selected.some((item) =>
            requirementMatchScore(item.text, requirement),
          )
        ) {
          coverageGain += 8 * matchScore;
        } else if (
          !selected.some((item) =>
            requirementMatchScore(item.text, requirement),
          )
        ) {
          coverageGain += matchScore;
        }
      }
      return { candidate, value: coverageGain + score / 10 };
    })
    .sort((left, right) => right.value - left.value)
    .map(({ candidate }) => candidate);
  selected.push(
    ...selectWithinBudget(fallbackRanked, input.contentBudgetLines, selected),
  );
  const finalSelectedIds = new Set(selected.map(({ evidence }) => evidence.id));
  const byId = new Map(
    result.selections.map((item) => [item.achievementId, item]),
  );
  const selections = selected.map((candidate) => {
    const modelItem = byId.get(candidate.evidence.id);
    return modelItem && matchedSelectionIds.has(candidate.evidence.id)
      ? modelItem
      : {
          achievementId: candidate.evidence.id,
          section: candidate.evidence.section,
          confidence: 0.35,
          rationale:
            "Added by local matching to preserve relevant evidence coverage.",
        };
  });

  const requirementCoverage = getRequirements(input.analysis).map(
    (requirement) => {
      const modelIds = aiCoverage.get(requirement) ?? new Set<string>();
      const deterministicIds = rankedCandidates
        .filter(
          ({ candidate }) =>
            finalSelectedIds.has(candidate.evidence.id) &&
            requirementMatchScore(candidate.text, requirement),
        )
        .map(({ candidate }) => candidate.evidence.id);
      const coveredByAchievementIds = [
        ...new Set([
          ...[...modelIds].filter((id) => finalSelectedIds.has(id)),
          ...deterministicIds,
        ]),
      ];
      return { requirement, coveredByAchievementIds };
    },
  );
  const selectedUnlistedSkills = input.skills.filter(
    (skill) => !skill.isListedOnCurrentResume,
  );
  const skillRecommendations = result.skillRecommendations.flatMap(
    (recommendation) => {
      const skill = selectedUnlistedSkills.find(
        (item) => item.id === recommendation.skillId,
      );
      if (!skill) return [];
      const supportingAchievementIds = recommendation.supportingAchievementIds
        .filter(
          (id) =>
            finalSelectedIds.has(id) &&
            skill.evidenceAchievementIds.includes(id),
        )
        .slice(0, 100);
      return supportingAchievementIds.length
        ? [{ ...recommendation, supportingAchievementIds }]
        : [];
    },
  );
  for (const skill of selectedUnlistedSkills) {
    if (skillRecommendations.some((item) => item.skillId === skill.id))
      continue;
    const supportingAchievementIds = skill.evidenceAchievementIds.filter((id) =>
      finalSelectedIds.has(id),
    );
    if (supportingAchievementIds.length) {
      skillRecommendations.push({
        skillId: skill.id,
        rationale:
          "This skill is supported by the linked selected resume evidence.",
        supportingAchievementIds,
      });
    }
  }

  return {
    selections,
    requirementCoverage,
    skillRecommendations,
    confidence: result.confidence,
    summary: result.summary,
  };
}

export async function recommendAchievements(args: {
  input: AchievementSelectionInput;
  selectWithAi: () => Promise<AchievementSelectionResult>;
}): Promise<SelectionRecommendation> {
  const availableLines = args.input.contentBudgetLines;
  let aiResult: AchievementSelectionResult | undefined;
  let aiFailure: unknown;
  try {
    aiResult = AchievementSelectionResultSchema.parse(
      await args.selectWithAi(),
    );
  } catch (error) {
    aiFailure = error;
  }

  if (aiFailure) {
    console.warn("AI achievement selection failed; using local fallback.", {
      code:
        aiFailure instanceof AiProviderError
          ? aiFailure.code
          : "INVALID_RESPONSE",
      diagnostic:
        aiFailure instanceof AiProviderError
          ? (aiFailure.diagnosticCode ?? aiFailure.code)
          : "OUTPUT_SCHEMA_MISMATCH",
      retryable:
        aiFailure instanceof AiProviderError ? aiFailure.retryable : false,
    });
  }

  const recommendations = aiResult
    ? normalizeAiResult(args.input, aiResult)
    : makeFallbackResult(args.input);
  const selectedCandidates = buildCandidates(args.input).filter((candidate) =>
    recommendations.selections.some(
      (selection) => selection.achievementId === candidate.evidence.id,
    ),
  );
  const usedLines = budgetCost(selectedCandidates);
  const isFallback = !aiResult;
  const notice = isFallback
    ? aiFailure
      ? getFallbackNotice(aiFailure)
      : "Showing local matches because the AI returned no recommendations."
    : usedLines > availableLines
      ? "Recommendations exceeded the estimated content budget and were trimmed."
      : undefined;

  return {
    recommendations,
    mode: isFallback ? "local-fallback" : "ai",
    budget: { availableLines, usedLines },
    notice,
  };
}
