# UI task 26 — Desktop grid and rhythm

Branch: `codex/home-ui-task-26-desktop-grid`, parent task 25 (`47b96a5`).
Worktree: `C:/Users/Ayush/.codex/worktrees/home-ui-task-26-desktop-grid/re_changer`.
Frontend/API: `http://127.0.0.1:3226`, isolated sample-data namespace.

Opened the mandatory full-page, light-product and dark-product crops. Removed
the legacy fixed-height desktop frame and duplicate analysis-height override.
The home content now fills its available column up to a 1440px maximum, with
32px desktop inset, a full-width heading, 24px heading-to-grid separation,
24px grid gap and 2:1 sibling form/preview columns at >=1280px. Long content
scrolls naturally. The sidebar remains 260px at wide desktop widths. Shared
non-home page rules and other agents' work remain unchanged.

Captured and opened light/dark idle, validation-error and long-analysis pages
at 1440x900, 1280x800 and 1024x768; compared alignment and proportions with the
reference product regions. No poster panels/artwork or fake score added.

Validation: lint/typecheck passed; two desktop browser scenarios passed,
covering all three viewports, both themes, long company/role text, invalid URL,
long analysis items, exact insets/gaps/ratio and no horizontal overflow.
Production build result is recorded in the PR. Changes are limited to home
layout CSS, focused responsive tests and this evidence. No dependencies,
backend, environment, storage or schema changes.

Production build passed (19 routes). Final screenshots reviewed in both themes.
