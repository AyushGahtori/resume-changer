import type { EvidenceAllocation, EvidenceInventoryEntry } from "../types";

export type EvidenceFixtureState =
  "default" | "full" | "stale" | "empty" | "large";

const commitSha = "0123456789abcdef0123456789abcdef01234567";

function selectedEntries(): EvidenceInventoryEntry[] {
  return [
    {
      id: "overview-readme",
      path: "README.md",
      category: "overview",
      role: "overview",
      state: "selected",
      sizeBytes: 4_860,
      sourceBlobSha: "1111111111111111111111111111111111111111",
      selectionReasons: ["Root overview", "Project purpose"],
      preview: {
        commitSha,
        blobSha: "1111111111111111111111111111111111111111",
        startLine: 1,
        endLine: 12,
        excerptSha256: "a".repeat(64),
        text: "# Atlas Metrics\n\nA fictional service for comparing release metrics.\n\nThe API groups measurements by service and release.",
      },
    },
    {
      id: "implementation-aggregate",
      path: "src/metrics/aggregate.ts",
      category: "implementation",
      role: "implementation",
      state: "selected",
      sizeBytes: 8_420,
      sourceBlobSha: "2222222222222222222222222222222222222222",
      selectionReasons: [
        "Core aggregation implementation",
        "Matches selected contribution",
      ],
      preview: {
        commitSha,
        blobSha: "2222222222222222222222222222222222222222",
        startLine: 18,
        endLine: 31,
        excerptSha256: "b".repeat(64),
        text: 'export function aggregateByRelease(rows: MetricRow[]) {\n  return groupRows(rows, (row) => row.releaseId);\n}\n\nexport function summarizeWindow(rows: MetricRow[]) {\n  return rows.filter((row) => row.window === "current");\n}',
      },
    },
    {
      id: "verification-aggregate",
      path: "tests/metrics/aggregate.test.ts",
      category: "verification",
      role: "verification",
      state: "selected",
      sizeBytes: 2_120,
      sourceBlobSha: "3333333333333333333333333333333333333333",
      selectionReasons: ["Regression coverage for empty groups"],
      preview: {
        commitSha,
        blobSha: "3333333333333333333333333333333333333333",
        startLine: 6,
        endLine: 16,
        excerptSha256: "c".repeat(64),
        text: 'it("keeps empty releases visible", () => {\n  expect(aggregateByRelease([])).toEqual([]);\n});',
      },
    },
  ];
}

function eligibleEntries(): EvidenceInventoryEntry[] {
  return [
    {
      id: "eligible-auth-session",
      path: "src/auth/session.ts",
      category: "implementation",
      role: "implementation",
      state: "eligible",
      sizeBytes: 3_320,
      selectionReasons: ["Related to authentication flow"],
    },
    {
      id: "eligible-deployment-docs",
      path: "docs/operations/deployment-guide.md",
      category: "overview",
      role: "overview",
      state: "eligible",
      sizeBytes: 5_100,
      selectionReasons: ["Explains deployment configuration"],
    },
    {
      id: "eligible-report-parser",
      path: "src/lib/reports/normalize-release-report.ts",
      category: "implementation",
      role: "implementation",
      state: "eligible",
      sizeBytes: 7_800,
      selectionReasons: ["Supports report parsing"],
    },
  ];
}

function excludedEntries(): EvidenceInventoryEntry[] {
  return [
    {
      id: "excluded-image",
      path: "docs/screenshots/release-dashboard.png",
      category: "other",
      role: "other",
      state: "excluded",
      sizeBytes: 94_220,
      selectionReasons: [],
      exclusion: { code: "unsupported-binary" },
    },
    {
      id: "excluded-large-text",
      path: "data/exports/annual-metrics.json",
      category: "other",
      role: "other",
      state: "excluded",
      sizeBytes: 102_400,
      selectionReasons: [],
      exclusion: {
        code: "excessive-text-size",
        sizeBytes: 102_400,
        limitBytes: 65_536,
      },
    },
    {
      id: "excluded-credential-name",
      path: "config/.env.example",
      category: "other",
      role: "other",
      state: "excluded",
      sizeBytes: 620,
      selectionReasons: [],
      exclusion: { code: "credential-like-filename", ruleId: "env-path-rule" },
    },
    {
      id: "excluded-unsafe-path",
      path: "../private/credentials.json",
      category: "other",
      role: "other",
      state: "excluded",
      sizeBytes: null,
      selectionReasons: [],
      exclusion: { code: "unsafe-path", ruleId: "tree-path-validation" },
    },
    {
      id: "excluded-symlink",
      path: "docs/current-release",
      category: "other",
      role: "other",
      state: "excluded",
      sizeBytes: 32,
      selectionReasons: [],
      exclusion: { code: "symlink" },
    },
    {
      id: "excluded-submodule",
      path: "vendor/chart-library",
      category: "other",
      role: "other",
      state: "excluded",
      sizeBytes: null,
      selectionReasons: [],
      exclusion: { code: "submodule" },
    },
    {
      id: "excluded-content-screening",
      path: "fixtures/sample-token-response.txt",
      category: "other",
      role: "other",
      state: "excluded",
      sizeBytes: 280,
      selectionReasons: [],
      exclusion: { code: "content-screening", finding: "secret-content" },
    },
  ];
}

export const evidenceUiAllocations: EvidenceAllocation[] = [
  {
    role: "overview",
    selectedTokens: 480,
    targetTokens: 800,
    selectedFiles: 1,
  },
  {
    role: "implementation",
    selectedTokens: 1_670,
    targetTokens: 2_600,
    selectedFiles: 1,
  },
  {
    role: "verification",
    selectedTokens: 120,
    targetTokens: 700,
    selectedFiles: 1,
  },
];

export function buildEvidenceUiEntries(
  state: EvidenceFixtureState = "default",
): EvidenceInventoryEntry[] {
  if (state === "empty") return [];

  const selected = selectedEntries();
  if (state === "stale") {
    for (const entry of selected) {
      if (entry.state === "selected") {
        entry.stale = true;
        entry.staleReason =
          "The inventory snapshot changed after this item was prepared.";
      }
    }
  }

  const entries: EvidenceInventoryEntry[] = [
    ...selected,
    ...eligibleEntries(),
    ...excludedEntries(),
  ];

  if (state === "full") {
    entries.push(
      {
        id: "selected-release-config",
        path: "config/release-policy.ts",
        category: "implementation",
        role: "implementation",
        state: "selected",
        sizeBytes: 1_420,
        selectionReasons: ["Pinned by contributor"],
      },
      {
        id: "selected-package-manifest",
        path: "package.json",
        category: "overview",
        role: "overview",
        state: "selected",
        sizeBytes: 1_180,
        selectionReasons: ["Package manifest"],
      },
    );
  }

  if (state === "large") {
    const additions = Array.from(
      { length: 10_000 - entries.length },
      (_, index) => ({
        id: `eligible-generated-${index + 1}`,
        path: `packages/feature-${String(index + 1).padStart(5, "0")}/src/module.ts`,
        category: "implementation" as const,
        role: "implementation" as const,
        state: "eligible" as const,
        sizeBytes: 480 + (index % 13) * 31,
        selectionReasons: ["Discovered implementation candidate"],
      }),
    );
    entries.push(...additions);
  }
  return entries;
}

export const evidenceUiMissingFeatures = [
  "Authentication flow",
  "Deployment configuration",
];
