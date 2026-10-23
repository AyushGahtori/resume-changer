# UI task 28 — Accessibility, focus, contrast and motion

Branch: `codex/home-ui-task-28-accessibility`; parent task 27 (`d310a88`).
Worktree: `C:/Users/Ayush/.codex/worktrees/home-ui-task-28-accessibility/re_changer`.
Frontend/API: `http://127.0.0.1:3228`, isolated sample-library namespace.

Opened the mandatory role-form spacing/accessibility and JD-editor
accessibility crops. Added a keyboard skip link, explicit required/editor
helper association, icon-and-text errors, first-invalid-field focus and
2px violet focus outlines with 2px offset. Home controls meet 44px targets;
field/control boundaries and orange microcopy use readable contrast values.
Reduced-motion mode disables animations while preserving textual progress.

Retry remains the same DOM button during loading, failure and success, with
aria-disabled guarding repeated requests rather than removing the focused
button. Analysis status announcements are confined to the compact polite
status region. The mobile drawer updates visibility immediately, focuses after opening,
recovers focus after native blur and resets internal scroll on reopening.
This correction followed a real reduced-motion/long-flow focus failure.

Automated audits use axe-core already present in the locked eslint dependency
tree; no manifest/lockfile changes or new packages. WCAG 2 A/AA and 2.1 AA
audits cover idle, validation, successful analysis and open mobile navigation
in both themes. Keyboard checks cover skip navigation, errors, retry focus,
44px targets, reduced motion and repeated short-drawer opens. Screenshots were
captured and opened for desktop/mobile validation/focus and result review.
Lint, typecheck and the production build pass. All 11 accessibility, responsive and sidebar browser tests pass on port 3228.

Manual screen-reader record: no spoken-output Narrator/NVDA session was run.
Narrator is available, but starting a global reader on this shared desktop
would affect the user/other agents. Automated axe, browser accessibility-tree
and keyboard checks were performed; these are not represented as a manual
screen-reader test or a guarantee of complete WCAG conformance.

No backend/schema/storage-contract changes, dependencies, personal files or
other-agent edits. Prior generated task screenshots are restored before
commit; the evidence here represents task 28 specifically.
