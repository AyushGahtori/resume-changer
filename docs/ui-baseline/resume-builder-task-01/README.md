# Task 01: Resume Builder baseline

This package records the existing Resume Builder (`/generate`) before the
planned visual work. No application code, data contract, API behavior, or app
styling was changed for this baseline.

- [Behavior inventory, board-control mapping, and reference conflicts](inventory.md)
- [Viewport geometry, computed typography, computed colors, section order, and browser diagnostics](measurements.json)
- [Baseline screenshots](screenshots/)

The ten viewport captures use the app's existing light and dark themes at
1440×900, 1024×768, 768×1024, 390×844, and 320×740. Two further captures
record the empty job context, and four record a real manual generation with
the studio open. Screenshots exclude browser chrome.

Everything is synthetic: the fictional demo library, a synthetic job
description, and a synthetic cached job analysis. No personal data was read,
no live AI provider was called, and no external service was used.

## Validation performed on the Task 01 branch

- `npx playwright test` over the nine builder-focused suites —
  `tests/e2e/achievement-selection.spec.ts`, `auto-tailor.spec.ts`,
  `export-package.spec.ts`, `generate.spec.ts`, `generation-history.spec.ts`,
  `guided-tailor.spec.ts`, `resume-journey.spec.ts`, `resume-studio.spec.ts`,
  and `studio-overrides.spec.ts` — **35 passed, 0 failed** (3.8m). These
  assertions are the regression coverage for every later builder task.
- The capture run recorded **0 console errors and 0 page errors** across all
  sixteen screenshots, and no horizontal overflow at any of the five
  viewports in either theme.
- `git diff --check` — clean.

The browser suite needs a fontconfig configuration and the matching shared
libraries in this environment. They were provided outside the repository, and
no project file was changed for them.
