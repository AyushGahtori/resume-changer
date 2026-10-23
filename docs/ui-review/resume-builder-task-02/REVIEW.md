# Task 02 — Reconcile shared builder color tokens

Branch: `codex/resume-builder-task-02-color-tokens`. Base: `676f3aa`.
Review server: `http://127.0.0.1:3024` (production build, fictional demo data).

Owned changes: the builder color roles in `src/app/globals.css` and
`src/app/studio.css`, the new `tests/e2e/builder-color-tokens.spec.ts`, and
this review folder. No schema, prompt, API, data-loading, or export
behavior was changed.

## What the boards print, and what the app already uses

`docs/ui-images/resume-builder/ui-kit-color-palette.png` was opened before
any color was assigned. It prints this palette, and the plan's token table
repeats it:

| Board value           | Printed hex | Shared token used by the app                    | Shared value                     | Delta                                                                                                                    |
| --------------------- | ----------- | ----------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Primary orange        | `#FF7A18`   | `--color-orange`                                | `#f97316`                        | The app-wide orange is slightly deeper. Kept.                                                                            |
| Primary orange, hover | —           | `--color-orange-strong`                         | `#c2410c`                        | —                                                                                                                        |
| Secondary violet      | `#7C3AED`   | `--color-violet`                                | `#7c3aed`                        | None.                                                                                                                    |
| Accent violet         | `#A78BFA`   | `--color-violet-light`                          | `#a78bfa`                        | None.                                                                                                                    |
| Violet surface        | —           | `--color-violet-subtle`                         | `#ede9fe` light / `#322548` dark | —                                                                                                                        |
| Violet label          | —           | `--color-violet-strong`                         | `#6d28d9` light / `#a78bfa` dark | —                                                                                                                        |
| Background            | `#FFF7F1`   | `--color-canvas`                                | `#f8fafc`                        | The board's canvas is warm; the app's is neutral. Kept, because a builder-only warm canvas would fork the app.           |
| Surface               | `#F8FAFC`   | `--color-surface` / `--color-surface-alt`       | `#ffffff` / `#f1f5f9`            | The board's "Surface" is the app's canvas value. Kept.                                                                   |
| Text primary          | `#0F172A`   | `--color-text-primary`                          | `#0f172a`                        | None.                                                                                                                    |
| Text secondary        | `#64748B`   | `--color-text-secondary` / `--color-text-muted` | `#475569` / `#64748b`            | Both shared roles already exist; the builder uses `--muted` and `--quiet` as before.                                     |
| Border                | `#E2E8F0`   | `--color-border`                                | `#e2e8f0`                        | None.                                                                                                                    |
| Success               | `#16A34A`   | `--color-success`                               | `#10b981`                        | The app's success green is teal-leaning. Kept, because the home and library pages already use it for real confirmations. |
| Warning               | `#F59E0B`   | `--color-warning`                               | `#f59e0b`                        | None.                                                                                                                    |
| Error                 | `#EF4444`   | `--color-error`                                 | `#ef4444`                        | None.                                                                                                                    |
| Focus                 | —           | `--color-focus-ring`                            | `#7c3aed` light / `#a78bfa` dark | The board assigns violet to focus. Matches.                                                                              |

The plan is explicit about how to treat the deltas: _"The existing app and
home plan already use shared orange/violet/border values that may differ
from this board. Do not add a Resume Builder-only palette to hide that
mismatch. Use the current shared tokens unless a coordinated, app-wide token
decision explicitly changes them; record the delta in the plan or review
notes and keep the home, library, and builder consistent."_ No coordinated
app-wide decision has changed the orange, the canvas, or the success green,
so the shared tokens stand and the deltas are recorded here.

The dark equivalents are estimates on the boards. The app's dark theme
already separates nested surfaces by a small tonal step plus a border
(`#211d2e` surface on `#171421` canvas, `#3a3548` border), and this task
changed no dark value.

## The color roles the builder was violating

The builder already used shared tokens for every color — there was no
builder-only palette to remove. What was wrong was the _role_ three
selected states were playing. The board's kit prints the checked checkbox in
violet, and the plan asks for orange on the main resume action, violet on
AI, selected, and focus emphasis, and success, warning, and error only on a
truthful status.

| Control                                                                          | Before                   | After                    | Reason                                                      |
| -------------------------------------------------------------------------------- | ------------------------ | ------------------------ | ----------------------------------------------------------- |
| Achievement row checkbox (`.generation-point input`)                             | `--teal` (success green) | `--imagination` (violet) | A selected row is not a success state.                      |
| Skill inclusion checkbox (`.selection-skill-option input`)                       | `--accent` (orange)      | `--imagination` (violet) | Orange is reserved for the main resume action.              |
| Guided Tailor approval checkbox (`.guided-tailor-approve input`)                 | `--accent` (orange)      | `--imagination` (violet) | Same.                                                       |
| Studio section tab (`.studio-navigation button[aria-pressed="true"]`)            | `--accent` (orange)      | `--imagination` (violet) | A selected tab is a selected state, not the primary action. |
| Selected skill chip (`.studio-chip-list button[aria-pressed="true"].is-current`) | `--accent` (orange)      | `--imagination` (violet) | Same.                                                       |
| PDF fit toggle (`.pdf-fit-button[aria-pressed="true"]`)                          | `--accent` (orange)      | `--imagination` (violet) | Same.                                                       |

All six now resolve to the shared `--color-violet` family. The AI actions,
the skill filter chips, the merge handle, and the studio's own checkbox
already used the shared violet, and the main `Generate LaTeX` and
`Create PDF` actions already used the shared orange. Nothing else in the
builder or the studio was recolored.

## What was deliberately left alone

- The achievement library's own checkboxes and chips still use the app's
  shared `--teal`. They belong to the library page, not the builder.
- `.studio-notice` still uses the success green, even though it also
  carries neutral messages such as "Projects are hidden in the PDF." The
  notice bucket mixes a real confirmation ("Changes applied. The one-page
  PDF and its margins were validated.") with cautions, so it needs to be
  split into separate states in the component. That is a review-state
  change, not a token change, and it is left to the review tasks.
- The `Create PDF` button is a second orange primary next to
  `Generate LaTeX`. Which action is the primary one is a button-hierarchy
  decision, not a token decision, and it belongs to the button and export
  tasks.
- The job-context card's green left rule matches the board's own job
  context card, so it stays.

## Coverage

`tests/e2e/builder-color-tokens.spec.ts` is new and focused. It pins four
things in both themes:

1. The builder's palette resolves to the app-wide token values, so the
   board's shared colors cannot drift into a private palette.
2. The main action carries `--color-orange`, the AI actions carry
   `--color-violet-subtle` and `--color-violet-strong`, the achievement
   checkbox carries `--color-violet`, and the focus ring carries
   `--color-focus-ring`.
3. Every color the builder's own surfaces render is a value from the shared
   token set, so no builder-only hex can creep in.
4. The main action label and the AI action label keep a contrast of at
   least 4.5:1 on their own surfaces.

The spec is deterministic: it seeds a synthetic draft and a synthetic cached
analysis in local storage, and it makes no network or AI call.

## Review screenshots

Captured from the production build used by the browser suite and opened for
visual review in both themes:

- `selection-1440-light.png`, `selection-1440-dark.png` — two achievement
  rows selected, showing the violet checked state next to the violet AI
  actions.
- `selection-390-light.png`, `selection-390-dark.png` — the same state at
  the mobile width.
- `studio-1440-light.png`, `studio-1440-dark.png` — the studio after a real
  manual generation, showing the violet selected section tab.

## Validation

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — 554 passed, 10 skipped, 0 failed.
- `npx playwright test tests/e2e/builder-color-tokens.spec.ts` — 4 passed.
- `npx playwright test` over the nine builder-focused suites — 35 passed.
- `npx playwright test tests/e2e/color-tokens.spec.ts` — passed, so the
  app-wide token contract is unchanged.
- `git diff --check` — clean.

The browser suite needs a fontconfig configuration and the matching shared
libraries in this environment. They were provided outside the repository, and
no project file was changed for them.
