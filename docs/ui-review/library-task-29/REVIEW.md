# Task 29 — Component tests and final visual acceptance

Branch: `codex/library-task-29-acceptance`, based on `origin/main` (`4a701ac`).
Capture server: `http://127.0.0.1:3049`, production build, isolated temporary
sample library (`resume-changer-playwright-data-3049`), `AI_PROVIDER=mock`.
The server was stopped and the temporary data root deleted after the capture.
No new dependencies, no schema change, no environment change, and no product
code change.

Changes: nine focused browser specs and one extended unit spec, the capture
script, and the screenshots in this folder. The specs are named
`library-task-29-*.spec.ts` so that they can be merged alongside the other
open library pull requests without a file-name clash; the reason is set out
under "The test map".

## What this branch is, and what it is not

Task 29 is the acceptance task for the Achievement Library. It adds the
focused component coverage the earlier tasks depend on, and it records the
visual acceptance.

This branch is based on `origin/main` and changes no product code, so what it
contains is the library **as it is on `main` today**, plus the tests that hold
it in place. The tasks that restyle the library — 02 to 28 — are separate
pull requests, and none of them is in this branch, so the design the boards
describe — the reconciled palette, the metric tiles, the sticky workbench,
the category navigation, the group disclosure, the restyled card surface — is
not in these screenshots.

The visual acceptance below is therefore honest about two different things:
what is verified here, and what is owned by a pull request that has not been
merged. Every checklist item that belongs to another task is named with the
task that owns it, rather than being quietly reported as done or quietly
dropped.

## The test map

| File                                           | What it protects                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/library-task-29-shell.spec.ts`      | The library inside the shared workspace shell: the frame, the named regions, the source switch, the add and detailed-entry controls, keyboard focus, and a clean console and network.                |
| `tests/e2e/library-task-29-summary.spec.ts`    | The summary: the real counts, the identity, the source label, and the rule that the count line follows the filters.                                                                                  |
| `tests/e2e/library-task-29-search.spec.ts`     | The search box: finding a point by id, by text and by a linked skill, the empty result, the live region, and clearing the box.                                                                       |
| `tests/e2e/library-task-29-filters.spec.ts`    | Each filter facet on its own, the tag and skill chips, the reset action, and keyboard access to a select.                                                                                            |
| `tests/e2e/library-task-29-cards.spec.ts`      | The card surface: identity, text, state, provenance, metrics with their evidence, the tag and skill distinction, and the skills and credentials lists.                                               |
| `tests/e2e/library-task-29-groups.spec.ts`     | The groups: the job and project kinds, the points inside a group, the date range, a finished role, and the stable order.                                                                             |
| `tests/e2e/library-task-29-responsive.spec.ts` | 1440x900, 1024x768, 768x1024, 390x844 and 320x740: no horizontal overflow, the filter row, the source switch, and the point text.                                                                    |
| `tests/e2e/library-task-29-theme.spec.ts`      | The dark theme: the switch, the canvas, the readability of the point text, the choice across a reload, and reduced motion.                                                                           |
| `tests/e2e/library-task-29-error.spec.ts`      | The failure state: a library file that cannot be parsed has to be reported and has to offer the other source.                                                                                        |
| `tests/unit/data/achievement-search.test.ts`   | The filter helper: the stable order, the five search fields, the combined filters, the alias match, the project filter, the independence of the skill and credential lists, and the disabled branch. |

### Why the file names carry the task number

The plan names the files it expects — `library-shell.spec.ts`,
`library-summary.spec.ts`, `library-filters.spec.ts`, `library-groups.spec.ts`,
`library-cards.spec.ts`, `library-responsive.spec.ts` — but the other open
library pull requests already use those exact paths:

| Path the plan suggests                 | Also used by                |
| -------------------------------------- | --------------------------- |
| `tests/e2e/library-shell.spec.ts`      | PR #80                      |
| `tests/e2e/library-summary.spec.ts`    | PRs #72, #75, #76, #79, #86 |
| `tests/e2e/library-filters.spec.ts`    | PR #80                      |
| `tests/e2e/library-groups.spec.ts`     | PRs #79, #81, #85           |
| `tests/e2e/library-cards.spec.ts`      | PRs #75, #79, #84           |
| `tests/e2e/library-responsive.spec.ts` | PR #87                      |

Two branches that each add a different file at the same path cannot both be
merged; the merge stops on an add/add conflict and a person has to reconcile
the two files by hand, seven times over. The specs here are therefore named
`library-task-29-*.spec.ts`, which keeps the plan's "one clearly named file
per component" and leaves every pull request mergeable on its own. The
reviewer who merges them will find two files for some components, one from
the feature pull request and one from this acceptance, which is the honest
result: the two cover different things.

`tests/unit/data/achievement-search.test.ts` is the one file the plan
explicitly asks to be extended, and PR #80 extends it too. That overlap
cannot be avoided. The additions here are appended at the end of the file and
assert the branches the sample library cannot reach on its own, so the two
sets of cases can be kept side by side.

The unit file grew from six cases to fourteen. The extra cases are the
branches the shipped sample library cannot reach on its own: a project named
by the experience filter, a skill reached through its alias, the independence
of the skill and credential lists from the point filters, and the disabled
status. A small fictional library with one enabled and one disabled point
covers the last one.

`tests/e2e/library.spec.ts` and `tests/e2e/library-editing.spec.ts` are left
as they are. They already hold the regressions the plan asks for, and adding
a second copy of the same assertions under a new name would be duplication,
not coverage.

The plan also suggests `tests/e2e/library-header.spec.ts` and
`tests/e2e/library-category-navigation.spec.ts`. There is no category
navigation on this branch — it is Task 17 — so there is nothing to test yet.
The header is covered by `library-task-29-shell.spec.ts`, which is where the
source switch and the add controls live, so a separate file would only move
the same assertions to another name. PR #74 adds
`tests/e2e/library-header.spec.ts` for the restyled header, and PR #80 adds
`tests/e2e/library-shell.spec.ts` for the shell, so the two paths are left to
the pull requests that own them.

## Regressions preserved

| The plan asks for            | Where it is held                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source switching             | `library.spec.ts` ("offers explicit personal and demo source navigation"), `library-task-29-shell.spec.ts` ("marks the source the reader is looking at"), `library-task-29-summary.spec.ts` ("shows the personal source label on the personal route") |
| Group and provenance display | `library.spec.ts` ("shows a grouped fictional library and its source details"), `library-task-29-groups.spec.ts`, `library-task-29-cards.spec.ts` ("keeps the provenance of a point inspectable")                                                     |
| Combined search and facets   | `library.spec.ts` ("searches and combines facets, then resets them"), `library-task-29-search.spec.ts`, `library-task-29-filters.spec.ts`                                                                                                             |
| Empty results                | `library.spec.ts` ("shows an empty state and supports searching credentials"), `library-task-29-search.spec.ts` ("reports an empty result and an empty skill list together")                                                                          |
| Reset                        | `library.spec.ts`, `library-task-29-filters.spec.ts` ("offers the reset action only while a filter is active")                                                                                                                                        |
| Create, edit, cancel, save   | `library-editing.spec.ts` (four tests)                                                                                                                                                                                                                |
| Duplicate id                 | `library-editing.spec.ts` ("rejects a duplicate point ID without altering existing data")                                                                                                                                                             |
| Demo read-only               | `library-editing.spec.ts` ("keeps demo data read-only"), `library-task-29-shell.spec.ts` ("offers the add and detailed-entry controls on the personal route"), `library-task-29-cards.spec.ts` ("offers the edit action on the personal route")       |
| Theme                        | `library-task-29-theme.spec.ts` (four tests)                                                                                                                                                                                                          |
| Mobile layout                | `library.spec.ts` ("keeps the library usable on a narrow viewport without horizontal overflow"), `library-task-29-responsive.spec.ts` (ten tests)                                                                                                     |

## Visual acceptance checklist

The screenshots in this folder were compared against
`docs/ui-images/achievement-library/achievement-overview-light-dark.png`,
`library-color-palette.png`, `library-type-scale.png`,
`long-page-before-after.png` and `achievement-card-light-dark.png`.

| Check                                                           | Result here                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Heading and context hierarchy                                   | **Met.** The eyebrow, the `h1` and the intro line are in the order the reference uses. The reference's restyled header is Task 08.                                                                                                                                                                                             |
| Shared palette decision                                         | **Owned by Task 02.** The library still uses the app-wide tokens. No cross-page colour fidelity is claimed.                                                                                                                                                                                                                    |
| Exact fonts remain unchanged                                    | **Met.** Georgia/Times and Arial/Helvetica are untouched; no font was added. The reference's Playfair/Inter annotations are a poster convention and are not applied.                                                                                                                                                           |
| Summary identity and counts are real                            | **Met.** The summary shows the loaded name, the role, the source label, and the counts 2 / 2 / 13 / 14 / 2, which are the counts of the sample library. `library-summary.spec.ts` asserts them.                                                                                                                                |
| Add, edit and source controls work                              | **Met.** The personal route offers `Detailed entry` and `Add achievement`; the demo route offers neither, and no card carries an `Edit` button there. The source switch marks the current source.                                                                                                                              |
| Search and every existing facet compose                         | **Met.** The five facets (`Job or project`, `Point source`, `Point status`, `Linked skill`, `Tag`) and the search box narrow the list together, and the count line follows.                                                                                                                                                    |
| Category navigation reaches sections                            | **Not present on this branch.** Task 17.                                                                                                                                                                                                                                                                                       |
| Sort is not a dead control                                      | **Not present on this branch.** Task 18. There is no sort control, so there is no dead one.                                                                                                                                                                                                                                    |
| The sticky workbench never overlays content                     | **Not applicable on this branch.** The filter panel is not sticky here; the sticky workbench is Task 14.                                                                                                                                                                                                                       |
| Group, date and count metadata is correct                       | **Partly.** The group shows its kind, its title, its context line and its date range, and the order is stable. The visible point count, the icon tile and the disclosure belong to Task 20. The date range is asserted for the months it contains rather than for one rendering, so the assertion survives the Task 20 change. |
| Card metrics retain their evidence                              | **Met.** A metric shows its label, its value, its unit, the evidence sentence and the context line.                                                                                                                                                                                                                            |
| Tags and skills stay distinct                                   | **Met.** A tag is `#name` and a linked skill is a plain name; the card spec counts them separately and the chip that carries a skill is marked apart from the one that carries a tag.                                                                                                                                          |
| Provenance stays inspectable                                    | **Met.** Every point shows its source type and its source label.                                                                                                                                                                                                                                                               |
| Enabled and disabled states carry a label                       | **Met.** The status is written out, and the unit spec covers the disabled branch.                                                                                                                                                                                                                                              |
| The demo library stays read-only                                | **Met.** No add button, no edit button, and no editor.                                                                                                                                                                                                                                                                         |
| Light and dark surfaces stay legible                            | **Met.** The dark theme changes the canvas and the surfaces, and the point text is measurably lighter in the dark theme than in the light one.                                                                                                                                                                                 |
| 320, 390, 768, 1024 and 1440                                    | **Met.** Every one of the five widths is captured, and the document does not scroll sideways at any of them.                                                                                                                                                                                                                   |
| Keyboard focus                                                  | **Met** for the controls this branch has: the source switch, the filter selects and the search box all show the focus ring.                                                                                                                                                                                                    |
| Reduced motion                                                  | **Met.** The library renders the same with `reducedMotion: "reduce"`.                                                                                                                                                                                                                                                          |
| Empty state                                                     | **Met.** "No achievement points match these filters." with the count line at 0 of 13 and the reset action offered.                                                                                                                                                                                                             |
| Error state                                                     | **Met.** A library file that is not valid JSON produces a named error section, the reason, and a link to the demo library. This state had no coverage before and now has two tests and two screenshots.                                                                                                                        |
| No console errors                                               | **Met.** The shell spec watches the console, the responses and the failed requests for a full load and expects all three to be empty.                                                                                                                                                                                          |
| No fake user values                                             | **Met.** Every screenshot is taken from the fictional sample library, served from an isolated temporary data root.                                                                                                                                                                                                             |
| No sample achievement claims in production defaults             | **Met.** Nothing was copied into the product.                                                                                                                                                                                                                                                                                  |
| No favorite, delete, Go Pro, poster decoration, gradient or orb | **Met.** The library on this branch has none of them, and this change adds none.                                                                                                                                                                                                                                               |
| No clipped text                                                 | **Not met at 768px.** The filter selects cut their selected option short at that width, and the search placeholder is cut at 320px. Both are described below. Nothing else is clipped, and the document never scrolls sideways.                                                                                                |
| No horizontal overflow                                          | **Met.** Checked at 1440, 1024, 768, 390 and 320.                                                                                                                                                                                                                                                                              |

### The two visible imperfections

**The filter selects lose their text at 768px.** The filter panel is a five
column grid above 700px. At 768px the sidebar is still open, so the library
column is about 500px wide and each select gets roughly 85px of it. The
browser then cuts the selected option off: the row reads `All expe`,
`All sour`, `All stat`, `All skill` and `All tags` instead of `All
experience`, `All sources`, `All statuses`, `All skills` and `All tags`. The
label above each select (`Job or project`, `Point source`, `Point status`,
`Linked skill`, `Tag`) is still complete, the select still opens and still
filters, and the document does not scroll sideways, so nothing is lost — but
the value the reader is looking at is not legible at that width. The same
panel is complete at 1024px and stacks to one column below 700px.

This is a finding of the acceptance, and it is not fixed on this branch: the
presentation of the facets belongs to Task 16, and the workbench that will
carry them is Task 14. It is recorded here so that the task that owns it
picks it up.

**The search placeholder is cut at 320px.** The placeholder of the search box
ends at the word `credentials`. That is the placeholder inside a single-line
input, which scrolls its own text, and the reader's own input replaces it. No
content is clipped, and the document does not scroll sideways. It is recorded
here because the checklist asks for no clipped text and a reviewer should be
able to see that this is the one place the rule is visible.

Neither imperfection is covered by a test, because a test that asserts the
current behaviour would lock the defect in place, and a test that asserts the
correct behaviour would fail on this branch. They are recorded instead.

## What this branch cannot claim

The following checklist items belong to the tasks that are still open. They
are listed so that the acceptance of Task 29 is not read as a claim about
work that is not in this branch.

| Item                                                                        | Owned by        | Open pull request |
| --------------------------------------------------------------------------- | --------------- | ----------------- |
| The reconciled shared colour tokens                                         | Task 02         | #71               |
| The library type scale                                                      | Task 03         | #70               |
| The surface, spacing, border and shadow tokens                              | Task 04         | #83               |
| The button and icon conventions, and the hover and pressed states           | Task 05         | #82               |
| The library composition inside the shell                                    | Task 06         | #78               |
| The active sidebar destination                                              | Task 07         | #80               |
| The restyled library header                                                 | Task 08         | #74               |
| The restyled source switch                                                  | Task 09         | #73               |
| The styled add and detailed-entry actions                                   | Task 10         | #77               |
| The profile summary surface and the honest identity navigation              | Tasks 11 and 12 | #76 and #72       |
| The dynamic metric tiles                                                    | Task 13         | #86               |
| The sticky search and filter workbench                                      | Task 14         | —                 |
| The search input states                                                     | Task 15         | —                 |
| The presented advanced filter facets                                        | Task 16         | —                 |
| The counted category navigation                                             | Task 17         | —                 |
| The real sort, the result count and the reset feedback                      | Task 18         | #80               |
| The content organised into jobs, projects, skills and credentials           | Task 19         | #81               |
| The section headers, the visible counts, the date ranges and the disclosure | Task 20         | #85               |
| The achievement card surface and its reading order                          | Task 21         | #84               |
| The narrative, the role context and the summary text                        | Task 22         | #75               |
| The metric presentation with evidence and context                           | Task 23         | —                 |
| The tag, linked-skill and overflow chips                                    | Task 24         | —                 |
| The source and provenance presentation                                      | Task 25         | —                 |
| The enabled state and the card actions                                      | Task 26         | —                 |
| The expanded details, the editing and the read-only demo state              | Task 27         | #79               |
| The remaining responsive, empty, error and accessibility states             | Task 28         | #87               |

The pull request column was read from the repository when this review was
written, and a task with no pull request yet is marked with a dash. Task 19
is in the list because the library groups the content by kind, and the group
spec asserts that grouping.

The specs in this branch are written so that they keep holding when those
changes land. The group spec asserts the date range for the months it
contains rather than for one rendering, and the card and filter specs assert
behaviour and labels rather than a specific colour or a specific header
markup.

## Validation

`npm run lint` and `npm run typecheck` were run and are clean.

`npm test` reported **558 passed, 1 failed, 3 skipped (562)**. The single
failure is `tests/unit/pdf/toolchain-detection.test.ts` ("reports both
binaries as missing when neither is installed"), which asserts that at least
one PDF binary is missing. Tectonic and pdfinfo are installed on this
machine, so the assertion cannot hold here. It fails the same way on an
unmodified `origin/main` checkout and is an environment condition, not a
result of this change. It is reported here rather than counted as a pass.

`npm run test:e2e` was run in full against the final code: **201 passed, 0
failed**.

The new specs were also run together on their own, 52 tests, so that a
failure inside them is visible without the rest of the suite. The new specs
never write to the shared browser-suite data folder, except
`library-task-29-error.spec.ts`, which has to break the personal library file
to reach the failure state and puts the fictional sample library back after
every test. The `docs/ui-review/task-20` and `docs/ui-review/task-21`
screenshots are rewritten by the browser suite, and they were restored
afterwards so that they are not part of this diff.

One earlier run of the suite reported nine failures and forty-three tests
that did not run. The cause was this review, not the product: the spec files
were renamed to the `library-task-29-` names while that run was in progress,
so the browser worker lost the file it was about to run. The suite was run
again from the start afterwards, against the final file names, and it is that
run the numbers above come from.

`git diff --check` is clean. No personal library file, log, secret, `.env`
file, generated artefact or poster asset is part of the diff.

## Screenshots

`docs/ui-review/library-task-29/` holds the captures, all taken from a
production build served from an isolated temporary data root with
`AI_PROVIDER=mock`:

- `light-1440x900.png` and `dark-1440x900.png` — the whole page.
- `light-1024x768.png` and `dark-1024x768.png` — the tablet layout with the
  sidebar still open.
- `light-768x1024.png` and `dark-768x1024.png` — the narrow tablet, the last
  width before the shell moves its navigation above the page.
- `light-390x844.png` and `dark-390x844.png` — the narrow layout with the
  sidebar collapsed.
- `light-320x740.png` and `dark-320x740.png` — the narrowest layout.
- `light-summary.png` and `dark-summary.png` — the summary on its own.
- `light-controls.png` and `dark-controls.png` — the search and filter panel
  on its own.
- `light-group.png` and `dark-group.png` — the first group with its points.
- `light-card.png` and `dark-card.png` — one card on its own, with its
  metric, its evidence and its chips.
- `light-secondary.png` and `dark-secondary.png` — the skills and the
  credentials, with the skills list opened.
- `light-empty.png` and `dark-empty.png` — the empty result, with the count
  line at 0 of 13 and the reset action.
- `light-error.png` and `dark-error.png` — the failure state, with the
  reason and the link to the demo library.

## Not changed

The achievement library component, the stylesheet, the schemas, the loaders,
the writers and the API routes are untouched. The card surface belongs to
Task 21, the group header to Task 20, and the workbench to Task 14. No
personal library file, log, secret or generated artefact is part of this
diff.
