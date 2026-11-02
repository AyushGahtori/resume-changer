# Phase one: backend integration review

Branch: `phase-one`. Base for this batch: `fcaff97` (Tasks 1–10). Tasks 11–20 were reviewed from their completed chats and uncommitted worktrees. Their 71 source files were copied into this integration checkout; the original worktrees were preserved. No changes are intended for `main` or the Production deployment.

## Review findings and corrections

| Task | Reviewed area                         | Integration correction                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11   | Atomic approval and library migration | Match full draft hashes across orchestration and the writer; derive eligibility after explicit review; allow inspected contextual evidence beyond manually named contribution paths; bind locally confirmed measurements to the exact draft.                                                                  |
| 12   | Import HTTP handlers                  | Align actual browser payloads and response DTOs; bind handlers to each authenticated request; honor legacy explicit file removals and measurement versions. Keep all handlers behind the existing API dispatcher.                                                                                             |
| 13   | Connection sessions                   | Bind the asynchronous access factory correctly; retain cookie/state/origin checks; require the exact JSON media type. Add a native access-to-DTO adapter that never returns credential handles.                                                                                                               |
| 14   | Report parsing                        | Preserve the bounded JSON/CSV parser, pinned blob/revision checks and source pointers. Attach the trusted capability and pinned source description needed by the calculator; verify parsed numeric candidates against the actual measurement calculator. Reports remain optional candidates requiring review. |
| 15   | Retrieval evaluation                  | Connect policy scoring to the actual selector while retaining safety, required coverage and budgets. Run the labeled tuning and holdout corpus with that policy. No token-saving claim is inferred from the retrieval test.                                                                                   |
| 16   | Structured extraction                 | Permit shared catalog recipe references; bind analysis to the current job and exact consent; preserve separate input/output/reasoning usage when committing budgets. Share a plain-Node provider core with the guarded Next entry.                                                                            |
| 17   | Durable execution                     | Adapt the durable job store to the real runner, checkpoint content-free ledgers before upstream calls, support silent preparation completion, and align worker-host exports and CommonJS startup.                                                                                                             |
| 18   | Local measurements                    | Read original drafts before any edit exists; use the shared safe file lock; keep stored-answer versions distinct from updated question versions; expose local preview through the browser client; keep approved reviews readable without allowing further edits.                                              |
| 19   | Import orchestration                  | Fix idempotent Analyze/approval retries, selection-helper validation, current draft versions, local measurement confirmation, project ownership and completed-job projection.                                                                                                                                 |
| 20   | Composition/status                    | Assemble the real store, job queue, inspection/PR/selection, measurements, extraction, approval and runner. Test browser requests through actual handlers and persisted status. Missing configuration remains explicitly unavailable.                                                                         |

The resume schema distinguishes observed measurements from user attestations. A measured metric requires source evidence. A standalone user attestation requires a recorded measurement description and explicit confirmation; it is never relabeled as an observed repository result. Targets and guesses cannot become achieved metric clauses.

## Composed acceptance tests

`tests/unit/github/gate-b-integration.test.ts` uses real internal modules with only GitHub transport, account authorization, clock and AI replaced by fictional fixtures. It checks:

- Browser create and prepare requests, durable queue execution and a new runtime instance reading persisted state.
- No provider call before consent; duplicate Analyze requests reuse one job.
- Exact evidence references, local preview of unedited drafts, one ready notification and independent read state.
- Qualitative approval and idempotent retries without duplicate achievements.
- A locally calculated and confirmed measurement saved with provenance, plus stale-result rejection.
- Cancellation while the provider is running: a late response cannot publish a review result or ready notification.
- Missing worker, foreign authorization namespace and revoked repository access.
- No additional GitHub/provider calls for measurement answers, previews, status, notification reads or approval.

The access adapter, report-to-calculator adapter and measurement provenance rules also have separate regression tests. Existing task tests retain adversarial coverage for transport destinations, leases/fences, source limits, prompt injection, malformed provider output, schema migration and atomic writes.

## Runtime and deployment boundaries

`createGithubBackendRuntime` assembles the local backend. Its trusted dependencies supply session/account resolution, fresh repository authorization, the approved pinned transport, provider and library writer. `createGithubAccessPort` adapts the native GitHub App access service; its pin resolver must return the same authorized repository identity.

Install the resulting services through `configureGithubServices(createGithubServicesFactory(...))` during trusted process startup in both Next and the worker. Both processes must use the same resolved personal data root. Credentials must be kept in the injected encrypted/OS vault; there is no plaintext-token fallback. Callback configuration uses `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CALLBACK_URL` and the configured application origin. Do not put secrets in fixtures or browser DTOs.

Local `npm run dev` and `npm start` supervise the web process and worker host. `npm run build` compiles the standalone worker before Next. Production local startup uses compiled JavaScript, without a TypeScript development runner. `GITHUB_IMPORT_WORKER_RUNTIME_MODULE` is a trusted server-side module path, not a browser input. The host reports missing runtime/configuration as unavailable and shuts down with the web process.

Staged imports, safe-content caches, interviews and durable jobs stay under the same personal root. Reads enforce their retention deadlines; store cleanup operations remove expired staged data. Deleting/discarding staged work does not revoke access upstream or erase approved library points. Disconnect fences active work and removes local grants through the access service; its response does not falsely claim upstream token revocation.

Vercel cannot host this filesystem queue as a continuously running durable worker. The local runtime therefore rejects that configuration on Vercel. A secure hosted queue/worker/storage adapter and real GitHub App/vault configuration must be installed before enabling live hosted imports. The branch Preview verifies packaging and safe unavailable responses, not a live private-repository import. Frontend implementation is Batch C.

All new GitHub and notification HTTP handlers are dispatched through the existing `/api/[...path]` function. Validation, compilation and service logic remain separate modules. This preserves the current Vercel function count.

## Verification record

- Initial integrated unit run: 1,146 passed, three optional live tests skipped.
- Final full unit/integration run: 1,149 passed, three optional live tests skipped. The later oversized-checkpoint regression also passed in the 15-test durable-store suite.
- Production build, full formatting check, lint, typecheck and whitespace checks: passed.
- Browser smoke: both the GitHub harness and the existing analysis → selection → PDF → override → export journey passed against the validated production build. The standard runner first exceeded its 300-second rebuild/startup limit under local memory pressure, before any test ran; the verification reused the successful build with isolated fictional data.
- Worker build/start/unavailable/shutdown smoke: passed; compiled backend and worker imports also passed in ordinary Node without a `server-only` shim.
- GitHub and AI traffic in tests is synthetic. No personal JSON, credentials, paid provider API or real private repository content was used.
- Vercel verification is Preview-only. No promotion to Production or merge into `main` is authorized by this batch.
