# Launch audit findings

Audited tree: `main` at `dc309ac` with the open pull requests #158, #159, #161 and #162 merged locally on `audit/launch-audit`. Problems those pull requests exist to fix are not repeated here. A problem that a pull request introduces is filed and names the pull request.

Local runs used `RESUME_APP_MODE=local` and a temporary copy of `examples/sample-resume-library.json`, never the owner's personal library. Port 3040 used the mock AI provider. Port 3041 used the live Gemini key with the same fictional data.

## Audit rules from the owner

These replace the stricter wording in `docs/architecture.md` and the README where they differ. Updating those documents is itself a finding (see the policy section).

- The AI may add a skill named in the job description even when the library does not contain it. A requirement whose only support is a skill entry, with no achievement behind it, is **partially** covered, never fully covered.
- Rewrites may strengthen verbs, broaden framing, and imply reasonable scope beyond the source. Embellishment is not filed as a finding.
- Still enforced: employers, job titles, and dates stay as supplied; bullets trace to achievement ids that exist and are enabled; required and preferred qualifications stay separate; the compiler measures the one-page limit; experience order matches the editor; the role is the job the user chose; an AI outage is disclosed and a local fallback is not presented as model output.

## Map

### Pages

| Route | Entry component | Notes |
|---|---|---|
| `/sign-in` | `SignIn` | Hosted only. Local mode skips it. |
| `/` | `JDWorkspace` | Job description draft, analysis panel, saved analyses (#162). |
| `/library` | `AchievementLibrary` | Jobs, projects, skills (#159 chips), credentials, point editor. |
| `/library/imagination` | `ImaginationCanvasClient` | Imagination Canvas: connect points, write or merge an achievement, choose a destination. |
| `/library/github/new`, `/library/github/[importId]` | `ImportWorkspace` | GitHub import; the in-tab session flow is the live path. |
| `/generate` | `ResumeGenerator` with embedded `ResumeStudio` | Builder steps, generation settings (#161), Studio, PDF preview. |
| `/history` | `GenerationHistory` | Saved generations, LaTeX and PDF download, delete. |
| `/settings` | `AccountDataTools` | Export, import, Check PDF service (hosted). |
| `/e2e/*` | Test harnesses | Only rendered when `GITHUB_IMPORT_E2E_HARNESS=1` outside Vercel. |

Navigation lives in `src/components/workspace-shell.tsx`: Job description, Achievement library, Resume builder, History, Settings, plus the theme toggle and account control.

### API (one function, `src/app/api/[...path]/route.ts`, dispatched by `src/lib/api/dispatch.ts`)

| Path | Methods | Handler |
|---|---|---|
| `auth/session` | GET, POST, DELETE | `api/auth/session/handler.ts` |
| `account/library` | GET, PUT | `api/account/library/handler.ts` |
| `account/import/history` | POST | `api/account/import/history/handler.ts` |
| `ai/analyze-job-description` | POST | `api/ai/analyze-job-description/handler.ts` |
| `ai/select-achievements` | POST | `api/ai/select-achievements/handler.ts` |
| `ai/tailor-achievements` | POST | `api/ai/tailor-achievements/handler.ts` |
| `ai/auto-tailor` | POST | `api/ai/auto-tailor/handler.ts` |
| `ai/achievement` | POST | `api/ai/achievement/handler.ts` (Imagination writing) |
| `job-analyses`, `job-analyses/{id}` | GET, POST / GET, DELETE | #162 saved job analyses |
| `library/points`, `library/points/{id}` | POST / PATCH | point create and edit |
| `library/skills` | POST | skill create (#159) |
| `generate` | POST | manual generation |
| `compile` | POST | LaTeX to PDF |
| `resume/edit` | POST | Studio apply |
| `resume/skills` | GET | skill width measurement (runs the compiler) |
| `history`, `history/{id}`, `history/{id}/pdf` | GET, POST / GET, DELETE / GET | generation history |
| `github/session` | POST | in-tab GitHub import session |
| `github/connection/*` | start, callback, repositories, disconnect | GitHub App connection |
| `github/imports/*`, `github/jobs/*`, `library/notifications*` | various | Return 410 outside the test harness. |

### Background work

- `src/workers/github-import-host.ts` and `github-import-worker.ts`: local child process started by `scripts/run-local.mjs`.
- `src/workflows/github-import.ts`: workflow steps for GitHub import.
- History PDF deletion runs after a grace period, retried on later history access (runbook).

## Work outside the audited tree

The owner's earlier UI fixes (custom "All experiences" filter, sidebar flyout stacking, Imagination centering, skill-list scrollbar, chip shape, chevrons, restore copy) are about 800 changed lines that are **uncommitted** in the `re_changer-main` checkout on the unrelated branch `codex/firebase-admin-session-runtime-guard`. They are not in `main` or any open pull request. Commit them to their own branch and open a pull request before anything else, or they can be lost. Findings below do not repeat them.

Pull request #161's description promises more than its pushed branch contains. On `origin/ui/builder-studio-polish` the builder step chip is still the literal `02 / 04` (`src/components/resume-generator.tsx` line 1594), there is no "Back to studio" generation-settings step, and the builder has no `LibrarySelect`. All three exist only in the uncommitted changes above (for example `data-step={generationStep}`). Either push them to #161 or correct its description before merging; reviewers are currently approving a summary that does not match the diff.

## Findings

### F01. A missing company or description is reported as a failed AI analysis

- Severity: medium
- Route: `/`, every viewport.
- What I did and what happened: With the company empty I selected Analyze job description. No request was sent, but the analysis panel showed "Analysis could not be completed." in a red error card with a Retry button, and the main button was renamed "Retry analysis". Filling the company and leaving the description empty produced the same card with "Check the job description and try again." Each click reports only one missing field.
- Why it fails: The screen claims an AI attempt failed when nothing ran, and offers Retry, which cannot help. The user needs to fill a field, not retry.
- Where: `src/components/jd-workspace.tsx`, `handleAnalyze`, lines 267–301 set `analysisState` to `"error"` for local validation; `src/components/home/job-analysis-panel.tsx` lines 49 and 76 render that state as an analysis failure.
- Confidence: high, reproduced in the browser and read in code. Not checked: screen reader announcement order.
- Smallest fix: Keep local validation in `errors` only and leave `analysisState` unchanged, so the panel stays in its previous state. Validate company, description, and URL together before returning. Invariant: `analysisState === "error"` only after a request was sent and failed.
- How to prove it: extend `tests/e2e/home-action-states.spec.ts`: click Analyze with empty fields, expect both field errors, no request to `/api/ai/analyze-job-description`, and no "Analysis could not be completed" text. Click-path: `/` → Analyze with empty form → fill company → Analyze.
- What not to change: the server-side 400 path and its message, or the real failure card for provider errors.

### F02. Local mode says analyzed jobs are saved "on this account"

- Severity: low
- Route: `/`, local mode.
- What happened: The footer reads "Unfinished drafts stay in this browser. Analyzed jobs stay on this account." while the sidebar says "Saved on this device" and there is no account.
- Why it fails: The user is told their data lives somewhere it does not.
- Where: `src/components/jd-workspace.tsx` lines 696–699 (added by #162). Local mode writes saved jobs under the data root (`src/lib/jobs/saved-job-store.ts`, `saveLocal`).
- Confidence: high.
- Smallest fix: Choose the sentence from the same `account` value the sidebar uses (`useWorkspaceAccount()`): "on this account" when signed in, "on this device" in local mode. Invariant: footer and sidebar never disagree about where data lives.
- How to prove it: a unit or e2e check in `tests/e2e/home-analysis.spec.ts` that local mode shows "on this device".
- What not to change: the hosted copy.

### F03. Library header bubbles sit between and behind the header controls

- Severity: medium
- Route: `/library`, 1440×900 light and dark; also at 700px and below with smaller bubbles.
- What happened: Four animated decorative circles float inside the header's top-right corner, exactly where Detailed entry, Add achievement, and the My data / Demo data switch sit. A lavender disc shows behind Detailed entry, a peach disc pokes out between the data switch and Add achievement, a violet dot hangs off the button corner, and an orange dot sits on the summary card's top border. Evidence: `%TEMP%\rc-audit-shots\library-header.png`.
- Why it fails: Decoration collides with the primary actions and reads as broken layout.
- Where: `src/components/achievement-library.tsx` lines 352–356 (`.library-page-atmosphere`); `src/app/globals.css` lines 9492–9575 and the 700px overrides at 9617–9647. Fixed pixel offsets do not account for the controls. On `main` since #130.
- Confidence: high, measured and seen. Not checked: every width between 1024 and 1440.
- Smallest fix: Place the atmosphere where no control lives (behind the heading text on the left, or outside the header), or remove it below a width where it cannot clear the controls. Invariant: no decoration overlaps an interactive element's box at any viewport.
- How to prove it: add a Playwright check to the library spec that no `.library-bubble` box intersects any `button`, `a`, or `[role=tab]` box at 390, 768, 1280, and 1440. Repeat by eye in light and dark.
- What not to change: the header controls' layout or the reduced-motion rule.

### F04. Imagination page: native selects and an "Apply changes" instruction with no Apply button

- Severity: medium
- Route: `/library/imagination`, all viewports; seen at 844×390 landscape and 1440×900.
- What happened: On the same screen, "Resume destination" uses the app's custom menu while the footer's "Save to" and the writing controls' target lines are native browser selects. The footer always says "Your PDF updates only after Apply changes." and the create-mode notice repeats it, but this page has no Apply changes button; that button exists only in Resume Studio. The two destination concepts ("Resume destination" and "Save to") sit on one screen without saying how they relate.
- Why it fails: System widgets inside a custom surface, and an instruction that points to a control the user cannot find.
- Where: `src/components/imagination-save-footer.tsx` lines 84–102 (native select) and 109–111 (unconditional PDF note); `src/components/imagination-writing-controls.tsx` around line 273 (target lines select); `src/components/imagination-composer.tsx` lines 39–42 (notice copy). The uncommitted fixes in `re_changer-main` restyle the Studio dialog's button group but not these two files.
- Confidence: high.
- Smallest fix: Use `LibrarySelect` (or the dialog's existing target-lines button group) for both controls. Show the PDF note only when the save destination includes the resume. Invariant: on one screen, every select uses the same control, and every instruction names a control that is present.
- How to prove it: extend `tests/unit/ui/imagination-composer.test.ts` for the note condition and `tests/e2e/imagination-integration.spec.ts` to assert no native `select` on the route. Click-path: `/library/imagination` → change Save to → read the footer.
- What not to change: save destination rules in `src/lib/generation/imagination-save.ts`.

### F05. Builder puts "Build for a saved job" last, below Generate LaTeX

- Severity: medium
- Route: `/generate`, 360×740 and 1440×900 (introduced by #162).
- What happened: The saved-job chooser, which decides the analysis, recommendations, and coverage above it, renders at the bottom of the page under the Generate LaTeX button (y=2053 of 2272 at 360 wide; y=1376 below the footer at 1440).
- Why it fails: The first decision is placed after the final action, so a new user selects points and generates without seeing which job they are building for.
- Where: `src/components/resume-generator.tsx`, the `SavedJobList` render near lines 3234–3243, after `.generation-footer`.
- Confidence: high for placement. Not checked: whether a selected job is visible elsewhere on the screen at every width.
- Smallest fix: Render the chooser (or the chosen job with a Change action) at the top of the builder, before Choose achievements. Invariant: the job context is visible before any action that depends on it.
- How to prove it: extend `tests/e2e/resume-builder-job-context.spec.ts`: the saved-job region precedes "Choose achievements" in DOM order and on screen at 390 and 1440.
- What not to change: saved-job selection behavior itself.

### F06. GitHub import error box follows the operating system theme, not the app theme

- Severity: low
- Route: `/library/github/*`.
- What happened (code): `.error` switches to a dark red background and pale text under `@media (prefers-color-scheme: dark)`, while the rest of the app switches on `:root[data-theme="dark"]`. With the OS in dark mode and the app in light, the error box turns dark on a light page; the reverse gives a light box on a dark page.
- Where: `src/components/github-import/import-workspace.module.css` lines 269–274 (since #130).
- Confidence: medium. Read in code; the library and GitHub agent is confirming it in the browser.
- Smallest fix: Key the dark variant on `:global(:root[data-theme="dark"]) .error`. Invariant: every themed surface follows `data-theme`.
- How to prove it: Playwright with `colorScheme: 'dark'` and app theme light; screenshot the error box.
- What not to change: the error copy.

### F00. The `phase-one` Preview is given a production database key

- Severity: high
- Where it lives: `scripts/provision-github-hosted.mjs` lines 40–42 (service account `github-phase-one@<prod project>`), 85–101 (binds it), 110–169 (creates a user-managed key and publishes it with `publishGithubPreviewSecrets({ GITHUB_FIREBASE_SERVICE_ACCOUNT: ... })`); `scripts/lib/github-hosted-iam.mjs` lines 10–17 grant `roles/datastore.user` on `projects/<prod>/databases/resume-changer`. The script refuses any project other than the `.firebaserc` default, which is production.
- What it means: Code pushed to the `phase-one` branch runs in a Preview that holds a key with read and write access to the whole production database. The Admin SDK ignores Security Rules, so that key can read or change every user's library, history, and saved jobs. `firebase.json` also authorizes the Preview hostnames on the production auth project, so users who sign in there hand production tokens to branch code.
- Why it fails: The runbook states "Preview deployments have no production credentials" (`docs/production-runbook.md` lines 12–14). One user's data must never be reachable by another user or by unreviewed code.
- Confidence: high on what the scripts do. Not checked: whether the key is still set in Vercel and still active in Google Cloud IAM; check both first.
- Smallest fix: Revoke the key and remove `GITHUB_FIREBASE_SERVICE_ACCOUNT` from the Preview environment now. Give the Preview its own non-production Firebase project, or move the GitHub runtime to a server-only production path. Invariant: no Preview environment holds a credential for the production project.
- How to prove it: a check in `scripts/check-hosted-account-config.mjs` (and its unit test under `tests/unit/deployment/`) that fails a Preview build when it sees a production service account; `vercel env ls preview` shows no production secret.
- What not to change: the production deployment's own credentials.

### F07. Adding a skill always fails for signed-in accounts

- Severity: high (hosted)
- Route: `/library`, Skills, Add a skill (added by #159).
- What happens (code): `addSkill` posts with the browser's plain `fetch`, so the `X-Workspace-Account` header that `apiFetch` adds is never sent. In Firebase mode `assertAccountBinding` rejects any mutation without that header with 403 "The active account changed. Reload your workspace before continuing." Reloading cannot fix it. Local mode skips the check, which is why local testing passes.
- Why it fails: A core library action is broken for every real user, and the error message sends them on a useless reload.
- Where: `src/components/library/skill-board.tsx`, `addSkill`, lines 34–38; `src/lib/cloud/security.ts`, `assertAccountBinding`, lines 92–101; `src/lib/cloud/api-fetch.ts` line 56 adds the header.
- Confidence: high from code. Not run against a hosted or emulator session.
- Smallest fix: Call `apiFetch` (as every other client does) and read the body with a JSON fallback. Invariant: every client mutation to `/api/*` goes through `apiFetch`.
- How to prove it: add `/api/library/skills` POST to `tests/account/account-http.test.ts` with and without the header, and an ESLint `no-restricted-globals`/custom rule or a unit test that greps `src/components` for bare `fetch("/api/`.
- What not to change: the server-side binding check.

### F08. Opening a page after an analysis erases that saved job's link

- Severity: medium
- Route: `/` then `/generate` or a reload of `/`.
- What happens (code): Every analysis writes the legacy browser cache (`writeJobAnalysisCache`) but never sets the import marker. On the next load, `loadSavedJobs` treats that cache as a legacy entry and re-saves it with `jobUrl: ""`. The fingerprint matches the saved job (company, role, description), and `nextSavedJob` merges `{ ...existing, ...fields }`, so the stored link is replaced with an empty string and `updatedAt` moves. On hosted accounts this also spends a saved-jobs usage unit per page load.
- Why it fails: Data the user entered silently disappears.
- Where: `src/lib/jobs/saved-job-client.ts`, `loadSavedJobs`, lines 96–134 (`jobUrl: ""` at line 112); `src/components/jd-workspace.tsx`, `handleAnalyze`, lines 335–339; `src/lib/jobs/saved-job-record.ts`, `nextSavedJob`, line 68.
- Confidence: high from code. Not reproduced in the browser yet.
- Smallest fix: Stop writing the legacy cache once saved jobs exist (or set the import marker in the same place the cache is written), and never send an empty `jobUrl` that overwrites a stored one. Invariant: re-saving an identical job never clears a field the user supplied.
- How to prove it: extend `tests/unit/jobs/saved-job-store.test.ts` with "re-save with empty jobUrl keeps the stored link", and `tests/e2e/home-analysis.spec.ts`: analyze with a link, open `/generate`, return, and expect the link on the saved job.
- What not to change: the one-time import of genuinely old browser analyses.

### F09. Accepting the local fallback re-runs the slow AI call first, behind a native confirm dialog

- Severity: medium
- Route: `/generate`, Suggest points, Auto Tailor, or Guided Tailor after an AI failure.
- What happens (code): After a failure the builder shows `window.confirm(...)`. If the user chooses OK, the client re-posts with `allowLocalFallback: true`, but `recommendAchievements` still calls `selectWithAi()` before checking consent, so the user waits through the same AI call again (up to the provider's full timeout and fallback chain) and spends another AI usage unit before local matching runs.
- Why it fails: The user agreed to skip the AI and is made to wait for it again. The most consequential decision on the screen is a browser system dialog.
- Where: `src/components/resume-generator.tsx`, `postWithFallbackConsent`, lines 219–263 (confirm at 251, re-send at 259); `src/lib/ai/achievement-selection.ts`, `recommendAchievements`, lines 647–650.
- Confidence: high from code.
- Smallest fix: When `allowLocalFallback` is true, skip `selectWithAi` and build the fallback directly; replace the confirm with the app's dialog (`StudioDialog`). Invariant: consent to fallback never triggers another provider call.
- How to prove it: extend `tests/unit/api/auto-tailor-route.test.ts` (or the select-achievements route test) to assert the provider's select is called zero times on a consented request; e2e in `tests/e2e/auto-tailor.spec.ts` with a 503 route, accept, and count AI requests.
- What not to change: the requirement that fallback needs explicit consent.

### F10. An Auto Tailor page-fit failure throws away the finished selection and drafting

- Severity: medium
- Route: `/generate`, Auto Tailor.
- What happens (code): After AI selection and drafting succeed, `fitResumeToPage` can throw `PdfCompileError` (for example content exceeds one page). The handler returns only `{ error, code }`, so the recommendation and drafted wording are discarded and the client clears its status. The user's only option is to run the whole multi-minute flow again.
- Why it fails: A partial success is reported as a total failure, and paid AI work is lost.
- Where: `src/app/api/ai/auto-tailor/handler.ts`, lines 241–291.
- Confidence: high from code.
- Smallest fix: On a fit or compile error, still return `recommendation`, `tailoring`, and `selectedSkillIds` with a `compileError` field, and let the builder show the draft with "PDF did not fit; remove a point and compile again". Invariant: work that succeeded is returned even when a later step fails.
- How to prove it: a route test in `tests/unit/api/auto-tailor-route.test.ts` where the fitter throws `PdfCompileError` and the response still carries the proposals; e2e: Auto Tailor with an oversized library shows the draft and a compile error.
- What not to change: the one-page rule itself.

### F11. The builder's step chip is static

- Severity: low
- Route: `/` and `/generate`.
- What happens: Home always shows `01 / 04` and the builder always shows `02 / 04`, whether the user is selecting, has LaTeX, has a PDF, or is in Studio. No `03 / 04` or `04 / 04` exists in the audited tree.
- Where: `src/components/jd-workspace.tsx` line 472; `src/components/resume-generator.tsx` line 1594. The moving chip exists only in the uncommitted work described above.
- Confidence: high.
- Smallest fix: push the uncommitted `generationStep` change, or remove the chip. Invariant: a progress mark is derived from the same state as the action it describes.
- How to prove it: extend `tests/e2e/generate.spec.ts`: the chip reads 02 before generation, 03 after LaTeX, 04 after the PDF.
- What not to change: the eyebrow copy.

### F12. "Save draft" says the builder is ready, but the builder never reads that draft

- Severity: high
- Route: `/` then `/generate`. Reproduced at 1440, same at every width.
- What happened: Saving an unanalyzed draft said "Draft saved in this browser. You can open Resume builder now." The builder opened Northwind Labs, a different saved job, and never read `resume-changer.jd-draft.v1`. While autosave runs, the same orange button shows "Saving...", so it looks pressed when it was not. Analyze, the real next step, is the secondary button.
- Why it fails: The primary action sends the user to build a resume for a job they did not just save.
- Where: `src/components/jd-workspace.tsx` `handleSubmit` lines 386–409 and the Save button at 622–647; `src/components/resume-generator.tsx` lines 542–570 loads saved jobs only.
- Confidence: high. Walked in the browser by [Shell, home, settings](ddccb561-1827-43fb-bc36-4c539d17e510). Not checked while signed in.
- Smallest fix: Make Analyze the primary button. Stop telling the user to open the builder until an analysis exists for this exact draft. Do not show the autosave spinner on Save draft. Invariant: the builder only offers a job the user analyzed and chose.
- How to prove it: `tests/e2e/resume-builder-job-context.spec.ts`: save a draft without analyzing, open `/generate`, and assert the other company is not shown as ready.
- What not to change: autosave and the draft storage key.
- Evidence: `%TEMP%\rc-audit-shell\shots\b1-after-save.png`, `b1-builder-after-save-draft.png`.

### F13. Changing the point selection after generating throws away the resume, the PDF, and unsaved Studio edits

- Severity: high
- Route: `/generate`, every width.
- What happened: After Generate and a compiled one-page PDF, one Studio edit, then ticking a point in Generation settings, Studio, LaTeX, and the PDF all disappeared with no confirm. Regenerating produced a resume without the edit.
- Why it fails: Studio says changes are reversible. One checkbox destroys the compiled PDF and unsaved edits.
- Where: `src/components/resume-generator.tsx` `changeSelection` lines 694–707, and the same `clearPdfOutput(); setResult(null)` in `selectAll`, `clearSelection`, and the skill checkbox at 2118. Studio renders only while `result` exists, so it unmounts.
- Confidence: high. Reproduced twice by [Builder, Studio, history](355a7fa2-6e86-44a5-a796-8b425ed2c989). I confirmed the calls.
- Smallest fix: While settings are open, keep the current result and mark it out of date ("Selection changed. Generate LaTeX to rebuild"). Replace it only when the user generates. If Studio has pending changes, confirm first. Invariant: a compiled PDF or Studio draft is never discarded without an explicit action.
- How to prove it: a builder e2e: generate, compile, edit in Studio, tick a point, and expect the Studio and the PDF to still be there.
- What not to change: a new Generate still replaces the result.
- Evidence: `%TEMP%\rc-audit-builder\f06-after-remove.png`, `f07-after-add.png`.

### F14. "Restore editing session" brings the resume back with zero points selected

- Severity: high
- Route: `/generate`.
- What happened: After reload, Restore showed a resume with 6 achievements, while Generation settings said "0 selected". Ticking one point then hit F13 and the next Generate saved a one-point resume to history.
- Why it fails: The selection count no longer describes the resume on screen, and the next edit rebuilds from an empty selection.
- Where: `src/components/resume-generator.tsx` lines 1694–1717 set `result` and the PDF but never `setSelectedIds` or `setSelectedSkillIds`.
- Confidence: high, reproduced and read.
- Smallest fix: Restore `selectedIds` and `selectedSkillIds` from the saved generation metadata. Invariant: the selection count equals the selection behind the current result.
- How to prove it: builder e2e: generate with 6 points, reload, Restore, open settings, expect 6 ticked.
- What not to change: the job-signature check in `parseStudioSession`.
- Evidence: `%TEMP%\rc-audit-builder\i01-restore-settings-zero.png`.

### F15. Connected chips run off the Imagination canvas, and their remove buttons leave the screen

- Severity: high
- Route: `/library/imagination`, every width below 1728, worst at 360–430.
- What happened: Three connected chips form a row wider than the canvas. `overflow: hidden` clips them, so on a phone the × buttons cannot be reached. At 10 connections the third row is cut by a 96px cap and the connector lines no longer meet the chips. Scrolling the chip box does not move the lines.
- Why it fails: The canvas is supposed to show what is connected and let the user disconnect it.
- Where: `src/components/imagination-connection-canvas.module.css` `.items` lines 129–141 (`margin: 16px auto 0` with no width, `max-height: 96px`); `src/components/imagination-connection-canvas.tsx` `measureConnections` remeasures on resize, not on scroll.
- Confidence: high. Measured in the browser by [Imagination Canvas](b23fe08c-861d-4eea-a67a-308fa449453d). I confirmed the CSS.
- Smallest fix: Give `.items` `width: 100%` and drop the 96px cap so all 10 chips stay visible. Remeasure lines when the chip box scrolls. Invariant: every chip and its × button sit inside the canvas, and every line ends at its chip.
- How to prove it: `tests/e2e/imagination-canvas.spec.ts` at 390 and 1280, connect 3 then 10, and assert each chip is inside the canvas.
- What not to change: `buildConnectionPaths` and the centered connector dots.
- Evidence: `%TEMP%\rc-audit-imagination\mx\390x844-light-3-canvas.png`, `f-1440x900-light-canvas-10.png`.

### F16. "Save achievement" can store the rough notes instead of the imagined version

- Severity: high
- Route: `/library/imagination`.
- What happened: After a suggestion appears, the footer says "Review the facts before accepting this draft" and Save stays enabled, but the editor still holds the rough notes. Save sends that box as `reviewedText`. The suggestion is saved only if the user first clicks "Use suggestion in editor".
- Why it fails: The user accepts a reviewed draft and the library gets the unreviewed notes.
- Where: `src/components/imagination-canvas.tsx` `save` line 258 (`reviewedText: text`) and `canSave` line 435 (`Boolean(text.trim() && groupId)`); `src/components/imagination-result.tsx` `useSuggestion`.
- Confidence: high from the code and the enabled state. Save was not clicked, because the shared library is read-only.
- Smallest fix: While a suggestion differs from the editor, disable Save and say why, or label the button with the text it will save. Invariant: the saved text is the text the user is looking at.
- How to prove it: `tests/e2e/imagination-canvas.spec.ts` with a stubbed `/api/ai/achievement`: either Save is disabled, or the posted text equals the suggestion.
- What not to change: the path where nothing is connected and the user saves what they typed.
- Evidence: `%TEMP%\rc-audit-imagination\bh\ready-1440-viewport.png`.

### F17. Studio Apply puts disabled achievements, and bullets with no source, into the PDF

- Severity: high
- Route: `/generate` Studio Apply, and Imagination create with only skills connected.
- What happened: `renderStudioGeneration` was called with a bullet whose source was `enabled: false` and a bullet with `sourceAchievementIds: []`. Both were written into the LaTeX, and the disabled id stayed in `selectedAchievementIds`. Two real paths reach this: a restored Studio session from before the point was disabled, and Imagination create where only skills are connected, so `sourceIds` is empty while the AI text is accepted.
- Why it fails: Every bullet must trace to an existing, enabled achievement.
- Where: `src/lib/generation/studio-generation.ts` lines 42–66 (no enabled check, no minimum source count) and line 106 (`enabled: true`); `src/lib/generation/studio-document.ts` line 15 (`.max(100)` with no minimum); `src/components/achievement-imagination.tsx` `accept` around 257–317.
- Confidence: high. [Code verification](03f7447e-9afe-4954-b5ca-753fbe21e361) reproduced it with `%TEMP%\rc-audit-verify\t5.ts` (`disabled rendered: true`, `zero-source rendered: true`). I confirmed the renderer forces `enabled: true`.
- Smallest fix: Reject a bullet with zero sources or a disabled source in `renderStudioGeneration` and in `/api/ai/achievement`. In Imagination, accept the proposal only when at least one achievement is connected. Invariant: every rendered bullet has at least one enabled source in its group. Text the user typed with nothing connected becomes a new library point first.
- How to prove it: extend `tests/unit/generation/studio-generation.test.ts` with both cases expected to throw.
- What not to change: the same-group checks at lines 43–61.
- Evidence: the probe output above.

### F18. A skill with no achievement marks a requirement fully supported

- Severity: high under the owner's rule
- Route: `/generate` coverage, and Studio job match.
- What happened: A required qualification such as "3+ years of Python" or "Kubernetes" is `supported` when the only evidence is a skill chip and `coveredByAchievementIds` is empty. The years are not checked. The owner rule is that skill-only support is partial.
- Why it fails: "Supported" is being used for "mentioned".
- Where: `src/lib/ai/requirement-coverage.ts` skill sources around 457–470 and status assignment around 749–758. Confirmed by probe `t2.ts`: `Kubernetes => supported ['skill:s-k8s']`.
- Confidence: high on the code and the probe. Not watched in the live Gemini run, which is still going.
- Smallest fix: When no selected achievement, project, education, or credential covers the requirement, cap the status at `partial`. Invariant: `supported` requires at least one selected achievement.
- How to prove it: extend `tests/unit/ai/evidence-and-coverage.test.ts` with a skill-only requirement expecting `partial`.
- What not to change: adding the JD skill to the skills section, which the owner wants.
- Evidence: `%TEMP%\rc-audit-verify\t2.ts`.

### F19. Switching saved jobs does not cancel the AI request already running

- Severity: medium
- Route: `/generate`.
- What happened (code, not yet driven in the browser): `handleSelectSavedJob` (`resume-generator.tsx` 491–512) does not abort `selectionAbortRef` or `tailoringAbortRef`. When job A's response arrives it is applied, and the session effect (620–648) can store it under job B's signature. A later restore for B brings back A's resume.
- Why it fails: The resume on screen can belong to a different job than the header.
- Confidence: high. [Live resume accuracy](a0c5517d-8281-4df4-8030-d1392b280dc4) reproduced it: a late Fabrikam suggestion, labelled AI, landed under the Contoso header with a summary about React, Next.js, and GraphQL. A later click on Contoso cleared it.
- Smallest fix: Abort in-flight selection, tailoring, and generation in `handleSelectSavedJob`, and ignore a response whose job id is no longer selected. Invariant: a result is applied only to the job it was requested for.
- How to prove it: `tests/e2e/resume-builder-job-context.spec.ts`, delay the tailor route, switch jobs, and assert the first response is not shown.
- What not to change: saved-job selection itself.
- Evidence: code. The self-hash `contextId` is not a separate bug; it only proves the request body is internally consistent.

### F20. An empty AI selection is filled with local matches and still labelled AI

- Severity: medium
- Route: `/generate` recommendations.
- What happened (code and probe): When the model returns a valid result with zero selections, `normalizeAiResult` adds local matches ("Added by local matching…") while `isFallback` stays false because `aiResult` is truthy. The UI heading stays "AI recommendations" and the notice "the AI returned no recommendations" never shows.
- Where: `src/lib/ai/achievement-selection.ts` around 482–637, 693, 713, and 771.
- Why it fails: A local fallback is presented as model output, and the user did not agree to it. Consent exists only when the call throws (F09).
- Confidence: high. Probe returned `mode: "ai"` with local picks.
- Smallest fix: Treat zero selections as the fallback path: ask consent, or set `mode: "local-fallback"` and show the notice. Invariant: `mode: "ai"` means every listed point was chosen by the model.
- How to prove it: `tests/unit/ai/achievement-selection.test.ts` with an empty AI result.
- What not to change: the consented fallback when the provider is down.
- Evidence: the selection probe.

### F21. Choosing or deleting a saved analysis discards what the user just typed

- Severity: medium
- Route: `/`.
- What happened: Clicking a saved analysis replaced the current unanalyzed draft with no warning, and the "Your saved draft was restored" notice stayed above the other job's text. Deleting the selected analysis, after a native confirm that does not mention the form, cleared company and description and left `resume-changer.selected-job.v1` pointing at the deleted id. Focus fell to the page body.
- Where: `src/components/jd-workspace.tsx` `applySavedJob` 200–221 and `handleDeleteSavedJob` 233–264 (`window.confirm` at 234).
- Confidence: high, walked in the browser.
- Smallest fix: Ask in the app's own dialog before replacing a draft that differs from every saved job. On delete, keep the typed text and remove the selected-job key. Invariant: typed text is never discarded without a choice that says so.
- How to prove it: `tests/e2e/home-draft-state.spec.ts` and `tests/e2e/home-analysis.spec.ts`.
- What not to change: selecting a job still loads its analysis.
- Evidence: `%TEMP%\rc-audit-shell\shots\b3-selected-replaced-draft.png`, `d-after-delete.png`.

### F22. Home and the builder disagree about which job is current

- Severity: medium
- Route: `/` and `/generate`.
- What happened: Editing a selected job's description left the analysis panel saying "ready" for the old text, and the builder used the original description. Leaving and returning dropped the selection highlight on home while the builder still opened that job. Clear draft did not clear `SELECTED_SAVED_JOB_KEY`, so the builder still opened the cleared job.
- Where: `src/components/jd-workspace.tsx` mount effect 125–145 reads only the draft; `handleClear` 411–429 does not remove the key; `resume-generator.tsx` 549–570 reads the key.
- Confidence: high.
- Smallest fix: Restore the selected job on mount when the draft still matches it. Clear the key in `handleClear`. Mark the analysis out of date when the form differs. Invariant: home and the builder name the same job.
- How to prove it: `tests/e2e/resume-builder-job-context.spec.ts`.
- What not to change: the builder's "saved job is no longer available" path.
- Evidence: `%TEMP%\rc-audit-shell\shots\b4-builder-after-edit.png`, `b6-cleared.png`.

### F23. Settings in local mode is an unfinished page

- Severity: medium
- Route: `/settings`, every viewport, light and dark.
- What happened: The nav item opens one card, "Available in a later step", with nothing to do.
- Where: `src/app/(workspace)/settings/page.tsx` line 14 renders `WorkspacePlaceholder` outside firebase mode.
- Confidence: high in local mode. Firebase mode, which renders account tools, was not opened.
- Smallest fix: Hide Settings in local mode, or put real local content there (where data lives, theme). Invariant: every nav item opens a usable page.
- How to prove it: `tests/e2e/home-sidebar.spec.ts` asserts no "Available in a later step".
- What not to change: the firebase `AccountDataTools`.
- Evidence: `%TEMP%\rc-audit-shell\shots\settings-1440x900-light.png`.

### F24. Changing the Imagination destination silently drops connected points

- Severity: medium
- Route: `/library/imagination`.
- What happened: Switching from Example Cloud Labs to SampleWorks took the count from 3/10 to 1/10 with no message, and cleared any suggestion.
- Where: `src/components/imagination-composer.tsx` `handleDestinationChange` 89–103 and `reconcileDestinationAchievementIds` 45–63.
- Confidence: high.
- Smallest fix: When connections are dropped, say how many and offer Undo. Invariant: a connection never disappears without a visible message.
- How to prove it: `tests/e2e/imagination-canvas.spec.ts`.
- What not to change: points stay scoped to their destination.
- Evidence: `%TEMP%\rc-audit-imagination\bh\dest-changed.png`.

### F25. Text typed under the Imagination restore notice is not saved, and Restore overwrites it

- Severity: medium
- Route: `/library/imagination`.
- What happened: The restore notice auto-focuses the empty editor. Text typed then was not written to storage, because autosave is skipped while the notice is up. "Restore writing draft" replaced it with no warning.
- Where: `src/components/imagination-canvas.tsx` line 105 (`if (!storageReady || savedDraft) return`) and `restore` 163–173.
- Confidence: high.
- Smallest fix: Dismiss the notice on the first edit, or confirm Restore when the editor is not empty. Invariant: typed text is not discarded without a choice.
- How to prove it: `tests/e2e/imagination-canvas.spec.ts`.
- What not to change: the draft schema.
- Evidence: `%TEMP%\rc-audit-imagination\bh\restore-notice.png`.

### F26. Studio tabs, including Generation settings, are off-screen at laptop widths

- Severity: medium
- Route: `/generate` with Studio open, 360 through 1440.
- What happened: At 1450px and below the tabs become a horizontal strip. It is 1076px wide and only 610px is visible at 1440, so Job match, Revision history, and Generation settings are off-screen, with no arrow, only a thin scrollbar. Labels are cut mid-word.
- Where: `src/app/studio.css` `.studio-navigation` in the `max-width: 1450px` block around 1618–1640. "Generation settings" is `resume-studio.tsx` line 680, and it only reveals the point list; there is no Back to studio step. That step exists only in uncommitted work.
- Confidence: high, measured.
- Smallest fix: Let the tabs wrap, or move Generation settings out of the scroller. Invariant: every Studio tab is reachable without horizontal scrolling at 1024 and wider.
- How to prove it: an e2e at 1280 and 1440 asserting the settings control is inside the viewport.
- What not to change: the vertical rail above 1450px.
- Evidence: `%TEMP%\rc-audit-builder\g11-studio-nav-zoom.png`.

### F27. Recompile ignores pending Studio edits and still says the PDF is ready

- Severity: medium
- Route: `/generate`.
- What happened: With "Draft · 3 changes", Recompile compiled the old LaTeX and showed "PDF ready · 1 page." Only Apply changes includes the edits.
- Where: `src/components/resume-generator.tsx` `compilePdf` around 1245 always uses `result.latex`. The pending count stays inside Studio.
- Confidence: high.
- Smallest fix: While Studio has pending changes, disable Recompile or label it "Recompile last applied version". Invariant: "PDF ready" does not imply it includes unapplied edits.
- How to prove it: builder e2e: edit in Studio, assert Recompile is disabled or relabelled.
- What not to change: Apply validation.
- Evidence: `%TEMP%\rc-audit-builder\g06-after-recompile-pending.png`.

### F28. On a phone, opening a history entry shows nothing, and there is no way back

- Severity: medium
- Route: `/history` at 360, 390, and 430.
- What happened: Tapping an entry only highlights it. The detail starts below the fold (y=782 on a 740px screen) with no scroll and no "Back to list". There is also no "Open in builder", while the intro says "pick up where you left off".
- Where: `src/components/generation-history.tsx` `openEntry` 140–167; the single column is `globals.css` around 5802; actions are 444–473.
- Confidence: high for the layout. The PDF iframe was blank in headless Chromium, so the PDF pixels were not judged.
- Smallest fix: At 700px and below, scroll the detail into view, focus its heading, and add Back to list. Either add Open in builder using that entry's own job, or change the intro. Invariant: the desktop two-column layout stays, and a reopened resume uses the entry's job.
- How to prove it: e2e at 390: open an entry and assert the heading is in the viewport.
- What not to change: list order and filters.
- Evidence: `%TEMP%\rc-audit-builder\hist-open-390-light.png`.

### F29. Local mode accepts writes from another website and from other devices on the network

- Severity: medium. Local mode only. Hosted mode checks origin and account.
- What happened (code): `protectAccountRoute` returns before `assertSameOrigin` when the mode is local (`src/lib/cloud/protect-route.ts` line 32). `scripts/run-local.mjs` line 195 starts Next without a hostname. Next 15.5.28 leaves the host unset on purpose ("We do not set a default host value"), and Node then listens on all interfaces. Handlers call `request.json()` with no Content-Type check, so a cross-site `text/plain` POST parses. `POST /api/library/skills` needs only `{name}`.
- Why it fails: The personal library is meant to stay on this machine. Any site the developer visits, or any device on the same network, can write it, and AI routes can spend the Gemini quota.
- Confidence: high on the code. A live cross-site request was not sent, so the shared libraries were not mutated. Whether current browsers block the cross-site request to localhost was not tested.
- Smallest fix: Pass `--hostname 127.0.0.1` unless the user opts out. Run the same-origin check for non-GET requests in local mode too, and reject bodies that are not `application/json`. Invariant: in local mode, only this browser on this machine can read or change the library.
- How to prove it: extend `tests/account/account-http.test.ts` to local mode, with `Origin: https://evil.example` and `Content-Type: text/plain`, expecting 403.
- What not to change: the GitHub local session, which already requires loopback.
- Evidence: the files above, and `node_modules/next/dist/cli/next-dev.js` lines 192–194.

### F30. Coverage counts skills that were dropped from the PDF

- Severity: medium
- Route: `/generate` after Generate LaTeX, manual and Guided.
- What happened (code and probe): Coverage is recomputed with `renderedSkillIds: selectedSkillIds`, the skills the user asked for. `selectSkillsForResume` keeps only what fits two 100-character rows. The same page shows "N skills shown" from the smaller rendered list. Passing the rendered ids in the probe flipped "Experience with Terraform" from `supported` to `evidence-not-selected`.
- Where: `src/components/resume-generator.tsx` `currentCoverage` around 1462–1478; `src/lib/latex/render-resume.ts` `selectSkillsForResume` 256–320. Manual generation records `renderedSkillIds` but does not set `finalCoverage` (`src/lib/generation/manual-generation.ts` 147–152), so Studio keeps the pre-generation count.
- Confidence: high. [Empty and broken data](28a27c6b-362b-4e3a-a0e4-c5d2779eacba) reproduced it: 16 skill-only requirements showed Covered, then Generate said "11 skills shown · 15 omitted," and six Covered names were absent from both rows.
- Smallest fix: After a result exists, pass `result.metadata.renderedSkillIds`, and store that assessment as `finalCoverage` on the manual result. Invariant: a skill absent from the rendered rows does not count as selected evidence. The two-row cap and the omission notice stay.
- How to prove it: extend `tests/unit/generation/manual-generation.test.ts` and `tests/e2e/requirement-coverage.spec.ts` with more skills than fit.
- What not to change: the preview before generation, which should keep using the requested skills. The separate rule that a skill with no achievement is partial (F18).
- Evidence: `%TEMP%\rc-audit-verify\t2.ts`, `%TEMP%\rc-audit-data-grok\shots\1440-coverage-generated.png`.

### F31. Studio job match prints internal status codes and mixes required with preferred

- Severity: medium
- Route: Resume Studio, job match.
- What happened (code): Each row prints `{requirement} · {status}`, so the user sees `evidence-not-selected` and `no-evidence-found`. The headline counts `uncertain` as partial and pools required, responsibilities, and preferred into one fraction. The builder groups rows but its headline does the same pooling (`coverage-presentation.ts` line 98).
- Where: `src/components/resume-studio.tsx` 1241–1275; `src/lib/generation/coverage-presentation.ts` `summarizeCoverage` 56–101.
- Confidence: high from the code. Not rendered in this pass.
- Smallest fix: Studio should use `summarizeCoverage` and `coverageStatusLabel`, and both screens should count required and preferred separately. Invariant: one module produces the labels and the counts.
- How to prove it: `tests/unit/generation/coverage-presentation.test.ts` with mixed priorities, and `tests/e2e/auto-tailor.spec.ts` asserting no raw status code.
- What not to change: how `requirement-coverage.ts` computes the status.
- Evidence: the code.

### F32. The summary on screen is not the summary in the PDF

- Severity: medium
- Route: `/generate`, Auto Tailor, when the first fit attempt overflows.
- What happened (code): Each overflow removal replaces the summary with `buildEvidenceSummary`, a local template, and that change is not shown. The review panel keeps the AI summary under "Resume summary" and the status still says the AI drafted it. When the model returns no summary, the template is substituted with `mode: "ai"` and no quality note (`tailor-achievements.ts` line 550). The rejected-summary branch at 571 does add a note.
- Where: `src/lib/generation/fit-resume.ts` 477–484; `src/components/resume-generator.tsx` 2156–2159.
- Confidence: high on the path. An overflow was not triggered live.
- Smallest fix: Keep the AI summary unless it cites a removed source. Otherwise show the PDF's summary and say it was built from the evidence. Invariant: the summary on screen equals the summary in the PDF, and local text is labelled local.
- How to prove it: `tests/unit/generation/fit-resume.test.ts` and `tests/unit/ai/tailor-achievements.test.ts` for an empty `resumeSummary`.
- What not to change: the number and year checks on the summary.
- Evidence: the code.

### F33. The owner's name, email, employers, and real resume bullets are in the public repo

- Severity: medium
- What was opened: Nine boards in `docs/ui-images/achievement-library`. `achievement-overview-light-dark.png` shows the owner's name, employers JoyArc and TechSnitch, dates, and bullets. `achievement-card-anatomy.png`, `achievement-card-light-dark.png`, `library-achievement-card-gallery.png`, and `experience-section-card-anatomy.png` show real bullets, some labelled "Ayush resume PDF". `docs/production-deployment-plan.md` line 8 and `firebase.json` line 22 contain `gahtoriayush24@gmail.com`. `docs/UI_Tasks_achievement_library.md` and `docs/UI_Tasks_imagination_canvas.md` name the owner and JoyArc. `tests/e2e/library-cards.spec.ts` and `tests/unit/ui/point-provenance.test.ts` use the label "Ayush resume PDF".
- Why it fails: The runbook says personal data does not go into git. The repo is public.
- Confidence: high for the files opened. The other 28 boards in that folder, and the GitHub integration boards, were not opened. Git history would still hold the old files even after a replacement.
- Smallest fix: Replace the boards with renders of the fictional "Jordan Example" library, change the test label to "Example resume PDF", and take the email out of tracked docs. Invariant: tracked files contain only fictional resume content.
- How to prove it: a unit check that `git grep -i -E "gahtori|joyarc|techsnitch|Ayush resume"` returns nothing.
- What not to change: the repository URLs.
- Evidence: the paths above.

### F35. Save stays available on read-only Demo data and writes the personal library

- Severity: high
- Route: `/library`, then Demo data, at 1440 light.
- What happened: Edit was open on My data. Switching to Demo data showed "Read-only" and "Demo data is read-only. Switch to My data to add or edit achievements." The edit form stayed open with Save achievement enabled. Detailed entry did the same: the add form sat under that notice. No request was sent because Save was not pressed.
- Why it fails: The screen says this library cannot be changed, then offers the button that changes it. The write path always uses the personal library, so a save from the demo URL would change My data.
- Where: `src/components/achievement-library.tsx` line 255 (`canEdit` is personal only), the create form at 464–472 is not inside that check, and `editor={inlineEditor}` is still passed at 531. The notice is `LibraryReadOnlyNotice` in `src/components/library/library-states.tsx` 13–21. `commitLibraryMutation` uses `getPersonalDataRoot` (`src/lib/data/writers.ts` 282–298).
- Confidence: high on the screen and the code. The file change was not watched.
- Smallest fix: Close the editor when the source changes, and do not render it unless `canEdit`. A submit while the URL is `source=demo` must not write. Invariant: demo data never changes the personal library, and the form is absent while the page says read-only.
- How to prove it: `tests/e2e/library-source.spec.ts`: edit a point, click Demo data, assert no Save achievement. Repeat from Detailed entry.
- What not to change: the My data / Demo data switch and the notice itself.
- Evidence: `%TEMP%\rc-audit-library-grok\demo-editor-save.png`, `demo-create-top.png`.

### F36. A missing GitHub import is shown as Analyze, and Connect offers a retry that cannot work

- Severity: medium
- Route: `/library/github/does-not-exist-123` and `/library/github/new`, 1440 light. A bad slug (`BAD_ID!`) correctly 404s.
- What happened: A well-formed id that does not exist opened "Import repository achievements" with Analyze as the current step, "Connect GitHub before starting an import.", and a "Start a new import" link that looks like body text. On the new-import page, Connect GitHub posted `/api/github/connection/start`, then became Reconnect GitHub. The banner said "GitHub App callback setup is missing on this server." while the line under it still said "Connect GitHub above to get started."
- Why it fails: The person cannot tell the import does not exist, and the next action is the one that just failed for a reason this screen cannot fix.
- Where: `src/app/(workspace)/library/github/[importId]/page.tsx` 18–31 passes `routeState="analysis"` for any slug. `src/components/github-import/repository-setup.tsx` 118–133 maps `unavailable` to "Reconnect GitHub". `src/lib/github/server/connection-session.ts` 394–399.
- Confidence: high on this unconnected local server. A configured GitHub App was not tried.
- Smallest fix: An id that is not a live import renders a not-found state and does not mark Analyze current. A missing callback says import is unavailable here and removes Reconnect. A real expired sign-in still offers Reconnect. Invariant: a step mark is current only for an import that exists.
- How to prove it: `tests/e2e/github-import-harness.spec.ts`.
- What not to change: the slug check that 404s illegal ids.
- Evidence: `%TEMP%\rc-audit-library-grok\gh-missing-id.png`, `gh-connect-error.png`.

### F37. Library filter menus open off the bottom of the screen

- Severity: medium
- Route: `/library`. Tag menu at 360 and 390 (1–2 of 27 options on screen), Linked skill at 844×390 (0 of 15; the menu top was at 348px in a 390px-tall screen), Tag at 1024 (the next row sliced).
- What happened: Each menu opens downward and continues past the bottom edge. Its scroll area is mostly off screen.
- Where: `src/app/globals.css` `.library-select-menu` around 3940–3947 (`top: calc(100% + 6px)`, `max-height: min(300px, 42vh)`). `LibrarySelect` does not measure the space below the trigger.
- Confidence: high at those four viewports.
- Smallest fix: Keep the open menu inside the viewport, flipping above the trigger when there is more room above. Invariant: keyboard arrows and the custom menu styling stay.
- How to prove it: `tests/e2e/library-filters.spec.ts` at 844×390.
- What not to change: the six filter labels.
- Evidence: `%TEMP%\rc-audit-library-grok\menu-844x390.png`, `menu-1024x768.png`.

### F38. Skills and Credentials chips land on a closed section

- Severity: medium
- Route: `/library`, 1440 light.
- What happened: With both sections closed, Skills and Credentials highlighted the chip and changed the URL hash, but the section stayed closed. The heading sat at the bottom, under the sticky search bar.
- Where: `src/components/library/category-navigation.tsx` 101–108 only sets the hash. Skills open for a search or a selected skill (`achievement-library.tsx` 615–619). Credentials open only for a search (644–647).
- Confidence: high at 1440. Not repeated at 360.
- Smallest fix: Clicking the chip opens that section and scrolls the heading clear of the sticky bar. Invariant: a later manual collapse still sticks, and the chips stay navigation rather than filters.
- How to prove it: `tests/e2e/library-category-navigation.spec.ts`.
- What not to change: search opening the sections on its own.
- Evidence: `%TEMP%\rc-audit-library-grok\jump-skills.png`, `jump-credentials.png`.

### F39. "All 20" is not the 13 achievement points beside it

- Severity: medium
- Route: `/library`, 1440.
- What happened: The row reads All 20, Jobs 2, Projects 2, Skills 14, Credentials 2, beside "13 of 13 achievement points." All is the sum of those four counts. After the Python chip it read All 4, Jobs 0, Projects 1, Skills 1, Credentials 2, beside "2 of 13 achievement points." The credential count did not change, so it looks like two credentials matched Python.
- Where: `src/components/library/search-workbench.tsx` 62–72. Credential filtering uses the text query only (`src/lib/data/achievement-search.ts` 147–159).
- Confidence: high for the Python filter and a search with no matches. Not every tag was clicked.
- Smallest fix: Give All the same unit as the result line, or label each chip with its unit. Apply the active filters to credentials, or say they are unfiltered. Invariant: the summary tiles keep the whole-library totals.
- How to prove it: `tests/e2e/library-search.spec.ts`, select Python, and assert the credential count is not still 2 unless the label says unfiltered.
- What not to change: "N of 13 achievement points."
- Evidence: `%TEMP%\rc-audit-library-grok\unlisted-skill.png`.

### F40. The point editor uses native controls, and "All experience" is clipped

- Severity: medium for the controls, low for the clip.
- Route: `/library` editor at 1440 light and dark and at 360. The same native project select is on `/library/github/new`. The filter label clips at 768 and 1024.
- What happened: Provenance, Linked skills, and the enabled flag are a native dropdown, a native multi-select, and a native checkbox. The skills list clips the last name, and nothing says multi-select needs Ctrl-click. "All experience" reads "All experi…" at 1024 because its text is 88px in a 76px box. It fits at 360.
- Where: `src/components/achievement-point-editor.tsx` 226–239, 266–277, 297–315, and 451–457. `src/app/globals.css` line 359 is only `accent-color` on checkboxes. `.library-select-value` ellipsizes (3907–3912) and the 3-column rule at `max-width: 1024px` (4157–4160) is overridden by the later `minmax(120px, 1fr)` rule (4169–4175).
- Confidence: high visually. Values were not changed.
- Smallest fix: Use `LibrarySelect` for provenance, parent, and the GitHub project. Replace the multi-select with checkboxes or chips. Put the column rule after the base rule so "All experience" fits. Invariant: stored values do not change.
- How to prove it: `tests/e2e/library-editing.spec.ts` and `tests/e2e/library-responsive.spec.ts` at 1024.
- What not to change: the workbench menus that are already custom.
- Evidence: `%TEMP%\rc-audit-library\lib2\editor-inline.png`, `%TEMP%\rc-audit-library-grok\vp-library-768x1024.png`.

### F41. The skill dot has no visible meaning

- Severity: low
- Route: `/library` Skills, 1440, 360, and dark at 390.
- What happened: Filled chips have a green dot. Outline chips do not. The only explanation, "On current resume" or "Library only," is visually hidden. Python has no dot and still matches 2 points, so a hollow chip is not "no evidence."
- Where: `src/components/library/skill-board.tsx` 97–120. The dot is `.skill-chip.is-listed::before` in `globals.css` 4984–4996.
- Confidence: high for these 14 skills.
- Smallest fix: Show "On resume" or "Library only" as visible text or a one-line legend. Keep the screen-reader text. Invariant: grouping and clicking a chip to filter stay.
- How to prove it: `tests/e2e/library-sections.spec.ts`.
- What not to change: chip roundness.
- Evidence: `%TEMP%\rc-audit-library\lib2\skills-open-1440.png`.

### F42. A preferred skill is marked Covered from the employer description, not the bullet

- Severity: high
- Route: `/generate`, Contoso Grid / Senior Platform Engineer, after Suggest points. About 9 live Gemini calls were used for the whole accuracy pass.
- What happened: Preferred "React for internal tooling dashboards" showed Covered. The first proof was Example Cloud Labs, "Redesigned service boundaries and capacity planning for a multi-tenant processing platform." That bullet does not mention React. The scorer gives the observability bullet 0.75 only when the employer description is included, and 0.00 when it is removed. Full support starts at 0.75. The admin-UI bullet that actually carries the React skill scores 0.50, so it is listed as related and is not what flips the row to Covered.
- Why it fails: The row says this preferred skill is already supported. The words that produce that result are the employer description, "internal developer tooling," plus "dashboards" from an observability bullet.
- Where: `src/lib/ai/evidence.ts` `evidenceText` lines 119–131 includes `context`, and lines 88–103 set that context to `job.description`. `semanticMatchScore` in `src/lib/ai/requirement-coverage.ts` lines 309–325 treats a token overlap of 0.75 as a full score when the requirement has no concept entry. React is not in `CONCEPTS`. The builder labels `supported` as "Covered" in `src/lib/generation/coverage-presentation.ts` lines 10–16.
- Confidence: high. The same function was run on the live library. Not every other requirement was re-scored by hand.
- Smallest fix: Score the achievement's own text, tags, and metrics. Keep the employer description out of that score. A requirement with no concept entry is full only when its distinctive word is in an enabled achievement. Invariant: skill-only support stays partial, and a real React achievement can still be selected.
- How to prove it: extend `tests/unit/ai/evidence-and-coverage.test.ts` with the observability bullet plus "Fictional role supporting cloud services and internal developer tooling," and expect this requirement to stay below supported. Click path: builder, Contoso Grid, Suggest points, expand that preferred row.
- What not to change: adding a job-description skill to the skills section.
- Evidence: `%TEMP%\rc-audit-accuracy\A-gen-suggest.png`, `%TEMP%\rc-audit-live-grok\coverage-evidence.json`.

### F43. After Auto Tailor, bullets say React and the match says there is no evidence

- Severity: high
- Route: `/generate` after Auto Tailor, same Contoso job.
- What happened: The compiled one-page resume has SampleWorks, QueueBoard, and FieldNotes bullets that say "using React." `metadata.finalCoverage` records "React for internal tooling dashboards" as `no-evidence-found` with an empty evidence list. The rewritten sentence is the only text scored. "React" is one of four content tokens, the ratio is 0.25, and anything under 0.50 becomes 0 (`semanticMatchScore` lines 319–324).
- Why it fails: The match panel says the resume has no React evidence while the resume the user is looking at names React in three bullets.
- Where: `src/lib/generation/fit-resume.ts` lines 277–297 pass `renderedTexts` into `assessRequirementCoverage`. `src/lib/ai/requirement-coverage.ts` line 452 uses that rendered sentence as the whole quote. The builder prefers `finalCoverage` at `resume-generator.tsx` lines 1480–1484. Studio prints the raw status at `resume-studio.tsx` 1262–1266 (also F31).
- Confidence: high for the payload and the render path. The Job match tab was not opened on screen after the restore banner disappeared.
- Smallest fix: If the compiled bullet contains the requirement's technology, final coverage has to cite that bullet. A technology that is absent from the bullet still must not become Covered. Invariant: the pre-generation rule in F42 still applies, and one-page fitting stays.
- How to prove it: extend `tests/unit/ai/output-quality.test.ts` with the QueueBoard sentence "Created an operations view using React…" as `renderedTexts`, and expect this requirement to stay off `no-evidence-found`.
- What not to change: the source achievement ids on those React bullets.
- Evidence: `%TEMP%\rc-audit-accuracy\B-auto-done.png`, `%TEMP%\rc-audit-live-grok\auto-resume.tex`.

### F44. An edited job description is warned about on the home page and invisible in the builder

- Severity: medium
- Route: `/` then `/generate`.
- What happened: Appending "EDITED WITHOUT REANALYZE: now also requires GraphQL experience" to Contoso made the home page show 805 characters and "This draft differs from the saved analysis." The preview still listed the original requirements and no GraphQL. The builder then showed Contoso Grid, 740 description characters, badge Analyzed, and "12 requirements extracted," with no differs notice.
- Why it fails: The user can leave the editor believing the extra requirement is part of the job they are about to tailor. The builder presents the previous analysis as current.
- Where: the notice is only in `src/components/jd-workspace.tsx` lines 456–465 and 669–674. `showSavedJob` in `resume-generator.tsx` lines 453–474 copies the saved description and analysis. Lines 1898–1922 always say "Compared with the saved job description" once that analysis exists.
- Confidence: high. Analyze was not clicked again, so the model was not called a second time.
- Smallest fix: If the local draft matches the saved company and role and the description differs, show the same differs notice on the builder. Keep suggestions and tailoring on the saved analysis until the user analyzes again. Invariant: the unanalyzed draft is not sent to the model, and the saved analysis is not overwritten.
- How to prove it: extend `tests/e2e/home-analysis.spec.ts`, which already expects `.saved-job-unsaved` on `/`, and continue into `/generate`.
- What not to change: the home notice.
- Evidence: `%TEMP%\rc-audit-accuracy\D-home-edited.png`, `D-gen-after-edit.png`.

### F45. A demo resume is saved in history with no demo label

- Severity: medium
- Route: `/history` after compiling from `/generate?source=demo`, 390 and 1440 light.
- What happened: The row was titled Platform Engineer, Audit Corp, status PDF saved, provider none. The row, the facts panel, and the history schema have no data-source field. The stored TeX begins `ResumeHeader{Jordan Example}`.
- Why it fails: History is where a person comes back to reuse a resume. A fictional demo PDF sits there with the same labeling as a personal one.
- Where: `createHistoryRequest` in `src/components/resume-generator.tsx` lines 182–209 omits `metadata.dataSource`, which manual generation does set (`manual-generation.ts` line 234). `GenerationHistoryEntryFieldsSchema` is strict and has no source field (`src/lib/schemas/resume-data.ts` 1457–1473). The row renders role, status, and company (`generation-history.tsx` 352–366).
- Confidence: high in local mode. The PDF viewer text was not read; the stored TeX identifies the demo document.
- Smallest fix: Store the source on the history entry and show "Fictional demo data" on demo rows. Invariant: personal and demo entries can share one archive, and a demo row stays labelled demo after the library toggle changes.
- How to prove it: extend `tests/e2e/builder-task-10-source-choice.spec.ts`. Click path: Demo data, Generate LaTeX, Create PDF, open `/history`.
- What not to change: a failed compile stays "PDF unavailable."
- Evidence: `%TEMP%\rc-audit-data-grok\shots\1440-history-demo.png`.

### F46. An empty library cannot accept its first achievement

- Severity: medium
- Route: `/library` and `/library/imagination`, profile only, 1440 light.
- What happened: The empty state says "Add an achievement." The required Job or project select has no options, and both sections say none are saved. There is no control that creates a job or project. Imagination says "No resume destinations available" and "No save destination is available for this data source," which sends the person to switch source. Demo data is read-only, so that switch cannot save the achievement either.
- Why it fails: The empty state tells the person to add an achievement, and the form it opens cannot be finished. The Imagination sentence blames the data source when the personal library is valid and empty.
- Where: `LibraryEmptyState` (`src/components/library/library-states.tsx` 73–84) calls `openEditor`. Parents are only `library.jobs` and `library.projects` (`achievement-library.tsx` 265–276). The select is `achievement-point-editor.tsx` 224–238. `writers.ts` exports `createAchievementPoint` and `createSkill` only. Imagination: `hasLibraryDestination` is `groups.length > 0` (`achievement-imagination.tsx` line 102) and the footer copy is `imagination-save-footer.tsx` 104–107.
- Confidence: high. GitHub import was not tried as a way to create the first job.
- Smallest fix: When there is no job or project, collect one before asking for an achievement. On Imagination, say a job or project is required. Keep the data-source sentence for demo data, which is actually read-only. Invariant: an achievement still belongs to one parent, and demo mode still cannot write.
- How to prove it: a library empty-state test with `jobs: []` and `projects: []`, plus an imagination save-destination test with `source: "personal"` and no groups.
- What not to change: the already-filed Imagination "Apply changes" note and the native Save to select.
- Evidence: `%TEMP%\rc-audit-data-grok\shots\1440-empty-add.png`, `1440-empty-imagination.png`.

### F47. The builder points at coverage that is not on the page

- Severity: low
- Route: `/generate` before Suggest points, 390 light. Also seen on the live server with a saved analysis and no recommendation.
- What happened: The job analysis said "17 requirements extracted. The coverage below shows how selected evidence supports each one." The next region was the achievement search. The requirement list appears only after Suggest points.
- Where: `src/components/resume-generator.tsx` lines 1915–1922. `.selection-coverage` renders only when `recommendation` exists (line 1944).
- Confidence: high.
- Smallest fix: Render the current coverage under that sentence whenever an analysis is ready, or change the sentence until a recommendation exists. Invariant: coverage still describes the current selection.
- How to prove it: a builder test that loads a saved analysis, does not click Suggest points, and expects either the list or a sentence that does not say the list is below.
- What not to change: the dropped-skill fix in F30.
- Evidence: `%TEMP%\rc-audit-data-grok\shots\390-oversized-generate.png`.

### F48. A library with every point disabled looks empty in the builder, and schema errors run together

- Severity: low
- Route: `/generate` and `/library`, 390 and 1440 light.
- What happened: With all 13 points disabled, the library still listed them as Disabled. The builder said "0 selected · 0 enabled" and "This library has no enabled achievement points," with no link to turn them back on. A duplicate achievement id and a missing skill id produced one wrapped paragraph on the builder. The library and Imagination pages put each issue on its own line, and the duplicate-id issue does not name the id. The page still offers "Open fictional demo data" as a link.
- Where: `resume-generator.tsx` 2646–2649. `formatDataLoadError` joins issues with newlines (`src/lib/data/loaders.ts` 91–97). The library error uses `white-space: pre-line` (`globals.css` 5024–5025). `.generation-error > p` does not (`globals.css` 8265–8268). The unique-id issue has an empty path (`resume-data.ts` 923–929).
- Confidence: high for these fixtures.
- Smallest fix: When disabled points exist, say how many are turned off and link to the library. Give the builder error the same pre-line treatment and include the duplicated id. Invariant: disabled points stay out of the resume until enabled, and personal data stays unloaded until it validates.
- How to prove it: a builder empty-state test with every point `enabled: false`, and a loader rendering test for `/generate`.
- What not to change: the library Disabled badge and the explicit demo link.
- Evidence: `%TEMP%\rc-audit-data-grok\shots\1440-disabled-generate.png`, `1440-badschema-generate.png`.

### F49. Signed-in Generate, Compile, history save, and history delete never send the account header

- Severity: high for a hosted account. Local mode skips the check, which is why these walks passed.
- Route: `/generate` and `/history`.
- What happened (code): `assertAccountBinding` rejects every mutation that omits `X-Workspace-Account` with 403 "The active account changed. Reload your workspace before continuing." `apiFetch` is what adds that header. These calls use plain `fetch`: Suggest, Guided Tailor, and Auto Tailor (`resume-generator.tsx` line 225), Generate (1207), Create PDF (1264), history save (418), and history delete (`generation-history.tsx` 178). Reloading does not add the header. Add skill is the same miss, already F07.
- Why it fails: A signed-in person cannot generate, compile, save, or delete a resume. The message tells them to reload.
- Where: the lines above, and `src/lib/cloud/security.ts` `assertAccountBinding` 92–100.
- Confidence: high on the code. Not run against Firebase. History list and open are GET, so they still work without the header.
- Smallest fix: Send every one of these through `apiFetch`. Invariant: every client mutation to `/api/*` goes through `apiFetch`, and local mode still works with no account header.
- How to prove it: extend `tests/account/account-http.test.ts` for `/api/generate`, `/api/compile`, and `/api/history` POST and DELETE without the header, expecting 403, and a component test that the builder calls `apiFetch`.
- What not to change: a real account switch still asks for a reload.
- Evidence: the call sites above.

### F50. A failed delete looks successful and erases the open draft

- Severity: high
- Route: `/`, 1440 light.
- What happened: `DELETE /api/job-analyses/:id` returned HTTP 200 with an empty body, and again with a malformed body. The card disappeared, company, role, and description were cleared, and the only status was "No saved draft." Reload showed the three saved jobs still on the server. Abort, 400, 401, 403, 409, 429, 500, 502, and 503 left the card and showed an error.
- Why it fails: The screen reports a completed delete and throws away the draft. The analysis is still saved.
- Where: `deleteSavedJobRequest` in `src/lib/jobs/saved-job-client.ts` lines 73–81 treats every `response.ok` as success and does not read the body. `handleDeleteSavedJob` in `jd-workspace.tsx` 239–256 then removes the card and calls `clearDraft`.
- Confidence: high. Reproduced for empty and malformed 200. A 204 was not tried. History delete does parse the body and keeps the row, which is the right behavior.
- Smallest fix: Remove the card and clear the draft only after a parsed success body. A 200 with an empty or broken body stays on the error path. Invariant: a confirmed delete still removes that job, and resumes already in history stay there.
- How to prove it: `tests/e2e/home-analysis.spec.ts`: open a saved job, intercept DELETE with an empty 200, confirm, reload, and expect the job back and the draft kept.
- What not to change: the history delete path.
- Evidence: `%TEMP%\rc-audit-failure-grok\delete-empty200.png`.

### F51. An empty history save is reported as saved

- Severity: high
- Route: `/generate` after Generate LaTeX and after Create PDF.
- What happened: `POST /api/history` returned HTTP 200 with an empty body, and again with `{"ok": tru`. The builder showed "Saved to generation history on this device." and "LaTeX ready." The request never reached storage. Abort, 500, 502, and 429 correctly said the resume was ready but history could not be saved.
- Why it fails: The person is told the resume is in their archive. It is not, and there is nothing to retry.
- Where: `persistGeneration` in `resume-generator.tsx` lines 425–431. `response.json().catch(() => ({}))` turns a bad body into `{}`, then `response.ok` alone selects the saved sentence.
- Confidence: high for both generate and compile. History was not reopened to count rows; the intercepted request is enough.
- Smallest fix: Require a parsed history record before the saved sentence. Any other 200 uses the existing "could not be saved" sentence. Invariant: LaTeX and a verified PDF stay on screen either way.
- How to prove it: `tests/e2e/generation-history.spec.ts`: generate with the history POST intercepted as an empty 200.
- What not to change: a real 500 or 502 keeps the partial-success wording.
- Evidence: `%TEMP%\rc-audit-failure\builder-historyOnGenerate-empty200.png`.

### F52. Changing the selection while Generate is running is accepted, then ignored

- Severity: high
- Route: `/generate`.
- What happened: With an 8 second delay on `POST /api/generate`, the button said "Generating…", the checkboxes stayed enabled, and there was no Cancel. Unchecking one point and checking another was accepted. The resume that appeared still contained the unchecked point and did not contain the new one, with "LaTeX ready."
- Why it fails: The busy screen invites a correction, then delivers a resume for a selection the person has withdrawn. This is separate from F13, which discards a finished resume after Generate returns.
- Where: the checkbox at `resume-generator.tsx` 2687–2689 is disabled for recommending and tailoring, not for `isGenerating`. `requestGeneration` 1207–1229 has no `AbortController` and always applies the in-flight response.
- Confidence: high for one delayed generate.
- Smallest fix: Disable the checkboxes, Select all, and Clear while `isGenerating`, and ignore a response if the selection changed. Invariant: the ids in the resume are the ids that were submitted.
- How to prove it: `tests/e2e/generate.spec.ts`: delay `POST /api/generate`, toggle a box, and compare the Studio bullets with the checks.
- What not to change: Suggest and tailor already disable those boxes.
- Evidence: `%TEMP%\rc-audit-failure-grok\generate-selection-race.png`.

### F53. A history load failure looks like an empty archive

- Severity: high
- Route: `/history`, with resumes already stored.
- What happened: `GET /api/history` as HTML 502, empty 200, malformed 200, 400, 401, 429, and 500 each showed "0 saved resumes", "Your archive starts here", and "Create a resume", with the parser or server sentence above that. Refresh after removing the intercept restored 46 entries. Refresh while offline kept the 46 and showed "Failed to fetch."
- Why it fails: The count and the empty-archive copy say there is nothing saved. The resumes are still there.
- Where: `refreshEntries` in `generation-history.tsx` 60–75. `response.json()` has no catch, so an HTML body becomes the parser sentence. The initial state is an empty list, the count is `entries.length` (236–243), and the empty copy (389–412) renders whenever that list is empty, including when `error` is set.
- Confidence: high. 403, 409, and 503 use the same path and were not clicked separately.
- Smallest fix: When load throws, keep the previous entries and show the error. On a first load, replace the empty-archive copy with the error. Invariant: a truly empty account still gets "Your archive starts here."
- How to prove it: `tests/e2e/generation-history.spec.ts`: intercept the list with an HTML 502, then Refresh with the intercept removed.
- What not to change: opening or deleting one entry already keeps the rest of the list.
- Evidence: `%TEMP%\rc-audit-failure\pages-historyList-502.png`.

### F54. Other failure behavior from the same sweep

These were reproduced on port 3043. Each names the cause.

- Opening a saved job on HTML 502, empty 200, or malformed 200 says "Saved job not found." The job is still in the list. `readSavedJob` (`saved-job-client.ts` 41–48) uses that sentence whenever the body has no `job`. Use it only for a parsed 404. Evidence: `%TEMP%\rc-audit-failure\home-openJob-502.png`.
- The saved-job list failure is only "Saved job analyses could not be loaded." The 401 and 429 text is dropped and there is no Retry (`jd-workspace.tsx` 147–156). Show `error.message` and a Retry.
- Create PDF stays on "Compiling…" and Download stays disabled until the history save returns, even after the PDF tab is enabled (`compilePdf` sets the URL at 1304–1312, then awaits `persistGeneration` at 1313). Clear the compiling state once the PDF checks pass.
- A failed compile plus a failed history save says "Resume output is ready… You can keep using this output" while the PDF tab is disabled (`persistGeneration` catch at 433–436). Say the output is ready only after a verified PDF or existing LaTeX.
- HTML 502, empty 200, and malformed 200 show `Unexpected token '<'`, `Unexpected end of JSON input`, or `Failed to execute 'json'` on Analyze, Suggest, Guided Tailor, Auto Tailor, Apply, History, Ask Imagination, and Save achievement. The Skills tab shows that sentence under the capacity bars while Overview still says "LaTeX ready." Catch a parse failure and use one product sentence. Evidence: `%TEMP%\rc-audit-failure\builder-guided-502.png`, `%TEMP%\rc-audit-failure-grok\skills-502.png`.
- The history PDF pane renders the error body in the iframe while the badge stays "PDF saved" (`generation-history.tsx` 496–500). Show an error and a retry instead of the raw body.
- When analysis succeeds and saving the job fails, the only retry is Reanalyze (`job-analysis-panel.tsx` 100–104). Add "Save this analysis" for the result already on screen.
- Analyze, Suggest, and Apply show a busy label and cannot be cancelled. Clear draft is the only thing that aborts Analyze, and it also erases the form. Add a Cancel that aborts the request and leaves the draft.
- A 429 with `Retry-After: 30` never shows 30 seconds, and the button is enabled again immediately. No client reads `Retry-After`.

Failure sweep, checked and fine: typing in company, role, description, builder search, and history search sent no API calls. Double-clicking Analyze, Suggest, Guided Tailor, Generate, Create PDF, Apply, and Add skill each sent one mutation. JSON 4xx and 5xx on analyze, suggest, tailor, generate, compile, library points, and library skills kept the draft or the form and named the server error, except where F54 says the sentence was dropped. A good PDF with a failed history save correctly says "PDF ready" plus the save warning. History delete of an empty 200 keeps the row. Library point and skill saves collapse a bad body into "Could not reach the local save service" and do not claim success. A routed compile that is not a PDF says "unverified PDF" and does not open the PDF tab. Reloading during Analyze restores the draft and the idle button.

Data states, checked and fine: the sample library hash matches `examples/sample-resume-library.json` again. A missing or invalid library leaves the home form usable and does not swap in demo data. Long titles, a 600-character achievement, and 60 skills wrap at 360, 390, and 1440, with no horizontal scroll. Forty achievements compiled to "This resume must fit on one page; the compiled document has 2 pages." The LaTeX stayed on screen and history stored the attempt as failed, "PDF unavailable." Demo mode on Imagination shows the read-only notice and does not open the editor. "Emphasize engineering impact" clipped at 390 is the same preset already listed in F34.

Live accuracy, checked and fine: required and preferred stayed separate for Contoso and Fabrikam. Guided and Auto Tailor bullets traced to enabled ids. The disabled achievement `achievement-cloud-deployment-platform` was in neither resume. Employers, titles, dates, project names, education, and both credential names matched the library. 28% and 20% are the library metrics. The resume did not claim 6+ years, and that requirement stayed "no evidence found." Experience order matched the PDF: current Example Cloud Labs, then SampleWorks. One page came from the compiler (`X-PDF-Pages: 1` and measured `pageCount` 1). A settled job switch followed the selected job and made no AI call. A routed 503 asked before any local fallback, Cancel sent no second request, and Accept was labelled "Local matching fallback." The consent control is still the native confirm already filed in F09. Skill-only Covered was reproduced and is F18. Dropping "synthetic benchmark" from the 28% bullet is within the allowed stretch.

Library walk, checked and fine: search, the no-match state, the 28% metric card, summary tiles (2 jobs, 2 projects, 13 points, 14 skills, 2 credentials), chip wrapping at 360, dark mode, and no horizontal overflow from 360 through 2560. At 1920 and 2560 the column stays about 1440px wide. Demo data is labelled, and Edit is hidden when no form is already open. The mobile drawer traps focus. Header bubbles and the GitHub theme bug were already filed.

### F34. Lower-severity items from the same walks

These were reproduced or read. Each names its owner and the check that would lock it.

- Analyze moves focus to the page body because the button is `disabled` while busy (`jd-workspace.tsx` line 594). Use `aria-disabled`. Prove in `tests/e2e/home-accessibility.spec.ts`.
- On a phone, the analysis renders about 1,400px below the Analyze button with no scroll (`jd-workspace.tsx` 683–689). Scroll the heading into view at 700px and below.
- Dark mode flashes light on every load. Theme is applied in `useEffect` (`workspace-shell.tsx` 116–120) with no script in `src/app/layout.tsx`.
- "Saved on this device" sits next to "Fix the highlighted fields before saving" (`jd-workspace.tsx` 162–181 versus 386–409).
- "No analyzed jobs yet" shows while the list is still loading (`saved-job-list.tsx` 38–39). Home load took about 8 seconds in dev.
- Saved analyses are a bordered card inside the bordered form, and each job is another bordered card (`globals.css` `.saved-jobs` around 1811).
- At 844×390, expanding the sidebar clips Settings. `.sidebar` is sticky with no `overflow-y` (`globals.css` 379–396).
- The Imagination instruction starts as real text, "Create a concise, factual achievement…", and the placeholder repeats the label (`imagination-writing-controls.tsx` 31–32 and 242). Start empty and use the default as the placeholder, which the Studio dialog already does.
- Disabled Ask and Save never say why (`imagination-canvas.tsx` 383–386 and 435).
- The canvas says "Hold and drag" on touch screens, and the hint card covers the helper at 768 and 1280 (`imagination-connection-canvas.tsx` 322–343).
- The sticky save footer is 105px, 27% of an 844×390 screen (`globals.css` 9425–9440).
- "Emphasize engineering impact" is clipped at 360, 390, and 1280. The dismiss control is 15×15 and "Start with a draft" is 22px tall and only focuses an editor that is already focused.
- Builder status "Saved to generation history" stays after the resume is discarded (`resume-generator.tsx` 1684–1688).
- Native selects remain in Studio: company or project, and achievement destination (`resume-studio.tsx` 1328 and 1517).
- Studio dialogs at 360px stop 38px short of the right edge because `.studio-dialog` sets `width: 100vw` but not `max-width` (`studio.css` 1814–1820).
- Plurals are wrong: "1 changes", "1 achievements", "1 template lines". Manual resumes show the provider as the raw word "none".
- "Choose a saved job" is 17px tall and "Back to editing" is 15px, under a 24px touch target.
- Delete uses `window.confirm` in history (`generation-history.tsx` 170) and for saved jobs (`resume-generator.tsx` 516). Local delete says the files were deleted even when removal fails (`history-store.ts` 231–243). Hosted cleanup retries one deletion per history load (`cloud/history-store.ts` 266–276).
- The builder Role row prefers `analysis.targetTitle`, so the model's "Not specified" hides the user's role (`resume-generator.tsx` 1518–1528, `coverage-presentation.ts` 123–130).
- The job-analysis badge follows the suggestion request: Suggest points shows "Analyzing…" and a failed suggestion marks a valid analysis "Unavailable" (`resume-generator.tsx` 1529–1535).
- The builder point picker uses stored job order; the PDF uses `orderExperiencesForResume` (`resume-generator.tsx` `getPointGroups` 152–169, `render-resume.ts` 175). It shows up when an imported library is not already date-sorted.
- GitHub connect, repository select, and disconnect skip `assertAccountBinding` (`connection-session.ts` 328–336, 642–655, 1142–1145).
- `GET /api/resume/skills` runs Tectonic and is not charged to the compile quota, because quota applies only to non-GET (`protect-route.ts` 53, `skill-measurements.ts` 107–122).
- The 40-job cap is checked before the Firestore transaction (`cloud/saved-job-store.ts` 93–130), so two saves at 39 can both pass.
- `.github/workflows/live-integrations.yml` puts `GEMINI_API_KEY` on the whole job, so `npm ci` on a same-repo pull request can read it. Move it to the live-test step.
- `gemini-provider-core.ts` 1001–1006 logs `missing`, which contains job-description phrases. Log the count only.
- HTTP and rules tests omit `/api/job-analyses`, `/api/library/skills`, a 41st save, and the job-analysis rule attacks listed by [Code verification](03f7447e-9afe-4954-b5ca-753fbe21e361).

### Checked and fine, from the finished walks

- No horizontal page scroll on `/`, `/settings`, `/generate`, `/history`, or `/library/imagination` at the 12 viewports, in light, and in dark at 390 and 1440. No touch target under 24px on home. The mobile drawer traps focus, locks scroll, and returns focus on Escape.
- Collapsed-rail labels painted above the home page. The brief's "labels behind the page" did not reproduce on `/`.
- Mock analysis of an identical job did not create a duplicate saved entry. A second role did.
- Imagination: the 10-item cap blocks the 11th and says why. Keyboard connect, Escape, Cancel back to the library, and the mock 503 ("Imagination is unavailable… You can continue editing manually") all behaved honestly. One AI request per click.
- Builder: experience order in Studio matched the LaTeX (current role first). The "1 page" claims that were checked came from the compiler response, not from the model. Selecting all 13 sample points still compiled to one page. A two-page resume was not forced, so the overflow wording was not seen.
- Guided and Auto Tailor reject unknown and disabled achievement ids on the server. Employers, titles, and dates are copied from the library records, not from bullet text. Rewrites that invent tools are allowed under the owner's rule; the validators are stricter than that rule and revert unsupported terms with a quality note, which is shown. That is a policy mismatch, not a bug.
- Hosted routes checked in code still require same-origin and the account header, except the GitHub connection routes in F34.

### U01. Uncertain: page scrollbar stays light in dark mode in the embedded browser

`:root[data-theme="dark"]` sets `color-scheme: dark` (`src/app/globals.css` line 215), yet the document scrollbar rendered light in Cursor's embedded browser. This may be the host browser. Decide with a headless Chromium screenshot in dark mode; file only if it reproduces there.

### U02. Uncertain: hydration attribute mismatch on the skip link

Next's dev overlay reported a hydration attribute mismatch at `src/components/workspace-shell.tsx` line 264 (the skip link) in the embedded browser. It can come from the host injecting attributes. Decide by loading `/` in clean Playwright Chromium and checking the console for the same warning.
