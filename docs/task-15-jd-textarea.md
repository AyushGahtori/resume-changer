# Task 15: JD textarea

Implemented on `codex/task-15-jd-textarea`, isolated from the existing task 13 checkout, starting at latest fetched `origin/main` (`a736e4e`).

## Implementation

- The editor spans the form content width, with a 190px default height, 12px/14px insets, 14px/20px Arial text, and a 6px neutral border.
- Long content scrolls vertically; long unbroken text wraps within the container. The native scrollbar has a visible, theme-aware thumb.
- Focus uses a 2px violet ring. Validation retains the red border and associated error message, with an alert icon. Draft restoration has a muted native disabled state.
- Tablet/mobile layouts retain native vertical resizing. The fixed-height desktop layout retains its resize restriction and can shrink the editor to keep actions visible.
- No sample content is injected. Draft persistence, analysis, validation limits, and token estimates retain their existing contracts.

## Visual review

Inspected `jd-editor-light-dark.png` and `jd-editor-input-states.png`, plus the mandatory shared palette, type, input, layout, spacing, radius, shadow, and dark-theme references in the supplied task document.

Captured and inspected real browser screenshots from the dev server at 1440×900, 1024×768, and 390×844, in light and dark themes. Screenshots cover empty, filled, focused, error, and disabled states. Headless Chromium's scrollbar-hiding option is disabled for accurate scrollbar screenshots. Existing fonts and shared theme tokens follow the written specification; poster annotations, illustrative content, and neighboring tasks are outside this change.

Generated screenshots live in ignored `test-results/home-jd-editor-*/` directories, rather than production assets.

## Ownership and environment

Changed `src/components/jd-workspace.tsx`, `src/app/globals.css`, and the focused `tests/e2e/home-jd-editor.spec.ts`. Updated the existing `home.spec.ts` width assertion to verify the full form width instead of the old 880px cap.

Frontend and existing Next.js API routes use port **3015**. No separate backend, dependency, package manifest, environment file, or lockfile changes are required. Browser tests use synthetic content and the existing port-specific temporary data fixture.

## Verification

- `npm run lint`: passed. Focused final ESLint and formatting checks also passed.
- `npm run typecheck` / final `tsc --noEmit`: passed.
- `npm test`: 476 passed; three opt-in live Gemini tests skipped.
- `npm run build`: passed, including type validation and all 19 static pages.
- `PLAYWRIGHT_PORT=3015 npm run test:e2e -- tests/e2e/home-jd-editor.spec.ts tests/e2e/home.spec.ts --timeout=90000`: 13 passed, two failed. All **eight task 15 tests passed**, covering the six theme/viewport combinations, native resizing/scrolling, WCAG AA text/placeholder contrast, keyboard focus, paste/reload preservation, and near/over-limit validation.
- The two existing cross-page checks failed waiting for `/library` navigation and Resume builder's `.generation-draft` content. They passed in an earlier run; no navigation or builder implementation was changed. These dev-server navigation failures remain a verification limitation rather than being hidden or fixed outside task 15.
- Cold development compilation exceeded the original 30-second test setup allowance. Focused tests use the existing navigation test's 90-second allowance; the final selected-suite command applies it to setup hooks too.
- `git diff --check`: passed.

No task 15 functionality is left incomplete. Cross-page dev navigation failures above are the outstanding integration/check limitation. Live Gemini tests remain opt-in; no live AI calls are required for this visual change.
