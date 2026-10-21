# Task 20 — Draft persistence feedback

Branch: `codex/home-ui-task-20-draft-feedback`. Base: `4a8ed32`.
Dev frontend and API: `http://127.0.0.1:3220` (stopped after verification).

Owned changes: `src/components/jd-workspace.tsx`, draft-status rules in
`src/app/globals.css`, draft E2E coverage, existing home status-copy assertions,
and this review folder. Other worktrees and unfinished files were untouched.

Inspected `sidebar-workspace-status.png` and `action-bar-button-states.png`
from the supplied home boards, plus the palette, typography, spacing, radius,
shadow, dark surfaces, and overall composition crops.

The screenshots in this folder were captured from the running Next dev server
at 1440, 390, and 320px, in both themes, and opened for visual review.
The task-specific indicator matches the prescribed 8px dot, 12px copy, quiet
placement near actions, and local-only wording. Restore/storage feedback is a
single inline row. Saving is shown only during the debounce; explicit storage
writes are synchronous, so there is no artificial Saving button delay.

The existing form, action styling, and heading are from the committed base;
unfinished tasks 11–19 in other worktrees were not copied. This task does not
claim a pixel-identical complete page. Reference poster artwork and Go Pro
are intentionally absent per the plan.

Validation: lint and typecheck passed; 476 unit tests passed and 3 live-provider
tests were skipped. All 9 existing home/analysis browser checks passed. All
5 focused draft tests passed, including both visual-review tests. Tests cover
350ms debounce, restore, explicit Save, reload, Clear/reload, corrupt data,
blocked storage getter, failed clearing, and cache invalidation. Initial
ambiguous new test selectors were corrected before the passing rerun.

No new dependencies, environment files, storage contracts, or API changes.
Branches are sequential: task 21 will build on this task's commit.

Production build: passed (19 routes generated). Final transition-stable screenshots reviewed in both themes.
