import {
  FileCandidateSchema,
  RepositoryScopeSchema,
  PullRequestSummarySchema,
} from "@/lib/github/contracts";
import { createSelectionPolicy } from "@/lib/github/server/selection-policy";
import {
  EVIDENCE_LIMITS,
  type DomainError,
  type FileCandidate,
  type Result,
} from "@/lib/github/server/file-policy";
import {
  createEvidenceSelector,
  type EvidenceExecutionContext,
  type FetchedFile,
  type PreparedEvidence,
  type SelectionPlan,
} from "@/lib/github/server/selector";
import type {
  BudgetSelectionRequest,
  SelectorBudgetLedger,
} from "@/lib/github/server/selector";
import type { LabeledEvidenceBlock, RetrievalFixture } from "./fixtures";

export interface MissingEvidenceDiagnostic {
  blockId: string;
  path: string;
  reason:
    | "candidate-not-in-inventory"
    | "candidate-not-selected"
    | "selector-excluded"
    | "file-not-packed"
    | "block-not-in-excerpt";
}

export interface FixtureEvaluation {
  fixtureId: string;
  cohort: RetrievalFixture["cohort"];
  passed: boolean;
  outcome: SelectionPlan["status"] | PreparedEvidence["completeness"];
  requiredBlocks: {
    total: number;
    retrieved: number;
    missing: MissingEvidenceDiagnostic[];
  };
  supportedFacts: {
    total: number;
    supported: number;
    missing: string[];
  };
  counterevidence: {
    total: number;
    retrieved: number;
    missing: MissingEvidenceDiagnostic[];
  };
  attribution: {
    expected: RetrievalFixture["attribution"];
    safe: boolean;
    reasons: string[];
  };
  safeExclusionLeaks: string[];
  pins: {
    requested: number;
    resolved: number;
    unexplained: string[];
  };
  sourceVolume: {
    evidenceFiles: number;
    fetchedFiles: number;
    sourceBytes: number;
    sourceCharacters: number;
    excerptCharacters: number;
    sourceLines: number;
    excerptLines: number;
  };
  selectorReasons: string[];
  diagnostics: string[];
}

export interface RetrievalQualityReport {
  selector: "task-06-createEvidenceSelector";
  integrationFindings: string[];
  fixtureCount: number;
  passedFixtures: number;
  failedFixtureIds: string[];
  cohorts: Record<"tuning" | "holdout", CohortSummary>;
  gates: {
    requiredEvidence: "all-labeled-blocks-required";
    attribution: "no-ownership-inflation";
    safeExclusions: "zero-leaks";
    manualPins: "included-or-explicitly-explained";
  };
  fixtures: FixtureEvaluation[];
}

export interface CohortSummary {
  fixtureCount: number;
  passedFixtures: number;
  requiredBlocks: number;
  retrievedRequiredBlocks: number;
  counterevidenceBlocks: number;
  retrievedCounterevidenceBlocks: number;
  supportedFacts: number;
  supportedFactsWithEvidence: number;
  safeExclusionLeaks: number;
  unexplainedPins: number;
  sourceCharacters: number;
  excerptCharacters: number;
  sourceLines: number;
  excerptLines: number;
}

/** Deterministic, model-independent report used to compare selector revisions. */
export function buildRetrievalQualityReport(
  fixtures: readonly FixtureEvaluation[],
): RetrievalQualityReport {
  const cohortSummary = (cohort: RetrievalFixture["cohort"]): CohortSummary => {
    const entries = fixtures.filter((fixture) => fixture.cohort === cohort);
    return entries.reduce<CohortSummary>(
      (summary, fixture) => ({
        fixtureCount: summary.fixtureCount + 1,
        passedFixtures: summary.passedFixtures + Number(fixture.passed),
        requiredBlocks: summary.requiredBlocks + fixture.requiredBlocks.total,
        retrievedRequiredBlocks:
          summary.retrievedRequiredBlocks + fixture.requiredBlocks.retrieved,
        counterevidenceBlocks:
          summary.counterevidenceBlocks + fixture.counterevidence.total,
        retrievedCounterevidenceBlocks:
          summary.retrievedCounterevidenceBlocks +
          fixture.counterevidence.retrieved,
        supportedFacts: summary.supportedFacts + fixture.supportedFacts.total,
        supportedFactsWithEvidence:
          summary.supportedFactsWithEvidence + fixture.supportedFacts.supported,
        safeExclusionLeaks:
          summary.safeExclusionLeaks + fixture.safeExclusionLeaks.length,
        unexplainedPins:
          summary.unexplainedPins + fixture.pins.unexplained.length,
        sourceCharacters:
          summary.sourceCharacters + fixture.sourceVolume.sourceCharacters,
        excerptCharacters:
          summary.excerptCharacters + fixture.sourceVolume.excerptCharacters,
        sourceLines: summary.sourceLines + fixture.sourceVolume.sourceLines,
        excerptLines: summary.excerptLines + fixture.sourceVolume.excerptLines,
      }),
      {
        fixtureCount: 0,
        passedFixtures: 0,
        requiredBlocks: 0,
        retrievedRequiredBlocks: 0,
        counterevidenceBlocks: 0,
        retrievedCounterevidenceBlocks: 0,
        supportedFacts: 0,
        supportedFactsWithEvidence: 0,
        safeExclusionLeaks: 0,
        unexplainedPins: 0,
        sourceCharacters: 0,
        excerptCharacters: 0,
        sourceLines: 0,
        excerptLines: 0,
      },
    );
  };

  const sortedFixtures = [...fixtures].sort((left, right) =>
    left.fixtureId.localeCompare(right.fixtureId),
  );
  return {
    selector: "task-06-createEvidenceSelector",
    integrationFindings: [
      "The integrated selector uses SelectionPolicyPort scoring while retaining native safety, coverage and budget checks. Both tuning and holdout fixtures exercise this composed policy.",
      "No compact-excerpt variant is compared because the merged selector exposes no Task 15-owned packing-policy seam. Source and packed excerpt volumes are recorded as the reproducible baseline; no token or cost reduction is claimed.",
    ],
    fixtureCount: sortedFixtures.length,
    passedFixtures: sortedFixtures.filter(({ passed }) => passed).length,
    failedFixtureIds: sortedFixtures
      .filter(({ passed }) => !passed)
      .map(({ fixtureId }) => fixtureId),
    cohorts: {
      tuning: cohortSummary("tuning"),
      holdout: cohortSummary("holdout"),
    },
    gates: {
      requiredEvidence: "all-labeled-blocks-required",
      attribution: "no-ownership-inflation",
      safeExclusions: "zero-leaks",
      manualPins: "included-or-explicitly-explained",
    },
    fixtures: sortedFixtures,
  };
}

/** Stable JSON text suitable for a CI artifact or local selector comparison. */
export function formatRetrievalQualityReport(
  report: RetrievalQualityReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const FIXED_NOW = new Date("2026-10-26T10:00:00.000Z");

/** Runs the merged Task 06 selector with only local, synthetic boundaries. */
export async function evaluateRetrievalFixture(
  fixture: RetrievalFixture,
): Promise<FixtureEvaluation> {
  const textById = new Map(
    fixture.files.map(({ candidate, text }) => [candidate.id, text]),
  );
  const fetchedTextById = new Map<string, string>();
  const candidateByPath = new Map(
    fixture.files.map(({ candidate }) => [candidate.path, candidate]),
  );
  const ledger: SelectorBudgetLedger = {
    async checkSelection(request: BudgetSelectionRequest) {
      const exceeded: string[] = [];
      if (request.files.length > EVIDENCE_LIMITS.maxFilesPerRequest)
        exceeded.push("files");
      if (request.uniqueLineCount > EVIDENCE_LIMITS.maxLinesPerRequest)
        exceeded.push("lines");
      if (request.totalCharacters > EVIDENCE_LIMITS.maxCharsPerRequest)
        exceeded.push("characters");
      if (request.totalFetchedBytes > EVIDENCE_LIMITS.maxFetchedBytes)
        exceeded.push("bytes");
      return {
        ok: true as const,
        value: {
          allowed: exceeded.length === 0,
          exhaustedDimensions: exceeded,
        },
      };
    },
  };

  const policy = createSelectionPolicy({});
  const selector = createEvidenceSelector({
    scoreCandidate(ranked, scope, prs) {
      return policy.scoreCandidate({
        candidate: FileCandidateSchema.parse({
          id: ranked.candidate.id,
          path: ranked.candidate.path,
          blobSha: ranked.candidate.blobSha,
          mode: ranked.candidate.mode,
          byteSize: ranked.candidate.byteSize,
          category:
            (
              {
                purpose: "purpose",
                stack: "manifest",
                corroboration: "test",
                measurement: "report",
                unknown: "other",
              } as Record<string, string>
            )[ranked.candidate.category ?? "unknown"] ?? "implementation",
          reasonCodes: ranked.candidate.reasonCodes ?? [],
          eligible: ranked.candidate.eligibility !== "excluded",
          safety:
            ranked.candidate.eligibility === "excluded" ? "blocked" : "safe",
          selected: ranked.selectedPath,
          pinned: ranked.pinned,
        }),
        scope: RepositoryScopeSchema.parse({
          repositoryId: "42",
          owner: scope.owner,
          name: scope.name,
          canonicalUrl: `https://github.com/${scope.owner}/${scope.name}`,
          visibility: scope.visibility,
          ref: "main",
          commitSha: scope.fullSha,
          packagePath: scope.packagePath,
          selectedPaths: scope.selectedPaths ?? [],
          selectedPullRequestNumbers: scope.selectedPrNumbers ?? [],
          contributionStatement:
            scope.contributionStatement ?? "Contribution unknown",
          identitySource:
            scope.identitySource === "self-declared"
              ? "user-provided"
              : "unknown",
        }),
        pullRequests: prs.selectedPullRequests.map((p) =>
          PullRequestSummarySchema.parse({
            number: p.number,
            title: p.title,
            state: "unknown" as const,
            authorLogin: null,
            updatedAt: null,
            changedPaths: p.changedPaths,
            headSha: null,
            baseSha: null,
            selected: true,
          }),
        ),
      });
    },
    async fetchFile({ candidate }): Promise<Result<FetchedFile>> {
      const text = textById.get(candidate.id);
      if (text === undefined) {
        return {
          ok: false,
          error: {
            code: "not-found",
            message: "Synthetic fixture file was not found.",
            retryable: false,
          },
        };
      }
      fetchedTextById.set(candidate.id, text);
      return {
        ok: true,
        value: {
          text,
          blobSha: candidate.blobSha,
          byteSize: Buffer.byteLength(text, "utf8"),
        },
      };
    },
  });

  const context: EvidenceExecutionContext = {
    runId: `task-15-${fixture.id}`,
    snapshotId: `snapshot-${fixture.id}`,
    clock: () => new Date(FIXED_NOW),
    budgetLedger: ledger,
  };
  const planResult = selector.select({
    inventory: fixture.files.map(({ candidate }) => candidate),
    scope: fixture.scope,
    prContext: fixture.prContext,
    pinnedFileIds: fixture.pinnedFileIds,
    context,
  });

  if (!planResult.ok) {
    return failedBeforePacking(fixture, planResult.error);
  }

  const plan = planResult.value;
  const packedResult = await selector.pack({ selected: plan, context });
  if (!packedResult.ok)
    return failedDuringPacking(fixture, plan, packedResult.error);

  const prepared = packedResult.value;
  const evidenceByPath = new Map(
    prepared.evidence.map((item) => [item.path, item]),
  );
  const required = diagnoseBlocks(
    fixture.requiredBlocks,
    fixture,
    plan,
    prepared,
    candidateByPath,
    evidenceByPath,
  );
  const counterevidence = diagnoseBlocks(
    fixture.counterevidence,
    fixture,
    plan,
    prepared,
    candidateByPath,
    evidenceByPath,
  );
  const requiredById = new Map(
    fixture.requiredBlocks.map((block) => [block.id, block]),
  );
  const supportedFactMissing = fixture.supportedFacts
    .filter((fact) =>
      fact.evidenceBlockIds.some((blockId) => {
        const block = requiredById.get(blockId);
        const evidence = block ? evidenceByPath.get(block.path) : undefined;
        return !block || !evidence?.excerpt.includes(block.text);
      }),
    )
    .map(({ id }) => id);

  const attribution = assessAttribution(fixture, plan);
  const selectedPaths = new Set(
    plan.selectedFiles.map(({ candidate }) => candidate.path),
  );
  const fetchedPaths = new Set(
    fixture.files
      .filter(({ candidate }) => fetchedTextById.has(candidate.id))
      .map(({ candidate }) => candidate.path),
  );
  const safeExclusionLeaks = fixture.safeExclusionPaths.filter(
    (path) =>
      selectedPaths.has(path) ||
      fetchedPaths.has(path) ||
      evidenceByPath.has(path),
  );
  const pins = assessPins(fixture, plan, prepared);
  const fetchedSources = [...fetchedTextById.values()];
  const sourceVolume = {
    evidenceFiles: prepared.evidence.length,
    fetchedFiles: prepared.fetchedFileCount,
    sourceBytes: fetchedSources.reduce(
      (total, text) => total + Buffer.byteLength(text, "utf8"),
      0,
    ),
    sourceCharacters: fetchedSources.reduce(
      (total, text) => total + text.length,
      0,
    ),
    excerptCharacters: prepared.totalCharacters,
    sourceLines: fetchedSources.reduce(
      (total, text) => total + text.split(/\r?\n/u).length,
      0,
    ),
    excerptLines: prepared.transmittedLineCount,
  };

  const selectorReasons = [
    ...new Set([
      ...plan.selectedFiles.flatMap(({ reasonCodes }) => reasonCodes),
      ...prepared.evidence.flatMap(({ reasonCodes }) => reasonCodes),
    ]),
  ].sort();
  const diagnostics = [
    ...fixture.requiredBlocks
      .filter((block) =>
        evidenceByPath.get(block.path)?.excerpt.includes(block.text),
      )
      .map(({ id, path }) => `required-block:${id}:${path}:retrieved`),
    ...required.missing.map(
      ({ blockId, path, reason }) =>
        `required-block:${blockId}:${path}:${reason}`,
    ),
    ...fixture.counterevidence
      .filter((block) =>
        evidenceByPath.get(block.path)?.excerpt.includes(block.text),
      )
      .map(({ id, path }) => `counterevidence:${id}:${path}:retrieved`),
    ...counterevidence.missing.map(
      ({ blockId, path, reason }) =>
        `counterevidence:${blockId}:${path}:${reason}`,
    ),
    ...supportedFactMissing.map(
      (id) => `unsupported-fact:${id}:required-evidence-missing`,
    ),
    ...fixture.supportedFacts
      .filter((fact) => !supportedFactMissing.includes(fact.id))
      .map(({ id }) => `supported-fact:${id}:all-labeled-blocks-retrieved`),
    ...attribution.reasons.map((reason) => `attribution:${reason}`),
    ...(attribution.safe ? ["attribution:gate-passed"] : []),
    ...safeExclusionLeaks.map((path) => `safety-leak:${path}`),
    ...(safeExclusionLeaks.length === 0 ? ["safe-exclusions:no-leaks"] : []),
    ...pins.unexplained.map((id) => `pin:${id}:not-included-or-explained`),
    ...(pins.unexplained.length === 0
      ? ["pins:included-or-explicitly-explained"]
      : []),
    ...plan.limitations.map(
      (limitation) => `selector-limitation:${limitation}`,
    ),
    ...prepared.limitations.map(
      (limitation) => `packing-limitation:${limitation}`,
    ),
    `source-volume:files=${sourceVolume.evidenceFiles}:sourceChars=${sourceVolume.sourceCharacters}:excerptChars=${sourceVolume.excerptCharacters}`,
  ];
  const passed =
    required.missing.length === 0 &&
    counterevidence.missing.length === 0 &&
    supportedFactMissing.length === 0 &&
    attribution.safe &&
    safeExclusionLeaks.length === 0 &&
    pins.unexplained.length === 0;

  return {
    fixtureId: fixture.id,
    cohort: fixture.cohort,
    passed,
    outcome: prepared.completeness,
    requiredBlocks: {
      total: fixture.requiredBlocks.length,
      retrieved: fixture.requiredBlocks.length - required.missing.length,
      missing: required.missing,
    },
    supportedFacts: {
      total: fixture.supportedFacts.length,
      supported: fixture.supportedFacts.length - supportedFactMissing.length,
      missing: supportedFactMissing,
    },
    counterevidence: {
      total: fixture.counterevidence.length,
      retrieved:
        fixture.counterevidence.length - counterevidence.missing.length,
      missing: counterevidence.missing,
    },
    attribution,
    safeExclusionLeaks,
    pins,
    sourceVolume,
    selectorReasons,
    diagnostics,
  };
}

function diagnoseBlocks(
  blocks: readonly LabeledEvidenceBlock[],
  fixture: RetrievalFixture,
  plan: SelectionPlan,
  prepared: PreparedEvidence,
  candidateByPath: Map<string, FileCandidate>,
  evidenceByPath: Map<string, PreparedEvidence["evidence"][number]>,
): { missing: MissingEvidenceDiagnostic[] } {
  const selectedPaths = new Set(
    plan.selectedFiles.map(({ candidate }) => candidate.path),
  );
  const excludedByPath = new Map(
    [...plan.excludedFiles, ...prepared.excludedFiles].map((exclusion) => [
      exclusion.path,
      exclusion.reasonCode,
    ]),
  );

  const missing = blocks.flatMap((block) => {
    const candidate = candidateByPath.get(block.path);
    const evidence = evidenceByPath.get(block.path);
    let reason: MissingEvidenceDiagnostic["reason"] | undefined;

    if (!candidate) reason = "candidate-not-in-inventory";
    else if (!selectedPaths.has(block.path)) {
      reason = excludedByPath.has(block.path)
        ? "selector-excluded"
        : "candidate-not-selected";
    } else if (!evidence) reason = "file-not-packed";
    else if (!evidence.excerpt.includes(block.text))
      reason = "block-not-in-excerpt";

    return reason ? [{ blockId: block.id, path: block.path, reason }] : [];
  });
  return { missing };
}

function assessAttribution(
  fixture: RetrievalFixture,
  plan: SelectionPlan,
): FixtureEvaluation["attribution"] {
  if (fixture.attribution === "needs-input") {
    const safe =
      plan.status !== "ready" && plan.missingDimensions.includes("attribution");
    return {
      expected: fixture.attribution,
      safe,
      reasons: safe
        ? ["missing-contribution-kept-in-needs-context"]
        : ["selector-did-not-preserve-unknown-attribution"],
    };
  }

  const statementPresent = Boolean(fixture.scope.contributionStatement?.trim());
  const userScopedPaths = new Set([
    ...(fixture.scope.selectedPaths ?? []),
    ...(fixture.scope.selectedPrPaths ?? []),
    ...fixture.prContext.selectedPullRequests.flatMap(
      ({ changedPaths }) => changedPaths,
    ),
    ...fixture.pinnedFileIds.flatMap((id) => {
      const file = fixture.files.find(({ candidate }) => candidate.id === id);
      return file ? [file.candidate.path] : [];
    }),
  ]);
  const factsHaveContributionScope = fixture.supportedFacts.every((fact) =>
    fact.evidenceBlockIds.some((blockId) => {
      const block = fixture.requiredBlocks.find(
        (entry) => entry.id === blockId,
      );
      return Boolean(block && userScopedPaths.has(block.path));
    }),
  );
  const safe =
    statementPresent &&
    factsHaveContributionScope &&
    !plan.missingDimensions.includes("attribution");
  const reasons = [
    ...(statementPresent ? [] : ["user-contribution-statement-missing"]),
    ...(factsHaveContributionScope ? [] : ["supported-fact-not-in-user-scope"]),
    ...(plan.missingDimensions.includes("attribution")
      ? ["selector-requires-attribution-input"]
      : []),
  ];
  return { expected: fixture.attribution, safe, reasons };
}

function assessPins(
  fixture: RetrievalFixture,
  plan: SelectionPlan,
  prepared: PreparedEvidence,
): FixtureEvaluation["pins"] {
  const evidencePaths = new Set(prepared.evidence.map(({ path }) => path));
  const explicitlyConflicted = new Set(
    [...plan.pinConflicts, ...prepared.pinConflicts].map(
      ({ fileId }) => fileId,
    ),
  );
  const unexplained = fixture.pinnedFileIds.filter((fileId) => {
    const path = fixture.files.find(({ candidate }) => candidate.id === fileId)
      ?.candidate.path;
    return (
      !path || (!evidencePaths.has(path) && !explicitlyConflicted.has(fileId))
    );
  });
  const resolved = fixture.pinnedFileIds.length - unexplained.length;
  return { requested: fixture.pinnedFileIds.length, resolved, unexplained };
}

function failedBeforePacking(
  fixture: RetrievalFixture,
  error: DomainError,
): FixtureEvaluation {
  return failedEvaluation(fixture, error, `selector-input:${error.code}`);
}

function failedDuringPacking(
  fixture: RetrievalFixture,
  _plan: SelectionPlan,
  error: DomainError,
): FixtureEvaluation {
  return failedEvaluation(fixture, error, `selector-pack:${error.code}`);
}

function failedEvaluation(
  fixture: RetrievalFixture,
  error: DomainError,
  reason: string,
): FixtureEvaluation {
  return {
    fixtureId: fixture.id,
    cohort: fixture.cohort,
    passed: false,
    outcome: "needs-context",
    requiredBlocks: {
      total: fixture.requiredBlocks.length,
      retrieved: 0,
      missing: fixture.requiredBlocks.map(({ id, path }) => ({
        blockId: id,
        path,
        reason: "file-not-packed",
      })),
    },
    supportedFacts: {
      total: fixture.supportedFacts.length,
      supported: 0,
      missing: fixture.supportedFacts.map(({ id }) => id),
    },
    counterevidence: {
      total: fixture.counterevidence.length,
      retrieved: 0,
      missing: fixture.counterevidence.map(({ id, path }) => ({
        blockId: id,
        path,
        reason: "file-not-packed",
      })),
    },
    attribution: {
      expected: fixture.attribution,
      safe: false,
      reasons: ["selector-operation-failed"],
    },
    safeExclusionLeaks: [],
    pins: {
      requested: fixture.pinnedFileIds.length,
      resolved: 0,
      unexplained: fixture.pinnedFileIds,
    },
    sourceVolume: {
      evidenceFiles: 0,
      fetchedFiles: 0,
      sourceBytes: 0,
      sourceCharacters: 0,
      excerptCharacters: 0,
      sourceLines: 0,
      excerptLines: 0,
    },
    selectorReasons: [],
    diagnostics: [reason, `domain-error:${error.code}`],
  };
}
