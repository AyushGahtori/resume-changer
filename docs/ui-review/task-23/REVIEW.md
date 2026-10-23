# Task 23 — Score contract boundary

Branch: `codex/home-ui-task-23-score-contract`, based on task 22 (`e740df0`).
Dev frontend/API: `http://127.0.0.1:3223`, with an isolated fixture namespace.
Changes: ATS preview scope explanation, its small neutral text style, focused
additions to `home-ats-preview.spec.ts`, and this folder. No dependencies,
environment changes, schema fields, API endpoints or scoring logic added.

Opened the mandatory `ats-preview-light-dark.png` reference, including the
pictured 64px score ring and horizontal bar. The written condition explicitly
forbids those elements without a validated match-score contract.

The current `JobAnalysisResultSchema` provides JD extraction only. The preview
now says `Not scored.` and explains that a resume match has not been evaluated.
This is neutral information, not an error or empty progress indicator. There
is no percentage, ring, numeric progress, match label or implied coverage.

Captured and opened idle/result preview screenshots from the dev server in
both themes and 1440/390/320px layouts. Compared to the reference's product
region, retaining the compact heading/description/badge and intentionally
omitting its unsupported score artwork. Long text wraps without overflow.

Validation: lint and typecheck passed; three focused score-contract tests
passed. Valid extraction fixtures render no score. Empty results render no
score. Even a mocked result containing unsupported `score`, `atsMatch` and
`estimatedAtsMatch` properties cannot render a score. The strict current
schema rejects such additions. No supported scoring fixture exists today;
inventing one would violate the task's separate-contract requirement. Future
approved scoring must bring its own schema, boundary validation, accessible
progress semantics and tests before any score UI can be introduced.

Other worktrees and the uncommitted original task/reference files were untouched.

Production build passed (19 routes). The three contract tests passed again after final screenshot cleanup. Valid-result captures are separate from unsupported-response captures, whose cache warning truthfully reflects strict schema rejection.
