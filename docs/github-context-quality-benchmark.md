# GitHub context quality benchmark

This is Task 10's offline benchmark and contract harness. It compares the committed selector-core baseline with fixed top-N, role-balanced, and marginal-coverage reference strategies. Later task implementations can register an adapter without editing the fixtures or expected evidence.

## Task acceptance notes

- **Problem:** fixed file/category selection can over-represent wrappers and tests while missing overview context or core implementation.
- **Owned files:** tests/github-context-quality/, tests/fixtures/github/context-quality/, scripts/github-context-quality/, and this document.
- **Exported API:** QualityAdapter and the Section 5 input/output types from tests/github-context-quality/contracts.ts; runQualityAdapter and runQualityBenchmark from tests/github-context-quality/harness.ts.
- **Scope exclusions:** production selection, provider, API, persistence, shared schemas, package scripts, global Vitest settings, GitHub access, model calls, and release wiring.
- **Fixtures:** seven fictional repositories cover a wrapper-heavy full-stack app, test-heavy service, Python ML pipeline, monorepo, large docs/function, malicious/unsafe content, and unknown project type. The separate public regression manifest records only path/range/count metadata.
- **Safety:** the Vitest config replaces global fetch with an immediate failure. The fixtures use fictional source and canary strings; reports include metrics and identifiers, never excerpts or source content.
- **Benchmark integrity:** reviewer gold feature IDs are separate from repository topic hints. The monorepo screenshot fixture records dimensions, byte length, and a synthetic hash only; no image bytes are stored or passed to adapters.
- **Integration:** pass a future adapter module with the frozen QualityAdapter shape to --adapter. It must export default or qualityAdapter and declare kind: "candidate". The report labels every adapter adapter-contract-tested; production-wiring-not-proven.
- **Limitations:** token counts use ceil(characters / 4), source reads/requests are simulated, and retained-text/heap measurements are proxies. Wall-clock time and heap deltas vary and are excluded from the stable report hash. The synthetic benchmark cannot establish live GitHub or provider quality.

## Worktree and baseline

- Source root passed to managed worktree creation: C:\Users\Ayush\Documents\ChatGPT\re_changer.
- Common base SHA: bdaf1380ba99f6d7a80040574e0d788ff3b22d17 (8a3be18e2e6b346146ea3bea3c811ec1667755c5 plus the committed implementation-plan document).
- Branch: codex/github-context-task-10-quality-harness.
- Managed workspace returned by the worktree tool: C:\Users\Ayush\.codex\worktrees\github-context-task-10-quality-harness\re_changer.

## Run

Install the repository's locked dependencies in this worktree if needed, then run the focused tests:

    npx vitest run --config tests/github-context-quality/vitest.config.ts

Run the benchmark and print the human-readable report:

    node scripts/github-context-quality/run.mjs

Write both report formats:

    node scripts/github-context-quality/run.mjs --json .runtime/github-context-quality/report.json --markdown .runtime/github-context-quality/report.md

Run a later task's adapter against the same fixtures and budgets:

    node scripts/github-context-quality/run.mjs --adapter tests/path/to/adapter.ts --json .runtime/github-context-quality/candidate.json

The command runs the conformance suite and benchmark through the repository's installed Vitest. A missing port, empty/no-op output, wrong revision, stale provenance, unsafe source, or exceeded budget fails the command.

## Contract and metrics

The adapter ports follow the frozen logical sequence Discover -> ReadSections -> BuildGraph -> Rank -> Select. The harness owns Evaluate, so an adapter cannot alter the expected feature map or its denominators. Every section and selected bundle retains repository ID, full commit SHA, file path, blob identity, line range, and content hash.

Adapters receive the repository inventory and interview context, but not the reviewer-labeled evidence map. The evaluator checks exact snippets against their source files and line ranges. Safety checks reject unsafe fixture files; selection budgets are shared across strategies: 9 files, 900 lines, 12,000 estimated tokens, 256 KiB selected excerpt bytes, 256 KiB per-file reads, 1 MiB aggregate retained text, and 20 simulated requests.

Reports include per-feature and critical-feature coverage, overview presence, unresolved dependencies, wrapper/test/duplicate token shares, provenance correctness, selected token estimates, downloaded source bytes, simulated request count, retained-text bound, wall-clock duration, and process heap delta. Ratios include raw numerator/denominator pairs. Selection, safety, provenance, and quality fields contribute to deterministicHash; per-run timing/heap observations do not.

The source-free public reproduction manifest records the reviewed revision's 12 paths, 651 selected lines, 22,536 bytes, and test share of 434/651 lines. No source contents are checked in. Its role is to preserve the failure shape; it is not a live quality score.
