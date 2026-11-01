# Task 06 integration notes

## Acceptance record

- Problem: file/category scores over-rank thin wrappers, miss configured aliases, and do not reward new feature coverage against the already selected evidence set.
- Source root: `C:/Users/Ayush/Documents/ChatGPT/re_changer`.
- Base SHA: `bdaf1380ba99f6d7a80040574e0d788ff3b22d17` (the committed plan branch).
- Worktree: `C:/Users/Ayush/.codex/worktrees/github-context-task-06-local-ranking/re_changer`.
- Branch: `codex/github-context-task-06-local-ranking`.
- Owned implementation: `types.ts`, `graph.ts`, `ranking.ts`, and `index.ts` in this directory.
- Owned tests and fixtures: `tests/unit/github/context-ranking/` and `tests/fixtures/github/context-ranking.ts`.
- This is a non-UI module; no screenshots are applicable.

## Exported API

Import from `@/lib/github/context-ranking`:

- `buildDependencyGraph(projectMap, sections, options?)` returns a bounded, versioned graph with resolved, external, and unresolved edges plus diagnostics.
- `relatedImplementationTargets(graph, path, depth?)` traces wrapper chains without looping.
- `rankCandidates({ projectMap, sections, context, graph?, selectedSectionIds?, pinnedSectionIds? })` returns deterministic overall and role-specific rankings, named score components, reasons, per-role feature coverage, exclusions, and missing implementation features.
- `selectEvidenceCandidates({ projectMap, sections, context, graph?, pinnedSectionIds?, selectedSectionIds?, budget })` greedily admits candidates under the caller's token/file ceilings. A pin cannot bypass safety screening, explicit scope, duplicate handling, or either ceiling.

All inputs are structural task-local ports. `ProjectMap` carries already validated aliases and package boundaries; `ScreenedSection` carries a bounded excerpt, its safety decision, and repository/commit/blob provenance. This module does not fetch or persist repository content, inspect arbitrary configuration code, execute project code, call a provider, or write achievements.

## Scope and integration boundaries

- No Task 04/05 module is imported. Final assembly can adapt their project-map and screened-section outputs to these structural types.
- Test/spec paths are forced into the verification role even when incoming metadata labels them as implementation; their feature links cannot satisfy implementation coverage.
- The JavaScript/TypeScript scanner is a bounded tokenizer, not a compiler parser or a new runtime dependency. Other languages can provide parsed `staticImports`; when they do not, the graph reports that static parsing was unsupported and does not guess.
- `@/` and other aliases resolve only from a supplied, validated configuration mapping. Relative paths stay inside their package. Bare imports remain external unless a package boundary declares the workspace package.
- Thin-wrapper and implementation-depth signals are transparent heuristics based on excerpt structure and logic tokens. They are ranking evidence, not claims about runtime behaviour.
- Token cost uses the section reader's estimate when present and otherwise `ceil(excerpt characters / 4)`. It is a ranking estimate, not measured provider usage. Existing live caps remain the responsibility of bundle allocation/admission.
- Verification features are tracked under the verification role and never satisfy implementation coverage. This task does not choose the final overview/implementation/verification allocation; Task 07 owns that.
- `RANKING_WEIGHTS` and algorithm versions are versioned outputs. Calibration against held-out repositories remains a Task 10 evaluation activity; no learned ranker or embeddings are used.

## Synthetic fixtures and acceptance cases

The fixture set is entirely fictional. It covers:

- configured `@/*` and custom `~/*` aliases, relative/index imports, and declared workspace packages;
- absent aliases, unresolved imports, missing screened targets, unsafe paths, foreign revisions, and unreviewed/unsafe sections;
- import, re-export, static dynamic import, and `require` extraction while ignoring comment/string/template lookalikes;
- a wrapper chain with a cycle, a high-fan-in trivial helper, and a substantive implementation target;
- incremental feature coverage, duplicate content, separate overview/implementation/verification results, contribution-scope changes, and a suggested ML capability;
- unsupported-language fallback, fixed-cost estimates, shuffled input order, pins, and strict file/token budget admission.

## Checks

Commands and results from the final focused review pass:

| Command                                                                                                                                           | Result                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest run tests/unit/github/context-ranking/graph.test.ts tests/unit/github/context-ranking/ranking.test.ts`                                    | Pass: 19 tests across 2 files (the linked install reports Vitest 3.2.7)                                                                                                                                                                                                            |
| `eslint src/lib/github/context-ranking tests/fixtures/github/context-ranking.ts tests/unit/github/context-ranking`                                | Pass                                                                                                                                                                                                                                                                               |
| `prettier --check` on all owned implementation, fixture, test, and integration files                                                              | Pass                                                                                                                                                                                                                                                                               |
| Focused `tsc --noEmit --strict --skipLibCheck --target ES2021 --module ESNext --moduleResolution bundler src/lib/github/context-ranking/index.ts` | Pass                                                                                                                                                                                                                                                                               |
| `npm run typecheck`                                                                                                                               | Fails in the existing repository baseline because linked dependencies are missing `workflow`, `firebase`, `firebase-admin`, `@vercel/blob`, `jose`, and `@firebase/rules-unit-testing`; the installed Vitest config types also reject `oxc`. No Task 06 source diagnostic remains. |
| `git diff --check`                                                                                                                                | Pass                                                                                                                                                                                                                                                                               |

## Known limitations

- Ranking quality is not yet measured against the Task 10 held-out feature maps. The reason text and score components are intentionally inspectable so those weights can be compared and revised.
- The lightweight scanner handles common static JS/TS forms; computed imports, template-expression imports, dynamic configuration, and unsupported language syntax are not inferred.
- Wrapper detection can misclassify concise but substantive code or excerpts that omit surrounding logic. It emits signal labels and leaves final coverage reporting explicit.
- A supplied graph only describes safe sections within its configured bounds. Candidates omitted by that bound are reported as `not-a-candidate`; integration should retain diagnostics instead of presenting a complete graph.
