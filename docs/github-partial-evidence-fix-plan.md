# GitHub import: repair blocked analysis and premature save controls

Date: 31 October 2026. Status: implementation complete; final automated and Preview verification is tracked in `github-partial-evidence-fix-acceptance.md`.

## Objective and confirmed cause

After successful preparation, let the user review the evidence, explicitly consent to analysis, and then select real generated achievements. Missing test/corroborating evidence should be a visible coverage limitation when usable implementation and contribution context exist.

The diagnostic reproduced the screenshots using `AyushGahtori/resume-changer`, revision `4fc28cdbc015aff12f2e08b15428c63e4f9a040e`, contribution `entire project.`, and no selected PRs/manual paths: **12 files, 472 selected lines, 15,828 fetched bytes, zero drafts**. The selector reported only `missingDimensions: ["corroboration"]`. Preparation completed, but the service classified the bundle as `needs-context`, preventing analysis. AI was explicitly disabled in this diagnostic; repository contents stayed in request memory.

The selector distinguishes partial coverage from blocking requirements. `prepareCompleteness()` in `src/lib/github/server/service.ts` instead blocks on any missing dimension. `executePrepare()` also overwrites the packer's completeness and limitations. The context-recovery UI can send the user back to Setup, while the trust rail still displays achievement/save controls without drafts.

This proves the preparation blocker. It does not prove that a subsequent real model call will succeed or produce useful points.

## Working rules

- Planning baseline: `phase-one` at `46fe43725b3ea320a7e1fe5f0421ceb5ef164b96`. Verify the latest branch and preserve newer work before implementation.
- Use an isolated repair worktree containing the reviewed GitHub feature baseline; record the actual base SHA and branch. Keep `main` and Production unchanged. If a mandatory main-based workflow applies, integrate the reviewed prerequisite first; do not recreate the feature from a checkout that lacks it.
- Complete these five tasks sequentially in one repair branch. This document is the specification for this repair.
- Preserve authorization, pinned revisions, source screening, memory-only staging, budgets, exact-evidence consent, cancellation, duplicate protection and explicit/idempotent saves.
- Use synthetic repositories/providers in automated tests. Real model analysis requires the owner to approve the exact prepared evidence.

## GHF-1: Add a regression that reproduces the actual failure

**Why:** the previous complete-flow fixture included implementation plus tests, so it never exercised the reported missing-corroboration case.

1. Add a synthetic repository with usable implementation and contribution context but no selected test/corroborating evidence. Add a larger-inventory case where tests exist but are not selected within the bounded bundle.
2. Exercise the real selector, inspection adapter, service and session HTTP/controller path. Do not mock the final lifecycle into the expected state.
3. Record the failing behavior before the fix: successful preparation becomes `needs-context`, analysis is unavailable, and the UI asks for an achievement selection without drafts.
4. Add independent blocker cases: absent implementation, missing attribution, empty packed evidence, and unsafe/unresolved pinned files. Include a packer result stricter than the initial selection plan.
5. Keep the real repository SHA/counts in diagnosis notes. CI must not fetch the live repository, depend on its exact counts, or call a real provider.

**Acceptance:** a focused regression fails for the confirmed reason; genuine blocker cases are independently tested. Locate existing service tests under `tests/unit/github/` rather than assuming an old task's filename exists.

## GHF-2: Preserve the final evidence verdict through preparation

**Why:** the service currently replaces the selector's nuanced assessment with an overbroad blocking rule.

**Inspect:** `src/lib/github/server/service.ts`, `inspection-ports.ts`, `selector-core.ts`, `selection-policy.ts`, and `src/lib/github/ports.ts`.

1. Define the distinction between blocking evidence requirements and partial coverage. Missing corroboration alone may be partial; it never supports claiming that tests passed or a result was measured.
2. Preserve the packer's verified final verdict. Merge snapshot/inventory/PR incompleteness conservatively: complete may become partial; a blocked packed result must never become analyzable.
3. If the adapter needs to expose readiness/blocking reasons, extend the typed port and all consumers together. A missing-dimensions array alone cannot establish that pinned selections are safe.
4. Keep missing implementation/attribution, empty usable evidence and unsafe/unresolved pin conflicts blocked. Preserve existing failures for revoked access, invalid identities/hashes, unsafe source and budget violations.
5. Merge/deduplicate upstream and packer limitations instead of replacing either list. Explain missing corroboration clearly: “No test evidence was included. Drafts will be limited to the selected implementation evidence.”
6. Clarify policy names/documentation so a coverage target is distinguishable from a condition that forbids analysis. Preserve selection-hash and exact-disclosure consent binding; update internal version identifiers if required.
7. Prefer selecting relevant corroborating evidence when available, within existing limits and explicit pins. That selection-quality improvement must not become a requirement to analyze repositories without tests.

**Acceptance:** the implementation-only fixture becomes `partial` and can proceed to explicit consent. Complete bundles still work, packed limitations survive, and every genuine blocker remains blocked.

## GHF-3: Make the UI's next action and empty states truthful

**Why:** preparation statistics and an empty save panel currently resemble a completed analysis whose points disappeared.

**Inspect:** `src/components/github-import/import-workspace.tsx`, `use-import-workspace.ts`, `workspace-state.ts`, `analysis-status.tsx`, and `trust-rail.tsx`.

1. Successful analyzable preparation should show Analyze, a clear “Evidence prepared — analysis has not started” status, coverage warnings, the exact-evidence consent checkbox and the analysis action.
2. When Setup is opened to edit context, provide “Review prepared evidence” if the bundle is still current. Changed inputs must require preparation again. Successful preparation must leave forced Setup without skipping consent.
3. Blocked bundles must name the missing requirement and show a concrete recovery action.
4. Label repository counters as preparation statistics until a provider attempt runs. Leave model/actual token usage unknown when unreported.
5. Render achievement selection/save controls only when current drafts exist. Before analysis, show next-step guidance. A completed analysis returning zero drafts needs its own “No supported achievements were generated” state.
6. Preserve discard/back actions even without drafts, plus submission guards, cancellation, account cleanup and stale-selection checks. Do not automatically start AI to compensate for missing controls.

**Acceptance:** users can reach consent and analysis from the reported partial case; no pre-analysis state asks them to select nonexistent achievements. Current-bundle navigation and blocked recovery both work.

## GHF-4: Verify the assembled journey and safety boundaries

**Why:** helper-only tests would miss disagreement between the selector, service and UI.

1. Extend `tests/e2e/github-integrated-backend.spec.ts` and its isolated synthetic backend with the no-corroboration case.
2. Verify: choose repository/context; prepare; see partial warning and no save panel; explicitly consent; analyze once using a synthetic provider; see drafts; select/confirm contribution; save only the approved draft.
3. Assert zero provider requests during preparation and exactly one authorized attempt for analysis in this fixture. Repeated clicks must not duplicate it.
4. Verify blocker cases never invoke the provider. Cover Setup/current-evidence navigation, stale selections, preserved packer warnings, empty model output, discard and reload.
5. Inspect saved library/storage boundaries: no raw source in saved evidence, no new persistent source staging, and only explicitly selected/confirmed points saved.
6. Check keyboard access and warning/action visibility at desktop/mobile widths in both themes; capture the decisive states.
7. Run focused regressions, full unit/integration tests, lint, typecheck, formatting and a fresh optimized build/browser journey. Run Firebase emulator checks if Java is available; explicitly record unavailable checks. Investigate failures instead of raising production limits.

**Acceptance:** the original failure and blocker cases pass through assembled layers. Existing session, consent, cancellation, receipt and save tests stay green. Record commands, counts and screenshots.

## GHF-5: Review and validate the real Preview case

**Why:** synthetic success does not establish live provider availability or useful output for this repository.

1. Review the diff for relaxed safety/authorization checks or new persistence. Update acceptance notes with the final behavior, tests and remaining live gates.
2. Commit, integrate into `phase-one`, push through its existing Preview pipeline, and verify the alias points to the exact pushed commit. Keep main and Production unchanged.
3. Start a fresh temporary import on the new build with the reported repository/revision/context. Old tab-held bundles may retain the previous assessment or reuse an old completed preparation; do not edit capsules or bypass consent to force them through.
4. Confirm partial evidence exposes the warning and consent/action without premature save controls.
5. Have the owner approve the exact evidence for a real model call. Verify the provider response, draft rendering and explicit save separately. If the provider fails or legitimately returns zero drafts, show that outcome accurately.
6. Record live and synthetic results separately. A READY deployment alone does not complete live analysis acceptance.

**Acceptance:** the repair is on the authorized Preview with exact-commit evidence. Live acceptance is either verified or explicitly pending the owner's evidence approval.

## Final acceptance checklist

- [x] Missing corroboration alone is partial coverage with a visible warning.
- [x] Missing implementation/attribution, empty evidence and unsafe pins still block.
- [x] The service preserves the packer's stricter verdict and relevant limitations.
- [x] Preparation exposes a clear next action and makes zero provider calls.
- [x] Analysis requires exact-evidence consent and does not duplicate on repeat clicks.
- [x] Selection/save controls appear only when drafts exist.
- [x] Completed zero-draft analysis has a truthful empty state.
- [x] Setup recovery and return to a current bundle are usable.
- [x] Session privacy, budgets, cancellation and explicit saves remain intact.
- [x] Automated checks pass; Preview verification and the remaining owner-approved live gate are explicitly tracked in the acceptance record and delivery response.
