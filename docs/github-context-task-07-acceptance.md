# Task 07 acceptance notes: coverage-aware evidence bundle allocation

## Worktree record

- Problem: fixed top-N retrieval can spend the bundle on repeated wrappers and tests while omitting core implementation.
- Source root: `C:/Users/Ayush/Documents/ChatGPT/re_changer`.
- Common plan base (`PLAN_BASE_SHA`): `bdaf1380ba99f6d7a80040574e0d788ff3b22d17` (includes the committed implementation plan).
- Task branch: `codex/github-context-task-07-bundle-allocation`.
- Managed worktree path: `C:/Users/Ayush/.codex/worktrees/github-context-task-07/re_changer`.
- Owned paths: `src/lib/github/context-bundle/**`, `tests/unit/github/context-bundle/**`, `tests/fixtures/github/context-bundle/**`, and this task's integration and acceptance notes.

## Exported API

- `allocateEvidenceBundle`: deterministic marginal feature-coverage and token-cost allocator.
- `createBaselineBundleBudget` and `createBaselineSelectionAdapterInput`: adapters for live file, token, line, character, and section limits.
- Task-local Zod schemas and types for screened sections, ranked candidates, features, adjustments, budgets, and the resulting evidence bundle.

## Behaviour implemented

- Allocates overview/configuration, primary implementation, and verification roles at experimental targets of 15%, 70%, and 15%; unfilled capacity can be borrowed by useful evidence from other roles.
- Applies a soft 12.5% test-token target in general overview mode, with an explicit testing-contribution override.
- Recomputes marginal value from uncovered role-specific features and cost. Wrappers do not count as implementation proof; tests and overview documents do not fill implementation coverage.
- Preserves feasible pins and exact provenance, deduplicates identical excerpts, collapses unpinned duplicate/overlap groups, and reports unfulfilled pins and omitted candidates.
- Enforces the existing 12-file cap plus adapter-provided token, line, character, and section caps. Missing critical implementation features are explicit.
- Emits a deterministic selection identity and an explicitly denominated implementation-coverage ratio. `consentHash` remains null until a separate user approval flow binds consent.

## Scope exclusions

- No edits to `contracts.ts`, selector routes, workspace UI, provider interfaces, or package manifests.
- No dependency on Task 06, another task branch, live GitHub, AI ranking, or a provider call.
- No inference of personal authorship, whole-project ownership, or performance outcomes from bundle coverage.
- No production wiring, deployment, or request-cap increase.

## Fixture matrix

`tests/fixtures/github/context-bundle/cases.ts` supplies exact fictional cases:

- `fullStackResumeApp`: README/configuration, route wrappers, resume engine, PDF export, AI tailoring, storage, and focused tests.
- `monorepo`: web/API packages and shared domain code.
- `docsHeavyRepository`: repeated package documentation and implementation sections.
- `testHeavyRepository`: eight verification candidates against implementation evidence.
- `noTestRepository`: implementation and overview evidence with no test files.
- `testingContribution`: explicit test-focused context.
- `impossiblePinnedBundle`: over-budget pins, a missing pin, and hard file/token limits.
- `reproducedBaselineAnalogue`: a source-free analogue for the reported 12-file, 651-line, 434-test-line retrieval baseline.

The unit suite also covers overlapping sections, identical pinned excerpts, deterministic selection after shuffled input, role-specific missing-critical reporting, cap clamping, unsafe paths, commit mismatch, unknown features, excerpt-hash mismatch, and line/character admission.

## Verification record

- Environment: Node `v24.16.0`; baseline `package-lock.json` is present. The managed worktree did not include `node_modules`; the original checkout's dependencies differ from this baseline lockfile. `npm ci --offline` remained active for over ten minutes without creating command shims, so it was stopped; the installed direct tool entry points were usable afterward.
- Focused tests: `node node_modules/vitest/vitest.mjs run tests/unit/github/context-bundle/allocator.test.ts` — **18 passed**.
- Task-scoped TypeScript: direct `tsc --noEmit` over the module, fixture and test files — **passed**.
- ESLint: direct ESLint over the owned module, fixtures and tests — **passed**.
- Prettier: direct `prettier --check` over all owned code and notes — **passed**.
- Full-project TypeScript check: **not clean in this incomplete install**. It reported unresolved Next.js, Lucide, and CSS module declarations across unrelated baseline files. The task-scoped check passes.
- No broader suite, browser run, or live-provider call is part of this server-side standalone task.

## Safety checks and limitations

- Rejects unsafe repository paths, mixed repository/commit candidates, unknown feature references, duplicate IDs, and excerpt hash mismatches.
- Validates that each excerpt's line count matches its exact source line range before allocation.
- Selects only candidates marked eligible and safe; requested pins that cannot fit are returned as unfulfilled with a reason.
- Exact token estimates, eligibility, screening, feature mappings, and duplicate-group quality remain responsibilities of the upstream adapters. The final host request admission must recheck the complete payload.
- Separate overlapping sections with different evidence should be merged by an upstream sectioner; otherwise only one unpinned representative is selected and the omission/missing-coverage report explains the gap.
- Integration contract and live policy mapping: [github-context-task-07-integration.md](github-context-task-07-integration.md).
