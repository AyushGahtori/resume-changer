# Task 01: Achievement Library baseline

This package records the Achievement Library before the planned visual refactor. No application code, data file, API contract, or visual component was changed for this baseline.

- [Behaviour inventory, component map, conflicts, and open items](inventory.md)
- [Viewport geometry, tokens, typography, and DOM counts](measurements.json)
- [Baseline screenshots](screenshots/)

## Captures

The ten content captures use the app's existing light and dark themes at 1440×900, 1024×768, 768×1024, 390×844, and 320×740, and show the fictional demo library. Two full-page captures record the whole long page at 1440×900. Four further captures record the personal route with its creation actions, the manual point editor, and the loader error with its alternate-source link.

Every capture was taken against a production build in an isolated worktree, with the personal data root pointing at an empty temporary folder, so no real user data was read. The screenshots exclude browser chrome.

## Reproducing the captures

```bash
npm run build            # or: NEXT_DIST_DIR=.next-test next build
node scripts/capture-library-baseline.mjs
```

The script serves the build on port 3021 (override with `BASELINE_PORT`), writes the screenshots and `measurements.json` into this folder, and deletes its temporary data root when it finishes.

## Validation performed on the Task 01 branch

- `npx vitest run tests/unit/data/achievement-search.test.ts tests/unit/data/loaders.test.ts tests/unit/data/writers.test.ts tests/unit/data/sample-library.test.ts` — 32 passed.
- `npx playwright test tests/e2e/library.spec.ts tests/e2e/library-editing.spec.ts tests/e2e/library-baseline.spec.ts` — 20 passed. The browser suite runs against a production build, uses a temporary data root, and makes no live model request.
- `tests/e2e/library-baseline.spec.ts` was added in this task to protect the current reading order, summary counts, point anatomy, and group metadata, which no existing test covered.
