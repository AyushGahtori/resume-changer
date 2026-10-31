# Task 02 acceptance and integration notes

## Worktree record

- Plan: `docs/github-context-redesign-implementation-plan.md`
- Common `PLAN_BASE_SHA`: `bdaf1380ba99f6d7a80040574e0d788ff3b22d17`
- Planning checkout: `C:/Users/Ayush/.codex/worktrees/github-context-redesign-plan/re_changer`
- Managed worktree manager required `sourceRoot` to be inside the chat's workspace roots. The task worktree was therefore created from `C:/Users/Ayush/Documents/ChatGPT/re_changer` at the exact plan SHA above; no uncommitted files were copied.
- Branch: `codex/github-context-task-02-interview-ui`
- Returned absolute workspace path: `C:/Users/Ayush/.codex/worktrees/github-context-task-02-interview-ui/re_changer`

## Problem and owned files

The current import flow asks for a contribution statement without a separate adaptive interview, continuously available notes, or a user-editable answer review. This module gives the import flow an isolated UI that keeps project purpose separate from ownership and contribution.

Owned implementation and verification files:

- `src/components/github-import/context-interview/**`
- `src/app/e2e/github-context-interview/page.tsx` (local-only fixture route, hidden unless the existing GitHub import harness guard is enabled)
- `tests/unit/github/context-interview-ui/**`
- `tests/e2e/github-context-interview.spec.ts`
- `tests/fixtures/github/context-interview-ui/**`

## Exported API

`ContextInterview` accepts a `ContextInterviewPort`, optional context-revision callback, optional screenshot-panel slot, and optional class name. The port exposes `getSnapshot`, `submitAnswer`, `updateNotes`, `goBack`, `editAnswer`, `beginReview`, and `resume`. Port responses are validated before rendering. The component publishes monotonically increasing context revision events when a structured answer, answer draft, custom detail, or notes change.

The question contract requires exactly four normal options and one distinct custom option, supports single and multiple selection, and carries stable node IDs and catalog version. The UI validates 500 Unicode code points for custom detail and notes. The scripted port is test-only and is not imported by the production component.

## Scope exclusions

- No Task 01 question catalog or graph engine is implemented or imported.
- No existing workspace composition, shared GitHub contracts, API dispatcher, provider interface, or package manifest is changed.
- No repository data, answer text, or screenshots are written to browser persistent storage.
- No AI/provider call is made. Screenshot processing remains Task 03's responsibility; `attachments` is only a slot for a later independently built panel.
- This module does not approve or prepare evidence. The surrounding integration must invalidate any existing approval when it receives a context revision event.

## Exact fixtures

- `tests/fixtures/github/context-interview-ui/transcripts.json`: 5-question developer/tool, 7-question web, and 10-question data/ML transcript lengths; adaptive target lengths; limits; expected provider-call count of zero.
- `src/components/github-import/context-interview/testing/scripted-port.ts`: branch-aware in-memory port, whole-project ownership choice, solo/team distinction, overlapping multi-select choices, skip, purpose clarification, stale branch pruning, route shortening/lengthening, retry failure, slow response, empty route, and expired session with a retained answer.
- `src/app/e2e/github-context-interview/page.tsx`: gated fixture route using the existing `isGithubImportHarnessEnabled` check. It is not accessible in hosted Preview/Production.

## Safety and accessibility checks

- The component makes no network request directly and contains no provider API.
- Question and snapshot data are bounded and validated before display; IDs, option shape, question count, notes, and custom answers are checked.
- Notes and answer drafts live in React memory only. The browser history marker contains only an ephemeral session identifier and step metadata, never answers.
- Whole-project ownership is a normal structured answer and does not require a custom essay.
- Native radio groups provide arrow-key selection. Multi-select uses checkboxes. Navigation focuses the new question heading. Progress uses question counts, never a fixed percentage. Branch changes are politely announced.
- Motion uses 180 ms question, 120 ms choice, and 210 ms panel transitions with no movement above 8 px. Reduced-motion removes directional movement and progress/selection animation.
- Desktop uses interview and notes cards side by side at 1,024 px and above; smaller layouts stack in reading order. Controls have 44 px minimum targets.

## Integration instructions

1. Implement Task 01's engine adapter against the exported structural types; keep the catalog and graph engine in Task 01's owned module.
2. Mount `ContextInterview` in the later import-flow assembly. Supply a stable port instance for the active, tab-held interview session.
3. Map its structured answers to `project-context-v1`, preserving user-reported provenance. Keep the optional purpose detail supplemental to the purpose choice and keep ownership as a separate answer.
4. On every `onContextRevisionChange` event, invalidate prepared evidence and any previous exact-evidence consent. Re-prepare and request consent after edits.
5. Pass the Task 03 screenshot panel through `attachments`; keep its state separate from the question catalog and notes.
6. Keep interview progress separate from evidence-preparation and analysis status. The component has a separate explanatory panel for those later stages.

## Verification record

Passed checks in the task worktree:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/github/context-interview-ui/contract.test.ts
# 1 file passed, 9 tests passed

node_modules/.bin/tsc.cmd --noEmit --strict --skipLibCheck --jsx preserve --moduleResolution bundler --module esnext --target ES2017 --esModuleInterop --resolveJsonModule --lib dom,dom.iterable,esnext --types node,react,react-dom next-env.d.ts src/components/github-import/context-interview/types.ts src/components/github-import/context-interview/contract.ts src/components/github-import/context-interview/context-interview.tsx src/components/github-import/context-interview/index.ts src/components/github-import/context-interview/testing/scripted-port.ts src/components/github-import/context-interview/testing/harness.tsx src/app/e2e/github-context-interview/page.tsx tests/unit/github/context-interview-ui/contract.test.ts tests/e2e/github-context-interview.spec.ts
# Passed: task-owned TypeScript files

node_modules/.bin/eslint.cmd src/components/github-import/context-interview src/app/e2e/github-context-interview/page.tsx tests/unit/github/context-interview-ui tests/e2e/github-context-interview.spec.ts
# Passed

node_modules/.bin/prettier.cmd --check src/components/github-import/context-interview src/app/e2e/github-context-interview/page.tsx tests/unit/github/context-interview-ui tests/e2e/github-context-interview.spec.ts tests/fixtures/github/context-interview-ui/transcripts.json
# Passed
```

The repository-wide `npm run typecheck` and the browser suite were attempted but could not complete because the available shared `node_modules` tree is missing existing application dependencies (`firebase/*`, `firebase-admin/*`, `@vercel/blob`, and `jose`). Playwright's web server failed during the app's initial typecheck before any browser test ran. The new browser suite is configured to capture opening, mid-branch, notes, and review screenshots when run with a complete dependency install; no screenshots were produced in this environment.

Known limitations: this is a standalone UI module with a scripted port; the final adaptive catalog, context serialization, real import-flow integration, and consent invalidation adapter belong to other tasks/final assembly. Browser-level interaction, motion, responsive layout, and screenshot assertions remain to be run after restoring the complete repository dependencies.
