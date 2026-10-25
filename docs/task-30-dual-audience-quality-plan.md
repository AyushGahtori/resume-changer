# Task 30: Evidence-first resume quality

Branch: `codex/task-30-dual-audience-quality` (from `origin/main` at `0a4f750`).

## Goal

Produce a one-page resume whose important job requirements are supported by traceable source facts, whose PDF text can be read by a parser, and whose strongest accomplishments are obvious to a human reviewer. The coverage display is an internal evidence audit, not a hiring prediction. Never manufacture a qualification, metric, employer, or result to raise that count.

## Work and acceptance checks

- [x] **Requirement model:** break analyzed JD lines into testable facets, retain required/responsibility/preferred priority, handle conjunctions and alternatives, and expose the source and missing facets behind each coverage result. Keep saved analyses compatible.
- [x] **Evidence and selection:** rank job evidence above project evidence above a declared skill; select for marginal, priority-weighted requirement coverage and distinct accomplishment quality per estimated line. Keep relevant role balance without fixed caps. Re-evaluate coverage when measured fitting adds or removes a bullet.
- [x] **Metric discovery and writing:** give users contextual, evidence-first prompts for missing measurements in the achievement editor. Preserve metric value, unit, meaning, attribution, and source; flag unsupported or badly attached metrics. Avoid appending numeric fragments that weaken otherwise good bullets.
- [x] **Final PDF machine check:** inspect the compiled PDF text for core identity, section, role, skill, bullet, and metric retention and readable order. Surface actionable warnings and never label unverified extraction a verified parse.
- [x] **Human skim check:** assess the top third, first bullets, specificity, role relevance, repetition, and readability with a concise, transparent review report. Do not inflate page fill at the expense of legibility or useful content.
- [x] **Credibility check:** show which claims are directly sourced, which are inferred and need confirmation, and which are missing support. Check final rendered output rather than the draft alone.
- [x] **End-to-end UI:** show priority and evidence diagnostics together with machine, skim, and credibility checks; preserve existing guided and manual flows.
- [x] **Tests:** synthetic fixtures only. Cover compound JD requirements, correct evidence ranking, unique coverage per line, fitting decisions, metric prompts/attribution, PDF extraction failure, and review report presentation. Run lint, typecheck, unit tests, build, and relevant Playwright/PDF integration checks.
- [x] **Review:** inspect the final diff for unrelated edits; record validation results and any remaining limitations here.

## Design decisions

1. A source fact can support several JD facets, but a list of related terms cannot prove an action that the source never describes.
2. The required/responsibility/preferred priority guides selection; the original requirement count remains visible for transparency.
3. The final PDF is the authority for page fit and parser checks; word or line estimates only guide candidate choice.
4. A check may return `needs review`. A review warning must not silently become a claim of ATS or hiring success.

## Progress notes

- 2026-10-25: Created a separate worktree from fresh `origin/main` and opened this branch. Existing changes in the user's other checkout remain untouched.
- 2026-10-25: Added JD facets and priority-weighted, evidence-strength-aware selection. The page fitter now compares marginal coverage against the actual rendered bullets when removing content and recomputes coverage after fitting.
- 2026-10-25: Added metric-evidence prompts, PDF extraction checks, visible top-third review, and source/metric/inference warnings. The final review panel appears for measured Auto Tailor output; manual and guided generation keep their existing flow and checks.
- 2026-10-25: Validation passed: lint, TypeScript typecheck, production build, 739 unit/integration tests (3 live Gemini tests skipped by the normal command), including the real local PDF compiler suite, and 39 relevant Playwright tests across Auto Tailor, metric editing, Guided Tailor, requirement coverage, and manual preview. Focused tests for the last PDF-term check and top-third refinement passed afterward. `git diff --check` found no whitespace errors.

## Limits and follow-up

- No resume can guarantee passage through every ATS or hiring decision. The report verifies PDF text extraction and source-backed coverage in this app; a live employer parser, application questions, eligibility rules, and recruiter preference remain external.
- The PDF review is advisory. It checks recoverable wording, page bounds, opening relevance, and claim provenance. A person should still review typography, voice, and whether each inferred framework was actually used before applying.
- The measured final-PDF quality report is currently attached to Auto Tailor output. Manual/guided compilation still follows its existing one-page verification path; extending the same detailed report there would require a separate server-side PDF assessment step.
