# Achievement Library Task 11 — profile summary surface

Branch: `codex/library-task-11-profile-summary`. Base: `codex/library-task-02-color-tokens-v2` at `e2f68be`.
Worktree: `C:\Users\Ayush\.codex\worktrees\library-task-11-profile-summary\re_changer`.
Scope: `docs/UI_Tasks_achievement_library.md` Task 11, "Build The Profile Summary
Surface".

## Sources inspected

- `docs/ui-images/achievement-library/profile-summary-light-dark.png` — the
  printed light and dark summary: a single bordered surface with the identity
  on the left, five tinted metric tiles on the right, a small source label
  above a serif name, an optional headline, and a large value under each
  coloured label.
- `docs/ui-images/achievement-library/profile-summary-anatomy.png` — the
  annotated crop, used to confirm that the identity is plain text on the
  surface rather than a card of its own.
- `docs/UI_Tasks_achievement_library.md` — Task 11 and its visual
  specification.
- `src/components/achievement-library.tsx` — the previous inline summary, which
  rendered a `.library-overview` flex row with a `.library-owner` identity
  block and a `.library-counts` definition list.
- `src/lib/data/achievement-search.ts` — `filterAchievementLibrary`, which
  already returns a filter-independent `totalPointCount` next to the filtered
  `visiblePointCount`.

## Decision

The summary moved into its own component, `src/components/library/profile-summary.tsx`,
because the surface now has enough structure (an identity block and a metric
grid with per-category tokens) that keeping it inline in the 500-line library
component would obscure both. The component is still a single bordered
surface: the identity is unboxed text on the surface and each metric is a
tinted tile, so the panel never nests a second card around either one.

The previous markup already separated the two counts. `library-counts` showed
the five library totals and the search workbench showed "N of M achievement
points" separately, so the honest split the task asks for was preserved rather
than merged. The summary now reports the same five categories the task names
(Jobs, Projects, Points, Skills, Credentials) and the workbench keeps the
visible-result count.

## What changed

| Before                                 | After                                                                |
| -------------------------------------- | -------------------------------------------------------------------- |
| `.library-overview` flex row           | `.library-overview` grid: identity column plus metric grid           |
| `.library-owner` identity block        | `.library-identity` block, unboxed                                   |
| `.library-counts` flat definition list | `.library-metrics` grid of five `.library-metric` tiles              |
| no per-metric icon                     | one `lucide-react` icon per metric, matched to the category          |
| no metric label colors                 | `--color-category-*-text` tokens                                     |
| inline summary in the library page     | `<ProfileSummary />` in `src/components/library/profile-summary.tsx` |

The five counts are read from the loaded library, not from the filtered
result. `filterAchievementLibrary` computes `totalPointCount` from every job
and project point regardless of the active facets, so the summary count cannot
drift when a facet hides results.

## New tokens

The category identifier hues from Task 02 are fills: on a light surface they
are too light to carry text. A darker step of the same hue was added for the
metric labels and icons.

| Token                               | Light     | Dark      | Provenance                         |
| ----------------------------------- | --------- | --------- | ---------------------------------- |
| `--color-category-job-text`         | `#B23C0C` | `#FDBA74` | Implementation estimate (new step) |
| `--color-category-project-text`     | `#6D28D9` | `#A78BFA` | Implementation estimate (new step) |
| `--color-category-points-text`      | `#8F5206` | `#FBBF24` | Implementation estimate (new step) |
| `--color-category-skills-text`      | `#076B4D` | `#34D399` | Implementation estimate (new step) |
| `--color-category-credentials-text` | `#4F46E5` | `#818CF8` | Implementation estimate (new step) |

The dark steps match the dark identifier hues, which are already light enough
to carry text. The light steps were chosen as the darkest step of each hue
that still reads as that hue.

## Measured contrast

Label and icon color against the 12% tinted metric tile, and the tile's large
value against the same tile.

| Category    | Light label on tile | Light value | Dark label on tile | Dark value |
| ----------- | ------------------- | ----------- | ------------------ | ---------- |
| Jobs        | 5.30                | 15.96       | 8.60               | 13.86      |
| Projects    | 5.93                | 14.89       | 5.25               | 13.66      |
| Points      | 5.66                | 16.27       | 8.13               | 12.97      |
| Skills      | 5.84                | 15.98       | 7.23               | 13.28      |
| Credentials | 5.26                | 14.93       | 4.85               | 13.83      |

Text on the surface itself: source label 7.10 light / 6.36 dark (it uses
`--color-violet-strong`, the board's blue-violet), headline 10.35 light /
10.38 dark, name and value use `--color-text-primary`. Every label clears
4.5:1 on its own tile in both themes.

## Deliberate differences from the boards

- The board paints the metric icon in the bright identifier hue. On a 12%
  tinted tile that hue measures 1.96:1 (Points) to 2.31:1 (Jobs), so the icon
  takes the text-safe step of the same hue instead and the bright hue is kept
  for the tile tint. The category still reads by hue.
- The board's dark metric tiles carry their own border. The light tiles do
  not, so the border was added for the dark theme only.
- The board's light surface is a very slightly lavender card. The summary
  keeps the app's shared `--color-surface` so the library and the home page
  stay on the same token.

## Tests

`tests/e2e/library-summary.spec.ts` covers the demo and the personal source
label, the optional headline being present and being absent with no empty
placeholder left behind, zero counts, a 250-skill library whose value is not
clipped, the summary counts staying put while a search facet narrows the
workbench to "4 of 13 achievement points", the phone layout with the identity
stacked above a two-column metric grid and no horizontal scroll, and every
label and value being visible in both themes.

## Known follow-ups

- Task 12 owns the "View details" action and the profile interaction states
  that the board shows next to the identity. The summary leaves that space
  empty on purpose so the task can add it without a second card.
- The board shows a total of 25 points and 100 skills. Those are printed
  example values; the implementation always reports the loaded library.
