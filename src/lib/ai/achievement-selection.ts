import {
  AchievementSelectionInputSchema,
  AchievementSelectionResultSchema,
  type AchievementEvidence,
  type AchievementSelectionInput,
  type AchievementSelectionResult,
  type JobAnalysisResult,
} from "./contracts";
import {
  buildAchievementEvidence,
  buildSkillEvidence,
  buildProfileEvidence,
  evidenceText,
} from "./evidence";
import { enrichSourceText } from "./draft-quality";
import {
  assessRequirementCoverage,
  semanticMatchScore,
  type CoverageAssessment,
} from "./requirement-coverage";
import { AiProviderError } from "./provider";
import type { ResumeLibrary } from "../schemas/resume-data";

const PAGE_LINE_ESTIMATE = 58;
const CHARACTERS_PER_LINE_ESTIMATE = 105;

type Candidate = {
  evidence: AchievementEvidence;
  text: string;
};

type ScoredCandidate = {
  candidate: Candidate;
  matches: Map<string, number>;
  score: number;
};

export type SelectionBudget = {
  availableLines: number;
  usedLines: number;
};

export type SelectionRecommendation = {
  recommendations: AchievementSelectionResult;
  mode: "ai" | "local-fallback";
  budget: SelectionBudget;
  requirementEvidence: CoverageAssessment[];
  audit: Array<{
    achievementId: string;
    section: AchievementEvidence["section"];
    groupTitle: string;
    text: string;
    localScore: number;
    matchingRequirements: string[];
    modelRecommended: boolean;
    modelRationale?: string;
    selected: boolean;
    rationale?: string;
    outcome:
      | "selected"
      | "no-local-match"
      | "model-selected-but-excluded-by-budget-or-normalization"
      | "not-selected-by-model-or-local-priority";
  }>;
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
  const skillsLines = listedSkills.length > 0 ? 3 : 0;
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
  return AchievementSelectionInputSchema.parse({
    jobDescription: args.jobDescription,
    analysis: args.analysis,
    achievements: buildAchievementEvidence(args.library),
    skills: buildSkillEvidence(args.library),
    profile: buildProfileEvidence(args.library),
    contentBudgetLines: estimateAchievementContentBudget(args.library),
  });
}

export function requirementMatchScore(evidence: string, requirement: string) {
  return semanticMatchScore(evidence, requirement);
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
  return input.achievements.map((evidence) => ({
    evidence,
    text: [
      evidenceText(evidence),
      ...evidence.skillIds.flatMap((id) => {
        const skill = skillById.get(id);
        return skill ? [skill.name, ...skill.aliases] : [];
      }),
    ].join(" "),
  }));
}

function pointLineCost(candidate: Candidate) {
  const text = enrichSourceText(candidate.evidence);
  const words = text.trim().split(/\s+/).length;
  return (
    0.15 + Math.max(0.6, text.length / CHARACTERS_PER_LINE_ESTIMATE, words / 19)
  );
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
  return Math.ceil(lines);
}

function scoredCandidates(input: AchievementSelectionInput): ScoredCandidate[] {
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
      const words = candidate.evidence.text.split(/\s+/).length;
      const quality =
        Math.min(words, 45) / 20 +
        (candidate.evidence.metrics?.length ?? 0) * 1.5 +
        (candidate.evidence.section === "experience" ? 1.5 : 0.75);
      return { candidate, matches, score: score > 0 ? score + quality : 0 };
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

function selectBalancedCandidates(
  ranked: ScoredCandidate[],
  availableLines: number,
): Candidate[] {
  const selected: Candidate[] = [];
  const groupKey = (item: ScoredCandidate) =>
    `${item.candidate.evidence.section}:${item.candidate.evidence.groupId}`;
  const groups = new Map<string, ScoredCandidate[]>();
  for (const item of ranked) {
    const key = groupKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const byStrength = (left: ScoredCandidate[], right: ScoredCandidate[]) =>
    Math.max(...right.map((item) => item.score)) -
    Math.max(...left.map((item) => item.score));
  const experienceGroups = [...groups.values()]
    .filter((items) => items[0].candidate.evidence.section === "experience")
    .sort(byStrength);
  const projectGroups = [...groups.values()]
    .filter((items) => items[0].candidate.evidence.section === "projects")
    .sort(byStrength);

  const addIfFits = (item: ScoredCandidate) => {
    if (
      selected.some(
        ({ evidence }) => evidence.id === item.candidate.evidence.id,
      )
    ) {
      return false;
    }
    if (budgetCost([...selected, item.candidate]) > availableLines)
      return false;
    selected.push(item.candidate);
    return true;
  };

  for (const items of [...experienceGroups, ...projectGroups]) {
    const best = [...items].sort((left, right) => right.score - left.score);
    for (const item of best) {
      if (addIfFits(item)) break;
    }
  }

  // Representation is a floor when relevant evidence fits, never a role cap.
  for (let round = 1; round < 3; round++) {
    for (const items of experienceGroups) {
      const best = [...items].sort((a, b) => b.score - a.score);
      for (const item of best) {
        if (addIfFits(item)) break;
      }
    }
  }

  while (true) {
    const covered = new Set(
      selected.flatMap((candidate) =>
        Array.from(
          ranked
            .find(
              (item) => item.candidate.evidence.id === candidate.evidence.id,
            )
            ?.matches.keys() ?? [],
        ),
      ),
    );
    const groupCounts = new Map<string, number>();
    for (const candidate of selected) {
      const key = `${candidate.evidence.section}:${candidate.evidence.groupId}`;
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
    const next = ranked
      .filter(
        (item) =>
          !selected.some(
            ({ evidence }) => evidence.id === item.candidate.evidence.id,
          ) && budgetCost([...selected, item.candidate]) <= availableLines,
      )
      .map((item) => {
        const count = groupCounts.get(groupKey(item)) ?? 0;
        const newCoverage = [...item.matches.entries()].reduce(
          (sum, [requirement, score]) =>
            sum + (covered.has(requirement) ? 0 : score * 2),
          0,
        );
        const target = item.candidate.evidence.section === "projects" ? 2 : 4;
        return {
          item,
          value:
            item.score +
            newCoverage +
            (count === 0 ? 3 : 0) -
            Math.max(0, count - target + 1) * 4,
        };
      })
      .sort((left, right) => right.value - left.value)[0];
    if (!next || !addIfFits(next.item)) break;
  }
  return selected;
}

function makeFallbackResult(
  input: AchievementSelectionInput,
): AchievementSelectionResult {
  const ranked = scoredCandidates(input);
  const selected = selectBalancedCandidates(ranked, input.contentBudgetLines);
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

  const scoredById = new Map(
    rankedCandidates.map((item) => [item.candidate.evidence.id, item]),
  );
  const eligible = candidates.flatMap((candidate) => {
    const local = scoredById.get(candidate.evidence.id);
    const model = uniqueSelections.has(candidate.evidence.id)
      ? result.selections.find(
          (item) =>
            item.achievementId === candidate.evidence.id &&
            item.section === candidate.evidence.section,
        )
      : undefined;
    if (!local && !model) return [];
    const matches = local?.matches ?? new Map<string, number>();
    const verifiedModelCoverage = [...aiCoverage.entries()].filter(
      ([requirement, ids]) =>
        ids.has(candidate.evidence.id) &&
        requirementMatchScore(candidate.text, requirement) > 0,
    );
    const score =
      (local?.score ?? 0) +
      (model?.confidence ?? 0) * 5 +
      verifiedModelCoverage.length * 3;
    return [{ candidate, matches, score }];
  });
  const selected = selectBalancedCandidates(eligible, input.contentBudgetLines);
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
          ...[...modelIds].filter(
            (id) =>
              finalSelectedIds.has(id) &&
              requirementMatchScore(
                candidateById.get(id)?.text ?? "",
                requirement,
              ) > 0,
          ),
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
  const allCandidates = buildCandidates(args.input);
  const selectedCandidates = allCandidates.filter((candidate) =>
    recommendations.selections.some(
      (selection) => selection.achievementId === candidate.evidence.id,
    ),
  );
  const usedLines = budgetCost(selectedCandidates);
  const isFallback = !aiResult;
  const relevantGroups = new Set(
    scoredCandidates(args.input).map(
      ({ candidate }) =>
        `${candidate.evidence.section}:${candidate.evidence.groupId}`,
    ),
  );
  const chosenGroups = new Set(
    selectedCandidates.map(
      ({ evidence }) => `${evidence.section}:${evidence.groupId}`,
    ),
  );
  const sourceNotice = [...relevantGroups].some(
    (group) => !chosenGroups.has(group),
  )
    ? "The estimated page budget left some relevant source groups out. Review the selected points."
    : undefined;
  const providerNotice = isFallback
    ? aiFailure
      ? getFallbackNotice(aiFailure)
      : "Showing local matches because the AI returned no recommendations."
    : usedLines > availableLines
      ? "Recommendations exceeded the estimated content budget and were trimmed."
      : undefined;
  const requirementEvidence = assessRequirementCoverage(
    args.input,
    recommendations.selections.map((item) => item.achievementId),
  );
  recommendations.requirementCoverage = requirementEvidence.map(
    ({ availableAchievementIds: _available, ...item }) => item,
  );
  const selectionById = new Map(
    recommendations.selections.map((selection) => [
      selection.achievementId,
      selection,
    ]),
  );
  const modelSelectionById = new Map(
    (aiResult?.selections ?? []).map((selection) => [
      selection.achievementId,
      selection,
    ]),
  );
  const scoresById = new Map(
    scoredCandidates(args.input).map((item) => [
      item.candidate.evidence.id,
      item,
    ]),
  );
  const audit = allCandidates.map(({ evidence }) => {
    const score = scoresById.get(evidence.id);
    const selection = selectionById.get(evidence.id);
    const modelSelection = modelSelectionById.get(evidence.id);
    return {
      achievementId: evidence.id,
      section: evidence.section,
      groupTitle: evidence.groupTitle,
      text: evidence.text,
      localScore: score?.score ?? 0,
      matchingRequirements: [...(score?.matches.keys() ?? [])],
      modelRecommended: Boolean(modelSelection),
      ...(modelSelection?.rationale
        ? { modelRationale: modelSelection.rationale }
        : {}),
      selected: Boolean(selection),
      ...(selection ? { rationale: selection.rationale } : {}),
      outcome: selection
        ? ("selected" as const)
        : !score && !modelSelection
          ? ("no-local-match" as const)
          : modelSelection
            ? ("model-selected-but-excluded-by-budget-or-normalization" as const)
            : ("not-selected-by-model-or-local-priority" as const),
    };
  });

  return {
    recommendations,
    mode: isFallback ? "local-fallback" : "ai",
    budget: { availableLines, usedLines },
    requirementEvidence,
    audit,
    notice:
      [providerNotice, sourceNotice].filter(Boolean).join(" ") || undefined,
  };
}
