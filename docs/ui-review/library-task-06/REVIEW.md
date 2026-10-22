# Task 06 — Rebuild the library page composition inside the existing shell

Branch: `codex/library-task-06-rebuild-library-page-composition`. Base: `2afe609`.
E2E server: `http://127.0.0.1:3017` (stopped after verification).

Owned changes: `src/components/achievement-library.tsx`, the child components
under `src/components/library/`, `src/lib/data/library-summary.ts`,
`src/lib/ui/library-labels.ts`, the library styles in `src/app/globals.css`,
the layout/edit specs, and this review folder. Other worktrees and unfinished
files were untouched.

Inspected `achievement-overview-light-dark.png` and `library-header-light-dark.png`
from the supplied Achievement Library boards before moving any section. The
reference panes are the app composition and the header crop; the poster
background, callouts, and UI-kit panels are not app content.

## Composition

The page now reads in the order the plan requires, and the order is asserted by
`tests/e2e/library-layout.spec.ts`:

1. `header.library-page-header` — eyebrow, `h1`, the supporting line, the
   `My data` / `Demo data` source switch, and the creation controls.
2. `section.library-overview` — the profile summary (identity block plus the
   five counts derived from the loaded library).
3. `section.library-workbench` — the sticky band with the global search, the
   five existing facets, the in-page category navigation, and the result count.
4. `div.library-content` — the Jobs, Projects, Skills, and Credentials sections
   as sibling, unframed surfaces, each with its own current count.

`WorkspaceShell` still owns the brand, sidebar, breadcrumb, theme control, and
the responsive drawer. The library route adds no second shell and no duplicate
sidebar; the layout spec asserts one `main`, one `Main navigation` landmark,
and the shared breadcrumb.

The main column keeps the shell's `minmax(0, 1fr)` track and `min-width: 0`,
and the library column is a flex column with `min-width: 0`, so the long page
scrolls naturally. Sections are siblings separated by a rule and a heading row
rather than nested cards.

## Preserved behavior

The source links, the detailed point editor, the Imagination Canvas, the search
state, the five facets, the reset action, and the local save message all keep
their existing handlers and accessible names. The eight editing checks in
`tests/e2e/library-editing.spec.ts` still pass unchanged. The only change to
`library-editing.spec.ts` is the `.library-secondary` locator, a class that
this task removed when the two-column skill/credential area became the Skills
and Credentials sections.

## Empty states

Every section reports its own empty state, so a filtered-to-nothing library
reads truthfully instead of showing an empty heading. A section with no match
shows a plain `No jobs/projects/skills/credentials match this search.` line and
keeps its `0 …` count; a section with matches keeps its disclosure control.
The page-level `role="status"` message is unchanged, and the load-error state in
`src/app/library/page.tsx` was not touched.

## Review screenshots

Captured from the production build used by the browser suite and opened for
visual review in light and dark themes and at 1440, 390, and 320px:

- `light-1440.png`, `dark-1440.png` — the full composition in both themes.
- `light-390.png`, `light-320.png` — one column, no horizontal overflow.
- `light-1440-scrolled.png` — the workbench stays pinned and reachable.
- `light-1440-empty.png` — the filtered-to-nothing state.

The workbench is sticky above 1100px and static below it, so the filter row and
the section navigation never squeeze. Anchor targets carry a `scroll-margin-top`
that clears the pinned band, measured at 179px of workbench height against a
200px offset.

## Validation

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — 553 passed, 10 skipped, 0 failed. While the browser suite was
  building in parallel, `tests/unit/ai/mock-provider.test.ts > is selected by
the provider factory` intermittently hit its 5s timeout; it also fails that
  way on the untouched base commit `2afe609` in this environment and passes
  when the file is run alone. It is a load-sensitive timing issue unrelated to
  this task, and it was not changed here.
- `npx playwright test tests/e2e/library.spec.ts tests/e2e/library-layout.spec.ts tests/e2e/library-editing.spec.ts` — 20 passed.
- `git diff --check` — clean.

No new dependencies, environment files, storage contracts, or API changes. The
shared token set was reused; no `.library-page` palette override was added.

Environment note: the browser suite needs a fontconfig configuration and the
matching libraries to run here. They were provided outside the repository, and
no project file was changed for them.
