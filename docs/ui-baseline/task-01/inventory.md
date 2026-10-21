# Task 01 home-page baseline

Captured from the isolated Task 01 worktree at http://localhost:3001. Browser chrome and the Next.js development toolbar are hidden only during screenshot capture. Screenshots show the empty-draft state in the app's existing light and dark themes.

## Behavior inventory

- Routes: / (Job description), /library (Achievement library), /generate (Resume builder), /history (History), /settings (Settings).
- Draft key: resume-changer.jd-draft.v1; schema version 1. Inputs autosave locally after edits. Save validates a non-empty JD under 30,000 characters and an optional HTTP(S) job URL. Clear removes the draft and matching analysis cache.
- Analysis: POST /api/ai/analyze-job-description with company, roleTitle, and trimmed jobDescription. Stale requests abort on edits. Success writes resume-changer.jd-analysis.v1; failures preserve the draft and offer retry. Cache matching normalizes company, role title, and JD; Resume builder reads a matching cache.
- Theme key: resume-changer.theme.v1; light is default; the topbar toggle persists light/dark.
- Responsive behavior: at 1100px and below the sidebar narrows and metadata uses two columns with the URL full-width; at 700px and below navigation becomes horizontally scrollable, metadata stacks, and actions wrap; at 390px and below page/form padding decreases. At desktop the page is height-constrained and the textarea flexes.

## Component-to-source map

- Route mount: src/app/page.tsx; document metadata and shell integration: src/app/layout.tsx.
- Sidebar, route navigation, breadcrumb, Local mode, theme toggle: src/components/workspace-shell.tsx.
- Heading, role fields, JD editor, counter, actions, save/analysis states: src/components/jd-workspace.tsx.
- Shell/home/theme/responsive styles: src/app/globals.css.
- Draft schema, persistence, validation, token estimate: src/lib/jd-draft.ts.
- Analysis cache contract: src/lib/jd-analysis-cache.ts; consumer: src/components/resume-generator.tsx.
- Home regression tests: tests/e2e/home.spec.ts; analysis request tests: tests/e2e/jd-analysis.spec.ts.

## Reference conflicts

The reference uses two columns with an analysis preview; the current page has one form surface and no preview. It has a Job link field but no URL-paste action. The reference score, Go Pro tile, sample job values, and fake profile are illustrative and remain absent. These differences belong to later tasks and were recorded without changing the UI in Task 01.

## Captures and geometry

| Viewport | Theme | Sidebar | Topbar |   Form | Actions top | Horizontal overflow |
| -------- | ----- | ------: | -----: | -----: | ----------: | ------------------- |
| 1440×900 | light |   260px |   60px | 1030px |     781.5px | No                  |
| 1440×900 | dark  |   260px |   60px | 1030px |     781.5px | No                  |
| 1024×768 | light |   220px |   60px |  756px |     847.8px | No                  |
| 1024×768 | dark  |   220px |   60px |  756px |     847.8px | No                  |
| 390×844  | light |   390px |   56px |  358px |      1033px | No                  |
| 390×844  | dark  |   390px |   56px |  358px |      1033px | No                  |

Screenshots: screenshots/home-1440x900-light.png, screenshots/home-1440x900-dark.png, screenshots/home-1024x768-light.png, screenshots/home-1024x768-dark.png, screenshots/home-390x844-light.png, screenshots/home-390x844-dark.png. Zoom-equivalent CSS layouts were checked at 1152×720 (125%) and 1800×1125 (80%) in both themes. Pointer hover/press, Tab focus/Enter validation, geometry and browser errors are in measurements.json; the interaction captures are screenshots/home-save-pointer-pressed.png and screenshots/home-keyboard-save-validation.png.
