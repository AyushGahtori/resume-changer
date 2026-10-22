# Achievement Library Task 02 — shared color token reconciliation

Branch: `codex/library-task-02-color-tokens-v2`. Base: `origin/main` at `4a701ac`.
Worktree: `C:\Users\Ayush\.codex\worktrees\library-task-02-color-tokens\re_changer`.
Scope: `docs/UI_Tasks_achievement_library.md` Task 02, "Reconcile Shared Color
Tokens For The Library".

## Sources inspected

- `docs/ui-images/achievement-library/library-color-palette.png` — the printed
  primary/neutral/semantic palette.
- `docs/ui-images/achievement-library/sidebar-color-type-spacing.png` — the
  printed light/dark sidebar colors.
- `docs/UI_Tasks_achievement_library.md` — "Additional Exact Token Values From
  The Boards" and Task 02.
- `docs/UI_Tasks_home.md` — the home page's token table, which printed a
  different orange, violet-soft, text-secondary, and border.
- `src/app/globals.css` — the existing shared token file. It already defined
  one named token source for canvas, sidebar, surfaces, text, borders, violet,
  orange, the four status colors, and the focus ring, so no new palette or
  `.library-page` override was created.

## Decision

The two plans printed different values for the same tokens, and the library
plan is explicit that "the intended library-board target is the printed palette
above" and that a product-wide change "must remain consistent on the home
page". The Achievement Library board's printed values therefore won where the
boards disagreed, the change was applied to the single shared token file, and
`docs/UI_Tasks_home.md` was updated to the same numbers in the same commit. No
TypeScript token contract was introduced, so no `tests/unit/ui/design-tokens.test.ts`
was added; the token contract is CSS custom properties and is covered by
`tests/e2e/color-tokens.spec.ts`.

## Token reconciliation

| Token                            | Light before | Light after | Dark before | Dark after | Provenance                                |
| -------------------------------- | ------------ | ----------- | ----------- | ---------- | ----------------------------------------- |
| `--color-canvas`                 | `#F8FAFC`    | `#F8FAFC`   | `#171421`   | `#151522`  | Printed (light) / board estimate (dark)   |
| `--color-sidebar`                | `#FFFFFF`    | `#FAFBFD`   | `#14111F`   | `#0F1220`  | Printed                                   |
| `--color-surface`                | `#FFFFFF`    | `#FFFFFF`   | `#211D2E`   | `#17192D`  | Printed (light) / board estimate (dark)   |
| `--color-surface-alt`            | `#F1F5F9`    | `#F1F5F9`   | `#2A2538`   | `#202238`  | Printed (light) / board estimate (dark)   |
| `--color-surface-hover`          | `#E8EEF5`    | `#E8EEF5`   | `#342F43`   | `#2A2C46`  | App extension (unchanged in light)        |
| `--color-text-primary`           | `#0F172A`    | `#0F172A`   | `#F8FAFC`   | `#F8FAFC`  | Printed                                   |
| `--color-text-secondary`         | `#475569`    | `#334155`   | `#B7B3C7`   | `#C4C8D8`  | Printed (light) / board estimate (dark)   |
| `--color-text-muted`             | `#64748B`    | `#64748B`   | `#A49FB4`   | `#9BA2B8`  | Printed (light) / board estimate (dark)   |
| `--color-border`                 | `#E2E8F0`    | `#CBD5E1`   | `#3A3548`   | `#34374F`  | Printed (light) / board estimate (dark)   |
| `--color-border-strong`          | `#CBD5E1`    | `#94A3B8`   | `#514A61`   | `#464A6B`  | Implementation estimate (new darker step) |
| `--color-violet`                 | `#7C3AED`    | `#7C3AED`   | `#7C3AED`   | `#7C3AED`  | Printed                                   |
| `--color-violet-light`           | `#A78BFA`    | `#A78BFA`   | `#A78BFA`   | `#A78BFA`  | Printed (also the dark brand violet)      |
| `--color-violet-subtle`          | `#EDE9FE`    | `#EFEBFF`   | `#322548`   | `#302342`  | Printed (light) / board estimate (dark)   |
| `--color-violet-strong`          | `#6D28D9`    | `#6D28D9`   | `#A78BFA`   | `#A78BFA`  | App extension (unchanged)                 |
| `--color-orange`                 | `#F97316`    | `#FF7A45`   | `#F97316`   | `#FF7A45`  | Printed                                   |
| `--color-orange-light`           | `#FDBA74`    | `#FDBA74`   | `#FDBA74`   | `#FDBA74`  | App extension (unchanged)                 |
| `--color-orange-subtle`          | `#FFF7ED`    | `#FFE9E0`   | `#442719`   | `#40251F`  | Printed (light) / board estimate (dark)   |
| `--color-orange-strong`          | `#C2410C`    | `#B23C0C`   | `#FDBA74`   | `#FDBA74`  | App extension, darkened for text contrast |
| `--color-text-on-orange`         | `#0F172A`    | `#0F172A`   | `#171421`   | `#151522`  | App extension (follows the canvas)        |
| `--color-focus-ring`             | `#7C3AED`    | `#7C3AED`   | `#A78BFA`   | `#A78BFA`  | Printed                                   |
| Success / Warning / Error / Info | printed      | unchanged   | estimate    | unchanged  | Printed (light) / board estimate (dark)   |

### Category identifiers

The board's category colors are identifiers, not health or risk signals, so
they are defined as their own tokens instead of aliasing the semantic status
colors (an alias would let a category read as "warning" or "success").

| Category token                 | Light     | Dark      | Note                                                                 |
| ------------------------------ | --------- | --------- | -------------------------------------------------------------------- |
| `--color-category-job`         | `#FF7A45` | `#FF7A45` | Orange, printed                                                      |
| `--color-category-project`     | `#7C3AED` | `#A78BFA` | Violet, printed                                                      |
| `--color-category-points`      | `#F59E0B` | `#FBBF24` | Amber, printed                                                       |
| `--color-category-skills`      | `#10B981` | `#34D399` | Green, printed                                                       |
| `--color-category-credentials` | `#4F46E5` | `#818CF8` | **Indigo is an implementation estimate**; the board prints no indigo |

### Action-bar state tokens

`origin/main` already carried a second, literal copy of the brand colors in
the home action-bar state tokens (`--action-orange-surface: #F97316`,
`--action-violet-surface: #EDE9FE`). Left alone, the home Save action would
have kept the old orange while the library rendered the board orange, which
is exactly the split the task forbids. The brand and label state tokens now
resolve to the shared palette, so the two routes cannot drift:

| State token                        | Before (light / dark) | After                                            |
| ---------------------------------- | --------------------- | ------------------------------------------------ |
| `--action-orange-surface`          | `#F97316` / `#F97316` | `--color-orange`                                 |
| `--action-orange-surface-hover`    | `#C2410C` / `#FDBA74` | `--color-orange-strong`                          |
| `--action-orange-surface-disabled` | `#FDBA74` / `#4A2A19` | `--color-orange-light` / literal                 |
| `--action-orange-label`            | `#0F172A` / `#171421` | `--color-text-on-orange`                         |
| `--action-orange-label-hover`      | `#FFFFFF` / `#171421` | `--color-text-on-orange-hover`                   |
| `--action-violet-surface`          | `#EDE9FE` / `#7C3AED` | `--color-violet-subtle` / `--color-violet`       |
| `--action-violet-surface-pressed`  | `#7C3AED` / `#5B21B6` | `--color-violet` / literal                       |
| `--action-violet-label`            | `#6D28D9` / `#FFFFFF` | `--color-violet-strong` / `--color-text-inverse` |
| `--action-ghost-label`             | `#0F172A` / `#F8FAFC` | `--color-text-primary`                           |
| `--action-ghost-label-disabled`    | `#64748B` / `#A49FB4` | `--color-text-muted`                             |

The neutral control-elevation steps (`--action-ghost-surface*`, the violet
hover and disabled steps) stay literal. They exist to separate a control from
its canvas, they carry no brand meaning, and re-pointing them at the surface
tokens would erase the visible edge of the ghost button on the new dark
canvas.

## Deliberate differences from the boards

1. **White on orange is not used.** The board's orange `#FF7A45` is a fill, and
   white text on it is 2.59:1. The primary action keeps the dark label
   (`#0F172A`, 6.9:1 light and `#151522`, 6.99:1 dark) and the hover fill
   `#B23C0C` keeps white text at 5.92:1.
2. **Small orange text uses the darker orange.** The board's printed sidebar
   "active text & icon" `#FF6800` is 2.8:1 on the light sidebar and cannot be
   used for a label. Orange _text_ (the eyebrow, the brand mark, the job/project
   kind label, facet chips, and the analysis notice) therefore uses
   `--color-orange-strong` `#B23C0C`, which is 5.07:1 on the soft orange fill
   and 5.66:1 on the canvas.
3. **Dark brand violet.** The board prints `#A78BFA` as the dark brand violet.
   The app already carries that value in `--color-violet-light` and uses it for
   the dark focus ring, the dark active navigation row, and AI emphasis text,
   so the printed value is honored there. `--color-violet` stays `#7C3AED` for
   filled AI surfaces, where a dark fill reads as a button rather than as text.
4. **Border steps.** The board prints one border value (`#CBD5E1`). The app has
   a default and a strong border, so the printed value became the default and
   the strong step moved to the next step up (`#94A3B8` light, `#464A6B` dark),
   both marked as implementation estimates.

## Contrast verification (measured, not asserted from the board)

| Pair                                         | Ratio |
| -------------------------------------------- | ----- |
| `#0F172A` on `#FF7A45` (primary label)       | 6.90  |
| `#FFFFFF` on `#B23C0C` (primary hover label) | 5.92  |
| `#B23C0C` on `#FFE9E0` (active nav label)    | 5.07  |
| `#B23C0C` on `#F8FAFC` (orange eyebrow)      | 5.66  |
| `#334155` on `#FFFFFF` (secondary text)      | 10.35 |
| `#64748B` on `#FFFFFF` (muted text)          | 4.76  |
| `#7C3AED` on `#FFFFFF` (focus ring)          | 5.70  |
| `#151522` on `#FF7A45` (dark primary label)  | 6.99  |
| `#FDBA74` on `#151522` (dark orange text)    | 10.71 |
| `#C4C8D8` on `#17192D` (dark secondary text) | 10.38 |
| `#9BA2B8` on `#17192D` (dark muted text)     | 6.80  |
| `#A78BFA` on `#17192D` (dark focus ring)     | 6.36  |
| `#6D28D9` on `#EFEBFF` (violet action label) | 6.09  |

## Known follow-ups (not changed here)

- `input[type="checkbox"] { accent-color: var(--accent) }` fills a checked box
  with `#FF7A45` on white, which is 2.59:1 for a non-text control indicator
  (it was 2.8:1 before this change). It is a fill, not text, and the studio
  controls belong to a later task.
- The dark-mode hover state of the secondary AI button keeps a light violet
  fill with the pale primary text color. That combination predates this change
  and belongs to the button-conventions task, not to the palette.
- The dark ghost-button surfaces (`#211D2E`, `#2A2538`, `#342F43`) are literal
  control-elevation steps rather than palette tokens, so they are now one step
  above the reconciled dark surface (`#17192D`). They are recorded rather than
  re-pointed, for the reason given above.

## Files changed

- `src/app/globals.css` — token values, the new category tokens, the action-bar
  brand tokens re-pointed at the shared palette, and the orange-text rules
  pointed at `--accent-hover`.
- `docs/UI_Tasks_home.md` — palette line, token table, and the three inline
  border references updated to the reconciled values.
- `tests/e2e/color-tokens.spec.ts` — expected token values for both themes, the
  category tokens, the new library coverage, and the updated save-action
  colors.
- `tests/e2e/home-action-bar.spec.ts`, `tests/e2e/home-responsive.spec.ts`,
  `tests/e2e/home-sidebar.spec.ts`, `tests/e2e/home-action-states.spec.ts` —
  color expectations updated to the new token values.
