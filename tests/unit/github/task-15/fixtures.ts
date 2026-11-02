import { sha256, type FileCandidate } from "@/lib/github/server/file-policy";
import type {
  PullRequestContext,
  RepositoryScope,
} from "@/lib/github/server/selector";

export interface LabeledEvidenceBlock {
  id: string;
  path: string;
  text: string;
  kind: "contribution" | "helper" | "corroboration" | "counterevidence";
}

export interface LabeledContributionFact {
  id: string;
  statement: string;
  evidenceBlockIds: string[];
}

export interface RetrievalFixture {
  id: string;
  cohort: "tuning" | "holdout";
  description: string;
  scope: RepositoryScope;
  prContext: PullRequestContext;
  files: Array<{ candidate: FileCandidate; text: string }>;
  pinnedFileIds: string[];
  requiredBlocks: LabeledEvidenceBlock[];
  counterevidence: LabeledEvidenceBlock[];
  supportedFacts: LabeledContributionFact[];
  safeExclusionPaths: string[];
  attribution: "stated" | "needs-input";
}

const repositoryId = "repo-task-15";
const revision = "a".repeat(40);

function scope(
  name: string,
  overrides: Partial<RepositoryScope> = {},
): RepositoryScope {
  return {
    repositoryId,
    owner: "northstar-labs",
    name,
    fullSha: revision,
    visibility: "public",
    role: "software engineer",
    identitySource: "self-declared",
    contributionStatement: "I contributed implementation and tests.",
    ...overrides,
  };
}

function file(
  id: string,
  path: string,
  text: string,
  overrides: Partial<FileCandidate> = {},
) {
  return {
    candidate: {
      id,
      path,
      blobSha: sha256(text).slice(0, 40),
      mode: "100644",
      byteSize: Buffer.byteLength(text, "utf8"),
      ...overrides,
    },
    text,
  };
}

function noPullRequests(): PullRequestContext {
  return { selectedPullRequests: [] };
}

export const RETRIEVAL_FIXTURES: readonly RetrievalFixture[] = [
  {
    id: "solo-webhook-signing",
    cohort: "tuning",
    description:
      "Solo contribution has a selected implementation PR, helper, negative test, stale overview, and secret file.",
    scope: scope("webhook-service", {
      role: "backend engineer",
      selectedPaths: ["src/auth/signature.ts"],
      selectedPrNumbers: [12],
      contributionStatement:
        "I implemented webhook signature verification and its replay-window check.",
    }),
    prContext: {
      selectedPullRequests: [
        {
          number: 12,
          title: "feat: verify webhook signatures",
          changedPaths: [
            "src/auth/signature.ts",
            "tests/auth/signature.test.ts",
          ],
        },
      ],
    },
    files: [
      file(
        "signing",
        "src/auth/signature.ts",
        [
          'import { withinReplayWindow } from "./replay-window";',
          "export function verifySignature(expected: Uint8Array, supplied: Uint8Array, timestamp: number) {",
          "  if (!withinReplayWindow(timestamp)) return false;",
          "  return timingSafeEqual(expected, supplied);",
          "}",
        ].join("\n"),
      ),
      file(
        "replay-window",
        "src/auth/replay-window.ts",
        [
          "export function withinReplayWindow(timestamp: number, now = Date.now()) {",
          "  return Math.abs(now - timestamp) <= 300_000;",
          "}",
        ].join("\n"),
      ),
      file(
        "signing-test",
        "tests/auth/signature.test.ts",
        [
          'it("rejects expired webhook timestamps", () => {',
          "  expect(verifySignature(expected, supplied, expired)).toBe(false);",
          "});",
        ].join("\n"),
      ),
      file(
        "readme",
        "README.md",
        "# Webhook service\nThe old roadmap says signature verification is planned.",
      ),
      file("env", ".env.local", "GITHUB_TOKEN=synthetic-never-return-this"),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "constant-time-check",
        path: "src/auth/signature.ts",
        text: "return timingSafeEqual(expected, supplied);",
        kind: "contribution",
      },
      {
        id: "replay-window-guard",
        path: "src/auth/replay-window.ts",
        text: "Math.abs(now - timestamp) <= 300_000",
        kind: "helper",
      },
      {
        id: "expired-timestamp-test",
        path: "tests/auth/signature.test.ts",
        text: "rejects expired webhook timestamps",
        kind: "counterevidence",
      },
    ],
    counterevidence: [
      {
        id: "expired-timestamp-test",
        path: "tests/auth/signature.test.ts",
        text: "rejects expired webhook timestamps",
        kind: "counterevidence",
      },
    ],
    supportedFacts: [
      {
        id: "signature-and-replay-protection",
        statement:
          "Verifies signatures with constant-time comparison and rejects timestamps outside the replay window.",
        evidenceBlockIds: ["constant-time-check", "replay-window-guard"],
      },
    ],
    safeExclusionPaths: [".env.local"],
    attribution: "stated",
  },
  {
    id: "team-fork-unknown-attribution",
    cohort: "tuning",
    description:
      "Forked team repository has useful project files but no personal contribution statement.",
    scope: scope("team-portal", {
      role: "team contributor",
      identitySource: "unknown",
      contributionStatement: undefined,
      selectedPaths: ["src/cache/evict.ts"],
      selectedPrNumbers: [31],
    }),
    prContext: {
      selectedPullRequests: [
        {
          number: 31,
          title: "fix: cache eviction behavior",
          changedPaths: ["src/cache/evict.ts", "tests/cache/evict.test.ts"],
        },
      ],
    },
    files: [
      file(
        "evict",
        "src/cache/evict.ts",
        "export function evictExpired(entries: Entry[]) {\n  return entries.filter((entry) => !entry.expired);\n}",
      ),
      file(
        "evict-test",
        "tests/cache/evict.test.ts",
        'it("keeps active entries", () => {\n  expect(evictExpired([active])).toEqual([active]);\n});',
      ),
      file(
        "teammate-ui",
        "src/dashboard/overview.tsx",
        "export function TeamDashboard() { return <main>Team metrics</main>; }",
      ),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "team-eviction-implementation",
        path: "src/cache/evict.ts",
        text: "!entry.expired",
        kind: "contribution",
      },
    ],
    counterevidence: [],
    supportedFacts: [],
    safeExclusionPaths: [],
    attribution: "needs-input",
  },
  {
    id: "docs-poor-pr-free-cli",
    cohort: "tuning",
    description:
      "PR-free CLI repository has no README; the selected command delegates option parsing to a helper.",
    scope: scope("tiny-cli", {
      role: "CLI maintainer",
      selectedPaths: ["src/cli.ts"],
      selectedPrNumbers: [],
      contributionStatement:
        "I added the JSON output mode and its command-line option parser.",
    }),
    prContext: noPullRequests(),
    files: [
      file(
        "cli",
        "src/cli.ts",
        [
          'import { parseOptions } from "./cli/options";',
          "export function runCli(argv: string[]) {",
          "  const options = parseOptions(argv);",
          "  return options.json ? JSON.stringify(loadItems()) : renderItems();",
          "}",
        ].join("\n"),
      ),
      file(
        "options",
        "src/cli/options.ts",
        'export function parseOptions(argv: string[]) {\n  return { json: argv.includes("--json") };\n}',
      ),
      file(
        "cli-test",
        "tests/cli.test.ts",
        'it("prints JSON when --json is passed", () => {\n  expect(runCli(["--json"])).toContain("[");\n});',
      ),
      file("manifest", "package.json", '{"name":"tiny-cli"}'),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "cli-json-output",
        path: "src/cli.ts",
        text: "JSON.stringify(loadItems())",
        kind: "contribution",
      },
      {
        id: "cli-option-helper",
        path: "src/cli/options.ts",
        text: 'argv.includes("--json")',
        kind: "helper",
      },
      {
        id: "cli-json-test",
        path: "tests/cli.test.ts",
        text: "prints JSON when --json is passed",
        kind: "corroboration",
      },
    ],
    counterevidence: [],
    supportedFacts: [
      {
        id: "cli-json-mode",
        statement: "Adds a `--json` mode to the CLI.",
        evidenceBlockIds: [
          "cli-json-output",
          "cli-option-helper",
          "cli-json-test",
        ],
      },
    ],
    safeExclusionPaths: [],
    attribution: "stated",
  },
  {
    id: "misleading-dashboard-title",
    cohort: "tuning",
    description:
      "Dashboard title points to a docs-only PR and must not outrank the changed documentation path.",
    scope: scope("report-api", {
      role: "API documentation contributor",
      selectedPaths: ["docs/dashboard-api.md"],
      selectedPrNumbers: [44],
      contributionStatement:
        "I documented the dashboard reporting API and its response fields.",
    }),
    prContext: {
      selectedPullRequests: [
        {
          number: 44,
          title: "feat: dashboard analytics experience",
          changedPaths: ["docs/dashboard-api.md"],
        },
      ],
    },
    files: [
      file(
        "dashboard-docs",
        "docs/dashboard-api.md",
        "# Dashboard API\nThe endpoint returns daily report totals and the selected date range.",
      ),
      file(
        "dashboard-ui",
        "src/dashboard/view.tsx",
        "export function DashboardView() {\n  return <main>Analytics dashboard</main>;\n}",
      ),
      file(
        "report-api",
        "src/api/report.ts",
        "export function getDailyReport(range: Range) {\n  return queryDailyTotals(range);\n}",
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        file(
          `unrelated-${index}`,
          `src/maintenance/module-${index}.ts`,
          `export const maintenanceValue${index} = ${index};`,
        ),
      ),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "dashboard-api-docs",
        path: "docs/dashboard-api.md",
        text: "daily report totals",
        kind: "contribution",
      },
    ],
    counterevidence: [],
    supportedFacts: [
      {
        id: "dashboard-api-documentation",
        statement: "Documents the dashboard reporting API response fields.",
        evidenceBlockIds: ["dashboard-api-docs"],
      },
    ],
    safeExclusionPaths: [],
    attribution: "stated",
  },
  {
    id: "hybrid-ml-evaluation-ui",
    cohort: "holdout",
    description:
      "Hybrid feature spans a web dashboard, an ML evaluation engine, a helper, and a test.",
    scope: scope("evaluation-suite", {
      role: "ML and frontend engineer",
      selectedPaths: [
        "web/evaluation-dashboard.tsx",
        "src/evaluation/metrics.py",
      ],
      selectedPrNumbers: [52],
      contributionStatement:
        "I implemented the evaluation dashboard and metric aggregation.",
    }),
    prContext: {
      selectedPullRequests: [
        {
          number: 52,
          title: "feat: model evaluation dashboard",
          changedPaths: [
            "web/evaluation-dashboard.tsx",
            "src/evaluation/metrics.py",
            "tests/evaluation/test_metrics.py",
          ],
        },
      ],
    },
    files: [
      file(
        "evaluation-ui",
        "web/evaluation-dashboard.tsx",
        "export function EvaluationDashboard() {\n  return <MetricTable />;\n}",
      ),
      file(
        "evaluation-metrics",
        "src/evaluation/metrics.py",
        "def summarize_runs(rows):\n    return normalize_scores(rows)\n",
      ),
      file(
        "evaluation-helper",
        "src/evaluation/normalize.py",
        "def normalize_scores(rows):\n    return [row.score / row.total for row in rows]\n",
      ),
      file(
        "evaluation-test",
        "tests/evaluation/test_metrics.py",
        "def test_uses_total_as_denominator():\n    assert summarize_runs(rows) == expected_normalized_scores\n",
      ),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "evaluation-dashboard",
        path: "web/evaluation-dashboard.tsx",
        text: "return <MetricTable />",
        kind: "contribution",
      },
      {
        id: "evaluation-aggregation",
        path: "src/evaluation/metrics.py",
        text: "return normalize_scores(rows)",
        kind: "contribution",
      },
      {
        id: "normalization-helper",
        path: "src/evaluation/normalize.py",
        text: "row.score / row.total",
        kind: "helper",
      },
      {
        id: "denominator-test",
        path: "tests/evaluation/test_metrics.py",
        text: "uses_total_as_denominator",
        kind: "corroboration",
      },
    ],
    counterevidence: [],
    supportedFacts: [
      {
        id: "hybrid-evaluation-feature",
        statement:
          "Builds a dashboard over normalized model-evaluation metrics.",
        evidenceBlockIds: [
          "evaluation-dashboard",
          "evaluation-aggregation",
          "normalization-helper",
        ],
      },
    ],
    safeExclusionPaths: [],
    attribution: "stated",
  },
  {
    id: "delegated-cache-guard",
    cohort: "holdout",
    description:
      "The selected cache function delegates its critical expiration guard to a helper.",
    scope: scope("cache-library", {
      role: "backend engineer",
      selectedPaths: ["src/cache/read.ts"],
      selectedPrNumbers: [],
      contributionStatement:
        "I implemented cache reads with the delegated expiration guard.",
    }),
    prContext: noPullRequests(),
    files: [
      file(
        "cache-read",
        "src/cache/read.ts",
        [
          'import { isFresh } from "../shared/freshness";',
          "export function readCache(entry: Entry) {",
          "  if (!isFresh(entry)) return null;",
          "  return entry.value;",
          "}",
        ].join("\n"),
      ),
      file(
        "freshness",
        "src/shared/freshness.ts",
        "export function isFresh(entry: Entry) {\n  return Date.now() < entry.expiresAt;\n}",
      ),
      file(
        "cache-test",
        "tests/cache/read.test.ts",
        'it("rejects expired entries", () => {\n  expect(readCache(expiredEntry)).toBeNull();\n});',
      ),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "cache-read-path",
        path: "src/cache/read.ts",
        text: "if (!isFresh(entry)) return null;",
        kind: "contribution",
      },
      {
        id: "expiration-helper",
        path: "src/shared/freshness.ts",
        text: "Date.now() < entry.expiresAt",
        kind: "helper",
      },
      {
        id: "expired-entry-test",
        path: "tests/cache/read.test.ts",
        text: "rejects expired entries",
        kind: "counterevidence",
      },
    ],
    counterevidence: [
      {
        id: "expired-entry-test",
        path: "tests/cache/read.test.ts",
        text: "rejects expired entries",
        kind: "counterevidence",
      },
    ],
    supportedFacts: [
      {
        id: "cache-expiration",
        statement: "Cache reads reject entries that have expired.",
        evidenceBlockIds: ["cache-read-path", "expiration-helper"],
      },
    ],
    safeExclusionPaths: [],
    attribution: "stated",
  },
  {
    id: "contradictory-membership-test",
    cohort: "holdout",
    description:
      "A negative test narrows an apparently broad authorization helper.",
    scope: scope("access-control", {
      role: "API engineer",
      selectedPaths: ["src/access/authorize.ts"],
      selectedPrNumbers: [61],
      contributionStatement:
        "I changed authorization checks for verified members.",
    }),
    prContext: {
      selectedPullRequests: [
        {
          number: 61,
          title: "fix: authorize verified members",
          changedPaths: [
            "src/access/authorize.ts",
            "tests/access/authorize.test.ts",
          ],
        },
      ],
    },
    files: [
      file(
        "authorize",
        "src/access/authorize.ts",
        "export function authorize(member: Member) {\n  return member.isMember && member.verified;\n}",
      ),
      file(
        "authorize-test",
        "tests/access/authorize.test.ts",
        'it("rejects an unverified member", () => {\n  expect(authorize({ isMember: true, verified: false })).toBe(false);\n});',
      ),
      file(
        "old-doc",
        "README.md",
        "All members can access the API without verification.",
      ),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "verified-guard",
        path: "src/access/authorize.ts",
        text: "member.isMember && member.verified",
        kind: "contribution",
      },
      {
        id: "unverified-negative-test",
        path: "tests/access/authorize.test.ts",
        text: "rejects an unverified member",
        kind: "counterevidence",
      },
    ],
    counterevidence: [
      {
        id: "unverified-negative-test",
        path: "tests/access/authorize.test.ts",
        text: "rejects an unverified member",
        kind: "counterevidence",
      },
      {
        id: "stale-readme-claim",
        path: "README.md",
        text: "All members can access the API without verification.",
        kind: "counterevidence",
      },
    ],
    supportedFacts: [
      {
        id: "verified-member-guard",
        statement: "Requires both membership and a verified account.",
        evidenceBlockIds: ["verified-guard", "unverified-negative-test"],
      },
    ],
    safeExclusionPaths: [],
    attribution: "stated",
  },
  {
    id: "manual-report-denominator-pin",
    cohort: "holdout",
    description:
      "A manually pinned report helper is necessary to interpret the displayed metric denominator.",
    scope: scope("reporting-dashboard", {
      role: "reporting engineer",
      selectedPaths: [],
      selectedPrNumbers: [],
      contributionStatement:
        "I added the active-session denominator used by the report.",
    }),
    prContext: noPullRequests(),
    files: [
      file(
        "report-view",
        "src/reports/summary.ts",
        "export function summary() {\n  return active / eligibleSessions;\n}",
      ),
      file(
        "denominator",
        "src/reports/denominator.ts",
        "export const eligibleSessions = sessions.filter(isActive).length;",
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        file(
          `report-noise-${index}`,
          `src/reports/legacy-${index}.ts`,
          `export const legacyReport${index} = ${index};`,
        ),
      ),
    ],
    pinnedFileIds: ["denominator"],
    requiredBlocks: [
      {
        id: "manual-denominator",
        path: "src/reports/denominator.ts",
        text: "sessions.filter(isActive).length",
        kind: "contribution",
      },
    ],
    counterevidence: [],
    supportedFacts: [
      {
        id: "active-session-denominator",
        statement:
          "Uses the count of active sessions as the report denominator.",
        evidenceBlockIds: ["manual-denominator"],
      },
    ],
    safeExclusionPaths: [],
    attribution: "stated",
  },
  {
    id: "monorepo-package-holdout",
    cohort: "holdout",
    description:
      "A selected package must not be confused with similarly named files in a sibling package.",
    scope: scope("monorepo", {
      role: "resume builder engineer",
      packagePath: "packages/resume-builder",
      selectedPaths: ["packages/resume-builder/src/compose.ts"],
      selectedPrNumbers: [72],
      contributionStatement:
        "I implemented resume composition in the resume-builder package.",
    }),
    prContext: {
      selectedPullRequests: [
        {
          number: 72,
          title: "feat: compose resume sections",
          changedPaths: ["packages/resume-builder/src/compose.ts"],
        },
      ],
    },
    files: [
      file(
        "resume-compose",
        "packages/resume-builder/src/compose.ts",
        "export function composeResume(sections: Section[]) {\n  return sections.filter(isSelected).map(renderSection);\n}",
      ),
      file(
        "resume-test",
        "packages/resume-builder/tests/compose.test.ts",
        'it("omits unselected sections", () => {\n  expect(composeResume(sections)).not.toContain(hiddenSection);\n});',
      ),
      file(
        "sibling-dashboard",
        "packages/analytics/src/resume-dashboard.tsx",
        "export function ResumeDashboard() {\n  return <main>Analytics</main>;\n}",
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        file(
          `sibling-${index}`,
          `packages/analytics/src/legacy-${index}.ts`,
          `export const legacyAnalytics${index} = ${index};`,
        ),
      ),
    ],
    pinnedFileIds: [],
    requiredBlocks: [
      {
        id: "resume-compose-filter",
        path: "packages/resume-builder/src/compose.ts",
        text: "sections.filter(isSelected)",
        kind: "contribution",
      },
      {
        id: "resume-selection-test",
        path: "packages/resume-builder/tests/compose.test.ts",
        text: "omits unselected sections",
        kind: "corroboration",
      },
    ],
    counterevidence: [],
    supportedFacts: [
      {
        id: "selected-resume-sections",
        statement: "Composes only selected resume sections.",
        evidenceBlockIds: ["resume-compose-filter", "resume-selection-test"],
      },
    ],
    safeExclusionPaths: [],
    attribution: "stated",
  },
];

export const TUNING_FIXTURE_IDS = RETRIEVAL_FIXTURES.filter(
  (fixture) => fixture.cohort === "tuning",
).map((fixture) => fixture.id);

export const HELD_OUT_FIXTURE_IDS = RETRIEVAL_FIXTURES.filter(
  (fixture) => fixture.cohort === "holdout",
).map((fixture) => fixture.id);
