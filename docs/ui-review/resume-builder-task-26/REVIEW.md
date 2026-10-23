# UI review — Task 26: Download, recompile, and export actions

Branch: `codex/resume-builder-task-26-export-actions`
Worktree: `C:/Users/Ayush/.codex/worktrees/resume-builder-task-26-export-actions`
Frontend/API: `http://127.0.0.1:3111` (dev server), browser suite on port `3110`.

## Reference crops opened

- `docs/ui-images/resume-builder/ui-kit-preview-controls.png` — the LaTeX/PDF
  tabs, then a neutral outlined **Download PDF**, then a compact **Recompile**.
  No orange in the preview control row.
- `docs/ui-images/resume-builder/preview-light-dark.png` — the preview heading
  row in both themes: tabs on the left of the action group, Download PDF and
  Recompile to the right of them, in that order, in both themes.
- `docs/ui-images/resume-builder/preview-benefits-toolbar.png` — the viewer
  toolbar and its document actions, which are a separate surface from the
  preview heading row and are not touched by this task.

## What the controls do now

| Control          | Availability                                   | Wired to                                        |
| ---------------- | ---------------------------------------------- | ----------------------------------------------- |
| `Download PDF`   | always rendered; disabled until a PDF exists   | `downloadPdf()` → the latest verified PDF blob  |
| `Create PDF` / `Recompile` | always rendered; disabled while compiling | `compilePdf()` → the current generated LaTeX    |
| `Copy`           | LaTeX view                                     | `copyLatex()` → `result.latex`                  |
| `Download LaTeX` | LaTeX view                                     | `downloadLatex()` → `result.latex`              |
| `Export package` | always rendered; disabled while compiling      | `downloadExportPackage()` → `createResumeExportPackage()` |

The compile control is one control with three truthful labels: **Create PDF**
when nothing is compiled, **Recompile** once a verified PDF exists, and
**Creating PDF…** / **Compiling…** while the compiler runs. The old wording is
preserved exactly.

## States

- **No PDF yet.** `Download PDF` and the PDF tab are disabled, the PDF tab
  keeps its tooltip, and a line under the actions explains the missing
  compile output and the next action ("No compiled PDF yet. Choose “Create
  PDF” to compile your generated LaTeX; the PDF download and the PDF inside
  the export package stay unavailable until it succeeds."). Nothing is labelled
  ready: the `PDF ready · 1 page.` status only appears after a verified
  compile.
- **Compile running.** The compile control is disabled, reports its pending
  label, and carries `aria-busy`. `Download PDF` and `Export package` are
  disabled for the duration, so no action can capture a half-replaced PDF and
  no second compile can be submitted.
- **Compile failed.** The compiler's own error and diagnostics stay as they
  were, the PDF download stays disabled, and the compile control returns to
  its enabled state so the compile can be retried.
- **PDF ready.** `Download PDF` is enabled, the PDF tab is enabled, and the
  availability line disappears.

## Visual hierarchy

- `Download PDF` is the neutral outlined secondary control: a 1px border, the
  surface background, primary ink text, semibold.
- `Recompile`, `Copy`, `Download LaTeX` and `Export package` are compact
  utility actions: 26px tall, muted text, soft surface.
- The orange primary emphasis is gone from the preview action row. Orange now
  belongs only to the **Generate LaTeX** workflow call to action.
- The action order is the same in both themes and at every width: tabs,
  Download PDF, compile, LaTeX utilities, Export package. The row wraps
  instead of overflowing at 390px.

## Captures

`scripts/capture-builder-task-26.mjs` drives the demo library only, answers
`/api/compile` with a local fixture, and never reaches a real compiler, a
real AI provider, or personal data.

- `light-1440x900-latex-no-pdf-actions.png`, `light-1440x900-pdf-ready-actions.png`,
  `light-1440x900-latex-with-pdf-actions.png`, `light-1440x900-latex-no-pdf-preview.png`,
  `light-1440x900-pdf-ready-page.png`
- the same five for `dark-`
- the same five for `390x844` in both themes

## Mismatch found and fixed

The first capture showed the disabled `Download PDF` reading as the most
prominent control in the row: it kept the primary ink colour at 55% opacity,
while the enabled utility actions were muted to `--muted`. A disabled control
therefore looked stronger than the enabled ones. The disabled state now also
switches the text to `--muted` and drops to 50% opacity, so an unavailable
download reads as inert in both themes.
