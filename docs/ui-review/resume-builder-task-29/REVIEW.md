# Resume Builder UI tasks 01–29: final acceptance

Branch: `codex/ui-task-plan-audit`, based on integrated `main` at `5e397d2` (the Resume Builder and Achievement Library feature integration).

Status: all 29 Resume Builder tasks are implemented. During this audit, source switching revealed one real cross-library state leak: the route updated its library without remounting the builder, so selections and generated state could survive into a different source. The builder is now keyed by source, and the focused regression verifies that selections reset in both directions while each source reports its own available count. The draft remains restored from the existing local draft store, and generated sessions remain source-bound.

## What was audited

The current workflow preserves the shared shell and active route, the truthful job-description context, personal/demo source links, searchable/grouped evidence selection, measured skill capacity, explicit AI consent and operation feedback, review/apply behavior, LaTeX/PDF output, compile diagnostics, history, and export. The page does not invent role data, analysis results, scores, metrics, or generated content. Empty analysis and preview states remain labeled as such.

The source switch now forces the stateful `ResumeGenerator` to remount whenever the loaded source changes. This clears selection, analysis/recommendation/tailoring state, and generated output that came from the old library instead of displaying stale IDs or output under the new one. A browser test selects a demo achievement, switches to the synthetic personal library and back, and confirms both sources start at zero selected with their correct totals.

## Regression coverage

Focused suites include `builder-color-tokens.spec.ts`, `builder-typography.spec.ts`, `builder-task-04-geometry.spec.ts`, `resume-builder-active-destination.spec.ts`, `resume-builder-header.spec.ts`, `resume-builder-job-context.spec.ts`, `resume-builder-layout.spec.ts`, and `builder-task-10-source-choice.spec.ts`. Workflow coverage includes `achievement-selection.spec.ts`, `achievement-item-content.spec.ts`, `guided-tailor.spec.ts`, `auto-tailor.spec.ts`, `resume-studio.spec.ts`, `studio-overrides.spec.ts`, `resume-journey.spec.ts`, `generate-preview.spec.ts`, `preview-status.spec.ts`, `preview-toolbar.spec.ts`, `builder-export-actions.spec.ts`, `export-package.spec.ts`, and `generation-history.spec.ts`. The full unit suite also covers selection filtering, session parsing, draft/cache behavior, analysis coverage, skill layout, preview metadata, generation, compile validation, and export packages.

## Visual acceptance

The final production build was captured after the source-state fix with an isolated fictional sample library and synthetic job description. The page was reviewed in light and dark themes at 1440×900, 1024×768, 768×1024, 390×844, and 320×740. Separate captures cover personal/demo job context and narrow-width wrapping. The 1440px light composition, 390px light layout, and 320px dark layout were opened and inspected against the matching builder overview and component references. The desktop selection/preview panes align cleanly; the narrow layout stacks without page-level horizontal scrolling. Analysis and output remain honestly empty because the fixture does not claim an analysis or generated resume.

Capture files: this directory. Reproduction: set `CAPTURE_PORT=3450` and `CAPTURE_OUTPUT=docs/ui-review/resume-builder-task-29`, then run `node scripts/capture-resume-builder-task-10.mjs`. The capture uses an isolated temporary data root and removes it after completion.

## Validation and limits

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 665 passed, 3 opt-in live-provider tests skipped.
- `npm run test:e2e -- tests/e2e/builder-task-10-source-choice.spec.ts` with `PLAYWRIGHT_PORT=3471`: 12 passed, including the new source-bound selection regression.
- The screenshot capture's optimized production build completed successfully.
- API/provider behavior was not live-tested; the user asked to disregard those errors. Browser workflows use deterministic mocks/fixtures.
- Automated axe, keyboard, semantic, and responsive checks exist in the integrated suites. A manual spoken-output screen-reader session was not performed.

No Resume Builder task remains open in the plan. The supplied boards are illustrative product references; shared app tokens, existing Georgia/Arial typography, real user data, and truthful empty/loading/error states take precedence over sample poster content.
