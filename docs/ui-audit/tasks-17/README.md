# Task 17 audit — "Paste From URL" without unsafe fetching

Audit date: 21 October 2026. Branch: `codex/ui-task-17-paste-from-url`.

## Scope and source

Task 17 of the user-supplied `docs/UI_Tasks_home.md`, read together with the
plan's shared sections: Reference Interpretation, Additional Exact Token
Values, Current Code Map, Required Workflow And Test Rules, and the adjacent
Task 16 (metrics row), Task 18 (action bar) and Task 19 (button states) so
this task did not duplicate their scope.

Required reference images inspected before any styling:
`docs/ui-images/home/jd-editor-count-and-paste-url.png` (the mandatory
Task 17 crop) and `docs/ui-images/home/job-page-full-layout-both-themes.png`
(the mandatory full-page composition reference).

## Finding: the reference affordance has no safe backend to call

The task allows the control only "if an existing approved extraction service
supports it". The repository has no such service:

- There is no `/api/jd/extract` route. The only route in the app that takes a
  job description is `POST /api/ai/analyze-job-description`, which accepts
  `{ company, roleTitle, jobDescription }` — text only, no URL.
- The AI provider is never asked to fetch a URL. `src/lib/ai/` sends the
  supplied description to the model; it has no URL-grounding tool, so a link
  cannot be turned into a description by any existing call.
- The `jobUrl` draft field is stored as an opaque string in `localStorage` and
  is validated for shape only. Nothing consumes it.
- The project has no scraping dependency and no server code path that issues
  an outbound request to a user-supplied address.

Wiring the browser straight to the user's URL would be the SSRF-prone proxy
the task explicitly forbids. Fetching it from the server without a reviewed
network policy would create the same hazard server-side.

**Resolution:** the control is not shipped as a live button, and the
dependency is recorded in `docs/project-plan.md` under a new "Job
Description URL Extraction" section that specifies the required network
policy, limits, content handling, AI-grounding rules, privacy fit and tests.

## Result on this branch

| Area                  | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability resolution | `src/lib/jd-url-extraction-availability.ts` — a `server-only` module whose `isJdUrlExtractionAvailable()` returns `false`, with a comment explaining exactly which backend must exist before it can return `true`. The decision is made on the server so client state cannot flip it.                                                                                                                                                                                                                                                                                                                                  |
| Page wiring           | `src/app/page.tsx` resolves the capability and passes it to `JDWorkspace`; `src/components/jd-workspace.tsx` accepts `pasteFromUrlAvailable` (default `false`) and renders `<PasteFromUrl>` at the end of the metrics row.                                                                                                                                                                                                                                                                                                                                                                                             |
| Control               | `src/components/home/paste-from-url.tsx` returns `null` while unavailable, so the browser never sees a clickable-looking control. When available it is a persistent text button labelled `Paste from URL` with a 16px `Link2` chain-link icon before the label, violet 13-14px medium text, transparent background, 38px minimum hit height, a visible focus ring, a pale violet hover surface and a pressed tint, opening a panel with the URL field, Fetch and Cancel controls.                                                                                                                                      |
| States                | The panel implements idle, loading (`Fetching...`, `aria-busy`), error (`role="alert"`, `aria-invalid` on the field) and success (`role="status"`). The current draft is preserved until an extraction succeeds; only then is the description replaced through the parent's `onExtracted` callback, which routes through the existing `updateField` so the analysis cache and validation state are invalidated exactly as for a manual edit. Cancel closes the panel and resets the state. The transitions live in `src/lib/paste-from-url-state.ts` as a pure reducer so every one of them is testable without a DOM. |
| Network safety        | `src/lib/jd-url-extraction.ts` posts to `/api/jd/extract`. The client-side check accepts only `http:`/`https:` URLs, but the module's own doc comment and the project-plan section both state that the server must repeat every validation regardless of the client check.                                                                                                                                                                                                                                                                                                                                             |
| Dependency record     | `docs/project-plan.md` — "Job Description URL Extraction" section.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Why the control is a disclosure, not a modal

The panel is rendered inside the job-description form, which is already a
`<form>`. HTML forbids nesting a form inside a form and the browser's parser
breaks the outer form, so the panel uses a `div` with an explicit submit
handler and a `type="button"` submit control. The trigger stays mounted and
uses `aria-expanded` / `aria-controls` so the expanded state remains
observable, and the panel is the element the trigger controls.

### Layout

`.form-footer` became a column: a new `.form-metrics-row` holds the metrics
on the left and the optional URL action on the right, and `.form-actions`
sits on the row below. This is the composition the plan specifies in four
places — Task 16 ("the optional URL action right-aligned on desktop"), Task
17 ("align it at the end of the metrics row"), Task 18 ("the action footer
_follows_ the live count row with 16px top separation") and the mandatory
full-page board, whose markers 04/05 sit on the metrics row and marker 06 on
the action row beneath it. The Task 18 `action-bar-light-dark.png` crop is a
component board and, per the plan's Task 01 precedence rule ("use the
full-page concept as the composition reference and component boards as detail
specifications"), governs the action buttons' size, colour and hierarchy
rather than page composition.

The conflict with Task 18's single-row footer was reported to the other
agents before this branch was finalised, along with the one Task 18 assertion
that encodes the shared-row model
(`expect(geometry.metrics.top).toBeGreaterThanOrEqual(geometry.actions.top)`).

### Dark-mode label contrast

The reference shows a violet label, and the plan's token table gives violet
primary `#7C3AED` for both themes. On the dark form surface `#211D2E` that
reaches only **2.88:1**, below the 4.5:1 the plan requires for body text, so
the trigger would have been hard to read in dark mode.

The dark theme therefore uses the plan's _violet light_ `#A78BFA`, which the
token table documents for "focus/highlight/icon" and which the app already
uses for dark-mode violet text on the active navigation item. That reaches
**6.03:1** on the surface and **5.17:1** on the hover surface. Light mode
keeps `#7C3AED` at 5.70:1, and 4.80:1 on its hover surface. The theme-aware
rule is asserted by the browser test rather than left to review.

## Visual acceptance

The reference crop shows the count and token estimate on the left and a
violet chain-link "Paste from URL" on the right of the same row, in both
themes, with no filled button background. The implemented trigger matches
that anatomy: 16px `Link2` icon before the label, 13-14px medium violet text,
transparent background, 38px minimum hit height, and the same alignment at the
end of the metrics row.

Both themes were rendered and reviewed at 1440x900, 1024x768, 390x844 and
320px wide, in the available state and in the unavailable state. The metrics
row does not overflow at any of those widths, the metrics never wrap
mid-number, and the action buttons keep their reference order and hierarchy
below.

The reference's illustrative count values (`2,736` / `~684`) are examples
only; the live values are calculated from the draft by the existing
`MAX_JD_CHARACTERS` and `estimateTokenCount` helpers, which were not
modified.

### Captures

The control is shown in its available state, with the URL panel open, so the
reference anatomy and the panel can be reviewed together. The metrics row and
the action bar below it are both visible.

| Viewport                    | Light                                         | Dark                                        |
| --------------------------- | --------------------------------------------- | ------------------------------------------- |
| 1440x900 desktop            | [Light](screenshots/paste-from-url-light.png) | [Dark](screenshots/paste-from-url-dark.png) |
| 1440x900 desktop, full form | [Light](screenshots/form-light.png)           | [Dark](screenshots/form-dark.png)           |

## Tests

- `tests/unit/jd-url-extraction.test.ts` — URL validation (accepts `http`
  and `https`, trims surrounding whitespace, rejects an empty value, a
  non-URL, and non-HTTP schemes including `javascript:`, `file:`, `data:`
  and `ftp:`) and the extraction request (posts `{ url }` to the route,
  surfaces a service error message, maps a missing route to a clear
  "not available" message, handles an empty response body, a network
  failure, and a non-JSON response).
- `tests/unit/jd-url-extraction-availability.test.ts` — the capability
  resolves to unavailable.
- `tests/unit/paste-from-url-state.test.ts` — the reducer and the submit
  decision: an invalid URL never produces a request, a valid one does, a
  retry clears the previous error, a cancel returns to idle while keeping
  the typed URL, and success is never reached without a successful
  submission.
- `tests/e2e/home-jd-editor.spec.ts` — the control is absent while the
  capability is unavailable; the page issues no request to the extraction
  route and no outbound request for a user-supplied URL even with a job link
  saved; the metrics row keeps its content and does not overflow in light and
  dark themes at 1440, 1024, 390 and 320 pixels.
- `tests/e2e/home-paste-from-url.spec.ts` — the available path. These tests
  flip the server-resolved capability in the server-rendered payload before
  hydration, so the component still decides what to render from the prop it
  is given, and no test-only route or query flag is added to the shipped app.
  They cover the reference anatomy (16px chain-link icon, transparent
  background, 38px hit height, alignment at the end of the metrics row, and
  a WCAG AA contrast ratio in both themes), the focus ring, the invalid-URL
  and non-HTTP-scheme paths (neither of which contacts the service), the
  loading state, the success path (the draft survives the request and is
  replaced only when it succeeds), the failure path (the draft is kept and
  the control becomes usable again), cancel, and the job-link pre-fill.

Two defects were found by these tests and fixed here: the entry field was
seeded from the job link only at mount, so a link restored from local
storage after mount did not pre-fill it; and the violet label failed the
plan's contrast requirement in dark mode.

The contrast assertion also had to wait for the control's colour transition
to finish. The theme is applied after hydration and the label animates its
colour, so a read taken immediately after the page settles could land
mid-transition and measure a colour the control was only passing through.
The test now waits for running CSS transitions to complete, following the
same pattern the Task 19 branch uses for the action bar, and passes three
consecutive repeats of the whole file.

## Validation

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 498 passed, 10 skipped (3 opt-in live AI tests and the PDF
  toolchain tests).
- Full `PLAYWRIGHT_PORT=3149 npm run test:e2e`: 92 passed, 1 failed. The
  failure is `home-action-bar.spec.ts` "keeps the AI action disabled and the
  same size while analysis loads", which asserts that the Analyze button
  keeps its width while loading. It is **pre-existing on `main`** and was
  verified there in a separate clean worktree with the identical 23px
  difference; it also fails identically on the Task 18 and Task 19 branches.
  Its cause is that the idle button's content (a 25.36px sparkle icon, an 8px
  gap, and the label) exceeds its `min-width: 228px`, so the idle width is
  251px while the loading width falls back to the 228px minimum. Task 19
  owns that control, so the fix belongs there and was not made here.
- `tests/e2e/home-paste-from-url.spec.ts` with `--repeat-each=3`: 27 passed,
  confirming the transition-aware colour read is stable.
- `npm run build`: passed. The build needs a clean dist directory: the
  repository's development server and the build share `.next` by default and
  the build overwrites `next-env.d.ts` and `tsconfig.json`, both of which
  were restored afterwards.
- `npm run format:check`: passed for every file this branch touches. Two
  files still report formatting warnings — `src/app/api/generate/route.ts`
  and `tests/unit/api/tailor-achievements-route.test.ts` — both of which are
  unmodified on `main` and were left alone.
- `git diff --check`: passed.

No live AI request, personal data, or external reference board is used at
runtime. The reference images remain documentation only and were not added to
the app's assets.
