import { createHash } from "node:crypto";
import type {
  BundleAllocationInput,
  BundleContext,
  RankedCandidate,
  ScreenedSection,
  SourceIdentity,
} from "../../../../src/lib/github/context-bundle";

export const REPOSITORY_ID = "8347291";
export const COMMIT_SHA = "a".repeat(40);

export const FULL_STACK_FEATURES = [
  {
    id: "resume-engine",
    label: "Resume generation engine",
    critical: true,
    weight: 1,
  },
  { id: "pdf-export", label: "PDF export", critical: true, weight: 1 },
  { id: "ai-tailoring", label: "AI tailoring", critical: true, weight: 1 },
  { id: "draft-storage", label: "Draft storage", critical: false, weight: 1 },
];

export function makeCandidate(input: {
  id: string;
  path: string;
  role: RankedCandidate["role"];
  featureIds?: string[];
  text?: string;
  startLine?: number;
  endLine?: number;
  blobSha?: string;
  tokenCost?: number;
  rankScore?: number;
  expectedIncrementalCoverage?: number;
  eligible?: boolean;
  safety?: RankedCandidate["safety"];
  pinned?: boolean;
  isTestEvidence?: boolean;
  isWrapper?: boolean;
  duplicateGroupIds?: string[];
  uncertaintyFlags?: string[];
}): RankedCandidate {
  const excerpt =
    input.text ?? `${input.id} provides representative evidence.\n`;
  const excerptSha256 = createHash("sha256")
    .update(excerpt, "utf8")
    .digest("hex");
  const source: SourceIdentity = {
    repositoryId: REPOSITORY_ID,
    commitSha: COMMIT_SHA,
    path: input.path,
    blobSha:
      input.blobSha ?? createHash("sha1").update(input.path).digest("hex"),
    startLine: input.startLine ?? 1,
    endLine: input.endLine ?? input.startLine ?? 1,
    excerptSha256,
  };
  const section: ScreenedSection = {
    id: `section-${input.id}`,
    source,
    excerpt,
    screeningResult: "passed",
    warnings: [],
  };
  return {
    id: input.id,
    section,
    role: input.role,
    featureIds: input.featureIds ?? [],
    rankScore: input.rankScore ?? 50,
    expectedIncrementalCoverage: input.expectedIncrementalCoverage ?? 0.25,
    tokenCost: input.tokenCost ?? 100,
    eligible: input.eligible ?? true,
    safety: input.safety ?? "safe",
    pinned: input.pinned ?? false,
    isTestEvidence: input.isTestEvidence ?? false,
    isWrapper: input.isWrapper ?? false,
    duplicateGroupIds: input.duplicateGroupIds ?? [],
    uncertaintyFlags: input.uncertaintyFlags ?? [],
  };
}

export function makeInput(input: {
  candidates: RankedCandidate[];
  features?: BundleAllocationInput["features"];
  context?: Partial<BundleContext>;
  maxTokens?: number;
  maxFiles?: number;
  maxSections?: number;
  maxLinesPerFile?: number;
  maxTotalLines?: number;
  maxCharsPerFile?: number;
  maxTotalChars?: number;
  pinnedCandidateIds?: string[];
  excludedCandidateIds?: string[];
}): BundleAllocationInput {
  return {
    repositoryId: REPOSITORY_ID,
    commitSha: COMMIT_SHA,
    candidates: input.candidates,
    features: input.features ?? FULL_STACK_FEATURES,
    context: {
      mode: "whole-project",
      confirmedContributionFeatureIds: [],
      testingContributionConfirmed: false,
      ...input.context,
    },
    budget: {
      maxTokens: input.maxTokens ?? 2_700,
      maxFiles: input.maxFiles ?? 12,
      maxSections: input.maxSections ?? 100,
      maxLinesPerFile: input.maxLinesPerFile ?? 200,
      maxTotalLines: input.maxTotalLines ?? 1_500,
      maxCharsPerFile: input.maxCharsPerFile ?? 12_000,
      maxTotalChars: input.maxTotalChars ?? 80_000,
    },
    adjustments: {
      pinnedCandidateIds: input.pinnedCandidateIds ?? [],
      excludedCandidateIds: input.excludedCandidateIds ?? [],
    },
  };
}

export function fullStackResumeApp(): BundleAllocationInput {
  return makeInput({
    maxTokens: 3_000,
    candidates: [
      makeCandidate({
        id: "readme",
        path: "README.md",
        role: "overview",
        tokenCost: 180,
        rankScore: 80,
      }),
      makeCandidate({
        id: "package-config",
        path: "package.json",
        role: "overview",
        featureIds: ["resume-engine"],
        tokenCost: 130,
        rankScore: 70,
      }),
      makeCandidate({
        id: "resume-route",
        path: "src/app/resume/page.tsx",
        role: "implementation",
        tokenCost: 90,
        rankScore: 96,
        isWrapper: true,
        duplicateGroupIds: ["resume-route-wrappers"],
      }),
      makeCandidate({
        id: "resume-engine",
        path: "src/lib/resume/generate.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 800,
        rankScore: 72,
      }),
      makeCandidate({
        id: "pdf-export",
        path: "src/lib/pdf/export.ts",
        role: "implementation",
        featureIds: ["pdf-export"],
        tokenCost: 600,
        rankScore: 80,
      }),
      makeCandidate({
        id: "ai-tailoring",
        path: "src/lib/ai/tailor.ts",
        role: "implementation",
        featureIds: ["ai-tailoring"],
        tokenCost: 700,
        rankScore: 76,
      }),
      makeCandidate({
        id: "draft-store",
        path: "src/lib/storage/drafts.ts",
        role: "implementation",
        featureIds: ["draft-storage"],
        tokenCost: 600,
        rankScore: 65,
      }),
      makeCandidate({
        id: "resume-route-test",
        path: "tests/resume/page.test.ts",
        role: "verification",
        featureIds: ["resume-engine"],
        tokenCost: 190,
        rankScore: 98,
        isTestEvidence: true,
      }),
      makeCandidate({
        id: "pdf-export-test",
        path: "tests/pdf/export.spec.ts",
        role: "verification",
        featureIds: ["pdf-export"],
        tokenCost: 120,
        rankScore: 90,
        isTestEvidence: true,
      }),
      makeCandidate({
        id: "ai-tailoring-test",
        path: "tests/ai/tailor.test.ts",
        role: "verification",
        featureIds: ["ai-tailoring"],
        tokenCost: 100,
        rankScore: 88,
        isTestEvidence: true,
      }),
      makeCandidate({
        id: "second-resume-route",
        path: "src/app/(workspace)/resume/page.tsx",
        role: "implementation",
        tokenCost: 85,
        rankScore: 94,
        isWrapper: true,
        duplicateGroupIds: ["resume-route-wrappers"],
      }),
    ],
    context: {
      mode: "whole-project",
      confirmedContributionFeatureIds: ["resume-engine"],
    },
  });
}

export function monorepo(): BundleAllocationInput {
  return makeInput({
    maxTokens: 3_600,
    candidates: [
      makeCandidate({
        id: "root-readme",
        path: "README.md",
        role: "overview",
        tokenCost: 220,
        rankScore: 90,
      }),
      makeCandidate({
        id: "web-readme",
        path: "apps/web/README.md",
        role: "overview",
        tokenCost: 260,
        rankScore: 80,
      }),
      makeCandidate({
        id: "api-readme",
        path: "services/api/README.md",
        role: "overview",
        tokenCost: 250,
        rankScore: 80,
      }),
      makeCandidate({
        id: "web-entry",
        path: "apps/web/src/app/page.tsx",
        role: "implementation",
        tokenCost: 100,
        rankScore: 98,
        isWrapper: true,
        duplicateGroupIds: ["web-entry-wrappers"],
      }),
      makeCandidate({
        id: "api-entry",
        path: "services/api/src/server.ts",
        role: "implementation",
        featureIds: ["draft-storage"],
        tokenCost: 800,
        rankScore: 70,
      }),
      makeCandidate({
        id: "shared-domain",
        path: "packages/domain/src/resume.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 750,
        rankScore: 74,
      }),
      makeCandidate({
        id: "web-components",
        path: "apps/web/src/components/resume.tsx",
        role: "implementation",
        featureIds: ["pdf-export"],
        tokenCost: 650,
        rankScore: 71,
      }),
      makeCandidate({
        id: "ai-service",
        path: "services/ai/src/tailoring.ts",
        role: "implementation",
        featureIds: ["ai-tailoring"],
        tokenCost: 650,
        rankScore: 76,
      }),
      makeCandidate({
        id: "api-test",
        path: "services/api/test/resume.test.ts",
        role: "verification",
        featureIds: ["draft-storage"],
        tokenCost: 300,
        rankScore: 87,
        isTestEvidence: true,
      }),
    ],
  });
}

export function docsHeavyRepository(): BundleAllocationInput {
  const repeatedReadme =
    "Package documentation repeats the generated install notes.\n";
  return makeInput({
    maxTokens: 1_800,
    candidates: [
      makeCandidate({
        id: "root-overview",
        path: "README.md",
        role: "overview",
        text: "A concise architecture overview for the whole repository.\n",
        tokenCost: 180,
        rankScore: 90,
      }),
      makeCandidate({
        id: "package-a-readme",
        path: "packages/a/README.md",
        role: "overview",
        text: repeatedReadme,
        tokenCost: 400,
        rankScore: 85,
        duplicateGroupIds: ["generated-readmes"],
      }),
      makeCandidate({
        id: "package-b-readme",
        path: "packages/b/README.md",
        role: "overview",
        text: repeatedReadme,
        tokenCost: 400,
        rankScore: 84,
        duplicateGroupIds: ["generated-readmes"],
      }),
      makeCandidate({
        id: "architecture",
        path: "docs/architecture.md",
        role: "overview",
        tokenCost: 180,
        rankScore: 75,
      }),
      makeCandidate({
        id: "core-engine",
        path: "src/core/engine.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 500,
        rankScore: 80,
      }),
      makeCandidate({
        id: "export-service",
        path: "src/export/pdf.ts",
        role: "implementation",
        featureIds: ["pdf-export"],
        tokenCost: 420,
        rankScore: 78,
      }),
    ],
  });
}

export function testHeavyRepository(): BundleAllocationInput {
  const tests = Array.from({ length: 8 }, (_, index) =>
    makeCandidate({
      id: `test-${index + 1}`,
      path: `tests/area-${index + 1}.test.ts`,
      role: "verification",
      featureIds: [index % 2 === 0 ? "resume-engine" : "pdf-export"],
      tokenCost: 160,
      rankScore: 98 - index,
      isTestEvidence: true,
    }),
  );
  return makeInput({
    maxTokens: 1_600,
    candidates: [
      makeCandidate({
        id: "overview",
        path: "README.md",
        role: "overview",
        tokenCost: 160,
        rankScore: 84,
      }),
      makeCandidate({
        id: "resume-core",
        path: "src/resume/core.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 520,
        rankScore: 74,
      }),
      makeCandidate({
        id: "pdf-core",
        path: "src/pdf/render.ts",
        role: "implementation",
        featureIds: ["pdf-export"],
        tokenCost: 460,
        rankScore: 72,
      }),
      ...tests,
    ],
  });
}

export function noTestRepository(): BundleAllocationInput {
  return makeInput({
    maxTokens: 1_400,
    candidates: [
      makeCandidate({
        id: "readme",
        path: "README.md",
        role: "overview",
        tokenCost: 100,
        rankScore: 80,
      }),
      makeCandidate({
        id: "resume-core",
        path: "src/resume/core.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 700,
        rankScore: 75,
      }),
      makeCandidate({
        id: "pdf-core",
        path: "src/pdf/render.ts",
        role: "implementation",
        featureIds: ["pdf-export"],
        tokenCost: 520,
        rankScore: 70,
      }),
    ],
  });
}

export function testingContribution(): BundleAllocationInput {
  return makeInput({
    maxTokens: 1_600,
    context: {
      mode: "contribution-focused",
      confirmedContributionFeatureIds: ["resume-engine"],
      testingContributionConfirmed: true,
    },
    candidates: [
      makeCandidate({
        id: "overview",
        path: "README.md",
        role: "overview",
        tokenCost: 130,
        rankScore: 90,
      }),
      makeCandidate({
        id: "resume-tests",
        path: "tests/resume/contract.test.ts",
        role: "verification",
        featureIds: ["resume-engine"],
        tokenCost: 260,
        rankScore: 90,
        isTestEvidence: true,
      }),
      makeCandidate({
        id: "pdf-tests",
        path: "tests/pdf/export.test.ts",
        role: "verification",
        featureIds: ["pdf-export"],
        tokenCost: 260,
        rankScore: 88,
        isTestEvidence: true,
      }),
      makeCandidate({
        id: "engine-implementation",
        path: "src/resume/engine.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 700,
        rankScore: 75,
      }),
    ],
  });
}

export function impossiblePinnedBundle(): BundleAllocationInput {
  return makeInput({
    maxTokens: 120,
    maxFiles: 2,
    maxSections: 2,
    pinnedCandidateIds: ["pinned-core", "pinned-pdf", "pinned-missing"],
    candidates: [
      makeCandidate({
        id: "pinned-core",
        path: "src/core.ts",
        role: "implementation",
        featureIds: ["resume-engine"],
        tokenCost: 100,
        rankScore: 100,
      }),
      makeCandidate({
        id: "pinned-pdf",
        path: "src/pdf.ts",
        role: "implementation",
        featureIds: ["pdf-export"],
        tokenCost: 100,
        rankScore: 99,
      }),
      makeCandidate({
        id: "other",
        path: "src/other.ts",
        role: "implementation",
        featureIds: ["ai-tailoring"],
        tokenCost: 20,
        rankScore: 60,
      }),
    ],
  });
}

export function reproducedBaselineAnalogue(): {
  candidates: RankedCandidate[];
  expectedFeatures: BundleAllocationInput["features"];
  tokenBudget: number;
  baseline: { files: number; lines: number; testLines: number };
} {
  const wrappersAndTests = [
    ...Array.from({ length: 9 }, (_, index) =>
      makeCandidate({
        id: `wrapper-${index + 1}`,
        path: `src/app/page-${index + 1}.tsx`,
        role: "implementation",
        tokenCost: 100,
        rankScore: 100 - index,
        isWrapper: true,
        duplicateGroupIds: ["page-wrappers"],
      }),
    ),
    ...Array.from({ length: 3 }, (_, index) =>
      makeCandidate({
        id: `baseline-test-${index + 1}`,
        path: `tests/page-${index + 1}.test.ts`,
        role: "verification",
        featureIds: ["resume-engine"],
        tokenCost: 100,
        rankScore: 99 - index,
        isTestEvidence: true,
      }),
    ),
  ];
  const balanced = [
    makeCandidate({
      id: "baseline-readme",
      path: "README.md",
      role: "overview",
      tokenCost: 100,
      rankScore: 80,
    }),
    makeCandidate({
      id: "baseline-package",
      path: "package.json",
      role: "overview",
      tokenCost: 60,
      rankScore: 75,
    }),
    makeCandidate({
      id: "baseline-engine",
      path: "src/core/resume.ts",
      role: "implementation",
      featureIds: ["resume-engine"],
      tokenCost: 140,
      rankScore: 74,
    }),
    makeCandidate({
      id: "baseline-pdf",
      path: "src/pdf/export.ts",
      role: "implementation",
      featureIds: ["pdf-export"],
      tokenCost: 120,
      rankScore: 72,
    }),
    makeCandidate({
      id: "baseline-ai",
      path: "src/ai/tailor.ts",
      role: "implementation",
      featureIds: ["ai-tailoring"],
      tokenCost: 140,
      rankScore: 73,
    }),
    makeCandidate({
      id: "baseline-storage",
      path: "src/storage/drafts.ts",
      role: "implementation",
      featureIds: ["draft-storage"],
      tokenCost: 120,
      rankScore: 65,
    }),
    makeCandidate({
      id: "baseline-verification",
      path: "tests/core.test.ts",
      role: "verification",
      featureIds: ["resume-engine"],
      tokenCost: 80,
      rankScore: 70,
      isTestEvidence: true,
    }),
  ];
  return {
    candidates: [...wrappersAndTests, ...balanced],
    expectedFeatures: FULL_STACK_FEATURES,
    tokenBudget: 760,
    baseline: { files: 12, lines: 651, testLines: 434 },
  };
}
