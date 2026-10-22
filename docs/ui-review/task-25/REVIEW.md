# UI task 25 — Supporting tip and badge

Branch: `codex/home-ui-task-25-tip-badge`; parent: task 24 (`3c89f0e`).
Worktree: `C:/Users/Ayush/.codex/worktrees/home-ui-task-25-tip-badge/re_changer`.
Frontend/API: `http://127.0.0.1:3225`, isolated sample-library namespace.

Inspected the mandatory chip/badge and ATS preview crops. Added the quiet
violet tip at the bottom of the existing preview, with a 20px bulb, 12px inset,
8px radius, 14px/20px heading and 13px/18px body. Guidance reads “Review the
extracted requirements before tailoring your resume.” No unsupported claims,
sample-value chips, irrelevant filters or nonfunctional tag controls added.
The existing Beta badge retains its orange tint, 24px height and 4px radius.

Captured and opened light/dark preview screenshots at 1440, 390 and 320px;
compared the tip/badge hierarchy, spacing and wrapping with both references.
The score artwork and promotional wording remain excluded by the plan.

Validation: lint/typecheck passed; two focused browser tests passed. Rendered
tip text contrast is >=4.5:1 and icon contrast >=3:1 in both themes. Tests also
check noninteractive semantics and horizontal containment. Production build
result is recorded in the PR after completion. No dependency, backend, schema,
environment or other-agent changes.

Production build passed: all 19 routes generated. Final screenshots reviewed in both themes.
