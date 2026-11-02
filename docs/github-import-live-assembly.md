# GitHub import live assembly — 1 November 2026

## Problem confirmed

The `phase-one` deployment at `839649e` included the independent interview UI and graph engine, but `ImportWorkspace` still rendered the legacy contribution textarea. Standalone module tests could pass without testing the actual `/library/github/new` journey. The real setup page now mounts `ContextInterview` with the real catalog adapter, rather than the scripted fixture.

A second confirmed defect affected analysis diagnostics: `extractRepositoryAchievements` called the Gemini transport without the SDK-error classification used by the other provider methods. Raw HTTP rejection/timeout errors consequently became generic domain upstream errors and could be normalized to an uncertain interruption. The specific provider exception behind import `73a2b030-4cd5-45c4-8ad0-513ecf646c06` remains unconfirmed; the old deployment did not record it.

## Changes

- Drive the real setup page with adaptive questions, answer review/editing, separate bounded notes, existing reduced-motion and keyboard behavior. Preserve the port while the tab moves between setup and preparation.
- Carry the versioned `projectContext` through scope validation, selection/context identity, preparation and the extraction input. Keep ownership user-reported; it is not evidence of authorship.
- Clear exact-evidence consent on any interview revision. Uncommitted answer/notes drafts cannot reuse the old contribution summary. Applying notes after answer review explicitly commits the notes before preparation.
- Classify SDK errors at the extraction provider boundary. Report known configuration, request-format and quota failures distinctly. A timeout stays outcome-unknown and does not trigger another paid request automatically.
- Preserve the job's safe domain failure through the session stream instead of replacing every failure with generic copy. The sidebar no longer calls an interrupted/failed attempt unstarted preparation.
- Record allowlisted stages, provider error codes, numeric HTTP status, elapsed time and hashed correlation IDs. Do not log exception messages/stacks, source, prompts, credentials, answers, account IDs or URLs.
- Keep the diagnostic implementation usable by an ordinary Node worker; the Next-only entry retains its `server-only` guard.

## Verification scope

The actual import-page browser journey uses real UI/session/service code with synthetic GitHub and provider boundaries. It covers answering the real catalog, preparing evidence, explicit consent, draft review, confirmed save, reload disposal, incomplete evidence, zero drafts, and provider denial. The independent interview browser suite covers branch changes, custom answers, notes, back/forward navigation, keyboard/motion and responsive layouts. These offline checks do not establish that the deployed provider accepts a real analysis request.

Vercel request history confirms the owner's 11:21 UTC attempt reached `/api/github/session` on deployment `dpl_8ivJH5wbPvhKXMNfe4pZ6NxgQp8u`. HTTP 200 is the stream envelope status, not an analysis-success result. Runtime logs had no underlying error for that attempt. A read-only provider model check via `vercel env run` could not run because Preview Secret values are intentionally unavailable to that CLI command. No secret was printed and no paid provider request was made.

## Remaining redesign boundaries

This change does not claim that every merged standalone module is assembled. The new discovery, expanded section reader, ranking/bundle allocator, optional screenshot transport and replacement evidence inventory still require their production adapters and full-flow acceptance. In particular, this patch does not claim whole-project coverage or that the old 12-file selection strategy has been replaced. Keep `github-context-merge-review.md` as the integration inventory, and verify those adapters separately before calling the entire redesign complete.

A fresh owner-approved analysis on the diagnostic deployment is required to establish the exact deployed provider failure. Do not silently replay an uncertain paid attempt, infer success from the stream's HTTP status, or call the provider problem fixed from mock-provider tests.

## Validation results

- Unit suite: 1,495 passed; 3 existing skips across 173 files.
- Lint, TypeScript and formatting checks passed.
- Ordinary Node worker build/start/unavailable/shutdown smoke passed.
- The final optimized browser build passed all six actual-page integration cases, including restored interview answers and a classified provider rejection. The independent interview suite passed all eleven cases in the preceding run.
- A broader attempt also ran the legacy `github-task-30.spec.ts` suite. Its three old controller fixtures returned `No mock route` for `/api/github/session`; they still mock direct import/job polling and assert durable reload recovery. Those fixtures predate the tab-owned NDJSON redesign and are not the acceptance harness for this patch. They were left unchanged rather than disabling or rewriting them to hide the failure. The two connection-recovery cases passed with the temporary interview-aware test helper. The current acceptance suite is `github-integrated-backend.spec.ts`, which exercises the actual session backend and asserts reload disposal.
- No paid model request was executed by the agent. A deployed owner's request is still needed for the real provider failure trace.
