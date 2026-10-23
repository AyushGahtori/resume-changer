# Task 03 — Define builder typography without changing fonts

Branch: `codex/resume-builder-task-03-typography`. Base: `676f3aa`.
Review server: `http://127.0.0.1:3028` (production build, fictional demo data).

Owned changes: the builder and studio typography in `src/app/globals.css` and
`src/app/studio.css`, the new `tests/e2e/builder-typography.spec.ts`, and this
review folder. No font family, font dependency, color token, schema, prompt,
API, data-loading, or export behavior was changed.

## The board, opened before any type was assigned

`docs/ui-images/resume-builder/ui-kit-typography.png`,
`docs/ui-images/resume-builder/header-anatomy-hierarchy.png`, and
`docs/ui-images/resume-builder/ui-kit-achievement-item-card.png` were opened
first. The type scale card prints two font families and one size ramp:

| Board role | Board size | Board weight | Board family |
| ---------- | ---------- | ------------ | ------------ |
| H1         | 40         | Bold         | Playfair Display |
| H2         | 32         | Bold         | Playfair Display |
| H3         | 24         | Semibold     | Playfair Display |
| H4         | 20         | Semibold     | Playfair Display |
| Body       | 16         | Regular      | Inter |
| Small      | 14         | Regular      | Inter |
| Caption    | 12         | Regular      | Inter |

The plan forbids both printed families: _"Preserve Georgia/Times for current
serif headings and Arial/Helvetica for operational UI. Do not load Playfair
Display/Inter or change remote font dependencies."_ So the **sizes** were taken
from the board and the **fonts** were not. The app's existing `h1` rule is
`Georgia, "Times New Roman", serif` at weight 400 and the operational UI is
already `Arial, Helvetica, sans-serif`; both are untouched. `git diff` on the
two style files contains no `font-family` line, and no web font, `@import`, or
`next/font` reference was added.

The header anatomy board is the product-hierarchy reference: a small
breadcrumb, a step counter, a page title, a page subtitle, the job context,
and a source toggle. The achievement item card shows a bold job label, a
company name beside it, and two lines of regular body copy under a checkbox.
The builder already had that structure; what it did not have was a readable
size for it.

## How the board's ramp maps to the app's scale

The plan's checklist names the ramp the app should use: _"page title near
40/48 desktop and 32/40 mobile; section 24/32; card title 16-20/24; body
14-16/20-24; labels/meta 12/16."_ The board's H2 32 is treated as the slide
heading, not an app heading, which is what the task's visual specification
says outright: _"The oversized serif slide heading is not the app heading."_

| Role                    | Board     | App token                        | Size / line height    |
| ----------------------- | --------- | -------------------------------- | --------------------- |
| Page title (H1)         | 40 Bold   | `--type-page-title-size`         | 40 / 48 desktop       |
| Page title, mobile      | —         | `--type-page-title-mobile-size`  | 32 / 40 at ≤ 700px    |
| Section heading (H3)    | 24 Semi   | `--type-section-heading-size`    | 24 / 32               |
| Card title (H4)         | 20 Semi   | `--type-card-heading-size`       | 16 / 24               |
| Card title, studio pane | 20 Semi   | local value in `studio.css`      | 20 / 28               |
| Body, lead copy         | 16 Regular| `--type-body-large-size`         | 16 / 24               |
| Body, operational       | 16 / 14   | `--type-body-size`               | 14 / 20               |
| Label / meta            | 12 Regular| `--type-label-size`              | 12 / 16               |
| Helper / caption        | 12 Regular| `--type-helper-size`             | 12 / 16               |

Eight roles already existed in `:root` and were reused as they were. Three
roles were missing and were added to the same `:root` block, so the builder
uses the app-wide scale and not a builder-private ramp:

```css
--type-page-title-mobile-size: 32px;
--type-page-title-mobile-line-height: 40px;
--type-body-large-size: 16px;
--type-body-large-line-height: 24px;
--type-label-size: 12px;
--type-label-line-height: 16px;
```

## What was wrong before

The builder and the studio had never been tokenized. Their type was written
as literal pixel values, and much of it was far below the board:

| Selector                              | Before                       | After                    |
| ------------------------------------- | ---------------------------- | ------------------------ |
| `.generation-heading h1`              | `38px`, no line height       | 40 / 48                  |
| `.generation-section-heading h2`      | `15px`, weight 650           | 24 / 32, weight 600      |
| `.generation-section-heading p`       | `10px`                       | 14 / 20, tabular counts  |
| `.generation-draft`                   | `11px`                       | 14 / 20, tabular counts  |
| `.generation-draft strong`            | `12px`                       | 16 / 24, weight 600      |
| `.generation-label`                   | `9px`, weight 700            | 12 / 16, weight 600      |
| `.generation-group legend strong`     | `11px`, weight 650           | 16 / 24, weight 600      |
| `.generation-point`                   | `9px`                        | 14 / 20                  |
| `.selection-point-reason`             | `9px`                        | 12 / 16                  |
| `.studio-kicker`                      | `9px`, weight 750, `0.12em`  | 12 / 16, weight 600, `0` |
| `.studio-heading h2`                  | `27px`, weight 500           | 24 / 32, weight 600      |
| `.studio-panel-heading h3`            | `15px`                       | 16 / 24, weight 600      |
| `.studio-badge`                       | `10px`, weight 650           | 12 / 16, weight 600      |

131 builder and studio rules were rewritten onto the shared tokens. Nothing
was scaled with the viewport: the only responsive step is the single
`@media (max-width: 700px)` breakpoint that swaps the page title to
32 / 40, which is the mobile size the plan names.

## Weight, letter spacing, and counts

- **Semibold.** Labels and headings are 600. The non-standard weights that
  were in the builder — 500, 650, 700, 750 — were normalized to 600 so the
  hierarchy is readable and consistent instead of a set of near-misses.
- **Regular body.** Explanatory copy, helper text, and paragraph text keep
  the regular weight at 14 / 20 or 12 / 16.
- **Letter spacing zero.** The only non-zero tracking left in the builder
  was `.studio-kicker` at `0.12em` and `.imagination-composer > span` at
  `0.07em`; both are now `0`. The remaining `letter-spacing: 0` declarations
  in the two files are explicit zeros, and no `em` or `ch` tracking is left
  on a builder selector.
- **Tabular counts.** Where the app already compares numbers, the digits
  now use `font-variant-numeric: tabular-nums`: the job-context card
  (`.generation-draft`), the section subtitle (`.generation-section-heading
  p`), the coverage heading, the Guided Tailor count, the studio badge, the
  studio overview stats, and the studio capacity row.
- **The page title keeps Georgia 400.** The plan's checkbox asks for
  "semibold labels/headings", but the same task also asks to preserve the
  current Georgia/Times serif heading treatment, and the app's own page
  title has always been Georgia 400 — that pairing is the app's identity
  and is what the board's product header shows. The semibold rule was
  applied to the sans operational headings and to every label. This is a
  deliberate, visible decision and is called out here rather than buried.

## Overflow was fixed by layout, not by squeezing type

Raising the type exposed one real layout fault. The selection panel's
section heading is a two-column flex row — the title on the left, the
action buttons on the right — and the wider buttons no longer fit the
panel. At 1440 the action row was 543px wide inside a 454px content box, so
it overflowed past the panel edge and into the preview pane, where the
`LaTeX preview` heading intercepted the click on **Auto Tailor**. The two
auto-tailor browser tests failed on that.

The fix is a layout change, exactly as the task's visual specification
requires ("Fix overflow by changing layout or wrapping, never by squeezing
type"):

```css
.generation-section-heading {
  flex-wrap: wrap;
}

.generation-selection-actions,
.generation-output-actions {
  flex: 0 1 auto;
  max-width: 100%;
}
```

The heading row now wraps, and the action row can shrink but never exceeds
the panel. Measured after the fix, at every supported width:

| Viewport | Panel content | Heading `scrollWidth` | Actions right edge | Panel right edge |
| -------- | ------------- | --------------------- | ------------------ | --------------- |
| 1440     | 454px         | 454                   | 765                | 784             |
| 1024     | 718px         | 718                   | within the panel  | 1000            |
| 768      | —             | = client width        | within the panel  | —               |
| 390      | 328px         | 328                   | 359                | 374             |
| 320      | 258px         | 258                   | 289                | 304             |

No font size was reduced to achieve this, and no element is clipped.

## Long content wraps in both themes

The plan asks for long company names, job titles, skill labels, counts, and
validation copy to wrap without clipping. The browser test seeds a 60-character
company name and a 62-character job title and asserts, at 1440 and 390 and in
both themes, that the document does not scroll horizontally and that no
`.generation-draft strong`, `.generation-draft span`, `.generation-point
span`, `.generation-label`, `.generation-section-heading h2`, or
`.generation-section-heading p` element is clipped. The captures
`long-context-1440-light.png` and `long-context-1440-dark.png` show the
result.

## Coverage

`tests/e2e/builder-typography.spec.ts` is new and focused. It pins four
things:

1. The builder heading hierarchy sits on the shared scale — page title
   40 / 48 in Georgia, section title 24 / 32 at weight 600, card title
   16 / 24 at weight 600, body 14 / 20, label 12 / 16 at weight 600.
2. The page title drops to 32 / 40 at the 390px width.
3. Letter spacing is `normal` or `0px` on six builder selectors, and the
   count surfaces render their digits with `tabular-nums`.
4. Long company names and job titles wrap without clipping at 1440 and 390
   in both the light and the dark theme.

The spec is deterministic: it seeds a synthetic draft and a synthetic cached
analysis in local storage, and it makes no network or AI call.

## What was deliberately left alone

- The home page, the library page, and the history page keep their own
  type. This task owns the builder and the studio only, and the plan says
  to change component styles _"only where existing typography is not
  already tokenized"_.
- The achievement library's own card typography is the library task's
  territory.
- The `.studio-heading p:last-child` mobile cap (`max-width: 190px`) and
  the studio's other spacing are spacing decisions and belong to the
  spacing task.
- The app's `h1` at 44px and `.page-intro` at its own size are the home
  page's scale. Only the builder's own title and lead copy were changed.

## Review screenshots

Captured from the production build used by the browser suite and opened for
visual review in both themes:

- `builder-1440-light.png`, `builder-1440-dark.png` — the selection panel
  with two rows selected, showing the section title, the job context card,
  and the action row.
- `builder-390-light.png`, `builder-390-dark.png` — the same state at the
  mobile width, with the 32 / 40 page title and the wrapped action row.
- `long-context-1440-light.png`, `long-context-1440-dark.png` — a 60-character
  company name and a 62-character job title, wrapped.
- `studio-1440-light.png`, `studio-1440-dark.png` — the studio after a real
  manual generation, showing the studio heading, the section tabs, and the
  editor panels.

## Validation

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — 554 passed, 10 skipped, 0 failed.
- `npx playwright test` over the builder-focused suites
  (`achievement-selection`, `auto-tailor`, `builder-typography`, `generate`,
  `guided-tailor`) — 16 passed, including the two auto-tailor tests that
  the overflow fix repaired.
- `npx playwright test` over the studio and token suites
  (`color-tokens`, `jd-analysis`, `quora-generation`, `resume-journey`,
  `resume-studio`, `studio-overrides`) — 23 passed.
- `npx prettier --check` over the source, test, and docs globs — clean.
- `git diff --check` — clean.

The browser suite needs a fontconfig configuration and the matching shared
libraries in this environment. They were provided outside the repository, and
no project file was changed for them.
