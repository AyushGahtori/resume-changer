# Achievement Library Task 21 — achievement card surface and reading order

Branch: `codex/library-task-21-achievement-card`. Base: `codex/library-task-11-profile-summary` at `e3850f6`.
Worktree: `C:\Users\Ayush\.codex\worktrees\library-task-21-achievement-card\re_changer`.
Scope: `docs/UI_Tasks_achievement_library.md` Task 21, "Build The Achievement Card
Surface And Reading Order".

## Sources inspected

- `docs/ui-images/achievement-library/achievement-card-light-dark.png` — the
  printed card in both themes: a category icon tile, the achievement text, the
  enabled state, an edit action, a quantified metric row, tag chips, and the
  source line.
- `docs/ui-images/achievement-library/library-achievement-card-gallery.png` —
  the card component at its real scale, used to judge the card's own
  proportions rather than the enlarged poster annotations.
- `docs/UI_Tasks_achievement_library.md` — Task 21 and its visual
  specification.
- `src/components/achievement-library.tsx` — the previous inline `PointRow`,
  which rendered the point ID, the state, the text, the provenance, the
  metrics, and the facet chips as one flat run of rows inside the experience
  group, with a divider between each point and no card of its own.

## Decision

The inline `PointRow` became `src/components/library/achievement-card.tsx`.
The old markup was a list of rows with a bottom border, so two achievements
in the same job ran together and the only thing that separated them was a
line. Each achievement is now one card with its own surface, its own border,
and its own internal spacing, so the card is the unit the eye reads.

The card keeps the board's order:

1. the category tile and the achievement text in the header,
2. the enabled state and the edit action in the same header,
3. the quantified metrics,
4. the tags and the linked skills,
5. the provenance.

Every field is real library data. A point with no metrics, no tags, no linked
skills, and a bare source leaves those rows out instead of reserving space
for them.

## What changed

| Before                                         | After                                                           |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `PointRow` inline in `achievement-library.tsx` | `src/components/library/achievement-card.tsx`                   |
| a row with a bottom border between points      | one card per point with its own border, radius, and padding     |
| `<p class="library-point-text">`               | `<h4 class="library-point-text">` inside a labelled `<article>` |
| the point ID as the first thing in the heading | the point ID under the achievement text, kept visible           |
| the state as a bare colored word               | a pill with an icon, still text-backed                          |
| each metric on its own line with a left bar    | one aligned metric subrow separated by low-contrast dividers    |
| facet chips as plain text links                | facet chips as small pills                                      |
| no category tile                               | a 36px category tile that takes the job or project hue          |

## Accessibility

- The card is an `<article>` labelled by its own heading, so each achievement
  is a landmark a screen reader can list and jump to. The heading ids are
  derived from the point id, which is unique in the library.
- The heading levels run `h1` (page), `h2` (summary name), `h3` (experience
  group), `h4` (achievement), so the outline matches what the card shows.
- The enabled state is text plus an icon, never color alone.
- The metric list keeps its `aria-label="Achievement metrics"`.
- A linked skill that no longer exists in the library is skipped rather than
  rendered as an empty chip.
- On a phone the state and the edit action move onto their own row, so the
  text is never squeezed to make room for them.

## Deliberate differences from the boards

- The board paints the metric value in green. The metric data carries no
  sign or direction, so a green value would be a claim the data does not
  support. The value keeps the primary ink and the label keeps the muted
  step.
- The board's metric blocks read as small cards. The task's visual
  specification asks for aligned subrows and low-contrast dividers instead of
  nested cards, so the metrics are one subrow and the tags are one chip row.
- The board's card has no point identifier. The existing library shows the
  identifier, and users refer to it when they edit or report an achievement,
  so it is kept under the achievement text.
- The board's card shows a kebab menu. There is no menu behind it, so no
  kebab was invented.

## Tests

`tests/e2e/library-cards.spec.ts` covers one card per point with a unique
accessible name, the reading order of the card's regions, a card with no
metrics, no tags, no skills, and a bare source, a long achievement with a long
source reference shown in full and never clamped, the header keeping the same
height for a card with zero, one, and three metrics, the metric values,
evidence, and context, the enabled state and the edit action on personal data,
demo data staying read-only, the job and project tiles using their own
category hues, the card in both themes with a visible border, and the card at
320px without horizontal scroll and without hiding the actions.

## Known follow-ups

- Task 22 owns the narrative, the role context, and the summary text, which
  is where the achievement sentence and the experience heading get their
  final typography.
- Task 27 owns progressive disclosure. Nothing in the card is truncated
  today, and when a disclosure is added it has to keep a way to reveal the
  full value.
- The kebab menu on the board has no behaviour to hang off yet, so the card
  has no overflow action.
