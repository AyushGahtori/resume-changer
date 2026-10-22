# Task 22 — ATS preview surface

Branch: `codex/home-ui-task-22-ats-preview`, based on task 21 (`11b9978`).
Frontend/API: `http://127.0.0.1:3222`; isolated temporary sample library.
No dependencies, environment files, backend behavior or contracts changed.

Owned files: `ats-analysis-preview.tsx`, embedded presentation adjustments in
`job-analysis-panel.tsx`, `jd-workspace.tsx`, scoped global styles,
`home-ats-preview.spec.ts`, natural-scroll assertions in `home.spec.ts`, and
this review folder. Other agents' files/worktrees were not touched.

Opened both mandatory ATS preview/anatomy crops and the overall composition,
palette, typography, spacing, shadow, radius and dark references. Inspected
the dev screenshots here against those boards, including isolated component
crops at 1440, 1280, 1024, 768, 390 and 320px in light and dark themes.

The preview has a 16px inset, 1px border, 8px radius, light-only XS shadow,
32px violet icon tile, 16px/24px heading and compact orange Beta badge. The
description is verbatim from the plan, at 14px/20px. Form and preview are
top-aligned siblings at approximately 2:1 on desktop; tablet/mobile stack
in reading order. The empty state is a neutral prompt, without checklist or
score. Loading, error/retry and all real response categories reuse task 21.
The result section has no second card border/shadow, and heading levels
remain ordered inside the preview. Long values wrap naturally.

Visual review identified insufficient dark icon contrast; it now uses the
existing strong violet token. Automated rendered-color checks passed for
icon contrast >= 3:1 and description/Beta text >= 4.5:1 in both themes.
All updated captures were opened and reviewed. The score and sample status
distribution remain absent; no tip or fabricated resume claims were added.

Validation: lint and typecheck passed. Twelve browser checks passed (three
preview tests plus existing home/analysis coverage), followed by a passing
three-test rerun with contrast checks and final screenshots. A transient
Next dev-server JSON parse log appeared on that rerun; the browser scenarios
still passed without page errors. A final combined browser run is planned
after task 24 to check the complete stack. The home viewport test now checks
natural document scrolling, as required for growing preview content.

Unrelated header/form/action styling remains at the committed base; no claim
of pixel-identical full-page reproduction. The written plan's font, honest
data, score and poster-art exclusions take precedence over literal artwork.

Production build passed: all 19 routes generated successfully.
