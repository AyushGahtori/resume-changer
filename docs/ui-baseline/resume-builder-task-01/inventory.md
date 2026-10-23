# Task 01 Resume Builder baseline

Inventory of the Resume Builder (`/generate`) as it exists on `main` at
`676f3aa`, captured in the isolated Task 01 worktree. No application code,
data contract, or app styling was changed for this baseline.

Everything below was read from the source, not from the boards. The boards
(`docs/ui-images/resume-builder/builder-overview-light-dark.png` and
`builder-page-breakdown-design-system.png`) were opened first, and the app
panes were compared against them; the poster background, the page-breakdown
cards, the slide title, and the annotation callouts are not app UI.

All captures use the fictional demo library
(`examples/sample-resume-library.json`), a synthetic job description, and a
synthetic cached job analysis. No personal data, no live AI provider, and no
external service was used.

## Route and shell

- Route: `/generate`, resolved by `src/app/generate/page.tsx`.
- Source value: `?source=demo` selects the fictional demo library; every other
  value (including none) resolves to `personal`. The value is passed to
  `loadResumeLibrary` and to the client component as the `source` prop.
- Load failure: the route renders `section.generation-error` with
  `role="alert"`, the loader's message, and a link to the other source.
- Shell: `src/components/workspace-shell.tsx` owns the brand, the five
  destinations (Job description, Achievement library, Resume builder, History,
  Settings), the `Workspace / Resume builder` breadcrumb, the `Local mode`
  badge, the theme toggle, the `Private workspace / Saved on this device`
  footer, the skip link, and the mobile drawer. The builder adds no second
  shell and no duplicate navigation.

## Job context, draft restore, and analysis

- Draft key: `resume-changer.jd-draft.v1`, schema version 1, read on mount by
  `readDraft` (`src/lib/jd-draft.ts`). The read has four states: `empty`,
  `restored`, `invalid`, and `unavailable` (storage blocked).
- The builder renders the stored role title (`Target role not specified` when
  empty), the company, and the trimmed character count of the stored
  description. When no draft exists it shows `No saved job description.` with
  a link to the Job description page. When the stored job URL is an HTTP(S)
  URL it also renders an `Open job link` link.
- A draft that cannot be parsed produces the notice
  `The saved job draft could not be restored. Return to Job description and
save it again.`; blocked storage produces `Browser storage is unavailable,
so no saved job draft can be used.`
- Analysis cache key: `resume-changer.jd-analysis.v1`. The builder only
  accepts a cached analysis when the company, role title, and job description
  match the restored draft exactly (trimmed). Without a matching analysis the
  page states `Analyze this job description on the Job description page
before requesting AI recommendations.`
- The job description is never sent to the builder route; the builder reads it
  from browser storage only.

## Selection

- Groups: `getPointGroups` builds one group per job and per project, keeping
  only the points whose `enabled` flag is true, and dropping empty groups.
  Each group is a `fieldset` whose `legend` shows the kind (`JOB` /
  `PROJECT`), the title, and the subtitle (company, or project role).
- Each point is a native checkbox inside a `label`, with the accessible name
  `Select achievement <point id>`.
- The heading reports `{selected} selected · {enabled} enabled`, where
  `enabled` is the number of enabled points across all groups.
- `Select all` selects every enabled point; `Clear` empties the selection and
  resets the skill selection to the skills already listed on the resume.
- Any change to the selection clears the generated result, the compiled PDF,
  the copy message, and the request error, so the preview can never show
  output that does not match the current selection.
- Empty library: `This library has no enabled achievement points.`

## AI actions and fallback consent

- `Suggest points` → `POST /api/ai/select-achievements` with
  `{ dataSource, jobDescription, analysis }`. It requires a saved description
  and a matching analysis. On success the returned selections replace the
  selection and the recommended skills are merged with the skills already
  listed on the resume. A separate `Apply recommendations` action re-applies
  the stored recommendation without calling the service again.
- `Guided Tailor` → `POST /api/ai/tailor-achievements`. It additionally
  requires at least one selected point and refuses more than 100. Its
  proposals are shown as a comparison with the original wording, and nothing
  is rewritten until the user approves each proposal. The approved text is
  the only text sent to generation.
- `Auto Tailor` → `POST /api/ai/auto-tailor`. It selects, drafts wording, and
  reports the coverage, the summary, and the inferred terms it used.
- All three are disabled while any other AI request is in flight, and the
  buttons show `Finding matches…`, `Drafting wording…`, and `Auto tailoring…`
  while running.
- Fallback consent: every AI request goes through `postWithFallbackConsent`.
  If the route answers with a non-2xx status and `fallbackAvailable: true`,
  the app opens a confirmation that states the AI did not complete the step
  and names the fallback type. Nothing falls back until the user accepts; the
  accepted request then sets `allowLocalFallback` or `allowOriginalsFallback`
  explicitly.
- The three AI actions are violet (`--color-violet-subtle` surface,
  `--color-violet-strong` label) and are visually distinct from the orange
  primary action.

## Generation, review, history, compile, download, and errors

- Generation: `POST /api/generate` with `dataSource`, `company`,
  `roleTitle`, `jobUrl`, `jobDescription`, `tailoringMode`,
  `selectedAchievementIds`, `sectionOrder`, and, when present,
  `selectedSkillIds` and `achievementTextOverrides`.
- Guards: a missing description reports `Save a job description before
generating a resume.`; an empty selection reports `Select at least one
enabled achievement point.` A transport failure reports `The server could
not be reached. Try again.`
- The manual workflow uses the original wording, and the preview states
  `Generated internally by Resume Changer from your selected evidence. AI did
not rewrite the content.`
- After a generation the selection panel is replaced by the Resume Studio
  (`src/components/resume-studio.tsx`), which owns the review tabs (Overview,
  Achievements, Skills, Projects, Education & credentials, Job match), the
  staged edits, undo/redo, the skill capacity measurement, and the apply
  flow.
- History: every generation is posted to `POST /api/history` with the
  status `drafted`, `compiled`, or `failed`. The notice is `Saved to
generation history on this device.`; when history cannot be reached the
  output is still kept and the message says so.
- Compile: `POST /api/compile` with the generated LaTeX. The response is only
  accepted when the content type is `application/pdf` and the `X-PDF-Pages`
  header is `1`; otherwise the page reports `The server returned an unverified
PDF. Try compiling again.` Compiler diagnostics are available in a
  `Compiler details` disclosure inside the `role="alert"` block.
- Downloads: `Download LaTeX` writes the `.tex` file, `Download PDF` writes
  the compiled PDF, and `Export package` writes a `.zip` with the LaTeX, the
  generation metadata, and the PDF when a verified one exists. The export
  package keeps the private job description out of the metadata.
- Session restore: a saved generation is stored per source under
  `resume-changer.resume-session.v1.<source>` and offered back through a
  `Restore editing session` / `Start fresh` choice.

## API calls used by the builder

| Call                               | Trigger                | Notes                                             |
| ---------------------------------- | ---------------------- | ------------------------------------------------- |
| `POST /api/ai/select-achievements` | Suggest points         | Needs a saved description and a matching analysis |
| `POST /api/ai/tailor-achievements` | Guided Tailor          | Needs at least one selected point                 |
| `POST /api/ai/auto-tailor`         | Auto Tailor            | Needs a saved description and a matching analysis |
| `POST /api/generate`               | Generate LaTeX         | Manual, guided, or auto workflow                  |
| `POST /api/compile`                | Create PDF / Recompile | Requires a verified PDF response                  |
| `POST /api/history`                | After every generation | Status `drafted`, `compiled`, or `failed`         |
| `GET /api/history`                 | History page           | Not called by the builder itself                  |
| `POST /api/resume/edit`            | Studio apply           | Commits a reviewed draft                          |
| `POST /api/resume/skills`          | Studio skill changes   | Re-measures the two-line capacity                 |

`POST /api/ai/analyze-job-description` is called from the Job description
page, not from the builder; the builder only reads the analysis it cached.

## Section order in the current DOM

1. `header.generation-heading` — eyebrow `MANUAL GENERATION 02 / 04`, the
   `h1` (`Build your resume.` before a generation, `Your next chapter.` after
   one), and the supporting line.
2. `nav.library-source-switch` — `My data` / `Demo data`, with
   `aria-current="page"` on the active source.
3. `div.generation-draft` — the job context card.
4. Status notices — the draft notice, the auto-tailor status, the history
   notice, and the saved-session restore prompt.
5. `form.generation-form` →
   `div.generation-layout` →
   `section.generation-selection` (`aria-label="Choose achievements"`), the
   `div.studio-panel-resizer` divider (only after a generation), and
   `section.generation-preview` (`aria-labelledby="preview-title"`).
6. `div.generation-footer` — the source label and the `Generate LaTeX`
   primary action.

The preview is a sibling of the selection panel, not a child of it, and the
page is a single scrolling column.

## Viewer and empty states

- The preview panel is titled `LaTeX preview` or `PDF preview` and carries
  the `LaTeX` / `PDF` tabs as a `role="tablist"`. The `PDF` tab is disabled
  until a verified PDF exists.
- Before a generation the preview shows `Your generated LaTeX will appear
here.`
- The LaTeX tab shows the generated source in a `role="region"` named
  `Generated LaTeX`. The PDF tab shows the compiled document in an iframe
  named `Generated resume PDF`, with zoom from 50% to 200%, `Fit width`,
  `Fit page`, and a full-screen toggle.
- The generated metadata line reports the generation time, the number of
  rendered achievements, the number of skills shown, and how many skills were
  omitted to keep the two-row limit.
- The empty selection state is `This library has no enabled achievement
points.`

## Keyboard behavior

- Every interactive element is a native control: links, buttons, checkboxes,
  and text inputs. Nothing depends on pointer-only handlers.
- The output tabs are `role="tab"` buttons with `aria-selected` and
  `aria-controls`. There is no roving tabindex or arrow-key handling, so Tab
  moves between them.
- The panel divider is a `role="slider"` with `aria-valuemin` 30 and
  `aria-valuemax` 60; `ArrowLeft` and `ArrowRight` move the preview share by
  2 points.
- The shell provides a skip link to `#workspace-content` and moves focus
  when the mobile navigation drawer opens and closes.

## Board control to current behavior

| Board control                                                              | Current counterpart                      | Status                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Sidebar destinations and workspace footer                                  | `workspace-shell.tsx`                    | Supported                                                  |
| `Workspace / Resume builder` breadcrumb, `Local mode`, theme toggle        | `workspace-shell.tsx`                    | Supported                                                  |
| `MANUAL GENERATION 02 / 04` eyebrow, `Build your resume.`, supporting line | `.generation-heading`                    | Supported                                                  |
| Job description context card (role, company, character count)              | `.generation-draft`                      | Supported; the count comes from the stored draft           |
| `My data` / `Demo data`                                                    | `.library-source-switch`                 | Supported                                                  |
| `Choose achievements` and `0 selected · 13 enabled`                        | `.generation-section-heading`            | Supported; both numbers are derived                        |
| `Suggest points`, `Guided Tailor`, `Auto Tailor`                           | `.generation-ai-button`                  | Supported; Guided Tailor needs a selected point            |
| `Select all`, `Clear`                                                      | `.generation-selection-actions`          | Supported                                                  |
| Checkbox rows grouped by job and project with a subtitle                   | `.generation-group`, `.generation-point` | Supported                                                  |
| `Search achievements…` input                                               | none                                     | Not implemented today; Task 13 owns it                     |
| `All experiences` select                                                   | none                                     | Not implemented today; Task 13 owns it                     |
| `LaTeX preview` heading with `LaTeX` / `PDF` tabs                          | `.generation-preview`                    | Supported                                                  |
| `Download PDF`, `Recompile`                                                | preview actions, PDF tab only            | Supported                                                  |
| `Copy`, `Download LaTeX`, `Create PDF`, `Export package`                   | preview actions                          | Supported                                                  |
| Rendered document in the preview                                           | PDF tab iframe                           | Supported; the LaTeX tab shows the source                  |
| `Generate LaTeX` orange action                                             | `.generation-footer .primary-button`     | Supported; it sits in the footer, not in the preview panel |
| Fixed split between list and preview                                       | `.studio-panel-resizer`                  | Supported and resizable, 30–60%, default 43% preview       |
| `Include Projects section`, `Include credentials`                          | Studio tabs                              | Supported in the studio, not in the selection panel        |

## Product data the board shows that the product does not

- The board's companies, role titles, bullets, dates, counts, and character
  counts (`Google`, `ML engineer`, `2,736 description characters`,
  `13 enabled`) are illustration data. The product derives every one of them
  from the loaded library and the stored draft.
- The board shows a finished resume document in the preview before anything
  has been generated. The product shows an empty preview until a real
  generation exists, and never substitutes a sample document.
- The board shows a `Search achievements` field and an `All experiences`
  filter. Neither exists yet, so neither is faked here.
- The board has no job-match or coverage meter on the overview slide. The
  product's coverage lives in the studio `Job match` tab and in the
  recommendation panel, and is labelled with evidence rather than a score.

## Reference conflicts

- The board is a static poster crop with a fixed two-column list. The
  product is a resizable, scrollable workspace whose panes swap content
  after a generation.
- The board's palette prints `#FF7A18` for the primary orange, `#FFF7F1` for
  the app background, `#F8FAFC` for surfaces, and `#16A34A` for success. The
  shared tokens in `src/app/globals.css` currently print `#f97316`,
  `#f8fafc`, `#ffffff`, and `#10b981`. The delta is recorded here and belongs
  to Task 02; no color was changed for this baseline.
- The board's type specimen names Playfair Display and Inter. The product
  keeps Georgia for headings and Arial/Helvetica for operational UI, as the
  plan requires.

## Captures and geometry

Captured from the production build on `http://127.0.0.1:3022` against the
fictional demo library.

| Viewport | Theme |                 Sidebar | Page content |       Selection |         Preview | Horizontal overflow |
| -------- | ----- | ----------------------: | -----------: | --------------: | --------------: | ------------------- |
| 1440×900 | light |                   260px |       1180px |           492px |           602px | No                  |
| 1440×900 | dark  |                   260px |       1180px |           492px |           602px | No                  |
| 1024×768 | light |                   220px |        804px | 756px (stacked) | 756px (stacked) | No                  |
| 1024×768 | dark  |                   220px |        804px | 756px (stacked) | 756px (stacked) | No                  |
| 768×1024 | light |          72px collapsed |        696px | 648px (stacked) | 648px (stacked) | No                  |
| 768×1024 | dark  |          72px collapsed |        696px | 648px (stacked) | 648px (stacked) | No                  |
| 390×844  | light | 280px off-canvas drawer |        390px | 358px (stacked) | 358px (stacked) | No                  |
| 390×844  | dark  | 280px off-canvas drawer |        390px | 358px (stacked) | 358px (stacked) | No                  |
| 320×740  | light | 272px off-canvas drawer |        320px | 288px (stacked) | 288px (stacked) | No                  |
| 320×740  | dark  | 272px off-canvas drawer |        320px | 288px (stacked) | 288px (stacked) | No                  |

The two-pane layout only exists above 1100px; at 1100px and below
`.generation-layout` becomes a single `minmax(0, 1fr)` column, so the
selection panel and the preview stack. At 700px and below the page title
drops to 34px, the selection and preview padding drops to 14px, the action
rows wrap full width, the group list scrolls inside a `65vh` region, and the
LaTeX preview scrolls inside a `60vh` region.

Full geometry, computed typography, computed colors, the section list, and
the console-error log are in `measurements.json`. No console error and no
page error was recorded in any capture.

Screenshots: `screenshots/builder-1440x900-light.png`,
`screenshots/builder-1440x900-dark.png`,
`screenshots/builder-1024x768-light.png`,
`screenshots/builder-1024x768-dark.png`,
`screenshots/builder-768x1024-light.png`,
`screenshots/builder-768x1024-dark.png`,
`screenshots/builder-390x844-light.png`,
`screenshots/builder-390x844-dark.png`,
`screenshots/builder-320x740-light.png`,
`screenshots/builder-320x740-dark.png`,
`screenshots/builder-empty-job-context-light.png`,
`screenshots/builder-empty-job-context-dark.png`,
`screenshots/builder-review-1440x900-light.png`,
`screenshots/builder-review-1440x900-dark.png`,
`screenshots/builder-review-390x844-light.png`, and
`screenshots/builder-review-390x844-dark.png`.

The two `builder-empty-job-context` captures record the state with no saved
job description. The four `builder-review` captures record a real manual
generation of the demo library, with the studio open and the compiled LaTeX
in the preview.
