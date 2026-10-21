# Task 21 — Current analysis states

Branch: `codex/home-ui-task-21-analysis-states`, based on task 20 (`3e4300f`).
Frontend/API: `http://127.0.0.1:3221`, isolated temporary sample library;
server stopped after browser checks. No new dependencies or environment changes.

Changes: extracted `src/components/home/job-analysis-panel.tsx`, integration
in `jd-workspace.tsx`, scoped global styles, `home-analysis.spec.ts`, shared
synthetic analysis fixtures, and screenshots in this folder.

Inspected the supplied `ats-preview-light-dark.png` and component anatomy,
plus palette, typography, spacing, radius and dark-surface references.
Opened dev-server screenshots of loading, failure and populated results in
both themes and 1440/390/320px result layouts. Compared the hierarchy, border,
type scale and spacing to the reference. The pictured score is intentionally
absent. The right-column surface is task 22; this task preserves the current
panel position and makes long results scroll naturally instead of clipping.

Review found a 320px Reanalyze label wrapping inside a word. The final style
keeps the button intact and wraps the header row when necessary; screenshots
were regenerated and reviewed. Loading has a small violet spinner and fixed
skeleton lines. Errors have an icon, explanation, preserved draft and Retry.
Empty categories are neutral. Inference has a visible text label and tint.
All eight result categories and role metadata come from the response.

Validation: lint, typecheck and production build passed. Twelve focused browser
tests passed (five analysis, five draft, two existing analysis regressions),
including cancellation on edit, failure/retry, populated/empty data, cache
failure, and overflow checks. The two visual tests passed again after the
mobile correction, exercising loading, failure/retry and success in both
themes. No browser page errors in those visual flows. Unit suite inherited
from task 20: 476 passed, 3 live-provider checks skipped; no pure logic changed.

The analysis POST, request fields, response schema, cache identity and abort
logic are unchanged. No other worktree or unfinished component was modified.
No full-page pixel-identity claim: unrelated form/header/action work remains
at the committed base, and the plan excludes the poster score/artwork/upsell.
