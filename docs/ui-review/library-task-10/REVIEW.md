# Task 10 — The two creation actions

Branch: `codex/library-task-10-actions`, based on `origin/main` (`4a701ac`).
Capture server: `http://127.0.0.1:3031`, production build, isolated temporary
sample library (`resume-changer-playwright-data-3031`), `AI_PROVIDER=mock`.
The server was stopped and the temporary data root deleted after the capture.
No new dependencies and no environment changes.

Changes: `src/components/achievement-library.tsx` (the two actions, their
focus handling and the duplicate-invocation guard),
`src/components/achievement-point-editor.tsx` (an optional first-field focus),
`src/app/globals.css` (the action styles and the stack rule),
`tests/e2e/library-actions.spec.ts` (the focused coverage),
`scripts/capture-library-task-10.mjs` (the capture), and the screenshots in
this folder.

## What the reader sees

`Add achievement` is the primary orange CTA with a leading plus icon; it opens
the Imagination Canvas. `Detailed entry` is a neutral outlined secondary action
with a leading pencil icon; it opens the manual point editor. Both keep the
accessible names they had, both are real `button` elements, and neither carries
a `role` or `aria-checked`, so neither can be mistaken for a switch. The two
actions are only rendered on the personal route, so the read-only demo route
keeps no way into a flow it cannot complete.

## Reference inspection

Compared against `docs/ui-images/achievement-library/library-button-states.png`
and `docs/ui-images/achievement-library/source-toggle-add-control-states.png`.
The primary follows the reference in shape and order: a 44px tall orange
control, a 16-20px plus icon to the left of a 14px semibold label, a 12px
gap and a 6px radius. Two deliberate differences, both recorded here:

- The reference board hovers towards a lighter orange; the app-wide
  `--action-orange-surface-hover` token deepens it instead, and the home page
  CTA already uses that same token. The library reuses the app-wide token
  family instead of declaring its own, so the palette decision stays in one
  place for the shared colour-token task.
- The reference board sets white text on the orange. The app-wide
  `--action-orange-label` token keeps a dark label on this orange, because
  white on `#f97316` does not reach the contrast the shared tokens
  guarantee. The library follows the token.

The source toggle shown in the second reference belongs to a later task and
was left untouched.

## Stack rule

The action row keeps both buttons on one line while they fit and wraps them
onto separate lines when they do not. Below 480px the toolbar becomes a
column, the actions stack in a fixed order - secondary first, primary last -
and each button takes the full width, so the primary action stays in the same
place at every viewport. The rule is stated in the stylesheet next to the
rules it governs, and `tests/e2e/library-actions.spec.ts` asserts it at 320px.

## Review findings

- The focus restore originally ran synchronously in the close handler. The
  action that opens a flow is disabled while that flow is open, and a
  disabled button cannot take focus, so the restore was moved into an effect
  that runs after the button is enabled again.
- The trigger used to be captured from `document.activeElement` in an effect.
  A child's effect runs before its parent's, so that captured the dialog's
  text field rather than the control the reader came from. The trigger is
  now captured at click time.
- The disabled secondary action was muted only by its cursor. It now has the
  same muted surface and label as the disabled primary, so a reader can see
  that a flow is already open.
- Hover and pressed change colour only. Neither state moves the header, and
  no trailing arrow or spinner was added, because the component has no real
  pending state to show.

## Validation

`npm run lint`, `npm run typecheck` and `npm test` were run. The unit suite
reported 554 passed, 1 failed, 3 skipped; the single failure is
`tests/unit/pdf/toolchain-detection.test.ts` ("reports both binaries as
missing when neither is installed"), which fails identically on an unmodified
`origin/main` checkout on this machine because Tectonic and pdfinfo are
installed here. It is an environment condition and not caused by this change.

`npm run test:e2e` was run in full against the final code: **158 passed, 0
failed**.

An earlier run of the same suite failed one test,
`tests/e2e/home-paste-from-url.spec.ts` ("keeps the action bar on its own row
below the metrics row"), a home page layout assertion that this change does
not touch. The failure is a pre-existing race in that test. The spec flips
the server-resolved `pasteFromUrlAvailable` capability in the served
document, so the "Paste from URL" control only exists once the page has
hydrated. The test measures the footer geometry straight after
`page.goto("/")`, without waiting for that control, and the footer only
wraps into two rows while the control is present. Measuring the same page
with the same patch shows the two states directly: straight after the
navigation the footer does not wrap, the metrics end at 655 and the action
bar starts at 625, and once the patched control has appeared the footer
wraps and the action bar starts at 679. The assertion therefore passes or
fails depending on whether hydration won the race. The same test fails three
times out of three on an unmodified `origin/main` checkout, which is why it
is reported here rather than treated as a regression from this work.

The nine focused tests in `tests/e2e/library-actions.spec.ts` pass: both
actions on the personal route only, the primary presentation, the secondary
presentation, focus into and back out of the manual editor, the
duplicate-invocation guard, focus into and back out of the Imagination Canvas,
the 320px stack rule, the hover, pressed and disabled treatments, and the
keyboard focus ring on both actions.

Screenshots in this folder cover light and dark at 1440x900, 390x844 and
320px, the manual editor open over the header, and the action row in its
default, hover, disabled and secondary-disabled states.

## Not changed

The editor and the canvas contracts, the save route and the AI prompt are
untouched. The point count, the section header and the date range belong to
later tasks. No personal library file, log, secret or generated artefact is
part of the diff. The review artefacts for the home page tasks were rewritten
by running the browser suite and are not part of this change.
