import { z } from "zod";

export const BUNDLE_ALGORITHM_VERSION = "coverage-allocation-v1" as const;
export const BUNDLE_POLICY_VERSION = "evidence-roles-v1" as const;
export const BASELINE_MAX_FILES = 12;
export const BASELINE_MAX_SECTIONS = 300;
export const BASELINE_MAX_INPUT_TOKENS_PER_IMPORT = 36_000;
export const BASELINE_MAX_LINES_PER_FILE = 200;
export const BASELINE_MAX_LINES_PER_REQUEST = 1_500;
export const BASELINE_MAX_CHARS_PER_FILE = 12_000;
export const BASELINE_MAX_CHARS_TOTAL = 80_000;

const stableId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u);
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/iu);

export const SourceIdentitySchema = z
  .object({
    repositoryId: z.string().regex(/^\d{1,30}$/u),
    commitSha: sha,
    path: z
      .string()
      .min(1)
      .max(1_024)
      .refine(
        isSafeRepositoryPath,
        "Repository path must be safe and relative.",
      ),
    blobSha: sha,
    startLine: z.number().int().positive().max(10_000_000),
    endLine: z.number().int().positive().max(10_000_000),
    excerptSha256: sha256,
  })
  .strict()
  .refine((identity) => identity.endLine >= identity.startLine, {
    message: "End line must not precede start line.",
    path: ["endLine"],
  });
export type SourceIdentity = z.infer<typeof SourceIdentitySchema>;

export const ScreenedSectionSchema = z
  .object({
    id: stableId,
    source: SourceIdentitySchema,
    excerpt: z.string().min(1).max(20_000),
    screeningResult: z.literal("passed"),
    roleHint: z.string().max(80).optional(),
    warnings: z.array(z.string().max(250)).max(20).default([]),
  })
  .strict()
  .refine(
    (section) =>
      countExcerptLines(section.excerpt) ===
      section.source.endLine - section.source.startLine + 1,
    {
      message: "Excerpt line count must match its exact source line range.",
      path: ["excerpt"],
    },
  );
export type ScreenedSection = z.infer<typeof ScreenedSectionSchema>;

export const EvidenceRoleSchema = z.enum([
  "overview",
  "implementation",
  "verification",
]);
export type EvidenceRole = z.infer<typeof EvidenceRoleSchema>;

export const RankedCandidateSchema = z
  .object({
    id: stableId,
    section: ScreenedSectionSchema,
    role: EvidenceRoleSchema,
    featureIds: z.array(stableId).max(100),
    rankScore: z.number().finite().min(0).max(100),
    expectedIncrementalCoverage: z.number().finite().min(0).max(1),
    tokenCost: z.number().int().positive().max(1_000_000),
    eligible: z.boolean(),
    safety: z.enum(["safe", "blocked", "needs-review"]),
    pinned: z.boolean().default(false),
    isTestEvidence: z.boolean().default(false),
    isWrapper: z.boolean().default(false),
    duplicateGroupIds: z.array(stableId).max(20).default([]),
    uncertaintyFlags: z.array(stableId).max(20).default([]),
  })
  .strict()
  .refine(
    (candidate) =>
      !candidate.isTestEvidence || candidate.role === "verification",
    {
      message: "Test evidence must use the verification role.",
      path: ["role"],
    },
  );
export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;

export const ExpectedFeatureSchema = z
  .object({
    id: stableId,
    label: z.string().trim().min(1).max(160),
    critical: z.boolean(),
    weight: z.number().finite().positive().max(100),
  })
  .strict();
export type ExpectedFeature = z.infer<typeof ExpectedFeatureSchema>;

export const BundleBudgetSchema = z
  .object({
    maxTokens: z.number().int().positive().max(1_000_000),
    maxFiles: z.number().int().positive().max(10_000),
    maxSections: z
      .number()
      .int()
      .positive()
      .max(10_000)
      .default(BASELINE_MAX_SECTIONS),
    maxLinesPerFile: z.number().int().positive().max(10_000).default(200),
    maxTotalLines: z.number().int().positive().max(100_000).default(1_500),
    maxCharsPerFile: z.number().int().positive().max(1_000_000).default(12_000),
    maxTotalChars: z.number().int().positive().max(10_000_000).default(80_000),
  })
  .strict();
export type BundleBudget = z.infer<typeof BundleBudgetSchema>;

export const BundleContextSchema = z
  .object({
    mode: z.enum(["whole-project", "contribution-focused"]),
    confirmedContributionFeatureIds: z.array(stableId).max(100).default([]),
    testingContributionConfirmed: z.boolean().default(false),
  })
  .strict();
export type BundleContext = z.infer<typeof BundleContextSchema>;

export const BundleAdjustmentsSchema = z
  .object({
    pinnedCandidateIds: z.array(stableId).max(100).default([]),
    excludedCandidateIds: z.array(stableId).max(2_000).default([]),
  })
  .strict()
  .refine(
    (adjustments) =>
      !adjustments.pinnedCandidateIds.some((id) =>
        adjustments.excludedCandidateIds.includes(id),
      ),
    {
      message: "A candidate cannot be pinned and excluded at the same time.",
    },
  );
export type BundleAdjustments = z.infer<typeof BundleAdjustmentsSchema>;

export const BundleAllocationInputSchema = z
  .object({
    repositoryId: z.string().regex(/^\d{1,30}$/u),
    commitSha: sha,
    candidates: z.array(RankedCandidateSchema).max(2_000),
    features: z.array(ExpectedFeatureSchema).max(200),
    context: BundleContextSchema,
    budget: BundleBudgetSchema,
    adjustments: BundleAdjustmentsSchema.default({
      pinnedCandidateIds: [],
      excludedCandidateIds: [],
    }),
  })
  .strict();
export type BundleAllocationRequest = z.input<
  typeof BundleAllocationInputSchema
>;
export type BundleAllocationInput = z.infer<typeof BundleAllocationInputSchema>;

export const OmissionReasonSchema = z.enum([
  "unsafe-or-ineligible",
  "excluded-by-user",
  "duplicate-or-overlapping",
  "token-budget",
  "file-limit",
  "section-limit",
  "source-budget",
  "lower-marginal-value",
  "pin-could-not-fit",
]);
export type OmissionReason = z.infer<typeof OmissionReasonSchema>;

export interface OmittedCandidate {
  candidateId: string;
  path: string;
  reason: OmissionReason;
  detail: string;
  relatedCandidateId?: string;
  wasPinned: boolean;
}

export interface SelectedEvidenceSection {
  candidateId: string;
  section: ScreenedSection;
  role: EvidenceRole;
  featureIds: string[];
  rankScore: number;
  tokenCost: number;
  pinned: boolean;
  isTestEvidence: boolean;
  isWrapper: boolean;
  uncertaintyFlags: string[];
  marginalFeatureIds: string[];
  selectionReason: string;
  /** Exact-provenance aliases for explicitly pinned, content-identical sections. */
  pinnedAliases: Array<{
    candidateId: string;
    source: SourceIdentity;
    role: EvidenceRole;
    selectionReason: string;
  }>;
}

export interface FeatureCoverage {
  featureId: string;
  label: string;
  critical: boolean;
  overviewEvidenceIds: string[];
  implementationEvidenceIds: string[];
  verificationEvidenceIds: string[];
  confirmedContribution: boolean;
  implementationCovered: boolean;
}

export interface RoleAllocation {
  role: EvidenceRole;
  targetTokens: number;
  usedTokens: number;
  borrowedTokens: number;
}

export interface EvidenceBundle {
  algorithmVersion: typeof BUNDLE_ALGORITHM_VERSION;
  policyVersion: typeof BUNDLE_POLICY_VERSION;
  repositoryId: string;
  commitSha: string;
  selectionIdentity: string;
  /** Null until an explicit approval adapter binds this review to user consent. */
  consentHash: null;
  contextMode: BundleContext["mode"];
  selectedSections: SelectedEvidenceSection[];
  selectedFileIdentities: Array<{
    repositoryId: string;
    commitSha: string;
    path: string;
    blobSha: string;
  }>;
  selectedCandidateIds: string[];
  pinnedCandidateIds: string[];
  unfulfilledPinnedCandidateIds: string[];
  omittedCandidates: OmittedCandidate[];
  coverage: FeatureCoverage[];
  missingCriticalFeatureIds: string[];
  claimEvidenceFeatureIds: string[];
  implementationCoverage: {
    numerator: number;
    denominator: number;
    denominatorLabel: "expected implementation features";
    ratio: number | null;
    evidenceCandidateIds: string[];
  };
  roleAllocations: RoleAllocation[];
  testAllocation: {
    mode: "soft-overview" | "explicit-testing-contribution";
    targetTokens: number | null;
    usedTokens: number;
    exceededSoftTarget: boolean;
  };
  budget: {
    maxTokens: number;
    usedTokens: number;
    remainingTokens: number;
    maxFiles: number;
    usedFiles: number;
    maxSections: number;
    usedSections: number;
    maxLinesPerFile: number;
    maxTotalLines: number;
    usedTotalLines: number;
    maxCharsPerFile: number;
    maxTotalChars: number;
    usedTotalChars: number;
    admitted: true;
  };
  limitations: string[];
}

export interface LiveBaselineCaps {
  filesPerRequest: number;
  inputTokensPerImport: number;
  linesPerFilePerRequest: number;
  linesPerRequest: number;
  selectedCharactersPerFile: number;
  selectedCharactersTotal: number;
  reservedInputTokens?: number;
  sectionsPerPreparedSelection?: number;
}

export function createBaselineBundleBudget(
  caps: LiveBaselineCaps,
): BundleBudget {
  const parsed = z
    .object({
      filesPerRequest: z.number().int().positive(),
      inputTokensPerImport: z.number().int().positive(),
      linesPerFilePerRequest: z
        .number()
        .int()
        .positive()
        .default(BASELINE_MAX_LINES_PER_FILE),
      linesPerRequest: z
        .number()
        .int()
        .positive()
        .default(BASELINE_MAX_LINES_PER_REQUEST),
      selectedCharactersPerFile: z
        .number()
        .int()
        .positive()
        .default(BASELINE_MAX_CHARS_PER_FILE),
      selectedCharactersTotal: z
        .number()
        .int()
        .positive()
        .default(BASELINE_MAX_CHARS_TOTAL),
      reservedInputTokens: z.number().int().nonnegative().default(0),
      sectionsPerPreparedSelection: z
        .number()
        .int()
        .positive()
        .default(BASELINE_MAX_SECTIONS),
    })
    .strict()
    .parse(caps);
  const maxTokens =
    Math.min(
      parsed.inputTokensPerImport,
      BASELINE_MAX_INPUT_TOKENS_PER_IMPORT,
    ) - parsed.reservedInputTokens;
  if (maxTokens <= 0) {
    throw new RangeError(
      "Reserved tokens must leave a positive evidence budget.",
    );
  }

  return {
    maxTokens,
    maxFiles: Math.min(parsed.filesPerRequest, BASELINE_MAX_FILES),
    maxSections: Math.min(
      parsed.sectionsPerPreparedSelection,
      BASELINE_MAX_SECTIONS,
    ),
    maxLinesPerFile: Math.min(
      parsed.linesPerFilePerRequest,
      BASELINE_MAX_LINES_PER_FILE,
    ),
    maxTotalLines: Math.min(
      parsed.linesPerRequest,
      BASELINE_MAX_LINES_PER_REQUEST,
    ),
    maxCharsPerFile: Math.min(
      parsed.selectedCharactersPerFile,
      BASELINE_MAX_CHARS_PER_FILE,
    ),
    maxTotalChars: Math.min(
      parsed.selectedCharactersTotal,
      BASELINE_MAX_CHARS_TOTAL,
    ),
  };
}

function isSafeRepositoryPath(path: string): boolean {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    return false;
  }
  const segments = path.split("/");
  return segments.every(
    (segment) => segment && segment !== "." && segment !== "..",
  );
}

function countExcerptLines(excerpt: string): number {
  const lineCount = excerpt.split(/\r\n|\r|\n/u).length;
  return /(?:\r\n|\r|\n)$/u.test(excerpt) ? lineCount - 1 : lineCount;
}
