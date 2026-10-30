# GitHub Integration: Session-Based Import Project Plan

Date: 30 October 2026. Status: implementation backlog; no task is complete yet.

## 1. Project Summary

Replace the GitHub import's durable background-processing model with a tab-owned, temporary evidence workspace. The user connects GitHub, chooses one repository and pinned revision, describes their contribution, reviews selected evidence, explicitly consents to analysis, reviews proposed achievements, and explicitly saves chosen points to their existing Achievement Library project.

Retrieved source, prepared excerpts, unsaved drafts and review choices belong to the current import session. Reloading or closing the tab abandons them. Users do not need to recover this material tomorrow or receive a background completion notification after leaving. Approved achievements remain saved normally. Never treat repository access as proof that the user authored every change.

Nine tasks are sufficient as nine reviewable work packages. They are not nine independent changes that can all be implemented simultaneously. Follow the dependency table and the baseline gate below.

## 2. Why This Work Is Needed

The previous live investigation established these defects:

- A commit-metadata request received HTTP 200 but timed out while reading its body at 10,000 ms. Fifty checkpoint operations consumed 9,760 ms. Repeated remote persistence inside stream accounting blocked the reader before AI analysis began.
- The browser expects a full job record where the preparation endpoint returns an HTTP 202 acceptance receipt containing `jobId` and `statusUrl`. A valid acceptance is classified as an invalid response.
- Request history shows a successful selection update and accepted preparation followed by an overlapping selection update rejected with 409. The Retry control has no submission guard. The logs establish overlapping requests, not the browser gesture responsible for them.
- Restoring a budget snapshot with an unfinished HTTP reservation can block the replacement worker with `http-request-in-flight`. Job lease recovery does not reconcile that reservation.
- File contents fetched earlier in a batch are cached only after the entire batch succeeds. A later failure can waste completed downloads.
- The existing persistence design retains repository source and staged evidence even though the revised product does not require recovery after reload.

Relevant investigation reference: `phase-one` application baseline `962df5c17bd71ba939be2bdce4a10412dca7423c`; diagnostic-only follow-up `ff3ee210709a349c00b230b4942e830592721624`. These are historical references, not instructions to reset any checkout or blindly import an entire branch.

## 3. Product And Architecture Rules

1. The browser owns the import session and its bounded memory cache. Server requests own temporary request memory. A global server `Map` is never an authoritative shared cache across Vercel instances.
2. Do not persist retrieved source, excerpts, inventories, unsaved generated text or review state to Firestore, localStorage, sessionStorage, IndexedDB, browser Cache Storage, object storage or Workflow payloads/results. Do not put them in logs or analytics. A deliberately introduced shared source cache requires a new product decision; it is outside this plan.
3. Keep Firebase authentication, account isolation, saved achievements and secure GitHub credential storage. Removing source staging does not mean removing Firebase from the application.
4. Small source-free records may remain for authoritative rate limits, paid-operation deduplication and atomic achievement-save receipts. Task 01 must specify their fields, bounds and expiry. Do not use this exception to recreate the import document or store AI responses.
5. GitHub tokens, App private keys and AI credentials stay on the server. Browser memory may contain authorized source, never those credentials.
6. Keep the current source-safety checks, repository access checks, pinned revisions, bounded parsing, contribution context, exact-evidence consent, output validation and explicit save confirmation.
7. Use one browser coordinator per import session. Start with one GitHub download at a time. A bounded two-download mode is a measured experiment in Task 04, not permission to enable unbounded parallel requests.
8. Reload creates a fresh import session. Retain session data across ordinary internal navigation only while the same tab session owner remains mounted. Account changes, explicit discard and completion must release relevant memory and reject late results. Browser termination may happen without a cleanup callback; expiry must cover server-side metadata.
9. Client cancellation is best effort for an already submitted provider request. Do not promise that closing a tab instantly stops remote computation or deletes provider-held data. Do not automatically repeat a paid call whose outcome is unknown.
10. The server must distrust browser-held payloads. Returning evidence to the browser does not make it trusted when uploaded again. Bind authorized evidence and model output to the account, repository revision, selection and expiry using a reviewed integrity contract.
11. Keep this separate from JD analysis and resume tailoring. Do not change the current resume automatically.

### Proposed Data Placement

| Data                                                             | Owner and lifetime                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Active downloads, counters, completed screened files             | Bounded browser/server request memory; no source persistence |
| Prepared excerpts, consent, unsaved AI output, review choices    | Current browser import session                               |
| Credentials                                                      | Existing secure server-side credential storage               |
| Rate-limit counters and deduplication receipts                   | Minimal source-free server metadata with bounded retention   |
| Explicitly approved achievements and small provenance references | Existing account-owned Achievement Library                   |

Drop full downloaded files once they are no longer needed; retain only the current excerpts required for review. Clear unsaved source and drafts on discard, successful completion, account change or reload. Memory cleanup means releasing references; do not claim instantaneous secure erasure by JavaScript garbage collection.

## 4. Mandatory Worktree And Delivery Workflow

**Every task must create its own separate worktree from the latest `origin/main`.** Never implement a task in the primary checkout, in another task's worktree, or directly in `main`. Each task below repeats its branch name and this requirement.

At authoring time, local `main` and `origin/main` were `4fc28cd`, while the assembled GitHub implementation was on `phase-one`. A fresh worktree from that main baseline does not contain the feature. Task 01 must establish the reviewed baseline prerequisite before dependent tasks start. Do not silently start from `phase-one`, duplicate the feature from scratch, or cherry-pick the whole feature into every task branch.

For each task:

1. Inspect repository instructions, local changes, existing attachments and branch state. Preserve unrelated files and other developers' work.
2. Fetch `origin/main`. Prefer the managed worktree tool to create a new worktree with `ref: origin/main`; use its returned directory explicitly. Create the task's named `codex/` branch there. Do not update or reset the user's primary checkout to accomplish this.
3. Record the starting main SHA and verify required earlier tasks are already reviewed and merged into main. If they are absent, report that prerequisite and do not work around it with a different base. Independent tasks may proceed together only after their shared prerequisites have landed.
4. Read the task, linked contracts and relevant implementation/tests. File paths in this plan describe the historical feature branch; locate moved modules after baseline integration.
5. Implement only the assigned scope. Agree contract changes through Task 01's contract document. Do not invent alternate local DTOs or disable security/budget checks to get tests green.
6. Use synthetic repositories, accounts and provider responses in automated tests. Never copy personal resume data, real private source, OAuth codes or secrets into fixtures.
7. Run formatting, lint, typecheck and unit/integration checks. Add the relevant browser, account-security, build and worker checks listed in the task. Run expensive suites/builds sequentially on this machine.
8. Review the diff. Deliver a focused commit/PR and a handoff naming base SHA, changed contracts, commands/results, screenshots where relevant, limitations and live-verification status. Creating this plan does not itself authorize merging PRs or promoting Production.
9. Keep implementation testing in local environments and the authorized Preview. No billing upgrades, new paid services, production migrations or destructive legacy-data cleanup are implicitly authorized.

Expected commands, where present in the integrated baseline:

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e -- <relevant-specs>
npm run test:security
```

Do not run live paid-provider tests or change their configuration merely to satisfy a synthetic test gate. Record genuinely unavailable checks rather than claiming they passed.

## 5. Dependencies And Ownership

| Task | Work package                                                         | Must follow                     |
| ---- | -------------------------------------------------------------------- | ------------------------------- |
| 01   | Reviewed baseline and session/API contracts                          | None; establishes baseline gate |
| 02   | Browser session owner and memory cache                               | 01                              |
| 03   | Request-scoped GitHub reader and evidence integrity                  | 01                              |
| 04   | Completed-file reuse, request ownership and bounded concurrency      | 02, 03                          |
| 05   | Foreground AI analysis, consent and duplicate protection             | 01, 03, 04                      |
| 06   | Browser/API agreement, retry, cancellation and progress              | 02, 04, 05                      |
| 07   | Temporary review and explicit durable achievement save               | 05, 06                          |
| 08   | Legacy source-persistence retirement and safe cutover                | 02–07                           |
| 09   | Integrated acceptance, performance, privacy and Preview verification | 01–08                           |

## 6. Implementation Tasks

### Task 01: Establish The Reviewed Baseline And Freeze Session Contracts

**Required workflow:** create a new separate worktree from current `origin/main`, then branch `codex/github-session-01-contracts`. Record its main SHA. Read `docs/project-plan.md`, this plan, `docs/github-app-setup.md`, the historical GitHub gate documents and the feature branch read-only. Do not start the task worktree from `phase-one`.

**Why:** later tasks cannot share an implementation if main lacks it, and a browser cache cannot safely replace a database without agreeing lifecycle, trust and API rules first.

**Implementation guidance:**

1. Inventory the difference between main and the existing feature, including OAuth/runtime fixes. Propose the reviewed feature baseline needed on main. Preserve the proven connection fixes; do not import diagnostic logs or obsolete durable semantics indiscriminately. Any baseline merge remains a reviewed prerequisite, not an automatic action.
2. Write `docs/github-session-contracts.md` and define shared Zod DTOs/types once the baseline gate is satisfied. Cover session ID, operation ID, pinned repository identity, selected evidence, integrity proof, consent, analysis result, review edits, final save and safe errors.
3. Define states such as choosing, fetching, evidence-ready, analyzing, reviewing, saving, complete, cancelled and failed. Mark which transitions invalidate evidence or consent and how stale responses are rejected.
4. Specify endpoint paths, request/response schemas, status codes and the owner of each operation. Prefer direct request results/streams for the new foreground flow. If any endpoint returns 202, define an acceptance-receipt schema and its supported status-read mechanism; never validate it as a full job record or invent cross-instance memory polling.
5. Specify signed evidence/result envelopes or an equivalent reviewed integrity design, including account binding, canonical hashing, purpose, schema version, key management, expiry and replay boundaries. Keep source outside durable metadata.
6. Define authoritative source-free rate-limit, AI-operation and save receipts; include unknown-outcome handling and expiry. A client counter alone cannot enforce account-wide limits.

**Tests and review:** schema success/failure cases, producer/consumer contract checks, tampered identities, oversized payloads and illegal state transitions. Review endpoint/ownership tables with later implementers before starting their tasks.

**Done when:** the baseline prerequisite and merge decision are recorded; shared contracts and a storage allowlist are reviewed; dependent tasks can begin from main without copying missing code. Handoff includes the actual baseline SHA and contract version.

### Task 02: Build The Browser-Owned Import Session And Bounded Memory Cache

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-02-memory-owner`, and verify Task 01 and its baseline are on main. Do not reuse Task 01's worktree or branch.

**Why:** completed downloads and unsaved drafts should survive a recoverable request failure inside the open session, without writing private source to a database or browser disk.

**Read first:** the session contracts, `src/components/github-import/use-import-workspace.ts`, workspace state helpers, import pages and the shell/status provider.

**Implementation guidance:**

1. Create one session owner above the relevant import views. Keep it separate from component render lifetimes so switching internal steps does not recreate the cache.
2. Key cached content by account/session, repository identity, immutable blob/revision identity and parsing/safety version. Apply path-dependent checks even when identical content is reused at another path.
3. Define bounded cache entries for pending, complete and failed reads. Pending consumers share one promise; complete entries are immutable. Do not cache an error permanently or let rejected promises poison future retries.
4. Enforce total byte limits and eviction rules; protect content currently used by analysis/review. Release full files when only excerpts are needed. Avoid unnecessary copies into every component or worker.
5. Reset on reload, discard, account change and completed import. Use an incrementing session generation and abort controllers to reject late results from the previous session. Do not rely on unload callbacks for correctness.
6. Remove source/draft disk persistence for the new flow. Keep saved achievements intact. Do not use module-level server state as a substitute for this owner.

**Tests:** internal step navigation preserves cache; real page reload does not; account switch cannot expose the prior account's source; pending requests deduplicate; failed entries retry; eviction respects active references; late completion after discard is ignored. Inspect browser storage for synthetic source sentinels.

**Done when:** the session/cache API is usable by Tasks 04–07 with documented ownership and cleanup. Handoff includes memory limits, invalidation behaviour and browser coverage.

### Task 03: Replace Durable Stream Checkpointing With A Request-Scoped GitHub Reader

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-03-reader`, after Task 01 is merged. Read the contract before editing; coordinate interface changes through that contract.

**Why:** the reader currently waits on remote persistence while consuming tiny chunks, exhausting a network-request timeout even after GitHub returns 200.

**Read first:** `server/client-core.ts`, `inspection-ports.ts`, `hosted/network.ts`, `budget-port.ts`, `backend-runtime.ts`, repository inspection and file-safety modules under `src/lib/github/`.

**Implementation guidance:**

1. Provide authenticated, account-bound read/preparation endpoints for the session flow. Keep GitHub credentials on the server and recheck current repository access before serving content.
2. Make byte/size accounting immediate and in memory during a response. Remove awaited Firestore checkpoints from wire-byte and decoded-byte handling. Preserve conservative reservations, hard limits, cancellation and request/operation deadlines; do not merely increase the ten-second timeout.
3. Separate network time from bounded admission/coordination work in diagnostics while retaining an overall deadline. No per-chunk database write or progress-log stream is allowed.
4. Retain trusted-host/DNS pinning, redirect limits, content-encoding rules, immutable revision checks, UTF-8 handling, file exclusions and content screening. Never execute repository code.
5. Return only bounded authorized data needed by the tab. Bind screened content/excerpts to Task 01's integrity envelope so a later browser upload cannot substitute arbitrary source or another account's evidence.
6. Record stage, safe failure category, elapsed time and byte counts without response bodies, private paths, source, secrets or raw exceptions. Prevent HTTP/proxy caching of private responses.

**Tests:** reproduce a chunked response with slow coordination; prove consumption no longer incurs per-chunk persistence. Test cancellation, fragmented UTF-8, oversized streams, hostile paths/redirects, expired access, wrong revisions, tampered proofs and unavailable GitHub. Exercise the real network adapter with synthetic transport boundaries rather than only one-chunk JSON fixtures.

**Done when:** a modest successful GitHub response completes independently of checkpoint latency, with all safety limits preserved and no source-bearing Firestore write. Handoff includes before/after timings and persistence-call counts.

### Task 04: Preserve Completed Files And Coordinate Retries And Parallel Reads

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-04-downloads`, only after Tasks 02 and 03 are merged. Never implement this in either dependency's worktree.

**Why:** completed files are currently lost when a later batch member fails, and stale HTTP reservations can prevent recovery. Parallelism must not multiply those problems.

**Read first:** the new cache/reader APIs, existing `service.ts` batch-fetch logic, `budget.ts`, `phase-one-core.ts` and the old lease-recovery path for comparison.

**Implementation guidance:**

1. Publish each fully downloaded, screened and integrity-verified file to the browser cache as soon as it completes. Do not wait for every file in the batch. Never mark partial bytes as a complete file or persist download chunks to Firebase.
2. Give one coordinator ownership of the session's queue. Track each content key as pending/complete/failed, deduplicate both queued and active requests, and let duplicate consumers await the same result.
3. On transport failure, retain completed entries and retry only missing/failed files. Discard incomplete bytes initially; byte-range resume is outside scope unless separately designed and tested.
4. Reconcile abandoned HTTP reservations on owner/request termination. Once an old owner is invalid, it cannot block the new owner forever. Account conservatively for possibly used resources; never mark a possibly sent request as definitely unsent just to free budget.
5. Keep one active download as the default. Add a bounded two-download experiment only if aggregate reservations, total-byte ceilings, rate-limit backoff and cancellation work correctly. The current ledger explicitly disallows simultaneous HTTP requests, so changing only the loop to `Promise.all` is insufficient.
6. Reserve aggregate allowance atomically before dispatch. Distinct downloads return separate immutable results; the coordinator applies them only to the current session generation. Do not hold a database lock across a download.
7. State the guarantee accurately: prevent normal duplicate reads and stale result publication. A crash may still cause a repeat GET; do not promise exactly-once external network delivery.

**Tests:** files A/B succeed and C fails; retry downloads C only. Duplicate references to a blob cause one fetch. Restore/abandon the stale-reservation case and prove further work proceeds within budget. Test cancellation/takeover, late responses, limits with two downloads and rate-limit backoff.

**Done when:** completed downloads are reused, abandoned requests cannot deadlock the session and parallel mode cannot overspend or overwrite results. Handoff reports measurements for one versus two downloads and recommends the default based on evidence.

### Task 05: Run AI Analysis From Verified Session Evidence Without Durable Source Staging

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-05-analysis`, after Tasks 01, 03 and 04 are merged. Do not base it on an unmerged feature branch.

**Why:** the model needs the current approved evidence, not a recoverable Firestore copy of the repository. Paid calls still require trustworthy consent and duplicate protection.

**Read first:** `server/extraction.ts`, extraction schemas/prompts, AI provider adapters, consent logic, existing model-output validation and Task 01's integrity/operation contracts.

**Implementation guidance:**

1. Accept the bounded selected bundle from the tab through an authenticated foreground endpoint. Verify account/repository binding, current authorization, signed evidence, hashes, schema/policy version, expiry and explicit consent before any provider call.
2. Treat source and user statements as untrusted evidence, not instructions. Retain exclusions, prompt-injection handling, source-pointer checks, token bounds and the distinction between user contribution and repository-wide changes.
3. Keep source and generated text in request memory only; return validated drafts and their review/integrity envelope to the tab. Do not write them into Workflow steps/results, Firestore, logs or hidden response caches.
4. Use a source-free operation receipt to prevent simultaneous or retransmitted requests from invoking the model twice. Define started/completed/unknown outcomes and expiry. If output is lost with the session, report that honestly; a receipt must not silently become a stored response body.
5. Do not retry uncertain paid requests automatically. Separate an unsent validation rejection from a provider request whose outcome is unknown. Make browser/server cancellation and its limitations explicit.
6. Preserve qualitative drafts and deterministic measurement semantics. No invented metrics, unsupported contribution claims or automatic library writes.

**Tests:** tampered excerpts/consent/proofs, revoked access, expired or cross-account bundles, malformed AI output, repeated submissions, cancellation before/after send, lost response and unknown provider outcome. Use the real endpoint/client contract with a synthetic provider and assert zero source-bearing durable writes.

**Done when:** reviewed session evidence produces validated proposed drafts without durable source staging, and duplicate calls cannot create unintended paid work. Handoff documents operation-receipt fields and unknown-outcome UX.

### Task 06: Align Browser/API Contracts And Make Retry, Progress And Cancellation Correct

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-06-controller`, after Tasks 02, 04 and 05 are merged. Keep unrelated page styling out of this task.

**Why:** the existing UI mistakes a valid acceptance receipt for an invalid full job record and permits overlapping retries, causing misleading 409 errors while work is actually running.

**Read first:** `src/lib/github/client.ts`, import HTTP handlers/facade, `use-import-workspace.ts`, `import-workspace.tsx`, `analysis-status.tsx` and their browser fixtures.

**Implementation guidance:**

1. Implement Task 01's exact endpoint schemas on both sides. For any retained 202 route, parse the short receipt and use its supported status mechanism; for direct/streamed endpoints, handle their actual result/progress contract. Remove assumptions that every submission returns a full durable job record.
2. Add an immediate submission guard before the first await and disable every equivalent trigger while submitting. React state updates alone are insufficient protection against closely spaced calls.
3. Distinguish fetching evidence, model analysis, reviewing and saving. A preparation error must not claim the AI failed. Display a safe actionable reason, retain completed cache entries and show which operation Retry will repeat.
4. Use session/operation identities to ignore older replies. Repeating delivery of the same operation must not create a new operation. An explicit retry after a known failure is a new bounded attempt.
5. Remove stale-version coupling to abandoned durable imports. Keep version checks required for real saved library records. On any remaining conflict, refresh the relevant state and preserve the user's current text rather than issuing blind mutation retries.
6. Cancel queue work and invalidate callbacks on discard/account change. Explain that reload loses unsaved import work; do not retain background-notification promises for this session flow.

**Tests:** actual handler receipts through the real browser client; rapid double click; two equivalent controls; keyboard repeat; accepted request followed by delayed response; stale callback; failed file retry; model unknown outcome; account switch; cancellation and reload. Replace fixtures that falsely return full job objects from receipt endpoints.

**Done when:** one user action creates one operation, successful acceptance is not displayed as an error, and the failure/progress copy matches the actual stage. Handoff includes browser screenshots and request-count assertions.

### Task 07: Keep Review Temporary And Save Only Explicitly Approved Achievements

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-07-approval`, after Tasks 05 and 06 are merged. Verify the account-owned library writer baseline before editing save behaviour.

**Why:** removing Firestore staging must not weaken evidence validation or turn proposed model text into permanently saved achievements without the user's confirmation.

**Read first:** achievement review components, workspace draft helpers, measurement modules, `src/lib/data/writers.ts`, library schemas and the new result/integrity contract.

**Implementation guidance:**

1. Keep draft text, rejected suggestions, local edits, measurement answers and selected IDs in the tab-owned session. Retain only excerpts still needed for review; release full files once safe to do so.
2. Implement the new explicit save request without looking up an old durable staged import. Validate the account, destination project, result envelope, source references and declared user edits. Do not trust browser-provided evidence/support flags or model-origin assertions.
3. Preserve user editing, contribution confirmation, qualitative skip and deterministic measurement calculations. An edit invalidates the appropriate confirmations; a numerical claim still needs valid support.
4. Save selected achievements atomically using existing account-isolated persistence. Save small provenance references such as repository, commit and source location under the agreed schema; do not copy raw source/excerpts or rejected drafts into saved records.
5. Use an idempotent save receipt so a lost save response cannot duplicate achievements. Retrying a confirmed save must not require another AI call. Keep unrelated project data unchanged.
6. Release session source/drafts after confirmed completion or explicit discard. On reload before save, start empty; on reload after save, the achievements remain in the library.

**Tests:** edited/unconfirmed/unsupported drafts, forged result/provenance, cross-account/project save, concurrent save, lost response, repeated save, atomic failure, no automatic save and exact saved-field inspection for source sentinels. Cover review/save in the browser and account isolation in the appropriate security suite.

**Done when:** the only durable content created by the new journey is explicitly approved library data plus allowed source-free receipts. Handoff lists saved fields and evidence that unsaved content is absent.

### Task 08: Retire Legacy Source Persistence And Cut Over Without Losing Saved Data

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-08-cutover`, after Tasks 02–07 are merged. Inventory consumers before removing modules; do not work directly in main.

**Why:** a new memory cache does not meet the product requirement if old routes, Workflow payloads, review storage or notification paths still persist repository content behind it.

**Read first:** hosted runtime/storage/owner adapters, `server/store.ts`, workflow modules, status and notification composition, build scripts, deployment config, browser draft persistence and existing integration documentation.

**Implementation guidance:**

1. Inventory every writer and reader of source, inventory, prepared selections, unsaved drafts and measurements, including local-mode adapters and test harnesses. Document each disposition: removed, rerouted to session memory, or retained for a separate feature.
2. Stop the session import from dispatching durable Workflow jobs or writing compressed staged-source documents. Remove obsolete recovery/status subscriptions and completion notifications for that flow. Keep JD/resume jobs and unrelated notifications working.
3. Preserve Firebase Auth, saved library records, encrypted GitHub credentials, connection configuration and approved source-free receipts. Do not delete whole internal collections by name without checking what they contain.
4. Show an honest restart message for old durable-import URLs. Do not hydrate their staged content into the new memory workspace silently or pretend it survived a reload.
5. Prepare a separate, bounded dry-run inventory/cleanup tool for historical source-bearing records if needed. Target the exact project/database/namespace, report counts without source, verify active jobs, preserve saved data and require explicit authorization for actual deletion. Do not execute cleanup as part of this task's ordinary validation.
6. Update the old GitHub plans/runbooks to distinguish historical architecture from the new rules. Remove temporary diagnostic instrumentation once equivalent safe operational diagnostics and regression coverage exist.

**Tests:** zero source persistence across the new complete flow; old routes cannot recreate staged-source records; credentials/login/library remain functional; unrelated background features still work; migration dry-run is non-mutating and bounded. Verify application/build configuration after retiring obsolete imports.

**Done when:** the live session path has no hidden dependency on durable source staging and historical-data handling is documented without unauthorized deletion. Handoff includes the storage inventory and any separately pending cleanup approval.

### Task 09: Verify The Full Session Journey, Failure Recovery And Performance

**Required workflow:** create a new separate worktree from latest `origin/main`, branch `codex/github-session-09-acceptance`, after Tasks 01–08 are reviewed and merged. Record the exact integrated main SHA; do not assemble an unreviewed pile of other task branches.

**Why:** the previous tests passed while the real hosted combination failed. Acceptance must exercise actual contracts, streamed bodies, cache lifetime and account boundaries together.

**Implementation guidance:**

1. Exercise connect → repository/revision → contribution → download → evidence review → consent → AI → draft edits → explicit save using real internal modules. Substitute only controlled GitHub/provider boundaries in automated runs.
2. Use fragmented 33.6 KB-class metadata and multiple file bodies, slow coordination and injected failures. Assert there are no per-chunk durable writes, completed files survive another file's failure, cancellation releases ownership and an abandoned reservation cannot block a retry indefinitely.
3. Test real reload, navigation, account change, two tabs, repeated submissions, duplicate content, late replies, rate limits, lost AI/save responses and unknown paid outcomes. Two tabs must not bypass authoritative limits or share private source inadvertently.
4. Run source-sentinel checks against every persistence/logging adapter and browser storage mechanism. Inspect allowed durable records, not merely whether the happy-path UI looks right.
5. Benchmark one and optional two downloads using the same fixed workload. Report network time, coordination time, request counts, cache hits, peak retained bytes and database operations separately. Declare thresholds before running; never hide a regression by inflating deadlines.
6. Run format, lint, typecheck, complete unit/integration tests, relevant security tests, production build and assembled browser coverage. Verify themes, keyboard operation and narrow viewports for changed states. Use fixtures matching real endpoint DTOs.
7. Deploy only to the authorized Preview and verify its commit. Live acceptance requires the owner's authenticated GitHub interaction and explicit consent for any real provider call. Confirm saved points and reload semantics there. Separate automated results from live results; missing live evidence remains an unchecked gate.

**Done when:** all automated criteria pass, the Preview evidence identifies the exact build and any remaining live acceptance is explicitly listed. Produce `docs/github-session-acceptance.md` with timings, screenshots, storage inspection results and known limitations. No claim of Production readiness or completed live analysis is allowed from fixtures alone.

## 7. Final Acceptance Checklist

- [ ] Each task has its own worktree created from main, a focused branch and a recorded prerequisite/main SHA.
- [ ] No repository source, inventory, excerpts or unsaved model output is durably persisted by the new flow.
- [ ] Reload/discard/account change invalidate the session; internal steps reuse current memory safely.
- [ ] Completed downloads are reused after partial failure; abandoned reservations cannot strand the session.
- [ ] Network-body consumption is independent of remote checkpoint latency.
- [ ] Optional concurrency preserves aggregate limits, cancellation, deduplication and authorized data boundaries.
- [ ] Browser and API agree on submission/result contracts; one action produces one operation.
- [ ] AI consent and submitted evidence remain verifiable; unknown paid outcomes do not cause automatic duplicate calls.
- [ ] Only explicitly selected, confirmed achievements are saved, with atomic and idempotent account-owned writes.
- [ ] Credentials, authentication and unrelated application features remain intact.
- [ ] Historical staged-source cleanup is reviewed separately and never silently destroys saved data.
- [ ] Automated and live Preview evidence are recorded separately; deployment and merge scope are respected.
