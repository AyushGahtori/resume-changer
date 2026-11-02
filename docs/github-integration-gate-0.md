# GitHub integration Gate 0

Status: prepared for review; do not start Batch A until this baseline is merged.

## Baseline and ownership

- Parent baseline: 4fc28cdbc015aff12f2e08b15428c63e4f9a040e (origin/main, 26 October 2026).
- Shared contract owners remain the integration lead: src/lib/github/contracts.ts,
  src/lib/github/ports.ts, tests/fixtures/github/gate0.ts, and the E2E-only
  component harness/registry.
- Task-owned module files in this change are compile-safe placeholders. Their
  only runtime outcome is the typed unavailable error. They do not fetch,
  authorize, inspect, extract, save, persist, or approve anything.
- Batch tasks replace only their owned placeholder implementation and retain
  the signatures in contracts.ts and ports.ts. Contract changes go through
  the lead between batches.

## Frozen semantics

- Every service and injected port returns Result<T>; an error has a known
  DomainErrorCode, safe message, retryability, and optional safe field errors.
  Provider bodies, credentials, source contents, and stack traces are not error
  fields.
- IDs are stable lowercase hyphenated IDs. Versions are positive integers.
  Mutations supply an expected version. Timestamps are UTC ISO strings.
- ExecutionContext carries the resolved personal root, session and
  authorization namespace, abort signal, injected clock, run ID, absolute
  deadline, and one shared budget ledger. No port may resolve a personal root
  from the working directory or reset the ledger during recovery.
- Repository paths are relative slash-separated paths. Absolute paths, drive
  paths, control characters, encoded separators, and dot traversal are rejected.
  Repository paths are never storage filenames.
- Repository access and GitHub identity do not establish personal contribution.
  Contribution statements, claims, user confirmation, and source evidence stay
  separate. A draft result is never an approved library point.
- Consent is bound to the selection version and SHA-256 selection hash.
  Changing scope/selection invalidates consent and dependent result reuse.
- Targets and estimates remain measurement answers, never achieved
  MeasurementResult values or metric clauses. Qualitative skip is valid.
- Notifications, review state, and library approval are distinct. Navigation
  does not cancel a job. A completed job means drafts are ready for review.

## Cache identity and retention

The cache identity is intentionally different for each reusable layer:

| Layer                | Frozen identity fields                                                                                                                   | Namespace/invalidation                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Safe fetched content | Authorization namespace, repository ID, blob SHA, parser version, safety policy                                                          | Expiry, deletion, policy change, or revoked access                                        |
| Selected bundle      | Repository ID/revision, ordered source hashes and selected IDs, selection hash, scope/contribution hash, selector version, safety policy | Any changed scope, selection, content, selector, or authorization                         |
| Extraction result    | Selected-bundle identity plus exact prompt/schema versions, model, model-settings hash                                                   | Any changed factual input, prompt/schema/model setting, consent, expiry, or authorization |

Cache entries are immutable and proposed-only. A cache hit cannot bypass
source-pointer validation, current authorization, fresh review, or approval.
Provider-owned cache objects are not enabled by default.

Staging expires after 24 hours. The total import cache is capped at 50 MiB;
eviction removes the oldest eligible unapproved entries and never removes input
for an active job. Deferred measurement tasks use a separate 30-day retention
policy and contain only a concise claim context, question/version, and metric
definition IDs. They do not point back to expiring staging or copy raw excerpts.
Expired staging remains an honest expired state; it does not preserve a broken
review link.

## Frozen inspection and generation defaults

All limits are simultaneous. The first reached limit wins; retries and recovery
share the same ledger. These are starting policy limits, not measured
performance claims.

| Budget                      |                    Normal target |                                              Hard ceiling |
| --------------------------- | -------------------------------: | --------------------------------------------------------: |
| Selected files              | 8–10 after contribution coverage |                             12 per request; 16 per import |
| Initial source lines        |                          600–900 |                1,500 per request; 2,000 unique per import |
| Lines per file              |                   Usually 50–100 |               200 per file/request; 300 unique per import |
| Transmitted source lines    |               Avoid broad replay |                    3,000 occurrences across both attempts |
| Fetched bodies / file size  |             Relevant, safe files |                        20 bodies; 64 KiB per fetched body |
| Selected excerpt characters |          Compact complete blocks |                                 12,000/file; 80,000 total |
| Upstream HTTP               |           Sequential and bounded | 32 attempts; 8 PR attempts within that total; 2 redirects |
| Upstream bytes              |                                — |                                              12 MiB total |
| Model input                 |      Usually 6,000–10,000 tokens |                             24,000/request; 36,000/import |
| Generation                  |              One structured call |         One normal call plus at most one bounded recovery |
| Deadlines                   |                                — |             60 seconds inspection; 120 seconds extraction |
| Draft output                |                                — |            8 draft points, 12 claims, 8 metric candidates |

Count physical source lines after normalizing CRLF and CR to LF. Empty files
have zero lines and a final newline does not add an extra content line. Unique
source accounting unions overlapping ranges; transmitted accounting charges
each repeated occurrence. Compact report projections retain and charge their
original source pointers. Token limits cover the complete assembled request,
including policy and schema; estimates and provider-reported usage remain
distinct.

## Test harness

The /e2e/github-import route is force-dynamic and returns 404 unless both
GITHUB_IMPORT_E2E_HARNESS=1 and RESUME_APP_MODE=local are set. Only
scripts/start-e2e-server.mjs sets the explicit harness flag, on the test
server process. It is not set for builds, development, or normal application
startup. The harness contains fictional fixtures only and has no client,
provider, filesystem, approval, or GitHub integration.

The stable fixture registry covers UI Tasks 21–29: setup ready/empty/private
denied; PR-free/team/hybrid context; safe/blocked/manual file candidates;
supported/needs-context drafts; measured/skip/target answers; within/over-limit
budget; queued/running/ready/failed/interrupted status; read/unread/expired
notifications; and setup/analysis/review layout states.

## Verification recorded for this preparation

- TypeScript contract and application check: npm run typecheck.
- Frozen fixture/policy tests: npx vitest run tests/unit/github/gate-0-contracts.test.ts.
- E2E harness route and registry: npx playwright test tests/e2e/github-import-harness.spec.ts.
- Full existing checks must pass before this Gate 0 baseline is proposed for
  merge. Once merged, record the resulting main commit before Batch A starts.
