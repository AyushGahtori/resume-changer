# Gate C integration plan and review

Scope: integrate Tasks 21–30 with the Tasks 1–20 backend on `phase-one`; keep `main` and Production unchanged. Deliver the documented one-page import workflow and verify its real browser/API/storage boundaries. Original task worktrees remain untouched.

## Progress

- [x] Read all ten referenced task chats and Batch C requirements.
- [x] Import 55 task-owned source/test/handoff files; preserve original screenshots in their worktrees for comparison.
- [x] Identify controller defects: duplicate status streams, draft/import version confusion, empty PR list, placeholder fallback UI, blocked first save, missing inline metric confirmation and persisted-answer restoration.
- [x] Fix controller, shared status, PR loading, measurements and final save contracts.
- [x] Verify the assembled browser/API/worker/approval journey with fictional external boundaries; test consent, Back versus cancellation, scope changes and stale-version rejection. Safe OAuth return destinations have route regressions.
- [x] Prepare read-only Preview App registration and document server prerequisites in `github-app-setup.md`. User chose a new App; secrets must never be pasted into chat.
- [ ] Configure and verify a real App exchange, encrypted vault and hosted durable worker/persistence adapters. Registration alone does not implement those bindings; the hosted default remains unavailable.
- [x] Audit the assembled setup and expanded review in both themes at 1440/1024/768/390/320px. Check horizontal overflow and inspect rendered screenshots; related browser cases cover errors/expired notifications.
- [x] Run focused/full tests, lint, typecheck, production and worker builds, browser checks and formatting.
- [x] Push batch integration `81e83b2` to `phase-one` and verify its READY Vercel Preview (sign-in 200, harness 404, unauthenticated API 401).
- [ ] Push the follow-up hardening and verify its matching Preview and CI checks.

## Feature acceptance

Personal project → authorized repository and pinned revision → contribution/PR scope → prepared safe excerpts → explicit consent → durable background analysis → one library notification → editable cited drafts → optional locally calculated measurement → explicit contribution/metric confirmation → atomic save of selected achievements. Back, cancellation and discard remain distinct. Nothing changes the current resume automatically.

A fixture-only success is not a live GitHub connection. Missing credentials or hosted worker configuration must remain explicit, and final delivery must distinguish those setup requirements from verified application behavior.

## Integration corrections

- Tasks 24 and 27 mirrored frozen contracts locally; the controller now passes the real components' checked props and actual evidence/context instead of placeholder copies.
- Library attachment, expired-result and progress links now resolve to the actual `/library/github/new` or `/library/github/[importId]` pages.
- The shell owns one status subscription. The current import registers a listener on that subscription, and route changes remove that listener. Tests verify fan-out without a second stream.
- Draft mutations use the import's optimistic version, not the draft's version. Saving several local changes refreshes that version between writes. Local readiness allows the first save after confirmation; server eligibility is still required after persistence.
- Back preserves unsaved text in bounded session storage under the authorized namespace/import identity. Server updates cannot be hidden by a clean local override. Text edits invalidate confirmation.
- PR candidates come from a re-authorized, pinned server scope through the bounded PR reader. The route rejects browser-supplied alternate owners/URLs. The extraction scope permits three selected PRs, even though the candidate list can be longer.
- Answers and measurement results reload from trusted persisted state. Optional questions expand inside the corresponding draft. Exact local previews require an explicit insertion action and a new contribution confirmation.
- Changing, skipping or deferring an inserted measurement removes its old rendered clause and clears confirmation. Asynchronous answer failures preserve the prior answer and never report deferred help as saved.
- The controller renders one set of functional components, one discard confirmation and no duplicate save-error announcements. Theme aliases, responsive layout, real revision/run metadata and missing-data labels are wired to their actual values.
- OAuth resumes only allowlisted import destinations; external/open redirects are rejected. Local loopback aliases are accepted only at the same protocol/port, while hosted origin checks remain strict.

## Verification evidence

### Follow-up findings from CI and repeated Windows journeys

- Disabled shell subscriptions when no real runtime is configured and in demo mode; reset activity on account changes. This fixes unrelated home/library browser regressions caused by background 503 responses, without masking failed requests in tests.
- Restored Task 21's HTML fixture omitted by the original source-file copy filter. Scoped the fixture selector's minimum width so native select sizing cannot overflow the 320px test viewport.
- Repeated separate-process runs exposed Windows `EPERM` during atomic replacement of staged JSON. Bounded reads and atomic rename now retry transient Windows sharing errors for at most 1.27 seconds; it never deletes the existing target. Permanent failures preserve old state and remove the temporary file. Deterministic tests cover recovery and exhaustion.
- A separate regression forces seven-byte filesystem reads: the reader now assembles all chunks within its original size bound and rejects truncation/growth. Both new read cases failed before the correction and pass afterward.
- The assembled browser journey now also fails on any GitHub API error response, including an error recovered by later polling.
- Final clean production/worker build: passed. Ten consecutive assembled separate-worker journeys: **10 passed with zero GitHub API error responses**. Temporary exception logging was removed before this run.
- Responsive component suite: **19 passed**. Home/library/controller/notification regressions: **32 passed**. Lint, typecheck, formatting and worker build/start/shutdown smoke passed.

- Full suite after integration: **1,257 passed, 3 optional live tests skipped**, across 140 files (`npm test -- --maxWorkers=2`).
- Original related browser run: **8 passed**: actual worker journey, controller consent/scope/save/conflict/cancel cases, library notifications and harness registration.
- Twenty assembled-page captures cover setup and expanded review, both themes and all five target widths, with no horizontal page overflow. Captures are generated under ignored `.runtime/github-gate-c/` and uploaded by the dedicated CI job.
- New regressions cover PR authorization, new App settings, first-save readiness, stale local overrides, safe OAuth return paths, local-origin isolation, metric invalidation and asynchronous failure feedback.
- The synthetic backend is gated by local mode, explicit test flags, a dedicated temporary root and a Vercel exclusion. It substitutes external GitHub/AI responses only; real internal stores, selection, extraction validation, queue, separate worker and approval writer run.
- Test work is sequenced on this machine: an earlier simultaneous Next build/full-suite run caused timeouts. The final full-suite run passed with bounded concurrency, without increasing the existing backend test timeouts.
- Production/worker build, startup smoke, lint, typecheck and formatting passed. The reproducible `npm run test:github-journey` command also passed after its own isolated production build (1 assembled browser journey). Preview verification follows the branch push.

## Delivery boundary

All three batches are assembled on `phase-one`, based on `ccd8b8b` for this batch. Original task worktrees are unchanged. `main` and `origin/main` were verified at `4fc28cd`; neither is a merge target here. The final push updates only `phase-one` and its Preview.

The feature is verified with synthetic external boundaries. A live GitHub import, production rollout, hosted background execution and multi-account live acceptance are **not** claimed. The missing bindings above remain required before enabling the feature on Vercel.
