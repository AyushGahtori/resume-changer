# Task 01: Home-page baseline

This package records the existing Job Description workspace before the planned visual refactor. No application code or behavior was changed for this baseline.

- [Behavior inventory and component map](inventory.md)
- [Viewport geometry, interaction states, zoom checks, and browser diagnostics](measurements.json)
- [Baseline screenshots](screenshots/)

The six viewport captures use the app's existing light and dark themes at 1440×900, 1024×768, and 390×844. Two additional captures record pointer-pressed Save and keyboard-triggered validation. Screenshots exclude browser chrome.

Validation performed on the Task 01 branch: `npm run test:e2e -- tests/e2e/home.spec.ts` (6 passed). The Playwright run uses synthetic/empty draft state and makes no live analysis request.
