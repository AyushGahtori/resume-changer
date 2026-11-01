# Task 09 integration notes

## Acceptance notes

- **Problem:** the current import lifecycle can normalize an analysis failure to `interrupted` after the provider may have received the request. The existing UI can then describe a local worker stop or display the prepared bundle as if analysis had not started.
- **Owned files:** `src/lib/github/context-run-status/**`, `src/components/github-import/context-run-status/**`, `tests/unit/github/context-run-status/**`, `tests/fixtures/github/context-run-status/**`, and this note.
- **Exported API:** `deriveRunStatus`, `attemptMarkerFromCheckpoint`, `createRunDiagnosticSession`, `classifyRunFailure`, `RunStatusPanel`, and `RunStatusSidebar`. Client imports use `client.ts`; Node diagnostics use `server.ts`/`diagnostics.ts`.
- **Scope exclusions:** no edits to the shared import workspace, `AnalysisStatus`, runner, session handler, extraction/provider code, leases, retry limits, capsule shape, routes, or paid/live request behavior. The feature remains an independently testable module until final assembly.
- **Fixtures:** small synthetic lifecycle snapshots, including prepared plus interrupted state, absent attempt markers, provider failure, result staging/final acknowledgement, result with zero drafts, and saved state. No source text, credentials, prompts, provider responses, or personal data.
- **Safety checks:** diagnostics only accept allowlisted stage/error labels and bounded attempt numbers; operation/run IDs are SHA-256 hashed before emission; status copy never renders an exception message; no retry or provider call is initiated by either component.
- **Known limitation:** the baseline does not persist a complete provider attempt trace in the tab capsule. Until the integration patch below is applied, old/interrupted records without a trustworthy marker must remain `unknown`. The original live incident remains unresolved; this module does not establish its cause.
- Unreported model/token usage stays absent or `null`; this status module does not invent zero usage or a cost estimate.

## Baseline and task branch

- Planning checkout: `C:/Users/Ayush/.codex/worktrees/github-context-redesign-plan/re_changer`.
- Planning revision and common base: `bdaf1380ba99f6d7a80040574e0d788ff3b22d17`.
- Task branch: `codex/github-context-task-09-analysis-diagnostics`.
- Managed task workspace: `C:/Users/Ayush/.codex/worktrees/github-context-task-09-analysis-diagnostics/re_changer`.
- The worktree manager only accepted the selected project checkout as its source root. It created this worktree at the exact planning revision above; no uncommitted source-checkout changes were copied.

## Baseline findings

At the common baseline:

1. `src/lib/github/server/jobs/runner.ts` checkpoints `providerState: "in-flight"` before calling `executeAnalyze`, then maps some `io-error` and `upstream-error` results to the generic `INTERRUPTED` domain error. It does not retain an allowlisted stage/category in the user-visible run record.
2. `src/lib/github/server/extraction.ts` maps provider errors through `toDomainError`; provider-specific diagnostic codes and safe numeric HTTP status can be lost at that boundary.
3. `src/lib/github/server/session-handler.ts` converts an outer exception to a generic interrupted result, and `abandonPriorWork` marks earlier running analysis as interrupted. A stream-level HTTP 200 or a missing final event does not prove that the provider did or did not receive the request.
4. `src/components/github-import/analysis-status.tsx` says the local worker stopped and the checkpoint must be reconciled. `import-workspace.tsx` currently derives the trust-rail phase from drafts/results and busy state; a prepared selection can therefore appear current after a later interruption.
5. `claimSessionOperation` deliberately leaves an admitted-but-unfinished AI receipt conservative. This task must not make that receipt replayable or add automatic paid retries.

## Baseline runner/session integration patch description

Final assembly should apply this patch to the shared baseline files, after reviewing the diff with the task owners. It is intentionally described here rather than applied in this independently owned task.

### Runner and extractor instrumentation

1. In `jobs/runner.ts`, create one `createRunDiagnosticSession` per logical run with the server-generated operation/run IDs, bounded attempt number, injected clock, and a best-effort server log sink. Never put account IDs, repository paths, source text, prompts, image bytes, credentials, exception messages/stacks, or raw provider bodies in that sink.
2. Emit allowlisted stages before the corresponding boundary: `run-admission`, `initial-checkpoint`, `budget-admission`, `authorization`, `result-staging`, and `final-acknowledgement`. Call `failure` in the catch path **before** mapping the exception into the normalized `DomainError`. The current stage plus a validated domain error code is enough to classify most failures; unknown combinations remain `unknown`.
3. Instrument the provider edge in `server/extraction.ts`: record `provider-submission` immediately before the actual provider adapter call, `provider-response` when it returns or throws, and `result-validation` before output schema/evidence validation. Record attempts from the existing bounded generation loop (1 or 2 only); do not add attempts or alter its budget.
4. Convert only a fixed `HTTP_[1-5][0-9]{2}` diagnostic code to its numeric HTTP status. Keep provider codes only when they are from a reviewed allowlist. An absent upstream status or usage value remains unknown/null; never convert it to zero.
5. Log diagnostics as a best-effort side effect. A broken logger must not fail a job. Keep current lease/fence checks, idempotency receipts, cancellation/deadline behavior, unknown-outcome protection, and paid-attempt count unchanged. Do not retry after an uncertain provider completion.

### Session boundary and UI mapping

1. In `session-handler.ts`, record the stage currently executing in request-local memory so the outer catch can emit a safe fallback diagnostic. Use a bounded operation identifier and the run ID; do not log the session token, account UID, request body, URL query, or exception. Leave the encrypted capsule schema and storage policy unchanged unless a separate assembly review approves a versioned contract change.
2. Build the UI `RunStatusInput` from validated import/job state, transport busy state, the latest allowlisted diagnostic, explicit result availability/draft count, and the checkpoint attempt marker. A queued job before the analysis-started checkpoint can be `not-submitted`; a checkpoint with `providerState: "in-flight"` means **may have been submitted**; `providerState: "completed"` with a verified result reference means result persisted. Missing or malformed markers mean `unknown`.
   Bind attempt markers, failures, and results to the same current `runId`; ignore references from older runs. A stale `lifecycle: "analyzing"` without a live busy/job marker is outcome-unknown, not proof the job is still running.
3. Use the same `deriveRunStatus` output for the main analysis panel and the sidebar/trust-rail status. Terminal `interrupted` or `failed` state must outrank a prepared selection or stale browser busy flag. Only an explicit `not-submitted` marker plus an available prepared selection can produce “Analysis has not been submitted.”
4. Show `ready-with-drafts` only after the validated result is available with a positive draft count. Show `ready-with-zero-drafts` only when zero is confirmed. Gate save controls on `canSave`; zero drafts never exposes Save. A missing result or count is unknown, not a zero-draft result.
5. Keep retry preparation distinct from a new AI analysis. A user may return to setup or refresh status, but a new analysis requires changed/confirmed scope as applicable and fresh explicit consent. Neither component submits requests or retries on its own.

## Verification and handoff

The owned Vitest tests cover lifecycle precedence, category mapping, invalid/missing markers, safe diagnostics and both UI variants using synthetic fixtures. Run:

```powershell
npx vitest run tests/unit/github/context-run-status
npx tsc --noEmit
npx eslint src/lib/github/context-run-status src/components/github-import/context-run-status tests/unit/github/context-run-status tests/fixtures/github/context-run-status
npx prettier --check src/lib/github/context-run-status src/components/github-import/context-run-status tests/unit/github/context-run-status tests/fixtures/github/context-run-status
```

The components use the current theme variables, CSS modules, natural wrapping and no motion. They are not yet mounted in the baseline workspace, so integrated screenshots and the main-panel/sidebar assembly review belong to final assembly. Do not count these isolated tests as evidence that production instrumentation or a live provider call is working.

### Results for this independent pass

- `node node_modules/vitest/vitest.mjs run tests/unit/github/context-run-status` — **28 tests passed** on Vitest 5.0.5. Vite printed its config-loader migration warning; the tests passed.
- Targeted ESLint over all owned source, fixtures and tests — **passed**.
- Targeted Prettier check over all owned source, fixtures, tests and notes — **passed**.
- Targeted strict TypeScript check for the status contracts, lifecycle resolver and server diagnostics — **passed**.
- Full project typecheck and optimized build — **not verified**. A clean `npm ci` took several minutes while multiple other npm installs were active and was stopped before completion. The earlier full check against the already-present checkout dependencies reported missing unrelated Firebase/workflow packages and a Vitest-config version mismatch. A direct component-only `tsc` invocation also lacks the app's CSS-module type context; the TSX was exercised by Vitest and ESLint.
- The stopped install left an ignored, partial `node_modules` directory in this task worktree. Automatic review blocked the recursive cleanup command with a “blocked by policy” result; no tracked source files or dependencies in the original checkout were changed.
- Browser screenshots and five-width/two-theme visual review — **not captured** because this independent task does not mount the component into the shared workspace. Final assembly must review both rendered variants in the real shell.
