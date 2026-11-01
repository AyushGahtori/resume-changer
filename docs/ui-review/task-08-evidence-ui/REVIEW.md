# Task 08 — Evidence inventory and preparation UI repair

## Acceptance notes

- **Problem:** generic blocked-file notices obscured the difference between filename rules, unsafe paths, unsupported formats, size limits, links, submodules and actual content screening. Large inventories also lacked a bounded selected-evidence view.
- **Base and worktree:** `PLAN_BASE_SHA=bdaf1380ba99f6d7a80040574e0d788ff3b22d17`; branch `codex/github-context-task-08-evidence-ui`; worktree `C:/Users/Ayush/.codex/worktrees/github-context-task-08-evidence-ui/re_changer`.
- **Owned implementation:** `src/components/github-import/context-evidence-ui/**`; local-only route `src/app/e2e/github-context-evidence/page.tsx`; unit and Playwright coverage under `tests/unit/github/context-evidence-ui/` and `tests/e2e/`.
- **Exported API:** `ContextEvidenceUi` renders selected/eligible/all/excluded views; `adaptFileCandidate` maps current candidates plus structured inventory/screening metadata; exported types are in `index.ts`.
- **Fixtures:** mixed 13-entry inventory (3 selected, 3 eligible, 7 excluded) with binary, oversized text, filename-rule, unsafe-path, symlink, submodule and content-screening reasons; full-bundle, stale, empty and 10,000-entry states. All content is synthetic.
- **Implemented behavior:** one neutral full-bundle notice; disabled add controls have row-specific accessible descriptions; replacement preserves a file slot; exclusion counts and reasons stay distinct; excluded rows expose metadata only; selected excerpts retain commit/blob/hash/range; allocation and missing-feature summaries use supplied structural values; search pagination renders at most 100 rows (50 by default); stale selection and partial inventory are explicit.
- **Safety:** fixture route uses the existing local-only E2E gate; UI tests made zero `/api/` requests; no provider, GitHub, storage or approval calls; no excluded-source preview; credential-like filename copy explicitly says it is a path rule, not a content finding.
- **Scope exclusions:** shared `EvidencePanel`, inventory schema, workspace composition, provider and API files were not changed. The existing import route still uses the prior panel until final assembly wires this module through the owning workspace boundary.
- **Integration:** see [integration.md](../../../src/components/github-import/context-evidence-ui/integration.md) for the adapter map, missing unsafe-path metadata contract and assembly requirements.
- **Known limitation:** the current inventory builder drops unsafe paths before producing file records. Assembly must preserve a structured metadata-only exclusion record to list those paths; source must remain unavailable.

## Checks run

- `npm run typecheck` — passed.
- Scoped ESLint on the component, route and task tests — passed.
- `npx vitest run tests/unit/github/context-evidence-ui/model.test.ts` — 8 passed.
- Task Playwright harness — 6 passed, including optimized production build, full-bundle replacement, empty/stale states, 10,000-file search/pagination, keyboard operation, reduced motion and no horizontal overflow.
- Prettier check and `git diff --check` — passed.

The repository's standard Playwright startup limit expired during the first optimized build. A task-scoped config raises only this harness's startup allowance; the shared Playwright config and timeouts are unchanged.

## Rendered evidence

Captured from the mixed inventory fixture in both themes at 1440×900, 1024×768, 768×1024, 390×844 and 320×740. The test asserts no horizontal page overflow at each width.

- Light: `light-1440x900.png`, `light-1024x768.png`, `light-768x1024.png`, `light-390x844.png`, `light-320x740.png`
- Dark: `dark-1440x900.png`, `dark-1024x768.png`, `dark-768x1024.png`, `dark-390x844.png`, `dark-320x740.png`
