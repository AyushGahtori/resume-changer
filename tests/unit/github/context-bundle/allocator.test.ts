import { describe, expect, it } from "vitest";
import {
  allocateEvidenceBundle,
  createBaselineBundleBudget,
  createBaselineSelectionAdapterInput,
  type RankedCandidate,
} from "../../../../src/lib/github/context-bundle";
import {
  COMMIT_SHA,
  FULL_STACK_FEATURES,
  REPOSITORY_ID,
  docsHeavyRepository,
  fullStackResumeApp,
  impossiblePinnedBundle,
  makeCandidate,
  makeInput,
  monorepo,
  noTestRepository,
  reproducedBaselineAnalogue,
  testHeavyRepository,
  testingContribution,
} from "../../../fixtures/github/context-bundle/cases";

describe("coverage-aware evidence bundle allocation", () => {
  it("covers full-stack features with explicit roles and marginal gain", () => {
    const bundle = allocateEvidenceBundle(fullStackResumeApp());
    const selectedIds = new Set(bundle.selectedCandidateIds);

    expect(bundle.coverage.map((feature) => feature.featureId)).toEqual([
      "ai-tailoring",
      "draft-storage",
      "pdf-export",
      "resume-engine",
    ]);
    expect(
      bundle.coverage.filter((feature) => feature.implementationCovered).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      bundle.selectedSections.some((section) => section.role === "overview"),
    ).toBe(true);
    expect(
      bundle.selectedSections.some(
        (section) => section.role === "implementation",
      ),
    ).toBe(true);
    expect(
      bundle.selectedSections.some(
        (section) => section.role === "verification",
      ),
    ).toBe(true);
    expect(
      ["resume-route", "second-resume-route"].filter((id) =>
        selectedIds.has(id),
      ).length,
    ).toBeLessThanOrEqual(1);
    expect(bundle.claimEvidenceFeatureIds).toEqual(["resume-engine"]);
    expect(bundle.consentHash).toBeNull();
  });

  it("selects across monorepo package boundaries and keeps stable output under shuffling", () => {
    const input = monorepo();
    const first = allocateEvidenceBundle(input);
    const shuffled = allocateEvidenceBundle({
      ...input,
      candidates: [...input.candidates].reverse(),
    });

    expect(first.selectionIdentity).toBe(shuffled.selectionIdentity);
    expect(first.selectedCandidateIds).toEqual(shuffled.selectedCandidateIds);
    expect(
      first.selectedSections.map((section) => section.section.source.path),
    ).toContain("packages/domain/src/resume.ts");
    expect(first.budget.usedTokens).toBeLessThanOrEqual(first.budget.maxTokens);
  });

  it("does not let repeated docs or overlapping sections spend the same evidence budget twice", () => {
    const docs = allocateEvidenceBundle(docsHeavyRepository());
    const repeatedReadmeIds = docs.selectedCandidateIds.filter((id) =>
      ["package-a-readme", "package-b-readme"].includes(id),
    );
    expect(repeatedReadmeIds).toHaveLength(1);
    expect(
      docs.omittedCandidates.some(
        (item) => item.reason === "duplicate-or-overlapping",
      ),
    ).toBe(true);

    const overlapping = makeInput({
      maxTokens: 500,
      candidates: [
        makeCandidate({
          id: "broad-section",
          path: "src/core.ts",
          role: "implementation",
          featureIds: ["resume-engine"],
          text: Array.from(
            { length: 26 },
            (_, index) => `line ${index + 1}`,
          ).join("\n"),
          startLine: 10,
          endLine: 35,
          tokenCost: 200,
          rankScore: 80,
        }),
        makeCandidate({
          id: "nested-section",
          path: "src/core.ts",
          role: "implementation",
          featureIds: ["pdf-export"],
          text: Array.from(
            { length: 5 },
            (_, index) => `nested ${index + 1}`,
          ).join("\n"),
          startLine: 18,
          endLine: 22,
          tokenCost: 60,
          rankScore: 100,
        }),
      ],
    });
    const overlapBundle = allocateEvidenceBundle(overlapping);
    expect(overlapBundle.selectedSections).toHaveLength(1);
    expect(overlapBundle.omittedCandidates[0]?.reason).toBe(
      "duplicate-or-overlapping",
    );
  });

  it("keeps tests subordinate to implementations in a test-heavy repository", () => {
    const bundle = allocateEvidenceBundle(testHeavyRepository());
    const implementationTokens = bundle.roleAllocations.find(
      (item) => item.role === "implementation",
    )?.usedTokens;
    const testCount = bundle.selectedSections.filter(
      (item) => item.isTestEvidence,
    ).length;

    expect(implementationTokens).toBeGreaterThan(0);
    expect(
      bundle.coverage
        .filter((feature) =>
          ["resume-engine", "pdf-export"].includes(feature.featureId),
        )
        .every((feature) => feature.implementationCovered),
    ).toBe(true);
    expect(testCount).toBeLessThanOrEqual(2);
    expect(bundle.testAllocation.targetTokens).toBe(200);
    expect(bundle.budget.usedTokens).toBeLessThanOrEqual(1_600);
  });

  it("uses borrowed general-purpose tokens for an implementation section before over-target tests", () => {
    const bundle = allocateEvidenceBundle(
      makeInput({
        maxTokens: 1_000,
        candidates: [
          makeCandidate({
            id: "readme",
            path: "README.md",
            role: "overview",
            tokenCost: 100,
            rankScore: 80,
          }),
          makeCandidate({
            id: "large-core",
            path: "src/resume/core.ts",
            role: "implementation",
            featureIds: ["resume-engine"],
            tokenCost: 800,
            rankScore: 90,
          }),
          makeCandidate({
            id: "large-test",
            path: "tests/pdf/export.test.ts",
            role: "verification",
            featureIds: ["pdf-export"],
            tokenCost: 200,
            rankScore: 100,
            isTestEvidence: true,
          }),
        ],
      }),
    );

    expect(bundle.selectedCandidateIds).toContain("large-core");
    expect(bundle.selectedCandidateIds).not.toContain("large-test");
    expect(
      bundle.roleAllocations.find((item) => item.role === "implementation")
        ?.borrowedTokens,
    ).toBeGreaterThan(0);
    expect(bundle.budget.usedTokens).toBe(900);
  });

  it("borrows unused overview and verification targets when a repository has no tests", () => {
    const bundle = allocateEvidenceBundle(noTestRepository());
    const implementation = bundle.roleAllocations.find(
      (item) => item.role === "implementation",
    );

    expect(
      bundle.selectedSections.some(
        (section) => section.role === "verification",
      ),
    ).toBe(false);
    expect(
      bundle.coverage.find((feature) => feature.featureId === "pdf-export")
        ?.implementationCovered,
    ).toBe(true);
    expect(implementation?.borrowedTokens).toBeGreaterThan(0);
    expect(bundle.budget.usedTokens).toBeLessThanOrEqual(
      bundle.budget.maxTokens,
    );
  });

  it("allows a confirmed testing contribution to use the verification budget without a soft test-share target", () => {
    const explicit = allocateEvidenceBundle(testingContribution());
    const generalInput = testingContribution();
    const general = allocateEvidenceBundle({
      ...generalInput,
      context: { ...generalInput.context, testingContributionConfirmed: false },
    });

    expect(explicit.testAllocation.mode).toBe("explicit-testing-contribution");
    expect(explicit.testAllocation.targetTokens).toBeNull();
    expect(explicit.testAllocation.usedTokens).toBeGreaterThan(0);
    expect(general.testAllocation.mode).toBe("soft-overview");
    expect(general.testAllocation.targetTokens).toBe(200);
  });

  it("reports impossible pins while retaining only evidence that fits every hard cap", () => {
    const bundle = allocateEvidenceBundle(impossiblePinnedBundle());

    expect(bundle.selectedCandidateIds).toContain("pinned-core");
    expect(bundle.selectedCandidateIds).not.toContain("pinned-pdf");
    expect(bundle.unfulfilledPinnedCandidateIds).toEqual([
      "pinned-missing",
      "pinned-pdf",
    ]);
    expect(bundle.budget.usedTokens).toBeLessThanOrEqual(120);
    expect(bundle.budget.usedFiles).toBeLessThanOrEqual(2);
    expect(
      bundle.omittedCandidates.find((item) => item.candidateId === "pinned-pdf")
        ?.wasPinned,
    ).toBe(true);
    expect(bundle.missingCriticalFeatureIds).toContain("pdf-export");
  });

  it("preserves exact pinned provenance and charges identical content only once", () => {
    const sharedText = "A shared implementation excerpt.\n";
    const first = makeCandidate({
      id: "pin-a",
      path: "src/a.ts",
      role: "implementation",
      featureIds: ["resume-engine"],
      text: sharedText,
      tokenCost: 90,
      pinned: true,
    });
    const second = makeCandidate({
      id: "pin-b",
      path: "src/b.ts",
      role: "implementation",
      featureIds: ["pdf-export"],
      text: sharedText,
      tokenCost: 90,
      pinned: true,
    });
    const bundle = allocateEvidenceBundle(
      makeInput({
        candidates: [first, second],
        maxTokens: 100,
        maxFiles: 2,
      }),
    );

    expect(bundle.selectedCandidateIds).toEqual(["pin-a", "pin-b"]);
    expect(bundle.selectedSections).toHaveLength(1);
    expect(bundle.selectedSections[0]?.pinnedAliases[0]?.source.path).toBe(
      "src/b.ts",
    );
    expect(bundle.budget.usedTokens).toBe(90);
    expect(bundle.selectedFileIdentities.map((file) => file.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("changes the deterministic review identity when a user adjusts the selected evidence", () => {
    const input = makeInput({
      maxTokens: 400,
      candidates: [
        makeCandidate({
          id: "resume-core",
          path: "src/resume.ts",
          role: "implementation",
          featureIds: ["resume-engine"],
          tokenCost: 100,
          rankScore: 80,
        }),
        makeCandidate({
          id: "pdf-core",
          path: "src/pdf.ts",
          role: "implementation",
          featureIds: ["pdf-export"],
          tokenCost: 100,
          rankScore: 90,
        }),
      ],
    });
    const initial = allocateEvidenceBundle(input);
    const adjusted = allocateEvidenceBundle({
      ...input,
      adjustments: {
        pinnedCandidateIds: ["resume-core"],
        excludedCandidateIds: [],
      },
    });

    expect(adjusted.selectionIdentity).not.toBe(initial.selectionIdentity);
    expect(adjusted.pinnedCandidateIds).toEqual(["resume-core"]);
    expect(adjusted.consentHash).toBeNull();
  });

  it("reports role-specific coverage and never treats tests or overview as implementation", () => {
    const bundle = allocateEvidenceBundle(
      makeInput({
        maxTokens: 400,
        candidates: [
          makeCandidate({
            id: "readme",
            path: "README.md",
            role: "overview",
            featureIds: ["resume-engine"],
            tokenCost: 60,
            rankScore: 100,
          }),
          makeCandidate({
            id: "only-test",
            path: "tests/resume.test.ts",
            role: "verification",
            featureIds: ["resume-engine"],
            tokenCost: 60,
            rankScore: 100,
            isTestEvidence: true,
          }),
        ],
      }),
    );

    const resumeCoverage = bundle.coverage.find(
      (feature) => feature.featureId === "resume-engine",
    );
    expect(resumeCoverage?.overviewEvidenceIds.length).toBeGreaterThan(0);
    expect(resumeCoverage?.verificationEvidenceIds.length).toBeGreaterThan(0);
    expect(resumeCoverage?.implementationCovered).toBe(false);
    expect(bundle.missingCriticalFeatureIds).toContain("resume-engine");
    expect(bundle.implementationCoverage).toMatchObject({
      numerator: 0,
      denominator: FULL_STACK_FEATURES.length,
      denominatorLabel: "expected implementation features",
    });
  });

  it("does not let a selected application wrapper satisfy implementation coverage", () => {
    const bundle = allocateEvidenceBundle(
      makeInput({
        maxTokens: 400,
        candidates: [
          makeCandidate({
            id: "thin-route",
            path: "src/app/resume/page.tsx",
            role: "implementation",
            featureIds: ["resume-engine"],
            tokenCost: 80,
            rankScore: 100,
            isWrapper: true,
          }),
        ],
      }),
    );

    expect(bundle.selectedCandidateIds).toContain("thin-route");
    expect(
      bundle.coverage.find((feature) => feature.featureId === "resume-engine")
        ?.implementationCovered,
    ).toBe(false);
    expect(bundle.missingCriticalFeatureIds).toContain("resume-engine");
    expect(bundle.implementationCoverage.numerator).toBe(0);
  });

  it("prioritizes confirmed contribution areas without broadening them in whole-project mode", () => {
    const scoped = allocateEvidenceBundle(
      makeInput({
        maxTokens: 100,
        maxFiles: 1,
        context: {
          mode: "contribution-focused",
          confirmedContributionFeatureIds: ["resume-engine"],
        },
        candidates: [
          makeCandidate({
            id: "owned-engine",
            path: "src/resume.ts",
            role: "implementation",
            featureIds: ["resume-engine"],
            tokenCost: 100,
            rankScore: 80,
          }),
          makeCandidate({
            id: "other-critical",
            path: "src/pdf.ts",
            role: "implementation",
            featureIds: ["pdf-export"],
            tokenCost: 100,
            rankScore: 100,
          }),
        ],
      }),
    );

    expect(scoped.selectedCandidateIds).toEqual(["owned-engine"]);
    expect(scoped.claimEvidenceFeatureIds).toEqual(["resume-engine"]);
    expect(scoped.contextMode).toBe("contribution-focused");
  });

  it("keeps all line, character, file, section, and token admissions within caller limits", () => {
    const candidates = [
      makeCandidate({
        id: "long-a",
        path: "src/a.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        text: [
          "x".repeat(25),
          "x".repeat(25),
          "x".repeat(25),
          "x".repeat(23),
        ].join("\n"),
        startLine: 1,
        endLine: 4,
        tokenCost: 50,
      }),
      makeCandidate({
        id: "long-b",
        path: "src/b.ts",
        role: "implementation",
        featureIds: ["pdf-export"],
        text: [
          "y".repeat(25),
          "y".repeat(25),
          "y".repeat(25),
          "y".repeat(23),
        ].join("\n"),
        startLine: 1,
        endLine: 4,
        tokenCost: 50,
      }),
      makeCandidate({
        id: "long-c",
        path: "src/c.ts",
        role: "implementation",
        featureIds: ["ai-tailoring"],
        text: [
          "z".repeat(25),
          "z".repeat(25),
          "z".repeat(25),
          "z".repeat(23),
        ].join("\n"),
        startLine: 1,
        endLine: 4,
        tokenCost: 50,
      }),
    ];
    const bundle = allocateEvidenceBundle(
      makeInput({
        candidates,
        maxTokens: 150,
        maxFiles: 20,
        maxSections: 3,
        maxLinesPerFile: 3,
        maxTotalLines: 7,
        maxCharsPerFile: 100,
        maxTotalChars: 250,
      }),
    );

    expect(bundle.budget.maxFiles).toBe(12);
    expect(bundle.budget.usedTokens).toBeLessThanOrEqual(150);
    expect(bundle.budget.usedFiles).toBeLessThanOrEqual(12);
    expect(bundle.budget.usedTotalLines).toBeLessThanOrEqual(7);
    expect(bundle.budget.usedTotalChars).toBeLessThanOrEqual(250);
    expect(
      bundle.omittedCandidates.some((item) => item.reason === "source-budget"),
    ).toBe(true);
    expect(bundle.limitations.some((item) => item.includes("clamped"))).toBe(
      true,
    );
  });

  it("compares a fixed-rank baseline with a balanced bundle at the same token budget", () => {
    const fixture = reproducedBaselineAnalogue();
    const balanced = allocateEvidenceBundle(
      makeInput({
        candidates: fixture.candidates,
        features: fixture.expectedFeatures,
        maxTokens: fixture.tokenBudget,
      }),
    );
    const fixedTopN = [...fixture.candidates]
      .sort(
        (left, right) =>
          right.rankScore - left.rankScore ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .reduce<RankedCandidate[]>((selected, candidate) => {
        const usedTokens = selected.reduce(
          (sum, item) => sum + item.tokenCost,
          0,
        );
        if (
          selected.length < 12 &&
          usedTokens + candidate.tokenCost <= fixture.tokenBudget
        ) {
          selected.push(candidate);
        }
        return selected;
      }, []);
    const fixedImplementationCoverage = new Set(
      fixedTopN
        .filter((candidate) => candidate.role === "implementation")
        .flatMap((candidate) => candidate.featureIds),
    ).size;

    expect(fixture.baseline).toEqual({ files: 12, lines: 651, testLines: 434 });
    expect(balanced.budget.usedTokens).toBeLessThanOrEqual(fixture.tokenBudget);
    expect(balanced.budget.usedTokens).toBe(
      fixedTopN.reduce((sum, item) => sum + item.tokenCost, 0),
    );
    expect(balanced.implementationCoverage.numerator).toBeGreaterThan(
      fixedImplementationCoverage,
    );
    expect(balanced.implementationCoverage.numerator).toBe(4);
  });

  it("compares smaller and wider file/read allocations under the same token cap", () => {
    const candidates = [
      makeCandidate({
        id: "overview",
        path: "README.md",
        role: "overview",
        tokenCost: 100,
        text: "overview",
      }),
      makeCandidate({
        id: "resume-core",
        path: "src/resume.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 200,
        text: "resume line one\nresume line two",
        startLine: 1,
        endLine: 2,
      }),
      makeCandidate({
        id: "pdf-core",
        path: "src/pdf.ts",
        role: "implementation",
        featureIds: ["pdf-export"],
        tokenCost: 200,
        text: "pdf line one\npdf line two",
        startLine: 1,
        endLine: 2,
      }),
      makeCandidate({
        id: "ai-core",
        path: "src/ai.ts",
        role: "implementation",
        featureIds: ["ai-tailoring"],
        tokenCost: 200,
        text: "ai line one\nai line two",
        startLine: 1,
        endLine: 2,
      }),
      makeCandidate({
        id: "resume-test",
        path: "tests/resume.test.ts",
        role: "verification",
        featureIds: ["resume-engine"],
        tokenCost: 100,
        text: "resume test",
        isTestEvidence: true,
      }),
    ];
    const narrow = allocateEvidenceBundle(
      makeInput({
        candidates,
        maxTokens: 1_000,
        maxFiles: 2,
        maxLinesPerFile: 2,
        maxTotalLines: 3,
      }),
    );
    const wide = allocateEvidenceBundle(
      makeInput({
        candidates,
        maxTokens: 1_000,
        maxFiles: 5,
        maxLinesPerFile: 2,
        maxTotalLines: 8,
      }),
    );

    expect(narrow.budget.maxTokens).toBe(wide.budget.maxTokens);
    expect(narrow.implementationCoverage.numerator).toBe(1);
    expect(wide.implementationCoverage.numerator).toBe(3);
    expect(narrow.budget.usedTotalLines).toBeLessThanOrEqual(3);
    expect(wide.budget.usedTotalLines).toBeLessThanOrEqual(8);
  });

  it("clamps live adapter limits and binds the adapter to current repository caps", () => {
    const budget = createBaselineBundleBudget({
      filesPerRequest: 20,
      inputTokensPerImport: 40_000,
      linesPerFilePerRequest: 300,
      linesPerRequest: 2_000,
      selectedCharactersPerFile: 20_000,
      selectedCharactersTotal: 100_000,
      sectionsPerPreparedSelection: 400,
    });
    const adapted = createBaselineSelectionAdapterInput({
      repositoryId: REPOSITORY_ID,
      commitSha: COMMIT_SHA,
      candidates: [],
      features: FULL_STACK_FEATURES,
      context: {
        mode: "whole-project",
        confirmedContributionFeatureIds: [],
        testingContributionConfirmed: false,
      },
      caps: {
        filesPerRequest: 12,
        inputTokensPerImport: 36_000,
        linesPerFilePerRequest: 200,
        linesPerRequest: 1_500,
        selectedCharactersPerFile: 12_000,
        selectedCharactersTotal: 80_000,
      },
    });
    const reserved = createBaselineBundleBudget({
      filesPerRequest: 12,
      inputTokensPerImport: 36_000,
      linesPerFilePerRequest: 200,
      linesPerRequest: 1_500,
      selectedCharactersPerFile: 12_000,
      selectedCharactersTotal: 80_000,
      reservedInputTokens: 1_200,
    });

    expect(budget).toMatchObject({
      maxFiles: 12,
      maxTokens: 36_000,
      maxLinesPerFile: 200,
      maxTotalLines: 1_500,
      maxCharsPerFile: 12_000,
      maxTotalChars: 80_000,
    });
    expect(adapted.budget.maxFiles).toBe(12);
    expect(adapted.budget.maxSections).toBe(300);
    expect(reserved.maxTokens).toBe(34_800);
  });

  it("rejects mixed revisions, unknown feature IDs, unsafe paths, and excerpt hash mismatches", () => {
    const base = makeInput({
      candidates: [
        makeCandidate({
          id: "core",
          path: "src/core.ts",
          role: "implementation",
          featureIds: ["resume-engine"],
        }),
      ],
    });
    expect(() =>
      allocateEvidenceBundle({
        ...base,
        candidates: [
          {
            ...base.candidates[0]!,
            section: {
              ...base.candidates[0]!.section,
              source: {
                ...base.candidates[0]!.section.source,
                path: "../secret.ts",
              },
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      allocateEvidenceBundle({
        ...base,
        candidates: [
          {
            ...base.candidates[0]!,
            section: {
              ...base.candidates[0]!.section,
              source: {
                ...base.candidates[0]!.section.source,
                commitSha: "b".repeat(40),
              },
            },
          },
        ],
      }),
    ).toThrow(/requested repository commit/u);
    expect(() =>
      allocateEvidenceBundle({
        ...base,
        candidates: [
          {
            ...base.candidates[0]!,
            section: {
              ...base.candidates[0]!.section,
              source: {
                ...base.candidates[0]!.section.source,
                excerptSha256: "0".repeat(64),
              },
            },
          },
        ],
      }),
    ).toThrow(/Excerpt hash mismatch/u);
    expect(() =>
      allocateEvidenceBundle({
        ...base,
        candidates: [
          {
            ...base.candidates[0]!,
            section: {
              ...base.candidates[0]!.section,
              source: { ...base.candidates[0]!.section.source, endLine: 2 },
            },
          },
        ],
      }),
    ).toThrow(/Excerpt line count must match/u);
    expect(() =>
      allocateEvidenceBundle({
        ...base,
        candidates: [{ ...base.candidates[0]!, featureIds: ["unknown-area"] }],
      }),
    ).toThrow(/unknown feature/u);
  });
});
