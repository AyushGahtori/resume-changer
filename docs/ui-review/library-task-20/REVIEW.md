# Task 20 — Section headers, counts, date ranges and disclosure

Branch: `codex/library-task-20-groups`, based on `origin/main` (`4a701ac`).
Capture server: `http://127.0.0.1:3046`, production build, isolated temporary
sample library (`resume-changer-playwright-data-3046`), `AI_PROVIDER=mock`.
The server was stopped and the temporary data root deleted after the capture.
No new dependencies and no environment changes.

Changes: `src/components/achievement-library.tsx` (the group header, its
disclosure and the collapsible state),
`src/lib/data/experience-dates.ts` (the date formatting helper),
`src/app/globals.css` (the header styles and the stack rule),
`tests/unit/data/experience-dates.test.ts` (the helper coverage),
`tests/e2e/library-groups.spec.ts` (the focused coverage),
`scripts/capture-library-task-20.mjs` (the capture), and the screenshots in
this folder.

## What the reader sees

Every job and every project is one group. The group header is a single row: a
32px icon tile that marks the type (a briefcase for a job, a folder for a
project), the type as a small `JOB` or `PROJECT` label, the title, the context
line (the company for a job, the role for a project), the number of points the
reader can actually see, the date range, and a chevron.

The count follows the filters. A filter that hides points inside a group
lowers that group's count, and a group that ends up with no visible point is
omitted from the page instead of being shown as an empty shell. The date range
appears only when the source data holds a usable date, so a project that was
never dated shows no date at all rather than a placeholder.

The whole header is one real `button`, so the group is reachable and operable
from the keyboard and it can announce whether it is open. The header holds no
independent action, so making it the disclosure does not hide anything else
behind it. The chevron is the same icon in both states and is rotated rather
than swapped, so the open and closed states cannot be confused.

The heading outline stays honest: the `<h3>` is labelled by the title text
only, so a screen reader announces "Platform Engineer" and not the whole row.

## Reference inspection

Compared against `docs/ui-images/achievement-library/experience-section-card-anatomy.png`
and `docs/ui-images/achievement-library/page-map-hierarchy-browsing-flow.png`.

The anatomy reference shows a section header of `[tile] Jobs 12 achievements
…… Mar 2021 – Present` and an item row of `[tile] Software Developer / Job ·
03/2023 – 03/2026 …… 3 achievements`. The group header follows it: a 32px
tile, a 16px semibold title, a 12px muted count and a 12px muted date range
aligned to the right, and a compact chevron. Two deliberate differences, both
recorded here:

- The reference puts the title first and the context on a second line. The
  header here keeps the type label above the title, so the reader can tell a
  job from a project without reading the context line.
- The reference item row shows the date range as `03/2023 – 03/2026`. The
  library now shows `Jan 2023 – Present`. The library reads the same stored
  `YYYY-MM` values as the résumé renderer, and `src/lib/latex/render-resume.ts`
  already prints `Jan 2023` and prints `Present` only when the end date is
  actually `null`, so the library and the generated PDF now agree. The
  reference poster is an earlier mock-up and is not a data contract.

The browsing-flow reference lists the section container as "Icon, title, count,
date range, expand/collapse". All five are present, in that order.

## The date rule

`formatMonth` accepts only a `YYYY-MM` value that matches
`/^\d{4}-(0[1-9]|1[0-2])$/`, the same shape the schema enforces. Anything
else - an absent value, an empty string, `2023`, `2023-13`, `2023/01` - is
treated as no date at all, and the group shows no range.

`Present` is shown for exactly one case: the stored end date is `null`. A
missing end date and a malformed end date both mean "the end date is not
known", and neither is presented as an ongoing role. The distinction matters
because `null` and "absent" mean different things in the schema: `JobSchema`
requires `endDate` to be present and possibly `null`, while `ProjectSchema`
lets it be absent entirely.

The helper lives in `src/lib/data/experience-dates.ts` and is covered by
`tests/unit/data/experience-dates.test.ts`.

## Stack rule

The header keeps the tile, the title, the count, the date range and the
chevron on one row while they fit. Below 560px the count and the date range
move to a second row under the title, so the count stays readable and is never
squeezed behind the chevron. The rule is stated in the stylesheet next to the
rules it governs, and `tests/e2e/library-groups.spec.ts` asserts it at 320px:
the count must end before the chevron starts, and the date range must sit
below the title.

A long title and a long context line wrap inside the header instead of
pushing the row past the edge of the viewport. The title uses
`overflow-wrap: anywhere` for the same reason, and a fixture group with a
deliberately long name is checked at 320px: the document does not scroll
sideways, and the title stays to the left of the chevron.

## Review findings

- The first pass put the collapsed state in the group itself. A filter that
  unmounted a group and then let it come back also undid the reader's
  collapse. The state now lives in the parent as a set of group keys, so it
  survives the group being unmounted and mounted again.
- The first pass made the `<h3>` label the whole button, so the heading was
  announced as the type, the title, the company, the count and the date
  range. The heading is now labelled by the title text alone.
- The count was the total number of points in the group, which disagreed with
  the "N of M achievement points" line above the list as soon as a filter was
  applied. The count now counts the points the reader can see.
- Collapsing a group that is off screen moved the content below it, because
  the panel disappeared from the document flow. The browser's scroll anchoring
  keeps the reader's place, and a test asserts that the group below a
  collapsed group stays where it was.
- The header is a grid with named areas, so the icon, the heading, the count,
  the dates and the chevron each have a place. This is what lets the narrow
  rule move the count and the dates without touching the markup.
- The fixture library the new spec writes into the shared test data folder
  was left there when the spec finished. The browser suite shares one data
  folder, so the fixture reached the specs that ran after it and the
  `/generate` route, which loads the personal library, stopped offering the
  sample achievements. The spec now puts the sample library back after every
  fixture test, the same way the editing spec does.

## Validation

`npm run lint`, `npm run typecheck` and `npm test` were run. The unit suite
reported 562 passed, 1 failed, 3 skipped. The single failure is
`tests/unit/pdf/toolchain-detection.test.ts` ("reports both binaries as
missing when neither is installed"), which fails identically on an unmodified
`origin/main` checkout on this machine because Tectonic and pdfinfo are
installed here. It is an environment condition and not caused by this change.

`npm run test:e2e` was run in full against the final code: **163 passed, 0
failed**.

The first two full runs of the suite reported one failure each:
`tests/e2e/quora-generation.spec.ts` ("uses the Quora JD to generate expected
LaTeX from three selected points") timed out waiting for an achievement
checkbox on `/generate`. The cause was this branch's new spec, not the product
code. The new spec writes a fictional library into the shared browser-suite
data folder to check the absent-end-date rule on a rendered header, and it
left that fixture behind. The suite shares one data folder, so the fixture
reached the specs that ran afterwards, and `/generate` loads the *personal*
library, which stopped offering the sample achievements the Quora spec
selects. The new spec now puts the sample library back after every fixture
test, the same way `tests/e2e/library-editing.spec.ts` already does. Running
the two specs together confirms the ordering dependency is gone, and the full
suite is green.

`git diff --check` is clean, and no personal library file, log, secret or
generated artefact is part of the diff.

## Screenshots

`docs/ui-review/library-task-20/` holds the captures, all taken from a
production build served from an isolated temporary data root with
`AI_PROVIDER=mock`:

- `light-1440.png` and `dark-1440.png` — the whole page.
- `light-390.png`, `dark-390.png`, `light-320.png`, `dark-320.png` — the
  narrow layouts.
- `light-390-groups.png`, `dark-390-groups.png`, `light-320-groups.png`,
  `dark-320-groups.png` — the same viewports scrolled to the group headers,
  because the headers sit below the filters.
- `light-header-expanded.png`, `dark-header-expanded.png` — one group, open.
- `light-header-collapsed.png`, `dark-header-collapsed.png` — one group,
  closed, with the chevron rotated back.
- `light-header-focus.png`, `dark-header-focus.png` — one group with the
  keyboard focus on the disclosure, showing the focus outline.
- `light-320-collapsed.png`, `dark-320-collapsed.png` — the narrow stack rule
  with the first group closed.

## Not changed

The achievement cards, the filters, the point editor and the save route are
untouched; the card surface belongs to Task 21. The point source, status and
skill filters are untouched. No personal library file, log, secret or
generated artefact is part of the diff. The review artefacts for the home page
tasks were rewritten by running the browser suite and are not part of this
change.
