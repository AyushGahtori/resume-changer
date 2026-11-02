import { describe, expect, it } from "vitest";
import {
  createSelectionPolicy,
  DEFAULT_SELECTION_WEIGHTS,
} from "@/lib/github/server/selection-policy";
import type {
  FileCandidate as ContractFileCandidate,
  PullRequestSummary,
  RepositoryScope as ContractRepositoryScope,
} from "@/lib/github/contracts";
import {
  HELD_OUT_FIXTURE_IDS,
  RETRIEVAL_FIXTURES,
  TUNING_FIXTURE_IDS,
} from "./fixtures";
import {
  buildRetrievalQualityReport,
  evaluateRetrievalFixture,
  formatRetrievalQualityReport,
} from "./evaluator";

const revision = "b".repeat(40);

function policyScope(
  overrides: Partial<ContractRepositoryScope> = {},
): ContractRepositoryScope {
  return {
    repositoryId: "42",
    owner: "northstar-labs",
    name: "resume-changer",
    canonicalUrl: "https://github.com/northstar-labs/resume-changer",
    visibility: "public",
    ref: "main",
    commitSha: revision,
    selectedPullRequestNumbers: [],
    selectedPaths: [],
    contributionStatement: "I implemented the cache invalidation helper.",
    identitySource: "user-provided",
    ...overrides,
  };
}

function policyCandidate(
  overrides: Partial<ContractFileCandidate> = {},
): ContractFileCandidate {
  return {
    id: "cache-helper",
    path: "src/cache/invalidation.ts",
    blobSha: revision,
    mode: "100644",
    byteSize: 120,
    category: "implementation",
    reasonCodes: ["contribution", "core-method"],
    safety: "safe",
    eligible: true,
    selected: false,
    pinned: false,
    ...overrides,
  };
}

function pullRequest(
  overrides: Partial<PullRequestSummary> = {},
): PullRequestSummary {
  return {
    number: 14,
    title: "feat: cache invalidation",
    state: "merged",
    authorLogin: "contributor",
    updatedAt: "2026-10-20T12:00:00.000Z",
    changedPaths: ["src/cache/invalidation.ts"],
    headSha: revision,
    baseSha: "c".repeat(40),
    selected: true,
    ...overrides,
  };
}

describe("Task 15 contribution-first retrieval evaluation", () => {
  it("keeps a labeled held-out cohort separate from tuning fixtures", () => {
    expect(TUNING_FIXTURE_IDS.length).toBeGreaterThanOrEqual(4);
    expect(HELD_OUT_FIXTURE_IDS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(TUNING_FIXTURE_IDS).size).toBe(TUNING_FIXTURE_IDS.length);
    expect(new Set(HELD_OUT_FIXTURE_IDS).size).toBe(
      HELD_OUT_FIXTURE_IDS.length,
    );
    expect(
      TUNING_FIXTURE_IDS.filter((id) => HELD_OUT_FIXTURE_IDS.includes(id)),
    ).toEqual([]);
    expect(RETRIEVAL_FIXTURES.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "solo-webhook-signing",
        "team-fork-unknown-attribution",
        "docs-poor-pr-free-cli",
        "misleading-dashboard-title",
        "hybrid-ml-evaluation-ui",
        "delegated-cache-guard",
        "contradictory-membership-test",
        "manual-report-denominator-pin",
      ]),
    );
  });

  it.each(RETRIEVAL_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    "retrieves labeled facts and counterevidence for %s",
    async (_id, fixture) => {
      const result = await evaluateRetrievalFixture(fixture);

      expect(result.passed, result.diagnostics.join("\n")).toBe(true);
      expect(result.requiredBlocks.retrieved).toBe(result.requiredBlocks.total);
      expect(result.counterevidence.retrieved).toBe(
        result.counterevidence.total,
      );
      expect(result.supportedFacts.supported).toBe(result.supportedFacts.total);
      expect(result.safeExclusionLeaks).toEqual([]);
      expect(result.pins.unexplained).toEqual([]);
      expect(result.selectorReasons.length).toBeGreaterThan(0);
      expect(result.diagnostics).toContain("safe-exclusions:no-leaks");
      expect(result.diagnostics).toContain("attribution:gate-passed");

      if (fixture.attribution === "needs-input") {
        expect(result.attribution.reasons).toContain(
          "missing-contribution-kept-in-needs-context",
        );
        expect(result.diagnostics).toContain(
          "selector-limitation:Personal contribution has not been described by the user.",
        );
      }
    },
  );

  it("keeps missing-attribution team work in a clarification state", async () => {
    const fixture = RETRIEVAL_FIXTURES.find(
      ({ id }) => id === "team-fork-unknown-attribution",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const result = await evaluateRetrievalFixture(fixture);
    expect(result.attribution.safe).toBe(true);
    expect(result.attribution.expected).toBe("needs-input");
    expect(result.outcome).toBe("needs-context");
  });

  it("keeps a docs-only dashboard title below its exact changed path", async () => {
    const fixture = RETRIEVAL_FIXTURES.find(
      ({ id }) => id === "misleading-dashboard-title",
    );
    expect(fixture).toBeDefined();
    if (!fixture) return;

    const result = await evaluateRetrievalFixture(fixture);
    expect(result.passed, result.diagnostics.join("\n")).toBe(true);
    expect(result.selectorReasons).toContain("selected-contribution-path");
    expect(
      result.diagnostics.some((reason) => reason.includes("DashboardView")),
    ).toBe(false);
    expect(
      result.diagnostics.some((reason) =>
        reason.includes("dashboard-api-docs"),
      ),
    ).toBe(true);
  });

  it("uses same labels to measure source and packed excerpt volume without treating size as quality", async () => {
    const results = await Promise.all(
      RETRIEVAL_FIXTURES.map(evaluateRetrievalFixture),
    );
    const byCohort = {
      tuning: results.filter(({ cohort }) => cohort === "tuning"),
      holdout: results.filter(({ cohort }) => cohort === "holdout"),
    };

    for (const cohort of [byCohort.tuning, byCohort.holdout]) {
      expect(cohort.length).toBeGreaterThan(0);
      expect(cohort.every(({ passed }) => passed)).toBe(true);
      expect(
        cohort.every(
          ({ sourceVolume }) =>
            sourceVolume.excerptCharacters <= sourceVolume.sourceCharacters,
        ),
      ).toBe(true);
      expect(
        cohort.every(
          ({ sourceVolume }) =>
            sourceVolume.excerptLines <= sourceVolume.sourceLines,
        ),
      ).toBe(true);
    }

    expect(
      results.every(({ diagnostics }) =>
        diagnostics.some((reason) => reason.startsWith("source-volume:")),
      ),
    ).toBe(true);
    expect(JSON.stringify(results)).not.toContain(
      "synthetic-never-return-this",
    );
    expect(results.every((result) => !("confidence" in result))).toBe(true);
  });

  it("produces a deterministic cohort report after all quality gates pass", async () => {
    const evaluations = await Promise.all(
      RETRIEVAL_FIXTURES.map(evaluateRetrievalFixture),
    );
    const report = buildRetrievalQualityReport(evaluations);
    const formatted = formatRetrievalQualityReport(report);

    expect(report.selector).toBe("task-06-createEvidenceSelector");
    expect(report.integrationFindings).toEqual([
      expect.stringContaining("uses SelectionPolicyPort scoring"),
      expect.stringContaining("No compact-excerpt variant is compared"),
    ]);
    expect(report.fixtureCount).toBe(RETRIEVAL_FIXTURES.length);
    expect(report.passedFixtures).toBe(report.fixtureCount);
    expect(report.failedFixtureIds).toEqual([]);
    expect(report.cohorts.tuning.fixtureCount).toBe(TUNING_FIXTURE_IDS.length);
    expect(report.cohorts.holdout.fixtureCount).toBe(
      HELD_OUT_FIXTURE_IDS.length,
    );
    expect(report.cohorts.holdout.passedFixtures).toBe(
      report.cohorts.holdout.fixtureCount,
    );
    expect(report.cohorts.holdout.retrievedRequiredBlocks).toBe(
      report.cohorts.holdout.requiredBlocks,
    );
    expect(report.cohorts.holdout.safeExclusionLeaks).toBe(0);
    expect(report.gates.requiredEvidence).toBe("all-labeled-blocks-required");
    expect(formatted.endsWith("\n")).toBe(true);
    expect(formatted).toBe(formatRetrievalQualityReport(report));
    expect(formatted).not.toContain("confidence");
  });
});

describe("frozen selection-policy port", () => {
  it("ranks selected paths and explicitly selected PR paths above title-only hints", () => {
    const policy = createSelectionPolicy({});
    const scope = policyScope({
      selectedPaths: ["src/cache/invalidation.ts"],
      selectedPullRequestNumbers: [14],
    });
    const changedPath = policy.scoreCandidate({
      candidate: policyCandidate(),
      scope,
      pullRequests: [pullRequest()],
    });
    const titleOnly = policy.scoreCandidate({
      candidate: policyCandidate({
        id: "dashboard",
        path: "src/dashboard/view.tsx",
        category: "implementation",
      }),
      scope: policyScope({
        contributionStatement: "I worked on a dashboard integration.",
      }),
      pullRequests: [
        pullRequest({
          title: "feat: dashboard integration",
          changedPaths: ["docs/dashboard.md"],
        }),
      ],
    });

    expect(changedPath.ok && titleOnly.ok).toBe(true);
    if (!changedPath.ok || !titleOnly.ok) return;
    expect(changedPath.value).toBeGreaterThan(titleOnly.value);
    expect(changedPath.value).toBe(
      DEFAULT_SELECTION_WEIGHTS["category.implementation"] +
        DEFAULT_SELECTION_WEIGHTS["reason.contribution"] +
        DEFAULT_SELECTION_WEIGHTS["reason.core-method"] +
        DEFAULT_SELECTION_WEIGHTS["scope.selected-path"] +
        DEFAULT_SELECTION_WEIGHTS["scope.contribution-path-term"] +
        DEFAULT_SELECTION_WEIGHTS["pr.changed-path"],
    );
  });

  it("ignores unselected PRs and suppresses title hints that conflict with changed paths", () => {
    const policy = createSelectionPolicy({});
    const candidate = policyCandidate({
      id: "dashboard",
      path: "src/dashboard/view.tsx",
      category: "implementation",
    });
    const scope = policyScope({
      contributionStatement: "I worked on a dashboard integration.",
    });
    const noPrScore = policy.scoreCandidate({
      candidate,
      scope,
      pullRequests: [],
    });
    const unselectedPrScore = policy.scoreCandidate({
      candidate,
      scope,
      pullRequests: [pullRequest({ selected: false })],
    });
    const docsOnlyScore = policy.scoreCandidate({
      candidate,
      scope,
      pullRequests: [
        pullRequest({
          title: "feat: dashboard analytics experience",
          changedPaths: ["docs/dashboard.md"],
        }),
      ],
    });

    expect(noPrScore).toEqual(unselectedPrScore);
    expect(docsOnlyScore).toEqual(noPrScore);
  });

  it("validates configs and refuses to rank unsafe or ineligible candidates", () => {
    const unsafePolicy = createSelectionPolicy({
      weights: { "candidate.pinned": 1_000 },
    });
    const unsafe = unsafePolicy.scoreCandidate({
      candidate: policyCandidate({
        safety: "blocked",
        eligible: false,
        pinned: false,
      }),
      scope: policyScope(),
      pullRequests: [],
    });
    const invalidConfig = createSelectionPolicy({
      weights: { "category.implementation": Number.POSITIVE_INFINITY },
    }).scoreCandidate({
      candidate: policyCandidate(),
      scope: policyScope(),
      pullRequests: [],
    });

    expect(unsafe).toMatchObject({
      ok: false,
      error: { code: "invalid-evidence" },
    });
    expect(invalidConfig).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
  });

  it("keeps attribution and corroboration required while adding configured context dimensions", () => {
    const policy = createSelectionPolicy({
      coverageRules: {
        all: ["measurement-context"],
        "selected-prs": ["corroboration", "measurement-context"],
        "unknown-identity": ["attribution"],
      },
    });
    const result = policy.requiredDimensions({
      scope: policyScope({
        identitySource: "unknown",
        selectedPullRequestNumbers: [14],
      }),
    });

    expect(result).toEqual({
      ok: true,
      value: [
        "purpose",
        "method",
        "attribution",
        "corroboration",
        "measurement-context",
      ],
    });
  });
});
