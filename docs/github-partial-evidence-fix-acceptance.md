# Partial-evidence analysis repair: acceptance

Date: 31 October 2026. Plan: `github-partial-evidence-fix-plan.md`.

Implementation branch: `codex/github-partial-evidence-fix`, using the existing isolated review worktree. Base: `46fe43725b3ea320a7e1fe5f0421ceb5ef164b96`. Main and Production are unchanged.

## Result

- One shared evidence-readiness policy distinguishes optional coverage gaps from blockers. Missing corroboration is partial coverage; missing method/attribution, unknown critical requirements, empty evidence and unresolved pins remain blocked.
- The service combines upstream and packed verdicts conservatively and preserves both sets of limitations. A stricter packed result cannot be overwritten. Selector cache identities use `github-selector-v2`; saved provenance records `contribution-selector-v2`.
- Both analysis submission and execution reject blocked evidence on the server. The real API regression verified zero provider calls when a documentation-only bundle is submitted directly.
- Automatic selection makes room for a related test when one is available. Explicit path/PR priority, user pins, duplicate-blob handling and existing file/line/byte/request limits remain in force. An unrelated test is not required to proceed.
- The page says evidence is prepared and analysis has not started, exposes coverage warnings and exact-evidence consent, and labels pre-analysis repository statistics as preparation. The progress indicator stays at Analyze until analysis has actually run.
- Setup offers return to a current prepared bundle. Changed context requires fresh preparation and resets consent. Analysis consent is only exposed after navigation reaches the active import route; an unchanged repository-list refresh no longer clears a checked consent box. Revoked access and changed selection retain their guards.
- The save selector appears only for actual drafts. Pre-analysis, blocked and analyzing states explain the next step; a completed zero-draft model result has its own empty state. Discard and back actions remain available. Reported model input tokens are shown when returned by the provider.

## Regression evidence

Before the change, three added service regressions failed: missing corroboration was incorrectly blocked, a blocking packer verdict was overwritten, and an empty final bundle did not become an actionable blocker. The dense-inventory test also proved an available related test was crowded out. Those regressions now pass.

The real session HTTP tests cover implementation-only and dense inventories, direct attempts against documentation-only evidence, and a valid empty provider result. They count provider invocations: preparation makes zero, the authorized synthetic analysis makes one, and blocked analysis makes zero.

The browser checks cover the original import/analyze/confirm/save journey, reload loss of temporary evidence, partial evidence with Setup/Analyze navigation and changed-context consent reset, double-click submission, explicit save, documentation-only recovery, and a completed empty model response. Screenshots for desktop/mobile and both themes are in `.runtime/github-gate-c/`.

Final automated validation:

- Full unit/integration suite: **1,334 passed, 3 existing tests skipped**, 155 files, 24.56 seconds (`npm test -- --reporter=dot`). A concurrent Chromium/unit run hit five existing test timeouts; running the unchanged suite after Chromium exited passed. No test or production timeout was raised.
- `npm run typecheck`, `npm run lint` and `npm run format:check`: passed.
- Fresh optimized build and all **5 browser journeys passed** (2.7 minutes), including the corrected progress indicator (`PLAYWRIGHT_PORT=3041 node scripts/test-github-journey.mjs`). Visual review covered the decisive partial, blocked and empty-result screenshots; automated audits cover 320, 390, 768, 1024 and 1440 pixels in both themes, plus the keyboard save flow.
- Firebase emulator suite remains unavailable: Java is not on PATH and the common Android Studio bundled Java path is absent. Rules were not changed. Emulator results are not claimed.

## Public repository check

The diagnostic ran the actual GitHub reader/selector/service against public `AyushGahtori/resume-changer`, pinned at `4fc28cdbc015aff12f2e08b15428c63e4f9a040e`, with `entire project.` and no selected PRs/paths. It used request memory and explicitly disabled AI.

Before the repair: **12 files, 472 lines, 15,828 bytes**, missing corroboration, `needs-input` / `needs-context`.

After the repair: **12 files, 651 lines, 22,536 bytes**, including `tests/e2e/generate-preview.spec.ts`, preparation completed as **partial** with bounded-coverage limitations. The application can now proceed to evidence consent. No model was called, no achievements were saved, and no repository source was staged to Firestore or disk.

This checks the public preparation path, not the owner's authenticated Preview/model/save flow. Ordinary CI uses synthetic fixtures; it does not contact this repository.

## Delivery and live gates

The repair is delivered through `phase-one`. Exact pushed-commit/READY deployment and protected-HTTP verification occur after this acceptance record is committed and are reported in the delivery response. Production and main must remain unchanged.

The owner should open a fresh import after the new build loads. An old tab-held bundle may contain the previous computed assessment or reuse an old completed preparation. Do not modify capsules or bypass consent to upgrade it.

Live owner-authenticated preparation, approval of the exact evidence for a real model call, review of real drafts and explicit save remain a separate acceptance gate. A legitimate zero-draft response or provider failure must be reported as such; passing preparation does not guarantee useful model output.
