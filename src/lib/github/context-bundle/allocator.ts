import { createHash } from "node:crypto";
import {
  BASELINE_MAX_FILES,
  BASELINE_MAX_SECTIONS,
  BUNDLE_ALGORITHM_VERSION,
  BUNDLE_POLICY_VERSION,
  BundleAllocationInputSchema,
  createBaselineBundleBudget,
  type BundleAllocationInput,
  type BundleAllocationRequest,
  type BundleContext,
  type EvidenceBundle,
  type EvidenceRole,
  type ExpectedFeature,
  type LiveBaselineCaps,
  type OmissionReason,
  type OmittedCandidate,
  type RankedCandidate,
  type SelectedEvidenceSection,
} from "./types";

const ROLE_ORDER: readonly EvidenceRole[] = [
  "implementation",
  "overview",
  "verification",
];

const ROLE_SHARES: Readonly<Record<EvidenceRole, number>> = Object.freeze({
  overview: 0.15,
  implementation: 0.7,
  verification: 0.15,
});

const GENERAL_TEST_SHARE = 0.125;
const TEST_OVER_TARGET_PENALTY = 0.05;

interface NormalizedCandidate extends RankedCandidate {
  fileKey: string;
  contentKey: string;
  duplicateKeys: Set<string>;
}

interface InternalSelection {
  candidate: NormalizedCandidate;
  pinned: boolean;
  marginalFeatureIds: string[];
  selectionReason: string;
  aliases: Array<{
    candidate: NormalizedCandidate;
    pinned: boolean;
  }>;
  chargedTokens: number;
}

interface PinFailure {
  reason: OmissionReason;
  detail: string;
}

/**
 * Deterministically allocates exact screened sections under caller-supplied
 * limits. The live adapter should use createBaselineBundleBudget() so the
 * repository's current public caps remain authoritative.
 */
export function allocateEvidenceBundle(
  rawInput: BundleAllocationRequest,
): EvidenceBundle {
  const parsed = BundleAllocationInputSchema.parse(rawInput);
  validateInputRelations(parsed);

  const requestedMaxFiles = parsed.budget.maxFiles;
  const maxFiles = Math.min(requestedMaxFiles, BASELINE_MAX_FILES);
  const maxSections = Math.min(
    parsed.budget.maxSections,
    BASELINE_MAX_SECTIONS,
  );
  const maxTokens = parsed.budget.maxTokens;
  const candidates = normalizeCandidates(parsed);
  const featureById = new Map<string, ExpectedFeature>(
    parsed.features.map((feature) => [feature.id, feature] as const),
  );
  const confirmedContributionFeatures = new Set(
    parsed.context.confirmedContributionFeatureIds,
  );
  const featureWeights = new Map<string, number>(
    parsed.features.map(
      (feature) =>
        [
          feature.id,
          featureWeight(feature) *
            (parsed.context.mode === "contribution-focused" &&
            confirmedContributionFeatures.has(feature.id)
              ? 2
              : 1),
        ] as const,
    ),
  );
  const roleTargets = allocateRoleTargets(maxTokens);
  const testingOverride = parsed.context.testingContributionConfirmed;
  const softTestTarget = testingOverride
    ? null
    : Math.floor(maxTokens * GENERAL_TEST_SHARE);

  const limitations: string[] = [];
  if (requestedMaxFiles > BASELINE_MAX_FILES) {
    limitations.push(
      `The requested file limit (${requestedMaxFiles}) was clamped to the existing ${BASELINE_MAX_FILES}-file public cap.`,
    );
  }
  if (parsed.budget.maxSections > BASELINE_MAX_SECTIONS) {
    limitations.push(
      `The requested section limit (${parsed.budget.maxSections}) was clamped to the existing ${BASELINE_MAX_SECTIONS}-section prepared-selection cap.`,
    );
  }
  limitations.push(
    "Repository coverage supports project orientation; it does not establish personal authorship, sole ownership, or measured outcomes.",
  );

  const selected: InternalSelection[] = [];
  const selectedCandidateIds = new Set<string>();
  const selectedFileKeys = new Set<string>();
  const chargedContentKeys = new Set<string>();
  const linesByFile = new Map<string, number>();
  const charsByFile = new Map<string, number>();
  const coveredByRole = new Map<EvidenceRole, Set<string>>(
    ROLE_ORDER.map((role) => [role, new Set<string>()] as const),
  );
  let usedTokens = 0;
  let usedTotalLines = 0;
  let usedTotalChars = 0;
  const pinFailures = new Map<string, PinFailure>();

  function tokensForRole(role: EvidenceRole): number {
    return selected.reduce(
      (total, entry) =>
        total + (entry.candidate.role === role ? entry.chargedTokens : 0),
      0,
    );
  }

  function testTokensUsed(): number {
    return selected.reduce(
      (total, entry) =>
        total + (entry.candidate.isTestEvidence ? entry.chargedTokens : 0),
      0,
    );
  }

  function resourceDelta(candidate: NormalizedCandidate): {
    lines: number;
    chars: number;
    fileLines: number;
    fileChars: number;
  } {
    if (chargedContentKeys.has(candidate.contentKey)) {
      return { lines: 0, chars: 0, fileLines: 0, fileChars: 0 };
    }
    const fileLines =
      candidate.section.source.endLine - candidate.section.source.startLine + 1;
    return {
      lines: fileLines,
      chars: candidate.section.excerpt.length,
      fileLines,
      fileChars: candidate.section.excerpt.length,
    };
  }

  function resourceFits(candidate: NormalizedCandidate): boolean {
    const delta = resourceDelta(candidate);
    const fileLines = linesByFile.get(candidate.fileKey) ?? 0;
    const fileChars = charsByFile.get(candidate.fileKey) ?? 0;
    return (
      fileLines + delta.fileLines <= parsed.budget.maxLinesPerFile &&
      usedTotalLines + delta.lines <= parsed.budget.maxTotalLines &&
      fileChars + delta.fileChars <= parsed.budget.maxCharsPerFile &&
      usedTotalChars + delta.chars <= parsed.budget.maxTotalChars
    );
  }

  function recordResources(candidate: NormalizedCandidate): void {
    const lines =
      candidate.section.source.endLine - candidate.section.source.startLine + 1;
    linesByFile.set(
      candidate.fileKey,
      (linesByFile.get(candidate.fileKey) ?? 0) + lines,
    );
    usedTotalLines += lines;
    const chars = candidate.section.excerpt.length;
    charsByFile.set(
      candidate.fileKey,
      (charsByFile.get(candidate.fileKey) ?? 0) + chars,
    );
    usedTotalChars += chars;
  }

  function relationConflict(
    candidate: NormalizedCandidate,
  ): InternalSelection | undefined {
    return selected.find((entry) =>
      [...candidate.duplicateKeys].some(
        (duplicateKey) =>
          entry.candidate.duplicateKeys.has(duplicateKey) ||
          entry.aliases.some((alias) =>
            alias.candidate.duplicateKeys.has(duplicateKey),
          ),
      ),
    );
  }

  function addPinnedCandidate(candidate: NormalizedCandidate): boolean {
    if (!candidate.eligible || candidate.safety !== "safe") {
      pinFailures.set(candidate.id, {
        reason: "unsafe-or-ineligible",
        detail:
          "Pinned evidence is not eligible and safe, so it cannot enter the bundle.",
      });
      return false;
    }

    const existingContent = selected.find(
      (entry) => entry.candidate.contentKey === candidate.contentKey,
    );
    const newFile = !selectedFileKeys.has(candidate.fileKey);
    if (newFile && selectedFileKeys.size >= maxFiles) {
      pinFailures.set(candidate.id, {
        reason: "pin-could-not-fit",
        detail: `The pin would exceed the ${maxFiles}-file limit.`,
      });
      return false;
    }

    const addedTokens = existingContent ? 0 : candidate.tokenCost;
    if (usedTokens + addedTokens > maxTokens) {
      pinFailures.set(candidate.id, {
        reason: "pin-could-not-fit",
        detail: `The pin would exceed the ${maxTokens.toLocaleString("en-US")}-token budget.`,
      });
      return false;
    }

    if (!resourceFits(candidate)) {
      pinFailures.set(candidate.id, {
        reason: "pin-could-not-fit",
        detail:
          "The pin would exceed an existing per-file or total line/character limit.",
      });
      return false;
    }

    if (existingContent) {
      existingContent.aliases.push({ candidate, pinned: true });
      existingContent.aliases.sort((left, right) =>
        compareText(left.candidate.id, right.candidate.id),
      );
      selectedCandidateIds.add(candidate.id);
      selectedFileKeys.add(candidate.fileKey);
      return true;
    }

    if (selected.length >= maxSections) {
      pinFailures.set(candidate.id, {
        reason: "pin-could-not-fit",
        detail: `The pin would exceed the ${maxSections}-section limit.`,
      });
      return false;
    }

    const entry: InternalSelection = {
      candidate,
      pinned: true,
      marginalFeatureIds: [],
      selectionReason:
        "Pinned by the user and retained within current safety and resource limits.",
      aliases: [],
      chargedTokens: candidate.tokenCost,
    };
    selected.push(entry);
    selectedCandidateIds.add(candidate.id);
    selectedFileKeys.add(candidate.fileKey);
    chargedContentKeys.add(candidate.contentKey);
    usedTokens += candidate.tokenCost;
    recordResources(candidate);
    addRoleCoverage(entry, coveredByRole);
    return true;
  }

  const candidateById = new Map<string, NormalizedCandidate>(
    candidates.map((candidate) => [candidate.id, candidate] as const),
  );
  const requestedPins = new Set([
    ...parsed.candidates
      .filter((candidate) => candidate.pinned)
      .map((candidate) => candidate.id),
    ...parsed.adjustments.pinnedCandidateIds,
  ]);
  const excluded = new Set(parsed.adjustments.excludedCandidateIds);

  for (const pinId of [...requestedPins].sort(compareText)) {
    const candidate = candidateById.get(pinId);
    if (!candidate) {
      pinFailures.set(pinId, {
        reason: "pin-could-not-fit",
        detail:
          "The pinned candidate is no longer present in the prepared candidate set.",
      });
      continue;
    }
    if (excluded.has(pinId)) continue;
    addPinnedCandidate(candidate);
  }

  const selectedPins = [...selectedCandidateIds].filter((id) =>
    requestedPins.has(id),
  );
  if (selectedPins.length < requestedPins.size) {
    limitations.push(
      "One or more requested pins could not fit or were no longer eligible; review the pin warnings before approval.",
    );
  }

  for (const role of ROLE_ORDER) {
    const roleTarget = roleTargets[role];
    const roleRemaining = Math.max(0, roleTarget - tokensForRole(role));
    fillFromCandidates(
      roleRemaining,
      (candidate) => candidate.role === role,
      false,
    );
  }

  const remainingTokens = Math.max(0, maxTokens - usedTokens);
  if (remainingTokens > 0 && selected.length < maxSections) {
    fillFromCandidates(remainingTokens, () => true, true);
  }

  function fillFromCandidates(
    roleAllowance: number,
    roleMatches: (candidate: NormalizedCandidate) => boolean,
    borrowing: boolean,
  ): void {
    let allowanceUsed = 0;
    while (
      selected.length < maxSections &&
      usedTokens < maxTokens &&
      allowanceUsed < roleAllowance
    ) {
      const ranked = candidates
        .filter((candidate) => {
          if (selectedCandidateIds.has(candidate.id)) return false;
          if (requestedPins.has(candidate.id) || excluded.has(candidate.id))
            return false;
          if (!candidate.eligible || candidate.safety !== "safe") return false;
          if (!roleMatches(candidate)) return false;
          if (relationConflict(candidate)) return false;
          const isNewFile = !selectedFileKeys.has(candidate.fileKey);
          if (isNewFile && selectedFileKeys.size >= maxFiles) return false;
          const cost = marginalTokenCost(candidate);
          if (cost <= 0) return false;
          if (usedTokens + cost > maxTokens) return false;
          if (allowanceUsed + cost > roleAllowance) return false;
          if (!resourceFits(candidate)) return false;
          return true;
        })
        .map((candidate) => ({
          candidate,
          marginalGain: marginalGain(candidate, coveredByRole, featureWeights),
        }))
        .map((entry) => ({
          ...entry,
          utility: adjustedUtility(
            entry.candidate,
            entry.marginalGain,
            testTokensUsed(),
            softTestTarget,
            selected.some((item) => item.candidate.isWrapper),
          ),
        }))
        .filter((entry) => entry.utility > 0)
        .sort(compareRankedCandidates);

      const best = ranked[0];
      if (!best) break;

      const cost = marginalTokenCost(best.candidate);
      const marginalFeatureIds = getNewFeatureIds(
        best.candidate,
        coveredByRole,
      );
      const featureLabels = marginalFeatureIds.map(
        (featureId) => featureById.get(featureId)?.label ?? featureId,
      );
      const selectionReason = [
        featureLabels.length > 0
          ? `Selected for marginal ${best.candidate.role} coverage of ${featureLabels.join(", ")}.`
          : `Selected to represent useful ${best.candidate.role} evidence within the current budget.`,
        borrowing ? "Unused role capacity was borrowed." : "",
      ]
        .filter(Boolean)
        .join(" ");
      const entry: InternalSelection = {
        candidate: best.candidate,
        pinned: false,
        marginalFeatureIds,
        selectionReason,
        aliases: [],
        chargedTokens: cost,
      };
      selected.push(entry);
      selectedCandidateIds.add(best.candidate.id);
      selectedFileKeys.add(best.candidate.fileKey);
      chargedContentKeys.add(best.candidate.contentKey);
      usedTokens += cost;
      allowanceUsed += cost;
      recordResources(best.candidate);
      addRoleCoverage(entry, coveredByRole);
    }
  }

  const omittedCandidates: OmittedCandidate[] = candidates
    .filter((candidate) => !selectedCandidateIds.has(candidate.id))
    .map((candidate) => {
      const wasPinned = requestedPins.has(candidate.id);
      const pinFailure = pinFailures.get(candidate.id);
      if (pinFailure) {
        return omission(
          candidate,
          pinFailure.reason,
          pinFailure.detail,
          wasPinned,
        );
      }
      if (excluded.has(candidate.id)) {
        return omission(
          candidate,
          "excluded-by-user",
          "The user excluded this candidate in the current adjustment set.",
          wasPinned,
        );
      }
      if (!candidate.eligible || candidate.safety !== "safe") {
        return omission(
          candidate,
          "unsafe-or-ineligible",
          "Only screened, eligible, safe evidence can be selected.",
          wasPinned,
        );
      }
      const conflict = relationConflict(candidate);
      if (conflict) {
        return omission(
          candidate,
          "duplicate-or-overlapping",
          "An overlapping or duplicate section is already represented; select a merged section or adjust the bundle to include different evidence.",
          wasPinned,
          conflict.candidate.id,
        );
      }
      if (selected.length >= maxSections) {
        return omission(
          candidate,
          "section-limit",
          `The bundle reached its ${maxSections}-section limit.`,
          wasPinned,
        );
      }
      if (
        !selectedFileKeys.has(candidate.fileKey) &&
        selectedFileKeys.size >= maxFiles
      ) {
        return omission(
          candidate,
          "file-limit",
          `The bundle reached its ${maxFiles}-file limit.`,
          wasPinned,
        );
      }
      const cost = marginalTokenCost(candidate);
      if (usedTokens + cost > maxTokens) {
        return omission(
          candidate,
          "token-budget",
          `Adding this section would exceed the ${maxTokens.toLocaleString("en-US")}-token budget.`,
          wasPinned,
        );
      }
      if (!resourceFits(candidate)) {
        return omission(
          candidate,
          "source-budget",
          "Adding this section would exceed an existing per-file or total line/character limit.",
          wasPinned,
        );
      }
      return omission(
        candidate,
        "lower-marginal-value",
        "Higher-value evidence covered more currently missing role-specific features per token within the available role allocation.",
        wasPinned,
      );
    })
    .sort((left, right) => compareText(left.candidateId, right.candidateId));

  const sections = selected
    .map(toSelectedSection)
    .sort((left, right) => compareText(left.candidateId, right.candidateId));
  const coverage = buildCoverage(parsed.features, sections, parsed.context);
  const missingCriticalFeatureIds = coverage
    .filter((item) => item.critical && !item.implementationCovered)
    .map((item) => item.featureId)
    .sort(compareText);
  if (missingCriticalFeatureIds.length > 0) {
    limitations.push(
      `Critical implementation evidence is missing for: ${missingCriticalFeatureIds.join(", ")}. Overview documents or tests do not substitute for implementation evidence.`,
    );
  }

  if (softTestTarget !== null && testTokensUsed() > softTestTarget) {
    limitations.push(
      `Test evidence uses ${testTokensUsed()} tokens, above the soft ${(GENERAL_TEST_SHARE * 100).toFixed(1)}% overview allocation of ${softTestTarget} tokens; the soft target yielded to marginal evidence value or pins.`,
    );
  }

  const usedFiles = selectedFileKeys.size;
  const totalRoleUse = new Map<EvidenceRole, number>(
    ROLE_ORDER.map((role) => [role, tokensForRole(role)] as const),
  );
  const usedByRole = Object.fromEntries(
    ROLE_ORDER.map((role) => [role, totalRoleUse.get(role) ?? 0]),
  ) as Record<EvidenceRole, number>;
  const unusedTargets = ROLE_ORDER.reduce(
    (sum, role) => sum + Math.max(0, roleTargets[role] - usedByRole[role]),
    0,
  );
  const roleAllocations = ROLE_ORDER.map((role) => ({
    role,
    targetTokens: roleTargets[role],
    usedTokens: usedByRole[role],
    borrowedTokens: Math.max(0, usedByRole[role] - roleTargets[role]),
  }));
  const borrowedTokens = roleAllocations.reduce(
    (sum, allocation) => sum + allocation.borrowedTokens,
    0,
  );
  if (borrowedTokens > 0 && unusedTargets > 0) {
    limitations.push(
      `${borrowedTokens} tokens were borrowed from unfilled role targets to cover useful evidence in other roles.`,
    );
  }

  const claimEvidenceFeatureIds = coverage
    .filter(
      (item) =>
        item.confirmedContribution && item.implementationEvidenceIds.length > 0,
    )
    .map((item) => item.featureId)
    .sort(compareText);
  const implementationFeatureSet = new Set(
    parsed.features
      .filter((feature) =>
        sections.some(
          (section) =>
            section.role === "implementation" &&
            !section.isWrapper &&
            section.featureIds.includes(feature.id),
        ),
      )
      .map((feature) => feature.id),
  );
  const implementationEvidenceCandidateIds = sections
    .filter(
      (section) => section.role === "implementation" && !section.isWrapper,
    )
    .map((section) => section.candidateId)
    .sort(compareText);
  const implementationDenominator = parsed.features.length;
  const implementationNumerator = implementationFeatureSet.size;
  const pinnedCandidateIds = [...requestedPins].sort(compareText);
  const unfulfilledPinnedCandidateIds = [...pinFailures.keys()].sort(
    compareText,
  );
  const fileIdentities = new Map<
    string,
    EvidenceBundle["selectedFileIdentities"][number]
  >();
  for (const entry of selected) {
    for (const source of [
      entry.candidate.section.source,
      ...entry.aliases.map((alias) => alias.candidate.section.source),
    ]) {
      fileIdentities.set(
        key(
          source.repositoryId,
          source.commitSha.toLowerCase(),
          source.path,
          source.blobSha.toLowerCase(),
        ),
        {
          repositoryId: source.repositoryId,
          commitSha: source.commitSha,
          path: source.path,
          blobSha: source.blobSha,
        },
      );
    }
  }
  const sortedFileIdentities = [...fileIdentities.values()].sort(
    (left, right) =>
      compareText(
        `${left.path}:${left.blobSha}`,
        `${right.path}:${right.blobSha}`,
      ),
  );

  const bundle: Omit<EvidenceBundle, "selectionIdentity"> = {
    algorithmVersion: BUNDLE_ALGORITHM_VERSION,
    policyVersion: BUNDLE_POLICY_VERSION,
    repositoryId: parsed.repositoryId,
    commitSha: parsed.commitSha,
    consentHash: null,
    contextMode: parsed.context.mode,
    selectedSections: sections,
    selectedFileIdentities: sortedFileIdentities,
    selectedCandidateIds: [...selectedCandidateIds].sort(compareText),
    pinnedCandidateIds,
    unfulfilledPinnedCandidateIds,
    omittedCandidates,
    coverage,
    missingCriticalFeatureIds,
    claimEvidenceFeatureIds,
    implementationCoverage: {
      numerator: implementationNumerator,
      denominator: implementationDenominator,
      denominatorLabel: "expected implementation features",
      ratio:
        implementationDenominator === 0
          ? null
          : implementationNumerator / implementationDenominator,
      evidenceCandidateIds: implementationEvidenceCandidateIds,
    },
    roleAllocations,
    testAllocation: {
      mode: testingOverride ? "explicit-testing-contribution" : "soft-overview",
      targetTokens: softTestTarget,
      usedTokens: testTokensUsed(),
      exceededSoftTarget:
        softTestTarget !== null && testTokensUsed() > softTestTarget,
    },
    budget: {
      maxTokens,
      usedTokens,
      remainingTokens: maxTokens - usedTokens,
      maxFiles,
      usedFiles,
      maxSections,
      usedSections: sections.length,
      maxLinesPerFile: parsed.budget.maxLinesPerFile,
      maxTotalLines: parsed.budget.maxTotalLines,
      usedTotalLines,
      maxCharsPerFile: parsed.budget.maxCharsPerFile,
      maxTotalChars: parsed.budget.maxTotalChars,
      usedTotalChars,
      admitted: true,
    },
    limitations: uniqueSorted(limitations),
  };
  const selectionIdentity = createSelectionIdentity(bundle);
  return { ...bundle, selectionIdentity };

  function marginalTokenCost(candidate: NormalizedCandidate): number {
    return chargedContentKeys.has(candidate.contentKey)
      ? 0
      : candidate.tokenCost;
  }
}

function normalizeCandidates(
  input: BundleAllocationInput,
): NormalizedCandidate[] {
  const candidates: NormalizedCandidate[] = input.candidates.map(
    (candidate) => {
      const { source } = candidate.section;
      const excerptHash = hashText(candidate.section.excerpt);
      if (excerptHash !== source.excerptSha256.toLowerCase()) {
        throw new Error(`Excerpt hash mismatch for candidate ${candidate.id}.`);
      }
      if (
        source.repositoryId !== input.repositoryId ||
        source.commitSha.toLowerCase() !== input.commitSha.toLowerCase()
      ) {
        throw new Error(
          `Candidate ${candidate.id} does not belong to the requested repository commit.`,
        );
      }
      const fileKey = key(
        source.repositoryId,
        source.commitSha.toLowerCase(),
        source.path,
        source.blobSha.toLowerCase(),
      );
      return {
        ...candidate,
        fileKey,
        contentKey: `content:${excerptHash}`,
        duplicateKeys: new Set([
          `content:${excerptHash}`,
          ...candidate.duplicateGroupIds.map((id) => `group:${id}`),
        ]),
      };
    },
  );

  const byFile = new Map<string, NormalizedCandidate[]>();
  for (const candidate of candidates) {
    const group = byFile.get(candidate.fileKey) ?? [];
    group.push(candidate);
    byFile.set(candidate.fileKey, group);
  }
  for (const [fileKey, group] of byFile) {
    const sorted = [...group].sort(
      (left, right) =>
        left.section.source.startLine - right.section.source.startLine ||
        left.section.source.endLine - right.section.source.endLine ||
        compareText(left.id, right.id),
    );
    let active: NormalizedCandidate[] = [];
    let activeEndLine = -1;
    let groupIndex = 0;
    for (const candidate of sorted) {
      const { startLine, endLine } = candidate.section.source;
      if (active.length > 0 && startLine > activeEndLine) {
        groupIndex += 1;
        active = [];
        activeEndLine = -1;
      }
      active.push(candidate);
      activeEndLine = Math.max(activeEndLine, endLine);
      if (active.length > 1) {
        const overlapKey = `overlap:${fileKey}:${groupIndex}`;
        for (const member of active) member.duplicateKeys.add(overlapKey);
      }
    }
  }

  return candidates.sort((left, right) => compareText(left.id, right.id));
}

function validateInputRelations(input: BundleAllocationInput): void {
  const candidateIds = new Set<string>();
  for (const candidate of input.candidates) {
    if (candidateIds.has(candidate.id)) {
      throw new Error(`Duplicate ranked candidate id: ${candidate.id}.`);
    }
    candidateIds.add(candidate.id);
  }
  for (const candidate of input.candidates) {
    if (
      candidate.pinned &&
      input.adjustments.excludedCandidateIds.includes(candidate.id)
    ) {
      throw new Error(
        `Candidate ${candidate.id} cannot be pinned and excluded.`,
      );
    }
  }
  const featureIds = new Set<string>();
  for (const feature of input.features) {
    if (featureIds.has(feature.id)) {
      throw new Error(`Duplicate expected feature id: ${feature.id}.`);
    }
    featureIds.add(feature.id);
  }
  for (const candidate of input.candidates) {
    const unknownFeatureId = candidate.featureIds.find(
      (id) => !featureIds.has(id),
    );
    if (unknownFeatureId) {
      throw new Error(
        `Candidate ${candidate.id} references unknown feature ${unknownFeatureId}.`,
      );
    }
  }
  for (const featureId of input.context.confirmedContributionFeatureIds) {
    if (!featureIds.has(featureId)) {
      throw new Error(
        `Confirmed contribution feature is unknown: ${featureId}.`,
      );
    }
  }
  const adjustmentIds = new Set<string>();
  for (const id of [
    ...input.adjustments.pinnedCandidateIds,
    ...input.adjustments.excludedCandidateIds,
  ]) {
    if (
      adjustmentIds.has(id) &&
      input.adjustments.pinnedCandidateIds.includes(id)
    ) {
      throw new Error(`Candidate ${id} cannot be both pinned and excluded.`);
    }
    adjustmentIds.add(id);
  }
}

function allocateRoleTargets(maxTokens: number): Record<EvidenceRole, number> {
  const overview = Math.floor(maxTokens * ROLE_SHARES.overview);
  const verification = Math.floor(maxTokens * ROLE_SHARES.verification);
  return {
    overview,
    implementation: maxTokens - overview - verification,
    verification,
  };
}

function featureWeight(feature: ExpectedFeature): number {
  return feature.weight * (feature.critical ? 3 : 1);
}

function marginalGain(
  candidate: NormalizedCandidate,
  coveredByRole: Map<EvidenceRole, Set<string>>,
  weights: Map<string, number>,
): number {
  const covered = coveredByRole.get(candidate.role) ?? new Set<string>();
  const countableFeatureIds = candidate.isWrapper ? [] : candidate.featureIds;
  const newFeatureWeight = countableFeatureIds.reduce(
    (sum, featureId) =>
      sum + (covered.has(featureId) ? 0 : (weights.get(featureId) ?? 0)),
    0,
  );
  const rankingSignal = candidate.rankScore / 100;
  return newFeatureWeight + rankingSignal * 0.05;
}

function getNewFeatureIds(
  candidate: NormalizedCandidate,
  coveredByRole: Map<EvidenceRole, Set<string>>,
): string[] {
  if (candidate.isWrapper && candidate.role === "implementation") return [];
  const covered = coveredByRole.get(candidate.role) ?? new Set<string>();
  return candidate.featureIds
    .filter((featureId) => !covered.has(featureId))
    .sort(compareText);
}

function adjustedUtility(
  candidate: NormalizedCandidate,
  gain: number,
  testsAlreadyUsed: number,
  softTestTarget: number | null,
  wrapperAlreadySelected: boolean,
): number {
  const cost = Math.max(1, candidate.tokenCost);
  let utility = gain / cost;
  if (
    candidate.isTestEvidence &&
    softTestTarget !== null &&
    testsAlreadyUsed + cost > softTestTarget
  ) {
    utility *= TEST_OVER_TARGET_PENALTY;
  }
  if (candidate.isWrapper && wrapperAlreadySelected) utility *= 0.2;
  return utility;
}

function compareRankedCandidates(
  left: {
    candidate: NormalizedCandidate;
    marginalGain: number;
    utility: number;
  },
  right: {
    candidate: NormalizedCandidate;
    marginalGain: number;
    utility: number;
  },
): number {
  return (
    right.utility - left.utility ||
    right.marginalGain - left.marginalGain ||
    left.candidate.tokenCost - right.candidate.tokenCost ||
    compareText(left.candidate.id, right.candidate.id) ||
    compareText(
      left.candidate.section.source.path,
      right.candidate.section.source.path,
    )
  );
}

function addRoleCoverage(
  entry: InternalSelection,
  coveredByRole: Map<EvidenceRole, Set<string>>,
): void {
  if (entry.candidate.isWrapper && entry.candidate.role === "implementation") {
    return;
  }
  const covered = coveredByRole.get(entry.candidate.role);
  for (const featureId of entry.candidate.featureIds) covered?.add(featureId);
}

function toSelectedSection(entry: InternalSelection): SelectedEvidenceSection {
  return {
    candidateId: entry.candidate.id,
    section: entry.candidate.section,
    role: entry.candidate.role,
    featureIds: [...entry.candidate.featureIds].sort(compareText),
    rankScore: entry.candidate.rankScore,
    tokenCost: entry.chargedTokens,
    pinned: entry.pinned,
    isTestEvidence: entry.candidate.isTestEvidence,
    isWrapper: entry.candidate.isWrapper,
    uncertaintyFlags: [...entry.candidate.uncertaintyFlags].sort(compareText),
    marginalFeatureIds: entry.marginalFeatureIds,
    selectionReason: entry.selectionReason,
    pinnedAliases: entry.aliases
      .filter((alias) => alias.pinned)
      .map((alias) => ({
        candidateId: alias.candidate.id,
        source: alias.candidate.section.source,
        role: alias.candidate.role,
        selectionReason:
          "Pinned exact provenance is retained as an alias; its identical excerpt is transmitted once.",
      }))
      .sort((left, right) => compareText(left.candidateId, right.candidateId)),
  };
}

function buildCoverage(
  features: ExpectedFeature[],
  sections: SelectedEvidenceSection[],
  context: BundleContext,
): EvidenceBundle["coverage"] {
  const confirmed = new Set(context.confirmedContributionFeatureIds);
  return [...features]
    .sort((left, right) => compareText(left.id, right.id))
    .map((feature) => {
      const evidenceFor = (role: EvidenceRole) =>
        sections
          .filter(
            (section) =>
              section.role === role &&
              section.featureIds.includes(feature.id) &&
              !(role === "implementation" && section.isWrapper),
          )
          .map((section) => section.candidateId)
          .sort(compareText);
      const implementationEvidenceIds = evidenceFor("implementation");
      return {
        featureId: feature.id,
        label: feature.label,
        critical: feature.critical,
        overviewEvidenceIds: evidenceFor("overview"),
        implementationEvidenceIds,
        verificationEvidenceIds: evidenceFor("verification"),
        confirmedContribution: confirmed.has(feature.id),
        implementationCovered: implementationEvidenceIds.length > 0,
      };
    });
}

function omission(
  candidate: NormalizedCandidate,
  reason: OmissionReason,
  detail: string,
  wasPinned: boolean,
  relatedCandidateId?: string,
): OmittedCandidate {
  return {
    candidateId: candidate.id,
    path: candidate.section.source.path,
    reason,
    detail,
    ...(relatedCandidateId ? { relatedCandidateId } : {}),
    wasPinned,
  };
}

function createSelectionIdentity(
  bundle: Omit<EvidenceBundle, "selectionIdentity">,
): string {
  const material = {
    algorithmVersion: bundle.algorithmVersion,
    policyVersion: bundle.policyVersion,
    repositoryId: bundle.repositoryId,
    commitSha: bundle.commitSha.toLowerCase(),
    contextMode: bundle.contextMode,
    selectedSections: bundle.selectedSections.map((section) => ({
      candidateId: section.candidateId,
      source: section.section.source,
      excerptSha256: section.section.source.excerptSha256.toLowerCase(),
      role: section.role,
      featureIds: section.featureIds,
      tokenCost: section.tokenCost,
      pinned: section.pinned,
      marginalFeatureIds: section.marginalFeatureIds,
      selectionReason: section.selectionReason,
      pinnedAliases: section.pinnedAliases,
    })),
    selectedCandidateIds: bundle.selectedCandidateIds,
    pinnedCandidateIds: bundle.pinnedCandidateIds,
    unfulfilledPinnedCandidateIds: bundle.unfulfilledPinnedCandidateIds,
    omittedCandidates: bundle.omittedCandidates,
    coverage: bundle.coverage,
    claimEvidenceFeatureIds: bundle.claimEvidenceFeatureIds,
    roleAllocations: bundle.roleAllocations,
    limitations: bundle.limitations,
    budget: bundle.budget,
    testAllocation: bundle.testAllocation,
  };
  return `sha256:${hashText(stableJson(material))}`;
}

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareText(left, right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function key(...parts: Array<string | number>): string {
  return parts
    .map((part) => `${String(part).length}:${String(part)}`)
    .join("|");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

export function createBaselineSelectionAdapterInput(input: {
  repositoryId: string;
  commitSha: string;
  candidates: RankedCandidate[];
  features: ExpectedFeature[];
  context: BundleContext;
  caps: LiveBaselineCaps;
  adjustments?: BundleAllocationRequest["adjustments"];
}): BundleAllocationInput {
  const budget = createBaselineBundleBudget(input.caps);
  return BundleAllocationInputSchema.parse({
    repositoryId: input.repositoryId,
    commitSha: input.commitSha,
    candidates: input.candidates,
    features: input.features,
    context: input.context,
    budget,
    adjustments: input.adjustments,
  });
}
