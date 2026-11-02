# GitHub context modules: merge and quality review

Date: 1 November 2026.

## Scope and location

All ten referenced task chats were read before their handoffs were used. Their modules were merged into `codex/github-context-redesign-plan` in `C:/Users/Ayush/.codex/worktrees/github-context-redesign-plan/re_changer`, starting from the common plan baseline `bdaf1380ba99f6d7a80040574e0d788ff3b22d17`.

Eight handoffs were uncommitted. Their task-owned files were inspected and committed on their original task branches before merging. The two already committed tasks retained their existing commits. Every task has a separate merge commit; no merge conflicts occurred. The older unrelated drafts in `github-session-review/re_changer` were not included or discarded. No push, production deployment, or change to `phase-one`/`main` is part of this merge.

| Task | Module                   | Task commit |
| ---- | ------------------------ | ----------- |
| 01   | Interview catalog/engine | `7a1b33d`   |
| 02   | Interview UI             | `bf58f54`   |
| 03   | Screenshot boundary/UI   | `ed983d0`   |
| 04   | Discovery/project map    | `67b07b5`   |
| 05   | Bounded section reader   | `fa2a640`   |
| 06   | Dependency graph/ranking | `7d3a56a`   |
| 07   | Bundle allocation        | `87f933e`   |
| 08   | Evidence inventory UI    | `c063207`   |
| 09   | Run status/diagnostics   | `ecc33d5`   |
| 10   | Offline quality harness  | `41b9340`   |

## Review corrections

1. **Skipped component tests:** the baseline Vitest include pattern discovered only `.test.ts`, silently omitting the screenshot component's `.test.tsx` suite. Both extensions are now included. This exposed an outdated copy assertion and formatting problems in that previously omitted file; these were corrected without relaxing the behavioral checks.
2. **Screenshot aggregate boundary:** preliminary base64 accounting counted padding as decoded data and could reject valid images exactly at the 750 KiB aggregate bound. Accounting now subtracts padding; validation still checks canonical encoding, actual decoded bytes, hashes, dimensions, consent and the aggregate bound. A padded-image boundary regression uses valid synthetic PNG fixtures and a fake decoder port; it does not claim to test a production codec.
3. **Overlapping screenshot processing:** a synchronous active-controller guard prevents two input events from starting overlapping processing before React commits the busy state. A regression dispatches both events in the same turn and verifies one processing batch.
4. **Cache clearing during a read:** a completed in-flight source read could repopulate a cleared cache, and its cleanup could remove a newer same-key in-flight entry. Cache epochs now prevent stale repopulation; identity-checked cleanup preserves newer entries. A regression clears the cache while a read is pending and verifies that a subsequent read fetches again. This does not replace caller cancellation; the enclosing session must abort outstanding work on discard.
5. **Interview browser assertions:** two previously unrun assertions matched both the visible label/notice and its live-region announcement. Assertions now target the specific progress label and exact branch-change notice, retaining their expected content. Interview capture disables animations for stable screenshots while interaction tests continue to exercise motion/reduced-motion behavior.
6. **Landmark semantics:** the reusable interview rendered a nested `main` inside its harness page's `main`. It now uses a neutral container; browser verification asserts one main landmark.
7. **Screenshot readability:** the expanded image preview was constrained to the thumbnail grid card. The expanded card now spans the panel columns, and the browser test verifies that the preview is materially taller than the thumbnail at the test viewport.

Review also examined request-scoped cache/authentication boundaries, streamed read/byte accounting, configured alias resolution, source/consent provenance, allocation constraints, diagnostic allowlists, and the local-only harness guards. This is a bounded code review plus automated verification, not a claim that every possible input or language has been audited.

## Verification

One clean `npm ci --no-audit --no-fund` was run in this worktree using the existing lockfile. Task worktrees' partial dependency installs/junctions were left untouched. No package or lockfile upgrade was made.

- Full unit/integration suite after the logic fixes: **1,487 passed, 3 existing skips**, 172 files, 29.84 seconds. This includes the newly discovered TSX tests. An earlier run alongside other checks hit an existing Gate B timeout and cleanup error; the standalone final run passed without changing its timeout.
- Quality harness: **38 passed**. `node scripts/github-context-quality/run.mjs --json .runtime/github-context-quality/merged-report.json --markdown .runtime/github-context-quality/merged-report.md` completed successfully.
- Full project typecheck, ESLint and formatting checks passed. The final optimized build also performed its type/lint validation.
- Optimized browser build succeeded. First combined browser run: 22 passed, two ambiguous interview assertions failed. Those failures were investigated and corrected, rather than marked as product success.
- Final optimized browser run: **24/24 passed**, 5.3 minutes. This covers the interview, screenshot and inventory suites plus the existing session import/analyze/save journey. Expanded-preview readability and the corrected interview assertions pass. Final visual inspection checked the interview opening and enlarged screenshot preview.
- Java-dependent Firebase emulator checks have not been run in this review. No security-rule changes were made. No real provider or paid AI call was made.

Commands used for the combined browser run:

```powershell
$env:PLAYWRIGHT_PORT = '3051'
$env:GITHUB_IMPORT_E2E_BACKEND = '1'
npx playwright test tests/e2e/github-context-interview.spec.ts tests/e2e/github-context-screenshots.spec.ts tests/e2e/github-context-evidence-ui.spec.ts tests/e2e/github-integrated-backend.spec.ts
```

The browser run covers local fixture interview routes, screenshot processing/consent boundaries, evidence inventory views and the existing real-session synthetic import/approve/save journey. It does not exercise the new graph engine through the new UI against a live account. Screenshots/traces are under `test-results/`; offline benchmark artifacts are under `.runtime/github-context-quality/`. Task 08 also regenerates its tracked UI-review screenshots; the incidental changed reference image was restored after verification. No private source or screenshot was added by this review.

## Remaining assembly and release work

The task plan deliberately made these modules independent and left production assembly separate. **Merging the modules does not activate the redesigned import flow.** The following remain required before release:

- Adapt the real catalog/engine to the interview UI port and bind structured context/revisions to the session and exact-evidence consent. Scripted UI fixtures must never serve as production adapters.
- Connect project discovery, the authorized pinned transport, section reader, dependency graph/ranker and allocator. Reconcile their task-local structural types, source screening policies, algorithm/cache versions and payload budgets. The 256 KiB reader remains experimental; existing production caps are unchanged.
- Implement and declare a fully decoding server image codec, connect an explicitly image-capable configured provider, and enforce combined capsule/image wire admission at the authenticated route. The current screenshot boundary fails closed without its decoder; header sniffing alone is not full decoding.
- Mount the new inventory and consistent run-status components in the actual import workspace, and instrument the real runner/session/provider boundary with the new safe diagnostic recorder.
- Run cross-module quality adapters against the held-out feature maps. Task 10 currently compares baseline/reference strategies; its synthetic role-balanced result is not proof that the separately implemented Task 06/07 modules have been assembled or achieve the same quality. No universal project-understanding percentage is established.
- Verify the assembled flow's authorization, cancellation, session expiry, paid-attempt receipts, source/image privacy, stale-selection handling, exact approval and explicit saves. Obtain owner approval for any real model attempt; investigate the original interruption only from actual trace evidence.

The original interrupted analysis's root cause remains unconfirmed. This merge neither diagnoses it retroactively nor deploys instrumentation to collect a new live trace.
