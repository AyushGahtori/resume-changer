# Session import acceptance

Integration scope: the owner selected the complete tab/session redesign on `phase-one`, reusing compatible work from the reviewed handoffs. No main/Production merge or historical customer-data deletion is included. Architecture and API details are in `github-session-contract.md`; the original task audit is in `github-task-integration-review.md`.

## Implemented work packages

| Plan task | Integration result                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01        | Preserved the assembled feature and connection fixes; documented versioned session/transport, trust, expiry and allowed durable records.                                                                                                      |
| 02        | Added a single tab-memory capsule owner, serialized requests, account/discard/completion cleanup and stale-result generation checks. Removed import draft sessionStorage writes.                                                              |
| 03        | Restored authenticated evidence into request-local memory; retained repository authorization, pinned SHA, safety/output/consent validators and server-held credentials.                                                                       |
| 04        | Cached each completed screened download immediately and streamed its capsule. New request ledgers never restore abandoned HTTP reservations. One download at a time remains the default; the optional two-download experiment is not enabled. |
| 05        | Ran analysis inline under exact-evidence consent; added atomic source-free admission receipts and daily quotas. Emitted an uncertain-attempt marker before the paid call; no automatic unknown-outcome replay.                                |
| 06        | Returned complete foreground DTOs consistently; added synchronous submission guards, disabled Retry while busy, propagated abort and rejected late results.                                                                                   |
| 07        | Kept temporary review/measurement data in the capsule and React memory. Explicit approval uses the existing atomic/idempotent account library writer; new saved evidence omits raw excerpts.                                                  |
| 08        | Blocked legacy background APIs, disabled background notifications, removed hosted source-store configuration/Workflow dispatch/owner lookup and failed old Workflow invocation closed. Existing historical records are preserved.             |
| 09        | Added session privacy/lifecycle, partial failure, duplicate admission, lost response and assembled browser tests. Automated status and live limitations follow.                                                                               |

This is one integration implementation in the attached isolated worktree, not nine independently merged session branches. The eight referenced submissions followed the older task definitions; only compatible code was reused. Their worktrees remain intact.

## Automated evidence

- Full unit/integration run: **1,318 passed, 3 skipped**, 155 files, 21.57 seconds. The three existing skipped tests were not counted as passing.
- New request-memory tests cover concurrent account isolation, serialized locks, bounds, ciphertext tampering, expiry and missing hosted integrity keys.
- New client tests cover serialization, completed-file checkpoint retention after truncated response, account reset, expired state, late replies after discard and no automatic lost-AI replay.
- Source-free receipt tests cover concurrent duplicate admission, conservative unknown admission after quota failure, account isolation, sixty-entry bound and expiry pruning.
- The real session HTTP/client/service/selector/extractor/measurement/save integration test intentionally fails a later blob fetch, retries without fetching the first completed blob again, exercises a restored in-flight analysis marker, and confirms save acknowledgement replay returns the same IDs. It verifies no GitHub source-store directories are written and new saved evidence contains no `excerpt` or raw synthetic implementation text.
- Synthetic fixed workload measurement: preparation **including the injected failed batch and retry: 168 ms**, five blob attempts total, first successful blob fetched **once**, five memory checkpoint events including analysis admission, **zero source-persistence calls**. These numbers are local fixture measurements, not GitHub/Vercel network latency or a hosted performance claim. No timeout was increased.
- Typecheck, full ESLint and changed-file formatting: passed during implementation; final check recorded before commit.
- Fresh optimized Next.js build and both Chromium journeys: **2 passed** (17.7 seconds for import/analyze/review/save; 1.7 seconds for prepare/reload/restart). The final run including the fresh build took 1.9 minutes. The reload test also caught and verified the fix for account initialization cancelling the first page request. The journey includes keyboard confirmation/save, both themes and 1440/1024/768/390/320px horizontal-overflow checks with screenshots in `.runtime/github-gate-c/`.

The storage proof is bounded to the new flow: source calls go through AsyncLocalStorage request memory; the assembled test inspects the isolated fixture directory and saved library. Credential/usage/approval writes remain intentionally durable. No claim is made that old staged source has already been erased.

## Remaining live gates and limits

- The local Firebase emulator security suite could not run because Java is unavailable (`java` is not on PATH). Existing account, authorization and storage unit tests pass; emulator verification must be recorded separately.
- Live owner-authenticated GitHub preparation, exact consent to a real model call, reviewed-point save and reload behaviour must be checked on the new Preview. Synthetic tests do not establish real provider success or production readiness.
- Request memory is capped at 4 MiB, capsules at 3,800,000 characters, and evidence expires after 20 idle minutes. Larger selections fail closed. Source is uploaded back inside an encrypted capsule on each operation; this trades bounded network/CPU work for eliminating durable source staging.
- Account receipts are source-free, capped at sixty entries and logically expire after 24 hours. Pruning occurs at the next admission; inactive accounts may retain that bounded metadata document. No source cache exists in Firestore.
- Reload/close deliberately loses unsaved work. Cancellation cannot guarantee that an already submitted model call stops or is free. Unknown outputs cannot be recovered from the server.
- Historical source-store cleanup and optional two-download benchmarks remain separate follow-up work. This release neither deletes historical records nor enables concurrent downloads.

## Preview

Authorized Preview: [phase-one GitHub import](https://resume-changer-git-phase-one-ayushs-projects-ab23dbca.vercel.app/library/github/new). The delivery must verify that its deployment commit matches the pushed `phase-one` HEAD. Live authenticated model acceptance remains a separate gate above. No main or Production change is part of this delivery.
