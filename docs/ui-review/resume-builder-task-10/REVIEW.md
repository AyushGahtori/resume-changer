# Task 10 — Style the My data and Demo data source choice

## What this branch is, and what it is not

This branch changes one thing in the product: the source choice in the resume
builder at `/generate`.

It **is** about:

- where the choice sits,
- how the two options look,
- how the loaded source is marked, for a reader and for assistive technology,
- and the focused coverage that proves the choice changes the library the
  builder actually loads.

It is **not** about:

- the job context card's own surface, padding or typography — that is Task 09;
- the achievement library's own source switch, which is a different control
  with its own open pull request (library Task 09, PR #73);
- the shared builder colour, type or spacing tokens — that is Task 02;
- the selection state and the counts — that is Task 12;
- the AI action buttons next to the selection list — that is Task 11.

No schema, prompt, API route, data loader, dependency or environment file is
touched. The whole change is one component, one stylesheet and one spec.

## The change

**The choice moved next to the job context it applies to.** It used to sit in
the page heading row, on the far side of the page from the job description it
governs. The board puts it inside the job context card, and the plan's own
visual specification asks for the choice to stay "adjacent to job context". It
now sits in the job context band, on the right of the job description, and
drops below it on a narrow screen.

**It is a two-option segmented control.** Two compact, equal-height segments
inside a bordered container, with the loaded source on a tinted segment and the
other one on plain surface. The treatment follows
`docs/ui-images/resume-builder/header-component-states.png` and
`docs/ui-images/resume-builder/ui-kit-job-context-card.png`, adapted to the
app's own tokens: the container uses the shared surface, border and radius
tokens, and no builder-only palette was added.

**The loaded source is marked twice.** The link for the loaded source carries
`aria-current="page"`, which is the accessible current value, and it also gets
the tinted, bold segment, which is the visible selected state. The visible
state is never carried by colour alone — the weight and the marker are there
too.

**The control no longer inherits the band accent colour.** The job context
band coloured every link inside it with the accent colour, which is right for
"Add job details" and "Open job link" and wrong for a control. The accent
rule is now scoped to the job context links, and the unselected segment uses
the shared muted text colour.

**The builder has its own class for this.** The choice used the achievement
library's `.library-source-switch` class, which meant the two source switches
shared one stylesheet rule. The builder now uses `.builder-source-switch`, and
the library's own switch is not touched by this branch. This is deliberate:
the library switch has its own open pull request, and sharing the rule would
have made the two pull requests conflict over the same selector.

## Regressions preserved

| Behaviour                                                         | How it is protected                                                                                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The two routes, `/generate` and `/generate?source=demo`           | The route itself is unchanged; `src/app/generate/page.tsx` is not edited at all.                                                                                           |
| The link names "My data" and "Demo data"                          | Unchanged, so `tests/e2e/achievement-selection.spec.ts`, `tests/e2e/guided-tailor.spec.ts` and `tests/e2e/resume-journey.spec.ts`, which click them by name, keep working. |
| The source reaching every AI and generation route as `dataSource` | Unchanged. The `source` prop is read exactly as before, and it is what the server uses to load the library.                                                                |
| The job context live region                                       | Still `aria-live="polite"`. It now covers the job description only, so the source control is not part of the announced region.                                             |
| The job context band's left accent, label, and text               | Unchanged.                                                                                                                                                                 |

## The states that do not apply

The plan asks for the states the component can actually reach, and says not to
invent the ones it cannot.

- **Disabled or read-only segment:** not applicable. Both sources are always
  available, so there is no state in which one of them cannot be chosen. The
  builder has no read-only library either — the demo library is fictional
  rather than locked, and the page says so in the footer.
- **Loading:** not applicable. Choosing a segment is a navigation to another
  route, so the browser's own load takes over. There is no in-page request to
  put a spinner on, and adding one would mean faking a pending state.
- **Success and error:** not applicable to the control itself. The control
  either loads the library or the route reports that the library could not be
  loaded. That error state belongs to `src/app/generate/page.tsx`, it is
  unchanged by this branch, and it is not the control's state to draw.

## The test map

`tests/e2e/builder-task-10-source-choice.spec.ts` — eleven tests.

| Test                                                          | What it protects                                                                                                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| marks the loaded source as the current one on a direct load   | `aria-current` follows the route, on both routes, and the page says which data it is using.                                                                                         |
| loads the other source when the other segment is chosen       | Choosing a segment navigates to that source's route and the page reports the new source.                                                                                            |
| keeps the chosen source after a refresh                       | A reload does not fall back to the personal source.                                                                                                                                 |
| returns to the source that was loaded when the history moves  | Back and forward restore the right segment.                                                                                                                                         |
| activates a source from the keyboard                          | Tab reaches the segments and Enter activates them.                                                                                                                                  |
| shows a visible focus ring on the focused segment             | The focused segment has a real outline, not a removed one.                                                                                                                          |
| marks the segment under the pointer and the one being pressed | The pointer state and the pressed state are separate steps, and the test reads the computed background in both.                                                                     |
| keeps the choice beside the job context                       | The choice is inside the job context band, to the right of the job description, on the same band, at 1440px.                                                                        |
| stacks the choice under the job context on a narrow screen    | At 320px the choice drops below the job description instead of squeezing it.                                                                                                        |
| swaps the loaded library when the other segment is chosen     | The real proof that the choice is not a cosmetic preference: the personal library is given one extra achievement, the count moves from 13 to 14, and the demo library is untouched. |
| keeps a saved session with the source that produced it        | A finished session is offered under the source that produced it and not under the other one.                                                                                        |

The file name carries the task number on purpose. The plan names the files it
expects, and the parallel agents working the other builder tasks will pick the
same obvious names. `builder-task-10-source-choice.spec.ts` keeps this pull
request mergeable on its own, the same way the library specs were named.

The personal library fixture is written to the shared browser-suite data
folder and the sample library is copied back in `afterEach`, so the folder is
left as the suite found it.

## Visual acceptance

Captured from a production build served from an isolated temporary data root
with `AI_PROVIDER=mock`, in both themes, at 1440x900, 1024x768, 768x1024,
390x844 and 320x740.

| Check                                                  | Result                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two compact, equal-height segments                     | Met. Both segments are the same height and the same width floor in both themes.                                                                                   |
| The loaded source is visibly selected                  | Met. The loaded segment is tinted and bold, the other one is plain.                                                                                               |
| The current value is available to assistive technology | Met. `aria-current="page"` on the loaded segment, and the two segments are inside a labelled navigation.                                                          |
| The choice is adjacent to the job context              | Met. It sits in the job context band, to the right of the job description.                                                                                        |
| No large pill cards, no cloud-sync implication         | Met. The control is 3px-padded inside a 1px border; both labels name a local source.                                                                              |
| The source is labelled honestly                        | Met. The segments say "My data" and "Demo data", and the page footer states which one is loaded ("Using your local resume data" / "Using fictional demo data").   |
| Light theme                                            | Met. Unselected segment in the shared muted text colour, selected segment in the shared surface-hover tint.                                                       |
| Dark theme                                             | Met. The container is one tonal step below the band and the selected segment one step above it, so the selected state is a surface step and a border, not a glow. |
| No horizontal overflow at 320px                        | Met. The choice stacks below the job description.                                                                                                                 |
| The keyboard focus ring is visible                     | Met. The shared `a:focus-visible` ring applies, and the test measures the computed outline width.                                                                 |
| The pointer and pressed states are separate steps      | Met. The test reads the computed background in the resting, pointer and pressed states, and the pressed state is a further step.                                  |

## The one behaviour this branch does not change

There is a real finding here, and it is recorded rather than fixed, because
fixing it would change behaviour that this task is told to preserve.

The source choice is a link to another route, and Next.js keeps the page
mounted across that navigation. The builder's in-memory state — the checked
achievements, the recommendation, the tailoring, and the "restore editing
session" prompt — is therefore **not** re-read when the source changes through
the control. The library that the page renders _does_ change: the loaded
count moves from 13 to 14 in the test above, and the footer reports the new
source. But a selection or a saved session made under one source is still on
screen under the other one, until the page is loaded again.

A full load does bind the state to the source: the session is stored under
`resume-changer.resume-session.v1.<source>` and the loader refuses a session
whose `dataSource` does not match. The "keeps a saved session with the source
that produced it" test covers that.

This branch does not change it. The plan says to "preserve the current
personal/demo source routes and selection", and the count synchronisation
across a source change is named in Task 12, not here. The finding is handed
to Task 12 and to the task that owns the job context.

A test that asserts the current carry-over would lock it in, and a test that
asserts the opposite would fail here, so neither was written.

## Validation

- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm test` — **560 passed, 1 failed, 3 skipped (564)**. The single failure
  is `tests/unit/pdf/toolchain-detection.test.ts` ("reports both binaries as
  missing when neither is installed"). Tectonic and pdfinfo are installed on
  this machine, so the assertion that at least one binary is missing cannot
  hold. It fails the same way on an unmodified `origin/main` checkout. It is
  an environment condition, not a result of this change, and it is reported
  here rather than counted as a pass.
- `npm run test:e2e` — **191 passed, 0 failed**, run in full against the final
  code.
- `tests/e2e/builder-task-10-source-choice.spec.ts` — 11 passed.
- `npm run format:check` — clean.
- `git diff --check` — clean. No personal library file, log, secret, `.env`
  file, generated build output or poster asset is in the diff.

## Screenshots

`docs/ui-review/resume-builder-task-10/`

| File                                                           | What it shows                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `light-1440x900.png`, `dark-1440x900.png`                      | The whole builder in both themes.                                      |
| `light-1024x768.png`, `dark-1024x768.png`                      | Tablet width.                                                          |
| `light-768x1024.png`, `dark-768x1024.png`                      | Narrow tablet, where the choice still sits beside the job description. |
| `light-390x844.png`, `dark-390x844.png`                        | Phone width, where the choice stacks.                                  |
| `light-320x740.png`, `dark-320x740.png`                        | The narrowest supported width.                                         |
| `light-job-context-demo.png`, `light-job-context-personal.png` | The job context band with each source loaded.                          |
| `dark-job-context-demo.png`, `dark-job-context-personal.png`   | The same band in the dark theme.                                       |
| `light-job-context-320.png`, `dark-job-context-320.png`        | The band at 320px.                                                     |

The script that takes them is `scripts/capture-resume-builder-task-10.mjs`.
It builds the app, serves it on a port of its own, seeds the fictional sample
library into a temporary data root, seeds a synthetic job description into the
browser, and removes the data root when it is done.

## Not changed

- `src/app/generate/page.tsx` — the route semantics are correct, so it is not
  edited.
- The achievement library and its source switch.
- The job context band's own surface, padding, border and typography.
- The selection, the counts, the AI actions, the preview and the export.
- No dependency, schema, prompt, API route or loader.

## Integration follow-up — source-bound state

The final integration audit fixed the source-switch state leak recorded above. `src/app/generate/page.tsx` now keys `ResumeGenerator` by the loaded source, so selections, recommendations, analysis, tailoring, and generated output cannot remain attached to a different library after a client-side route change. The draft still comes from the existing shared job-draft store, and saved sessions continue to use their source-specific keys.

`tests/e2e/builder-task-10-source-choice.spec.ts` now covers selecting an item, switching demo → personal → demo, and verifying the correct counts and cleared checkboxes. The complete source-choice file passes: 12/12. See the final screenshots and validation in `docs/ui-review/resume-builder-task-29/REVIEW.md`.
