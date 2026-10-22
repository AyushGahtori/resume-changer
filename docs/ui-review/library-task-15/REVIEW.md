# Task 15 — Style global search and its input states

Branch: `codex/library-task-15-search-styles`.
Base: `codex/library-task-14-search-workbench` (`aaf483d`, PR #89).
Review server: `http://127.0.0.1:3030` (production build, fictional demo data).

Owned changes: the search control in
`src/components/library/search-workbench.tsx`, the `.library-search` rules in
`src/app/globals.css`, the new cases in `tests/e2e/library-search.spec.ts`,
and this review folder. No filter semantics, no search semantics, no schema,
no data loading, and no other control was changed.

## The boards, opened before the field was touched

`docs/ui-images/achievement-library/search-anatomy-and-states.png` and
`docs/ui-images/achievement-library/library-input-states.png` were opened
first.

The search board prints the field four times:

| State     | What the board shows                                                        |
| --------- | --------------------------------------------------------------------------- |
| Default   | magnifier, placeholder, neutral 1px border, no clear action                 |
| Focused   | 2px violet ring, the typed query, an `×` at the trailing edge               |
| Filled    | magnifier, the query, the `×`, and the neutral border again                 |
| Cleared   | back to the default field, with the filter reset affordance beside it        |

Its placeholder copy is `Search achievements... (points, skills, tags, jobs,
projects, credentials)`. The UI-kit input sheet prints the same rule for a
generic field: a 2px violet focus ring, and a border that returns to neutral
once the field is filled and the focus moves away.

## What the field looked like before

The field was a bare text input with a visible 10px label above it, no
icon, no clear action, and a 12px font. Its border came from the same rule
as the filter dropdowns, so the search control and the five facets were
styled as one undifferentiated group, and the focus state was only a border
colour change — no ring.

## What the field looks like now

- **One field, not a label and a box.** The border belongs to
  `.library-search` as a whole, so the magnifier and the clear action sit
  inside one control, exactly as the board prints it. The old visible
  `Search library` label is now visually hidden but still the field's
  accessible name, so `getByRole("searchbox", { name: "Search library" })`
  and every screen reader still announce it. The board shows no visible
  label on the global search, and the visible text is the placeholder.
- **A leading magnifier.** `lucide-react`'s `Search` icon, `aria-hidden`,
  in the neutral `--muted` colour, so it carries no meaning of its own.
- **A trailing clear action, only when there is something to clear.** The
  button is rendered only while the query is non-empty, its accessible name
  is `Clear search`, and it resets **the query only**. The separate
  `Reset filters` control, which clears the facets and the query together,
  is unchanged and is still the only control named that way.
- **The board placeholder.** `Search achievements... (points, skills, tags,
  jobs, projects, credentials)`.
- **The board's field measurements.** 1px neutral border
  (`--color-border-strong`), 6px radius (`--radius-control`, the app's
  shared control radius), 14px/20px text, 12px horizontal inset, 44px
  height, and the field spans the workbench width.
- **The app's shared focus treatment.** Focused, the field takes
  `border-color: var(--focus)` and `box-shadow: var(--field-focus-ring)`,
  which is the app-wide 2px violet ring — the same token the job
  description fields use. A filled field that is not focused keeps the
  neutral border, so the ring means "focused", not "has text".
- **One clear action, not two.** Chromium draws its own
  `::-webkit-search-cancel-button` on a `type="search"` input, which would
  have put a second `×` next to the field's own. The browser's decoration is
  hidden, and the field keeps a single, labelled, keyboard-reachable
  action.

The filter dropdown rules were split out of the shared selector but their
values are unchanged; only the search field was restyled.

## What was deliberately left alone

- **The search semantics.** `src/lib/data/achievement-search.ts` is
  untouched. The query still matches point text and ID, the experience
  name, tags, linked skill names and aliases, and the provenance fields,
  and the search stays global.
- **The empty-state copy.** The wording of the no-results message belongs
  to Task 28, which is already in flight as PR #87 and already rewrites
  that message and its heading. This task did not restate it, so the two
  branches cannot disagree about the same sentence. What this task does
  guarantee, and asserts in the browser test, is that the two states are
  structurally different: an empty or unmatched result is an inline
  `role="status"` message inside the page, while a library that cannot be
  read is a separate `role="alert"` page render, and the query stays in
  the field so it can be edited rather than being discarded.
- **The filter facets.** Their appearance is Task 16's work.
- **The workbench surface, the sticky offsets, and the result count.**
  They are Task 14's work and are unchanged.

## Coverage

Eight cases were added to `tests/e2e/library-search.spec.ts`:

1. The field keeps the accessible name `Search library`, carries the board
   placeholder, shows the magnifier, and shows the clear action only while
   there is text.
2. Clearing resets the query and leaves the chosen facet alone: the tag
   filter stays on `aws` and the result count returns to `1 of 13`.
3. The field is neutral at rest — 1px neutral border, 6px radius, no
   shadow, 44px tall — takes the 2px violet ring on focus, and returns to
   the neutral border once it is filled and blurred.
4. The same treatment holds in the dark theme, where the ring is the
   theme's lighter violet.
5. Typing updates the result count immediately: the count is read straight
   after the input event, so a debounced implementation would still show the
   old number.
6. The query composes with the facets — the `Python` skill, the query
   `python`, and the `aws` tag narrow `13 of 13` to `0 of 13`.
7. A long query stays on one line inside the field at 390px, scrolls within
   the input, and does not make the page scroll sideways.
8. The no-results state is a `role="status"` message, no load-failure
   element is present, and the query is still in the field.

The suite is deterministic: it uses the fictional demo library, makes no
network or AI call, and the only writes are the local library fixture the
harness already isolates per port.

## Review screenshots

Captured from the production build used by the browser suite and opened for
visual review in both themes:

- `search-default-1440-light.png`, `search-default-1440-dark.png` — the
  field at rest with the magnifier and the board placeholder.
- `search-focus-1440-light.png`, `search-focus-1440-dark.png` — the field
  focused, showing the 2px violet ring.
- `search-filled-1440-light.png`, `search-filled-1440-dark.png` — a filled
  field with the trailing clear action and the neutral border.
- `search-no-results-1440-light.png`, `search-no-results-1440-dark.png` —
  the no-results state.
- `search-390-light.png`, `search-390-dark.png` — a long query at the
  mobile width, on one line inside the field.

## Validation

- `npm run lint` — passed.
- `npm run typecheck` — passed.
- `npm test` — 548 passed, 10 skipped, 0 failed. One earlier run reported
  a timeout in `tests/unit/pdf/toolchain-detection.test.ts`; the file is
  byte-identical to the base commit, the test passes in isolation in
  1.4s, and the whole suite passed on the re-run, so it is load-dependent
  flakiness in this environment and not a change of mine.
- `npx playwright test tests/e2e/library-search.spec.ts` — 15 passed
  (7 from Task 14, 8 new).
- `npx playwright test` over `library.spec.ts`, `library-editing.spec.ts`,
  and `library-responsive.spec.ts` — 19 passed.
- `npx prettier --check` over the source, test, and docs globs — clean.
- `git diff --check` — clean.

The browser suite needs a fontconfig configuration and the matching shared
libraries in this environment. They were provided outside the repository, and
no project file was changed for them.
