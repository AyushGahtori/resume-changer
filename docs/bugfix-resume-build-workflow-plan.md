# Bug-Fix Plan: Resume Build Workflow

## Status

- Branch: `codex/bugfix-resume-build-workflow`
- Base: `origin/main` at `5443b4b` when this branch was created
- Current phase: implementation and verification complete; awaiting an explicit push request
- Implementation: approved in the user's 2026-10-15 request to complete this checklist
- Push: not requested

## Goal

Make the existing Suggest points → Guided Tailor → LaTeX/PDF workflow choose relevant, evidence-backed content across the user's jobs and projects, make remaining JD coverage understandable, and keep the final resume compact. Fix confirmed gaps in completed behavior here. Defer work that belongs to a later roadmap task instead of implementing it early.

## Investigation Findings

### JD draft isolation

- `src/lib/jd-draft.ts` stores one active draft under `resume-changer.jd-draft.v1`; saving a newer draft overwrites that active slot. The app does not currently maintain a list of older JDs.
- `src/lib/jd-analysis-cache.ts` stores one analysis and validates it against the exact company, role title, and description. Editing any of those fields clears the cached analysis.
- `src/components/resume-generator.tsx` reads that same active draft and sends its description and matching analysis to Suggest points. Guided Tailor receives that same description and analysis plus the selected achievement IDs.
- Finding: accidental mixing of multiple saved JDs is not supported by the current storage flow, so this is not the cause of the reported selection issue. A multi-JD library is a future feature, not a bug fix.

### Suggest points and source diversity

- `src/lib/ai/prompts/v1/select-achievements.ts` currently says not to use fixed bullet counts per role and to prefer source diversity only when relevance is comparable. This explains why the model can choose several points from one job and omit another job or a project when it ranks those points higher.
- `src/lib/ai/achievement-selection.ts` sends enabled job and project points, then normalizes AI selections and fills remaining budget using local lexical matching. Selection is constrained by the estimated one-page content budget.
- Existing tests cover some cross-section behavior, but do not guarantee the distribution requested here across multiple job groups and projects.
- Finding: the observed distribution is a real mismatch with the user's desired product behavior, but not a violation of the current Task 15 prompt. The desired group-balancing policy must be made explicit and tested; it should not select irrelevant evidence just to satisfy a quota.

### Requirement coverage and evidence

- The current UI renders each extracted requirement as a text row labeled Covered or Uncovered. “Covered” currently means the selected points have evidence associated with that requirement; it is not a general statement that the user's entire library contains no relevant experience.
- Existing matching uses model-provided coverage plus deterministic term/skill matching. Indirect evidence can be missed, while an actually unsupported qualification must remain uncovered.
- The local server logs do not persist or print raw Gemini prompts/responses. Recent logs show an initial Gemini `HTTP_503` followed by retry requests; a Guided Tailor request first returned `503`, and a later retry returned `200`. That points to a transient provider failure for the visible error, not proof that the selection prompt caused it. The actual model response body is not available in those logs, and must not be claimed as inspected.
- Finding: after approval, reproduce the selection issue with a controlled fixture and a privacy-safe trace of IDs, source groups, coverage IDs, scores, and budget only. Do not log job-description text, achievement text, API keys, or raw model responses.

### Guided Tailor handoff

- The stages are not completely disconnected: Guided Tailor receives the active JD, its analysis, and the selected IDs, then rebuilds evidence and supported skills for those selected points.
- It does not receive the selection stage's requirement-to-point coverage map or explicit unresolved gaps. It also cannot use points that Suggest points did not select.
- Task 16, **Add AI Resume Draft Generation**, is the planned owner for supported JD-term rewriting and distinct Guided/Auto workflows. Defer the richer selection-to-drafting coverage handoff and any Auto Tailor behavior to Task 16. Do not expand the current bug-fix implementation into the full Task 16 feature.
- Preserve the existing truthfulness rule: only inject a JD term when the selected source text or linked skill evidence supports it. An uncovered item must not be marked covered by inventing a skill or experience.

### Guided Tailor review controls

- Each proposal can be edited and approved individually; the UI has a “Select all” control for source points, but no bulk approval control inside the Guided Tailor review.
- Finding: the requested approve-all action is a current interaction gap and can be addressed here, with an explicit reversible “Approve all proposals” control. Editing a proposal must return that proposal to unapproved state.

### Technical skills section

- `src/lib/latex/render-resume.ts` renders every selected skill, grouped by category. The current path has no hard cap on category rows and does not rank the skill list against the active JD.
- The provided PDF screenshot shows a crowded skills section. This is a current output-quality issue, not explicitly guaranteed by the remaining Task 16 or Task 19 wording.
- Finding: the proposed hard requirement is at most two rendered skill rows. The selected set should be role-relevant and evidence-backed; if more skills qualify, keep the strongest supported subset rather than shrinking fonts/spacing or overflowing. Verify the final compiled PDF, not only the LaTeX string.

### Future work already on the roadmap

- Task 16 owns generated wording, supported keyword injection, and the Guided/Auto Tailor distinction. Handoff details above are deferred there.
- Task 19 owns the broader review workspace, generated-content overrides, and presentation of analysis, selected evidence, LaTeX, and PDF together. Keep this branch's coverage UI changes focused; defer a full workspace redesign to Task 19.
- Task 21 covers generated-resume history, not a library of saved job descriptions. The JD library requested here is recorded separately in `docs/project-plan.md` as a future feature.
- ATS readiness checking is not currently a numbered task; it has been added to the future-feature section of `docs/project-plan.md`, not this implementation scope.

## Proposed Work Checklist

The checked items below passed focused tests, regression checks, and visual review of a compiled fictional PDF. The fixed baseline uses only fictional job and resume data; no personal resume text or provider response body is logged.

- [x] **1. Reproduce and record a baseline.** The synthetic ML-platform JD in `tests/unit/ai/achievement-selection.test.ts` initially supplies two IDs from `job-cloud-one`; the final selection includes `achievement-feature-store` from `job-ml-two` and `achievement-project-queue` from `project-model-queue`. The estimated budget is 18 / 22 lines. Linked Python and explicit feature-store evidence are available; Pacific-time availability has no matching point. Only IDs, source groups, coverage, and budget appear in this record.
- [x] **2. Clarify source diversity policy.** The prompt and deterministic budget pass now aim for relevant job/project representation, with 3–4 per job and 1–2 per project as soft targets. A project is included when relevant evidence and the page budget allow it; a budget-constrained test confirms an omitted group is reported.
- [x] **3. Improve requirement matching without false coverage.** The selection response separates available evidence from selected evidence. Tests cover linked Python, distributed ML evidence, explicit feature-store work, and an unsupported availability requirement. Model coverage IDs are checked against identifiable evidence before being treated as covered.
- [x] **4. Improve the coverage UI.** The panel shows a covered/total indicator, grouped qualifications and responsibilities, three coverage states, and expandable source evidence. A browser test checks updated coverage after deselection and narrow-viewport width.
- [x] **5. Add Guided Tailor bulk approval.** Users can approve unchanged proposals together or revoke all approvals. Editing resets approval; edited proposals require individual approval. Playwright verifies these transitions and the resulting LaTeX.
- [x] **6. Limit technical skills to two rows.** Skills are ranked using the active JD and selected-point links; the renderer caps categories and row length. Generation metadata reports shown and omitted skills. A dense fictional library compiles to a valid one-page PDF; the rendered page was visually checked for row/rule overlap.
- [x] **7. Verify the end-to-end result.** A fixed fictional analysis selects evidence from two jobs and a project, generates LaTeX, and compiles a one-page PDF. Unit, API, Playwright, and real compiler tests cover the affected stages.
- [x] **8. Run project checks.** Changed-file Prettier, lint, typecheck, 141 unit tests, 29 Playwright tests, real PDF toolchain tests, and the production build pass. The live Gemini test used fictional data but received `RATE_LIMITED` / HTTP 429 on all three requests; it is an external quota result. Repository-wide `npm run format:check` still flags 53 untouched files; changed-file formatting passes.
- [x] **9. Final review and delivery.** Reviewed the implementation diff and worktree status; `git diff --check` passes, nothing is staged, and no secret or private resume file is among the changes. Task 16/19 and the future features below remain deferred. The branch is unpushed, awaiting an explicit push request.

## Explicitly Deferred

- A richer requirement-coverage handoff from Suggest points to Guided Tailor, plus the complete supported-term drafting behavior and Auto Tailor: **Task 16**.
- Full side-by-side review workspace and broader manual overrides: **Task 19**.
- Multiple saved JDs with search, open/rename/delete, and the wave-like vertical navigation interaction: future feature in `docs/project-plan.md`; not a current storage bug.
- ATS readiness scoring/checking: future feature in `docs/project-plan.md`; not part of this bug-fix branch.

## Scope Decision

The user authorized all checklist implementation on this branch. Source counts remain soft targets when relevance or the one-page limit prevents them. The two-row skills cap, focused coverage panel, and Guided Tailor bulk approval are implemented. Task 16 still owns the richer requirement-to-draft communication layer and automatic tailoring; Task 19 still owns the full review workspace.
