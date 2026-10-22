# Resume Builder Task 04 audit: spacing, surfaces, and radius

Audit date: 22 October 2026. Branch: `codex/builder-task-04-geometry`. Base: `origin/main` at `676f3aa`.

## Scope and source

Read Task 04 ("Standardize Builder Spacing, Surfaces, And Radius") in
`docs/UI_Tasks_resume_builder.md`, including its required image inspection, its
independence rule, and its file list (`src/app/studio.css`, and only shared
variables in `src/app/globals.css` when the existing system provides no
equivalent).

The three mandatory reference images were opened and compared against the
running app before any dimension was changed:

- `docs/ui-images/resume-builder/ui-kit-shadow-spacing.png` — a 4/8/16/24/32/48
  spacing scale and four elevation levels, where the smallest shadow is
  `0 1px 2px rgba(0,0,0,0.05)`.
- `docs/ui-images/resume-builder/ui-kit-border-principles.png` — a corner-radius
  ladder (4/8/12/16/24) over the four principles "consistent, accessible,
  flexible, beautiful".
- `docs/ui-images/resume-builder/builder-overview-light-dark.png` — the
  two-pane builder in both themes, showing an unframed workspace, panes
  separated by thin borders, and dark mode that separates surfaces by tone and
  border rather than by a glow.

## Decision

The builder already had a complete token system in `src/app/globals.css`
(`--space-4/8/12/16/24/32/48/64`, `--radius-control: 6px`, `--radius-card: 8px`,
`--radius-full`, `--shadow-xs`, `--shadow-sm`, `--shadow`, and a light/dark
pair for each). `src/app/studio.css` was the only file that had drifted away
from it: it still used hand-typed pixel values (14px and 16px card radii, 7px
and 9px control radii, 4px and 5px and 7px gaps) and hand-typed shadows.

So the whole task was a substitution pass over `src/app/studio.css`. No shared
variable was added, and `src/app/globals.css` was **not** touched — every token
Task 04 needs already existed, and that file is owned by the parallel
Achievement Library work.

## What changed

`src/app/studio.css` only: 178 insertions, 167 deletions, all of them
token substitutions and three explanatory comments.

| Area                                                | Before                                                                       | After                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Studio panel (the major surface)                    | `border-radius: 14px`, `box-shadow: var(--shadow)`                           | `var(--radius-card)`, `var(--shadow-xs)`                                  |
| Buttons and inputs                                  | `border-radius: 7px`                                                         | `var(--radius-control)` (6px)                                             |
| Cards, panels, groups, rows                         | `border-radius: 8px / 9px / 10px / 11px / 16px`                              | `var(--radius-card)` (8px)                                                |
| Chips, filter pills, badges, progress bars, resizer | `99px`, `4px`                                                                | `var(--radius-full)`                                                      |
| Notices and inline errors                           | `border-radius: 4px`                                                         | `var(--radius-control)`                                                   |
| Panel header                                        | `background: linear-gradient(115deg, accent-soft 40%, surface, surface 65%)` | `background: var(--surface)`                                              |
| Floating card menu                                  | `box-shadow: var(--shadow)`                                                  | `var(--shadow-sm)`                                                        |
| Studio dialog                                       | `box-shadow: 0 30px 100px #0006`                                             | `var(--shadow)`                                                           |
| Spacing                                             | hand-typed 5/6/7/9/10/13/14/17/18/20/22/26/30/44/46/47/48px                  | `var(--space-4/8/12/16/24/32/48)`                                         |
| Panel header inset                                  | `padding: 20px 22px`                                                         | `padding: var(--space-24)`                                                |
| Editor inset                                        | `padding: 18px 14px`                                                         | `padding: var(--space-16)`                                                |
| Action bar inset                                    | `padding: 13px 16px`                                                         | `padding: var(--space-16)`                                                |
| Selection row                                       | `padding: 13px 12px 10px 48px`                                               | `padding: var(--space-12) var(--space-12) var(--space-8) var(--space-48)` |
| Experience group header                             | `min-height: 47px; padding-left: 46px`                                       | `min-height: var(--space-48); padding-left: var(--space-48)`              |
| Drop zone                                           | `margin-left: 44px; padding: 20px`                                           | `margin-left: var(--space-48); padding: var(--space-24)`                  |
| Narrow layout                                       | `padding: 15px 10px` / `padding: 10px`                                       | `padding: var(--space-12) var(--space-8)` / `var(--space-8)`              |
| Navigation buttons                                  | height came from padding only                                                | `min-height: 32px` added                                                  |
| Status badge                                        | height came from padding only                                                | `min-height: 24px` added                                                  |

Three comments were added where a substitution is not self-explanatory: the
panel's shadow, the panel header's flat surface, and the floating menu's
shadow. They record why the darker or flatter option was chosen.

## Accessibility

- Every control keeps a hit target of at least 32px in height, and the
  navigation rail and status badge now declare it explicitly, so a state
  change cannot shrink them.
- The card menu, the studio panel, and the dialog keep a visible one-pixel
  border, so their edges are still legible in the dark theme, where every
  shadow token resolves to `none`.
- No focus, hover, or contrast behaviour was changed. The only colour change
  is the removal of a decorative gradient from the panel header, which was
  previously the one tinted surface in the studio.
- Removing the gradient does not affect the selected state of the studio
  navigation, which is a border-and-background treatment of its own.

## Deliberate differences from the reference boards

- The radius board lists 12px as its "cards" step. Task 04's own text caps
  cards at 8px, and the app's shared `--radius-card` token is 8px, so cards
  were left at 8px rather than following the board. The board's 24px "XL" step
  is not used anywhere in the builder.
- The board's elevation ladder goes up to `0 20px 40px rgba(0,0,0,0.12)`. The
  builder uses the app's subtler ladder, because the task allows "at most a
  subtle existing light shadow on a major surface" and no nested-card shadow.
  The one exception is the modal dialog, which is a floating surface rather
  than a nested card and keeps the `--shadow` token.
- The board's spacing scale stops at 48px. The builder's largest inset is
  `--space-48`, which the task lists as a valid major inset.

## Tests

`tests/e2e/builder-task-04-geometry.spec.ts` is a new focused suite for this
task. It drives the real studio through the existing `openStudio` helper with
mocked AI and no personal data, and asserts the observable geometry:

1. The studio panel is at most an 8px card radius with a one-pixel border, the
   navigation button, the search field, and the skill chip are all 6px
   controls, and the status badge keeps full rounding.
2. The panel header paints no gradient, uses a 24px inset, and shares the
   panel's own surface colour — it is a header, not a second card.
3. A selection row is an 8px card with the 48px gutter, and carries no shadow.
4. The major surface has a light-mode shadow with a blur of at most 4px, has
   `box-shadow: none` in the dark theme, and is still separated from the page
   canvas by tone and border in the dark theme.
5. A filter pill keeps the same box when it becomes the active filter and the
   toolbar keeps its height, and every skill chip in a group has the same box,
   so selecting a chip cannot make its row taller.
6. At 390px the editor inset shrinks to at most 16px and the page has no
   horizontal overflow.

## Captures

| Viewport            | Light                                                     | Dark                                                    |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Studio, 1440x900    | [Light](screenshots/builder-studio-1440x900-light.png)    | [Dark](screenshots/builder-studio-1440x900-dark.png)    |
| Selection, 1440x900 | [Light](screenshots/builder-selection-1440x900-light.png) | [Dark](screenshots/builder-selection-1440x900-dark.png) |
| Studio, 390x844     | [Light](screenshots/builder-studio-390x844-light.png)     | —                                                       |

## Validation

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 560 passed, 3 skipped, 1 failed. The failure is
  `tests/unit/pdf/toolchain-detection.test.ts` — "reports both binaries as
  missing when neither is installed" — which cannot pass on a machine where
  Tectonic and `pdfinfo` are installed. It is environment-only, unrelated to
  this CSS-only change, and reproduces on an unmodified checkout.
- `PLAYWRIGHT_PORT=3160 npm run test:e2e`: 186 passed, 0 failed, against a
  production build with the mock AI provider. Six of those are the new
  Task 04 suite. The run rewrites the tracked `docs/ui-review/**` capture
  images as a side effect of the existing home specs; those were restored
  afterwards so the change stays scoped to this task.
- `npx prettier --check src/app/studio.css tests/e2e/builder-task-04-geometry.spec.ts`: passed.
- `npx prettier --check "docs/**/*.md"`: passed.
- `git diff --check`: passed.

## Known follow-ups

- The two-pane balance itself is Task 06's scope. This task only put the
  studio panel's own surfaces on the shared scale.
- The one-pixel `border-left` on `.studio-error` and `.studio-notice` is a
  deliberate status marker rather than a radius rule, so it was left alone.
- Icon sizes (25px/26px/28px avatars and markers) are still literal. They are
  fixed-size graphic elements, not layout rhythm, so they were left alone.
- The build passes no `next.config.ts` change, and no environment variable is
  required for this task.
