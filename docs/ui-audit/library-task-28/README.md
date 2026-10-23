# Achievement Library Task 28 — responsive, empty, error, and accessibility states

Branch: `codex/library-task-28-states`. Base: `codex/library-task-21-achievement-card` at `4c49534`.
Worktree: `C:\Users\Ayush\.codex\worktrees\library-task-28-states\re_changer`.
Scope: `docs/UI_Tasks_achievement_library.md` Task 28, "Complete Responsive, Empty,
Error, And Accessibility States".

## Sources inspected

- `docs/ui-images/achievement-library/achievement-overview-light-dark.png` — the
  full page in both themes: the summary band, the search workbench, the
  filter row, the experience groups, and the cards. It shows the desktop
  composition only, so it sets the 1440px target and nothing below it.
- `docs/ui-images/achievement-library/sidebar-active-collapsed-variants.png` —
  the app navigation's active item in both themes. The active state is a
  filled surface plus a colored icon plus a colored label, never color alone.
  The library's own source switch follows the same rule with `aria-current`.
- `docs/ui-images/achievement-library/search-anatomy-and-states.png` — the
  search workbench's anatomy and its interaction states. The focused state is
  a violet ring around the field, and the result count is a separate,
  always-visible row.
- `docs/ui-images/achievement-library/profile-interaction-accessibility.png` —
  the accessibility panel: "High color contrast (meets WCAG AA)", "Icons have
  descriptive labels for screen readers", "Entire card is keyboard navigable",
  "Meaningful focus states for interactive elements", and "Responsive
  behavior: Stacks on mobile (full width)".
- `docs/ui-images/achievement-library/long-page-benefits.png` and
  `docs/ui-images/achievement-library/library-component-principles.png` — the
  long-content and component rules the card and the summary already follow.
- `docs/UI_Tasks_achievement_library.md` — Task 28 and its visual
  specification.

The board set has no full mobile Achievement Library screenshot, so nothing
below is claimed to match a mobile pixel design. The mobile rules come from
the task's own visual specification: one column, a 12–16px page inset, a
compact metric grid, stacked filters, and text that never shrinks to fit.

## Decision

Task 28 was treated as the closing pass over the surfaces Tasks 11 and 21
built, not as a redesign. Three things were missing and are now in place.

**The four library situations are four different messages.** A library with no
achievements, a library whose achievements are all filtered away, a personal
file that cannot be loaded, and the read-only demo library each used to look
alike, or were collapsed into one "no results" line. The library now
distinguishes them by meaning, not by wording alone:

- `filterAchievementLibrary` already returns a filter-independent
  `totalPointCount` and a filtered `visiblePointCount`. A total of zero is
  "no data" — there is nothing to search. A non-zero total with nothing
  visible is "no matches" — the data is there, the search is too narrow. The
  component reads the two counts instead of guessing from the visible list.
- The unavailable personal file stays a server-rendered route
  (`src/app/library/page.tsx`) with a `role="alert"` error and its
  alternate-source link. That route was not touched.
- The demo library gets a notice near the top of the page, because the demo
  data is fictional and read-only, and the page otherwise looks identical to
  the personal one until the user tries to edit it.

**Focus follows the editor.** The inline point editor is a form that opens
above the list, so the keyboard used to stay on the button that opened it and
the reader never met the fields. The library now moves focus into the editor's
first field when it opens, and returns focus to the exact control that opened
it — the card's Edit button, the "Detailed entry" button, or the empty
state's "Add achievement" button — when the editor is cancelled or saved. The
card hands that trigger back through `onEdit`, so no shared component had to
change.

**Below 1440px the page stops pretending to be a poster.** The five metric
tiles and the five filter selects each need roughly 130px of column to stay
readable, which only happens on a wide page. Below that they wrap onto more
rows instead of squeezing their labels, and the mobile layout stacks the
title, the source switch, the metrics, the filters, and the cards in one
column.

## What changed

| Before                                                                | After                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| one "No achievement points match these filters." line                 | two states, "No achievements saved yet" and "No achievements match these filters" |
| the empty state had no heading and no action                          | a labelled `<section>` with a heading, a message, and one action                  |
| a missing personal file and an empty library looked alike             | the missing file keeps its route-level `role="alert"` and its link                |
| the demo library looked editable until the user clicked               | a read-only notice above the summary                                              |
| the editor kept the keyboard on the button that opened it             | focus enters the first field and returns to the exact trigger                     |
| five metric tiles at every width                                      | five at 1440px, three at 1024/768px, a two-column grid on a phone                 |
| five filter selects in one row at every width                         | one row at 1440px, three columns at 1024/768px, one column on a phone             |
| the focus ring on the search and the filters was a border colour      | a real `outline` on `:focus-visible`                                              |
| the page title and the source switch shared one row on a phone        | they stack, so neither is squeezed into half the width                            |
| long metadata and long source references could push the page sideways | they wrap with `overflow-wrap: anywhere`                                          |
| the touch targets were as tall as their text                          | 44px on a phone and on any coarse pointer                                         |

## Accessibility

- The state block is a `<section>` labelled by its own heading, and the
  heading id comes from `useId()`, so the label stays correct when more than
  one state is on the page.
- The empty-state message keeps `role="status"`, so a screen reader hears
  why the list went empty without the focus moving.
- The result count in the filter summary keeps `aria-live="polite"` and
  reports "13 of 13", then "0 of 13", as the filters change.
- The card's category tile became a named `role="img"` — "Job achievement" or
  "Project achievement" — because the accessibility panel asks for
  descriptive icon labels. The summary's metric icons stay decorative,
  because their `<dt>` text already names them and a label would double
  announce.
- The source switch keeps `aria-current="page"` on the route it is showing,
  and the app navigation's active item is unaffected by this change.
- The search field and the filter selects now show a real focus ring
  (`outline: var(--focus-outline)`) instead of only a border colour change.
- The enabled/disabled state is text plus an icon. No critical information is
  hover-only: the card's metrics, tags, source, and status are all in the
  document.
- `prefers-reduced-motion` is already handled globally (every transition
  collapses to 0.01ms), and the e2e suite asserts it on the library page.

## Measured contrast

Computed from the token values in `src/app/globals.css`, light and dark:

| Surface                                       | Light   | Dark    |
| --------------------------------------------- | ------- | ------- |
| state message (`--muted` on `--surface-soft`) | 9.45:1  | 9.35:1  |
| state heading (`--ink` on `--surface-soft`)   | 16.30:1 | 14.90:1 |
| read-only notice text                         | 9.33:1  | 9.90:1  |
| read-only notice icon                         | 6.41:1  | 6.06:1  |

Every one of them clears WCAG AA for text (4.5:1), and the icons clear the
3:1 that non-text contrast asks for.

## Deliberate differences from the boards

- The board's search workbench shows quick filter chips with counts and a sort
  control. The library has neither today, so neither was invented. The chip
  count, when it arrives, has to keep the touch target and the wrap
  behaviour the CSS now provides.
- The board's empty state is not shown at all, so the wording and the layout
  of the two state blocks follow the task's own requirement for "concise
  messages" rather than a board.
- The board's mobile view does not exist, so the mobile layout is one column
  with a 16px inset as the task's visual specification asks, and no claim is
  made about matching a mobile design.
- The five-column metric row on the board is kept at 1440px. At 1024 and
  768px the tiles wrap to three columns instead of truncating, because the
  board's own rule "never shrink text to fit" outranks keeping the count.

## Tests

`tests/e2e/library-empty-states.spec.ts` (5 tests) covers the four
situations: a personal library with no achievements says it is empty and not
filtered, and offers the first achievement; a filtered library says that
nothing matched, names the total it searched, and brings all 13 points back
when the filters are reset; the demo library is read-only, says so, and shows
no Edit button; a personal file that has been removed produces the
`role="alert"` error that names the missing file, and the alternate-source
link still works.

`tests/e2e/library-responsive.spec.ts` (7 tests) covers no horizontal
overflow at 320, 390, 768, 1024, and 1440 with both the demo library and a
fixture of deliberately long company names, achievement text, metric labels,
evidence, source references, tags, and skills; the wide summary and filter
rows at 1440; the wrapped metrics and filters at 1024 and 768 with the
sections still full width; the stacked phone layout with the status pill and
the Edit button still visible; the editor inside a narrow viewport; and the
search workbench and the source switch sharing one row at 1440.

`tests/e2e/library-accessibility.spec.ts` (9 tests) covers the keyboard
moving into the editor and back to the "Detailed entry" button, the keyboard
returning to a card's Edit button, a visible focus ring on the focused
select, `aria-current="page"` on the navigation and the source switch, the
named category icons, the card's information being visible without a hover,
the polite result count, a 44px touch target for the facet chip on a phone,
and the reduced-motion rule.

`tests/e2e/library.spec.ts` was updated for the new empty-state wording.

Full suite on the branch: 190 passed, 0 failed. Unit tests: 554 passed, 1
failed, 3 skipped. The single unit failure is
`tests/unit/pdf/toolchain-detection.test.ts` → "reports both binaries as
missing when neither is installed", which fails on this machine because
Tectonic and `pdfinfo` are installed; it reproduces on an unmodified
checkout and is unrelated to this change.

## Known follow-ups

- `tests/e2e/home-paste-from-url.spec.ts` → "keeps the action bar on its own
  row below the metrics row" was observed failing intermittently during this
  task, including on the base commit `4c49534` with every Task 28 change
  removed. It is a home-page geometry assertion and it passes on the branch
  as it stands. It looks like load-dependent flakiness, and it is recorded
  here rather than hidden.
- Task 29 owns the final visual acceptance pass, which is where the light
  and dark regressions for all 190 tests get their final review.
- The quick filter chips and the sort control on the board are still not
  built. The CSS in this task already wraps and gives them a 44px target
  when they arrive.
- The sidebar's collapsed variant is the app navigation's work, not the
  library's. The library only owns the source switch, and its active state
  now matches the navigation's convention.
