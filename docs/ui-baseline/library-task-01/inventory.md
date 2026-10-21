# Task 01: Achievement Library baseline

This package records the Achievement Library exactly as it exists today, before the visual redesign described in [`docs/UI_Tasks_achievement_library.md`](../../UI_Tasks_achievement_library.md).

Nothing in the product was changed for this task. No visual component, data file, API contract, schema, or loader rule was touched. The only additions are this baseline package, the capture script that produced it, and one focused regression spec that locks the current facts down.

- [Behaviour, component map, and conflicts](inventory.md)
- [Viewport geometry, tokens, typography, and DOM counts](measurements.json)
- [Before screenshots](screenshots/)

## Method

- Captured in the isolated Task 01 worktree against a production build (`next build` + `next start`), so the rendering matches what CI and production serve, not the development server.
- The capture server runs with `RESUME_LIBRARY_ROOT` pointing at an empty temporary folder. The personal library is therefore genuinely absent, which is how the loader error was recorded. The fictional `examples/sample-resume-library.json` fixture was copied into that temporary folder only for the "personal route" captures, so the editable surface and the point editor could be recorded without reading real user data. The temporary folder is deleted when the script exits.
- Content screenshots use the **fictional demo library** (`/library?source=demo`). No personal profile, job, company, achievement text, metric, or source reference appears in any capture.
- Theme is set through the app's own key, `resume-changer.theme.v1`, before the page loads. The captures are taken with `prefers-reduced-motion: reduce` so no transition is caught mid-flight.
- Reproduce with `node scripts/capture-library-baseline.mjs` (port 3021 by default, override with `BASELINE_PORT`).
- The baseline was recorded against `main` at `4a701ac`, then re-verified after that commit landed. No library source file and no measured design token changed between the two, and re-running the capture reproduced `measurements.json` byte for byte; the only difference across all eighteen screenshots was 34 pixels of anti-aliasing noise in the two dark-mode captures.

## 1. Routes and data-source behavior

| Route                  | Source   | Behavior                                                                         |
| ---------------------- | -------- | -------------------------------------------------------------------------------- |
| `/library`             | personal | Loads `data/resume-library.json` from the resolved personal data root. Editable. |
| `/library?source=demo` | demo     | Loads `examples/sample-resume-library.json` from the project root. Read-only.    |

- The source is resolved on the server in `src/app/library/page.tsx:11`: any `source` value other than the exact string `demo` is treated as `personal`. There is no third state and no redirect.
- The page is a server component. It loads the library and hands the data to the client component `src/components/achievement-library.tsx:171`. The library is rendered from the data that was loaded on the server; a client-side save triggers `router.refresh()` (`src/components/achievement-library.tsx:296`, `:312`) so the page re-renders from the file.
- Personal data root resolution (`src/lib/data/root.ts:14`): `RESUME_LIBRARY_ROOT` if set, otherwise the working directory when it contains `data/resume-library.json`, otherwise the primary checkout of a linked Git worktree, otherwise the working directory. The demo source never reads the personal root.
- Validation is strict. `ResumeLibrarySchema` (`src/lib/schemas/resume-data.ts:242`) rejects unknown keys, duplicate entity IDs, unknown linked skill IDs, unknown evidence achievement IDs, inverted date ranges, and malformed `YYYY-MM` dates.

### Loader errors and alternate-source navigation

`loadResumeLibrary` raises a `DataLoadError` (`src/lib/data/loaders.ts:35`) with one of four codes and a specific, path-safe message (`src/lib/data/loaders.ts:72`):

| Code              | Message shape                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `missing-file`    | `data/resume-library.json was not found. Add the personal data file, set RESUME_LIBRARY_ROOT …, or explicitly choose demo mode.` |
| `unreadable-file` | `data/resume-library.json could not be read. Check that the file exists and is accessible.`                                      |
| `invalid-json`    | `data/resume-library.json is not valid JSON. Correct its syntax and try again.`                                                  |
| `invalid-schema`  | `data/resume-library.json does not match the required data schema:` followed by `path: message` lines.                           |

- The error replaces the whole library. `src/app/library/page.tsx:26` renders a `role="alert"` section with the eyebrow `LIBRARY UNAVAILABLE`, the heading `Could not load your library.` (or `Could not load demo library.`), the message, and a single link to the alternate source: `Open fictional demo data` or `Open my data`.
- The error message names the **relative** path `data/resume-library.json` only. No absolute path, home directory, or file content is exposed. This is asserted in `tests/unit/data/loaders.test.ts`.
- There is **no silent fallback** to demo data. A missing personal file is an error, not a switch. This is asserted in `tests/unit/data/loaders.test.ts:66`.
- The shell, breadcrumb, and navigation stay fully usable on the error page; only the library body is replaced. See `screenshots/library-error-1440x900-light.png` and `screenshots/library-error-1440x900-dark.png`.

## 2. Current visible structure (reading order)

At 1440×900 the library is five sibling blocks inside `.library-page` (`.library-page` is `width: min(100%, 1120px)`, centred, `src/app/globals.css:1513`):

1. `.library-heading` — `src/components/achievement-library.tsx:210`
   - eyebrow `YOUR EXPERIENCE`, one `h1` `Achievement library`, intro `Browse the resume information saved in this workspace.`
   - `.library-source-switch`: two real links, `My data` → `/library` and `Demo data` → `/library?source=demo`; the selected one carries `aria-current="page"`. Selecting a source navigates; it is not a toggle.
2. `.library-edit-toolbar` — **personal source only** (`:234`). Contains the save-message slot, the `Detailed entry` button, and the `Add achievement` primary button. The whole toolbar is absent for demo data.
3. `.library-overview` — `:259`. One surface holding the source indicator (`My resume data` / `Fictional demo data`), the profile `h2` full name, the optional headline, and a `dl.library-counts` with `Jobs`, `Projects`, `Points`, `Skills`, `Credentials`.
4. Editor surfaces, inserted between the summary and the search controls when open: the inline `.point-editor` form (`:289`) or the `Imagination Canvas` dialog (`:303`).
5. `.library-controls` — `:317`. The `Search library` search input, the five facet selects, and the `.library-filter-summary` line with the visible/total point count and the `Reset filters` action.
6. `.library-experiences` — `:443`. One `.experience-group` per job and project that still has a matching point.
7. `.library-secondary` — `:477`. Two `<details>` disclosures: `Skills` and `Credentials`, each with a count in its summary.

When nothing matches, the groups are replaced by `.library-empty` (`role="status"`): `No achievement points match these filters.` (`:438`). The skills and credentials disclosures still render, with their own empty messages.

### Group and point anatomy

- Group (`:117`): `section.experience-group` with `aria-label="Job: <title>"` / `"Project: <name>"`, a `JOB`/`PROJECT` eyebrow, an `h3` title, an optional organisation/role line, and a right-aligned date range. A group shows **no** point count today.
- Date range (`:26`): `MM/YYYY` pairs, `01/2023 – Present` for a null `endDate`, and a plain `MM/YYYY – MM/YYYY` otherwise. A project with no `startDate` renders an empty string.
- Point (`:35`): `article.library-point` containing the point id in a `<code>` element, the status text, the optional `Edit` button, the achievement text, the provenance line, the metric list, and the tag/skill chips. The article has **no** accessible name of its own.

## 3. Search and filter semantics

Source of truth: `src/lib/data/achievement-search.ts`. This is pure logic and must not be narrowed by the redesign.

- State: `LibraryFilters` = `query`, `sourceType`, `status`, `skillId`, `tag`, `experienceId`, with `EMPTY_LIBRARY_FILTERS` as the default.
- The query is trimmed and lowercased (`normalize`, `:41`) and matched against the experience name (`job title + company`, or the project name), the point id, the point text, every tag, the names and aliases of linked skills, and the source type, label, and reference (`:74`). Search covers the same fields today as it did before Task 01.
- The five facets are: `Job or project` (`All experience`), `Point source` (`All sources`), `Point status` (`All statuses`), `Linked skill` (`All skills`), `Tag` (`All tags`). The experience facet encodes the parent as `job:<id>` / `project:<id>`.
- Facet choices are generated from the loaded library: experience options from `library.jobs` and `library.projects`, source options from the distinct source types in use, skill options from `library.skills`, tag options from the deduplicated, alphabetically sorted tag set (`:162`).
- A group is dropped when it has no matching point (`:105`). The order of jobs, projects, and points inside them is never changed.
- `totalPointCount` counts every point in the library; `visiblePointCount` counts the points in the filtered groups (`:142`). The summary metric `Points` uses `totalPointCount`, so it does **not** move when a filter hides results, while the controls line shows `visible of total`. Keep that separation.
- The skills list is filtered by the query and by the `Linked skill` facet only; the credentials list is filtered by the query only. The experience, source, status, and tag facets do not narrow the secondary lists. This is current behaviour and is asserted in `tests/unit/data/achievement-search.test.ts`.
- `Reset filters` appears only when a facet or the query differs from the default (`:182`) and restores `EMPTY_LIBRARY_FILTERS` without touching the source, the theme, or the data.
- The tag and skill chips are the current filter shortcut: clicking a tag sets the `tag` facet, clicking a skill sets the `skillId` facet (`:450`, `:451`). Both handlers must survive the restyle.

## 4. Enabled state, edit, and editor flows

- Every point stores `enabled`. The card shows the text `Enabled` or `Disabled` in `.point-status`, coloured with `--color-success`/`--color-error` and nothing else. There is no pill, no icon, and no dot today.
- The `Point status` facet offers `All statuses`, `Enabled`, and `Disabled`. The demo fixture contains no disabled point, so the disabled appearance is only reachable through the personal library.
- The `Edit` action is rendered only when `source === "personal"` (`:59`, `:187`). Demo data shows no `Edit`, no `Detailed entry`, and no `Add achievement` at all. This read-only rule is asserted in `tests/e2e/library-editing.spec.ts:188`.
- The status can only be changed through the editor, and only through the API. There is no inline status toggle on the card, and there is no favourite or delete action anywhere in the product.
- `Detailed entry` opens the manual editor as an **inline form**, not a dialog (`:289`, `src/components/achievement-point-editor.tsx:145`). It renders above the search controls and pushes the page down. Fields: `Achievement ID` and `Job or project` (create only), `Achievement text`, `Tags, separated by commas`, `Provenance type` (one of `resume`, `linkedin`, `user-notes`, `project-document`, `direct-user`), `Source label`, `Source reference`, `Linked skills` (multi-select), a repeatable `Metrics` fieldset (`Metric ID` read-only, `Label`, `Value`, `Unit`, `Context`, `Evidence`), the `Use this point in resume selection` checkbox, an inline error region, and `Cancel` / `Save achievement`.
- `Add achievement` opens the shared `Imagination Canvas` dialog (`src/components/achievement-imagination.tsx`, rendered through `src/components/studio-dialog.tsx`, a native `<dialog>` with an `aria-label` and a `Close editor` button). It generates a draft through `POST /api/ai/achievement` (`:173`) and saves the accepted result through `POST /api/library/points` (`:237`).
- Cancelling either surface discards the entry without a request. A failed save keeps the entered values and shows the server message in the editor error region; the editor does not close on failure.

## 5. Persistence and API calls

| Call                             | Trigger                                                         | Contract                                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/library/points`       | create a point from the manual editor or the Imagination Canvas | body `{ parentType, parentId, point }`, validated by `CreateAchievementInputSchema` (`src/lib/data/writers.ts:44`)                                                                            |
| `PATCH /api/library/points/[id]` | edit an existing point                                          | body `{ changes }`; only `text`, `tags`, `skillIds`, `metrics`, `source`, and `enabled` may change. The id is stripped before the request (`src/components/achievement-point-editor.tsx:126`) |
| `POST /api/ai/achievement`       | generate a draft in the Imagination Canvas                      | AI contract, out of scope for the visual work                                                                                                                                                 |
| `GET /library` (server render)   | after a save                                                    | `router.refresh()` re-runs the server load so the page shows the saved file                                                                                                                   |

- Writes only ever touch the personal library file. The demo library has no write path.
- `commitPointChange` (`src/lib/data/writers.ts:130`) takes an exclusive `data/resume-library.json.lock` file, re-reads the library, applies the change, re-validates the whole library against the schema, and only then writes it.
- `saveLibrary` (`src/lib/data/writers.ts:97`) writes a temporary file, keeps the previous version as `data/resume-library.json.bak`, and renames atomically. A failed write leaves the existing file unchanged and reports `The library could not be saved. The existing data was left unchanged; try again.`
- Error mapping (`src/app/api/library/points/route.ts:12`): `not-found` → 404, `locked` → 409, `invalid-library` → 400, other write errors → 500, and a `DataLoadError` → 409. A duplicate point id is reported as `This change conflicts with the library data. Check IDs, skills, and metrics.`
- After a successful save the toolbar shows `Saved to your local library.` and the page refreshes from disk.

## 6. Component-to-source map

| Board component                                                                        | Current source                               | Support                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent shell, brand, sidebar, active route, breadcrumb, theme toggle, `Local mode` | `src/components/workspace-shell.tsx`         | **Exists.** `/library` is already the active route with `aria-current="page"` (`:270`). The library must not add a second shell.                                                                              |
| Page eyebrow, `h1`, intro line                                                         | `src/components/achievement-library.tsx:210` | **Exists.** Copy already matches the board.                                                                                                                                                                   |
| `My data` / `Demo data` switch                                                         | `src/components/achievement-library.tsx:218` | **Exists** as two links with `aria-current`. Keep it a navigation, not a toggle.                                                                                                                              |
| `Detailed entry` and `Add achievement`                                                 | `src/components/achievement-library.tsx:234` | **Exists**, personal source only. `Add achievement` opens the Imagination Canvas; `Detailed entry` opens the inline manual editor.                                                                            |
| Profile summary: source label, name, headline                                          | `src/components/achievement-library.tsx:259` | **Exists.** Headline is omitted when absent.                                                                                                                                                                  |
| Summary metrics `Jobs`, `Projects`, `Points`, `Skills`, `Credentials`                  | `src/components/achievement-library.tsx:265` | **Exists** as data-derived numbers in a `dl`. No icons and no colour accents today.                                                                                                                           |
| `View details` profile action                                                          | —                                            | **Unsupported.** No profile or settings destination exists for it. Omit unless a route is confirmed and tested.                                                                                               |
| Global search field with magnifier and clear                                           | `src/components/achievement-library.tsx:321` | **Partly exists.** The field, its `Search library` label, and its immediate filtering exist. The magnifier icon, the trailing clear button, and the board placeholder copy do not.                            |
| Advanced filter row (5 facets)                                                         | `src/components/achievement-library.tsx:330` | **Exists** as native selects with the board's option labels.                                                                                                                                                  |
| Advanced-filter icon button                                                            | —                                            | **Unsupported.** There is no filter panel to open. Omit.                                                                                                                                                      |
| Sticky workbench                                                                       | `src/app/globals.css`                        | **Does not exist.** `.library-controls` scrolls with the page. The topbar is 60px tall at desktop and 111px at 320px, which the sticky offset must respect.                                                   |
| Category chips `All`, `Jobs`, `Projects`, `Skills`, `Credentials`                      | —                                            | **Does not exist.** The counts can be derived from the loaded library, but there are no section anchors to navigate to yet.                                                                                   |
| Sort `Most recent`                                                                     | —                                            | **Does not exist.** No sort state and no sort helper.                                                                                                                                                         |
| Result count                                                                           | `src/components/achievement-library.tsx:421` | **Exists** as `13 of 13 achievement points` in an `aria-live="polite"` region. It is a sentence, not the board's `25 results` label.                                                                          |
| `Reset filters`                                                                        | `src/components/achievement-library.tsx:426` | **Exists** and only appears when a filter is active.                                                                                                                                                          |
| Jobs / Projects sections                                                               | `src/components/achievement-library.tsx:443` | **Partly exists.** Jobs and projects are rendered as one flat list of groups; there is no `Jobs` and `Projects` section heading, and the group kind is only a small `JOB`/`PROJECT` label.                    |
| Skills and Credentials sections                                                        | `src/components/achievement-library.tsx:477` | **Exists** as two `<details>` disclosures with counts, not as top-level sections.                                                                                                                             |
| Section heading with count, date range, chevron disclosure                             | `src/components/achievement-library.tsx:139` | **Partly exists.** The date range exists; the count and the disclosure do not.                                                                                                                                |
| Achievement card surface                                                               | `src/components/achievement-library.tsx:50`  | **Exists** as a flat `article` with hairline separators, not a bordered card.                                                                                                                                 |
| Card title / organisation / date context                                               | `src/components/achievement-library.tsx:143` | **Exists** on the group, not on the card. The card itself starts with the point id.                                                                                                                           |
| Achievement text as the main body                                                      | `src/components/achievement-library.tsx:66`  | **Exists**, but at 12px/18.6px, which is below the board's 14px/20px body.                                                                                                                                    |
| Metric tiles with label, value, unit, evidence, context                                | `src/components/achievement-library.tsx:72`  | **Partly exists.** All five fields are rendered as a left-bordered list. The demo fixture contains only two metrics across thirteen points, so a metric-heavy layout cannot be reviewed with demo data alone. |
| Tag chips and linked-skill chips                                                       | `src/components/achievement-library.tsx:86`  | **Partly exists.** They are plain coloured text with no chip shape, border, or padding, and they carry the filter behaviour.                                                                                  |
| `+N` overflow chip                                                                     | —                                            | **Does not exist.** All 64 chips render inline.                                                                                                                                                               |
| Provenance `Source: type · label · reference`                                          | `src/components/achievement-library.tsx:67`  | **Exists.** Optional segments are already omitted rather than left blank.                                                                                                                                     |
| `Enabled` / `Disabled` status                                                          | `src/components/achievement-library.tsx:55`  | **Exists** as coloured text. The board's pill with a dot and an icon does not.                                                                                                                                |
| `Edit` action                                                                          | `src/components/achievement-library.tsx:60`  | **Exists** as a text action, personal source only. No pencil icon yet.                                                                                                                                        |
| Heart / favourite                                                                      | —                                            | **Unsupported.** No field, API, or storage exists.                                                                                                                                                            |
| Trash / delete                                                                         | —                                            | **Unsupported.** No route, confirmation, or undo exists.                                                                                                                                                      |
| Card overflow menu (`…`)                                                               | —                                            | **Unsupported.** It would only contain unsupported actions.                                                                                                                                                   |
| Section disclosure chevron                                                             | —                                            | **Does not exist** for groups; `<details>` already provides a disclosure for skills and credentials.                                                                                                          |
| `Go Pro`, avatar, pricing, signed-in identity                                          | —                                            | **Unsupported and out of scope.** Must not ship.                                                                                                                                                              |

## 7. Current data the boards do not show

Everything below exists in the schema and is either rendered somewhere in the product or reachable through the editor. A visual grouping must not drop it.

- **Profile:** `email`, `phone`, `location`, `links[]` (label + URL), and a free-text `summary`. The library page shows only the full name and the optional headline; the rest belongs to the resume builder. They are optional in the schema and absent values must be omitted, never placeholdered.
- **Education:** `profile.education[]` with `institutions[]`, `degree`, `fieldOfStudy`, optional `programName`, optional `description`, and optional `startDate`/`endDate`. The library page does not render education today. It is not a credential and must not be merged into one; if a section is added it needs its own records and tests.
- **Job detail:** `employmentType`, optional `location`, and optional `description`. The library page shows the title, the company, and the date range only.
- **Project detail:** optional `role`, optional `url`, optional `description`. The library shows the project name, the role line, and the date range.
- **Point detail:** optional `context` (a free-text note on the point) and optional `initiativeId`. Neither is rendered on the library page today; the editor does not expose them either.
- **Metric detail:** `evidence` is required and rendered, `context` is optional and rendered, `unit` is optional and rendered. A metric is only meaningful together with its evidence.
- **Provenance detail:** `source.label` and `source.reference` are optional. Both are already omitted when absent, and the source type is one of five fixed values.
- **Skill detail:** `category`, `aliases`, `sources[]` (at least one), `evidenceAchievementIds[]`, and the `isListedOnCurrentResume` flag. The library shows the name, the category, and the `On current resume` / `Library only` label.
- **Credential detail:** `kind` (`license` / `certificate`), `issuer`, optional `issuedDate`, `expiresDate`, `credentialId`, and `url`. The library shows the name, the kind, and the issuer.
- **Preferences:** `preferences.sectionOrder` and `preferences.maxPages` exist in the library but belong to the resume builder, not to this page.
- **Empty values:** every optional field above can be absent. The current code omits absent segments; a redesign must keep that instead of rendering empty labels, dangling separators, or skeleton lines.

## 8. Visual conflicts with the boards

These are recorded, not fixed. They belong to the later tasks.

1. **Palette.** The boards print orange `#FF7A45`, orange light `#FFE9E0`, violet `#7C3AED`, violet light `#EFEBFF`, border `#CBD5E1`, secondary text `#334155`. The app-wide tokens are orange `#F97316`, orange subtle `#FFF7ED`, violet `#7C3AED`, violet subtle `#EDE9FE`, border `#E2E8F0`, secondary text `#475569`. The conflict is shared with `docs/UI_Tasks_home.md` and must be resolved once, in one place, in Task 02 — not with a `.library-page` override.
2. **Type.** The boards print Playfair Display and Inter. The app uses Georgia/Times for titles and Arial/Helvetica for the UI, and that must stay. The current library is also smaller than the board: the page title is 38px/42.6px (the shared page-title token is 40px/48px), the eyebrow is 10px/15px, the achievement text is 12px/18.6px, and the metric values are 17px/25.5px. The board asks for roughly 40/48, 12/16, 14/20, and 24–32/32.
3. **Density.** The current page is a full-width centred column with hairline separators and no card surfaces. The board draws individual bordered cards with 8px radii, 16px padding, and a category icon tile. The board's larger radii and glow shadows are not production targets under the compact-app rules.
4. **Chips and pills.** Tag chips, skill chips, and the status label are bare text today. The board draws full-round chips with borders, fills, and counts.
5. **Summary.** The current summary is one wide row with the name on the left and five plain numbers on the right. The board draws a bordered surface with an identity block and five coloured metric tiles.
6. **Workbench.** There is no sticky behaviour, no magnifier, no clear button, no category chips, and no sort control. The board's workbench stacks a search row, a facet row, and a category/result row.
7. **Header.** The `Detailed entry` and `Add achievement` actions sit in a separate toolbar row below the heading, not in the header beside the source switch, and the board draws `Detailed entry` as a switch, which would be an inaccurate affordance for an action that opens a form.
8. **Dark mode.** The current dark theme is a warm ink palette (`#171421` canvas, `#211d2e` surface) with a violet active sidebar row, while the board prints a deep blue-black shell (`#0F1220`) with a warm brown active state. The board's own dark values are estimates, so the shared token decision comes first.
9. **Editor placement.** The manual editor is an inline form in the page flow, and the Imagination Canvas is a native `<dialog>`. The board implies a modal editor.
10. **Icons.** The board uses category icons on cards, metric tiles, and the summary. The app has `lucide-react` available, but the library currently uses no icons at all.

## 9. Baseline geometry

All values are CSS pixels at `deviceScaleFactor: 1`, measured in `measurements.json`.

| Viewport | Theme |      Sidebar | Topbar | Library column | Heading | Overview | Controls | First group | First point | Page height | Horizontal overflow |
| -------- | ----- | -----------: | -----: | -------------: | ------: | -------: | -------: | ----------: | ----------: | ----------: | ------------------- |
| 1440×900 | light |          260 |     60 |           1116 |  102.55 |    122.5 |      197 |      598.38 |      168.59 |        2627 | No                  |
| 1440×900 | dark  |          260 |     60 |           1116 |  102.55 |    122.5 |      197 |      598.38 |      168.59 |        2627 | No                  |
| 1024×768 | light |          220 |     60 |            756 |  102.55 |    122.5 |      197 |      598.38 |      168.59 |        2627 | No                  |
| 1024×768 | dark  |          220 |     60 |            756 |  102.55 |    122.5 |      197 |      598.38 |      168.59 |        2627 | No                  |
| 768×1024 | light |          220 |     60 |            500 |  166.09 |      149 |      197 |      654.16 |      168.59 |        2935 | No                  |
| 768×1024 | dark  |          220 |     60 |            500 |  166.09 |      149 |      197 |      654.16 |      168.59 |        2935 | No                  |
| 390×844  | light | 280 (drawer) |     60 |            358 |  156.08 |      176 |      481 |      749.34 |      201.19 |        3428 | No                  |
| 390×844  | dark  | 280 (drawer) |     60 |            358 |  156.08 |      176 |      481 |      749.34 |      201.19 |        3428 | No                  |
| 320×740  | light | 272 (drawer) |    111 |            288 |  215.16 |      176 |      481 |      811.94 |      223.19 |        3865 | No                  |
| 320×740  | dark  | 272 (drawer) |    111 |            288 |  215.16 |      176 |      481 |      811.94 |      223.19 |        3865 | No                  |

Zoom-equivalent checks (light theme, demo source): 1152×720 (125%) → column 828, no overflow; 1800×1125 (80%) → column 1120, no overflow. Neither introduces page-level or nested horizontal overflow.

Two layout facts matter for the sticky workbench in Task 14: the topbar is 60px tall from 390px upwards and 111px tall at 320px, and the sidebar is still 220px wide at 768px, which leaves the library only 500px of column at that width.

### Measured type roles (1440, light)

| Role                    | Current                                               |
| ----------------------- | ----------------------------------------------------- |
| Page title              | Georgia/Times 38px/42.56px, weight 400, `#0F172A`     |
| Eyebrow                 | Arial 10px/15px, weight 700, `#F97316`                |
| Intro                   | Arial 14px/21px, `#475569`                            |
| Profile name            | Georgia/Times 23px/34.5px, weight 400                 |
| Metric label            | Arial 10px/15px, `#475569`                            |
| Metric value            | Arial 17px/25.5px, weight 650                         |
| Group title             | Arial 16px/24px, weight 650                           |
| Point text              | Arial 12px/18.6px, `#0F172A`                          |
| Point id                | Arial 10px/15px, `#64748B`                            |
| Provenance              | Arial 10px/15px, `#475569`                            |
| Metric value in a point | Arial 10px/15px, weight 600                           |
| Facet chip              | Arial 10px/15px, no padding, no radius, transparent   |
| Status label            | Arial 10px/15px, weight 650, no radius                |
| Search input            | 38px high, 5px radius, `1px solid #CBD5E1`, 12px text |
| Facet select            | 38px high, 5px radius, `1px solid #CBD5E1`, 12px text |

### Measured shared tokens

| Token                    | Light     | Dark      |
| ------------------------ | --------- | --------- |
| `--color-canvas`         | `#F8FAFC` | `#171421` |
| `--color-sidebar`        | `#FFFFFF` | `#14111F` |
| `--color-surface`        | `#FFFFFF` | `#211D2E` |
| `--color-surface-alt`    | `#F1F5F9` | `#2A2538` |
| `--color-text-primary`   | `#0F172A` | `#F8FAFC` |
| `--color-text-secondary` | `#475569` | `#B7B3C7` |
| `--color-text-muted`     | `#64748B` | `#A49FB4` |
| `--color-border`         | `#E2E8F0` | `#3A3548` |
| `--color-border-strong`  | `#CBD5E1` | `#514A61` |
| `--color-orange`         | `#F97316` | `#F97316` |
| `--color-orange-subtle`  | `#FFF7ED` | `#442719` |
| `--color-violet`         | `#7C3AED` | `#7C3AED` |
| `--color-violet-subtle`  | `#EDE9FE` | `#322548` |
| `--color-success`        | `#10B981` | `#34D399` |
| `--color-warning`        | `#F59E0B` | `#FBBF24` |
| `--color-error`          | `#EF4444` | `#F87171` |
| `--color-info`           | `#3B82F6` | `#60A5FA` |
| `--color-focus-ring`     | `#7C3AED` | `#A78BFA` |

## 10. Captures

Content captures use the fictional demo library. The personal and editor captures use the same fictional fixture copied into the isolated temporary data root. The error captures use the same temporary root before the fixture was copied.

| File                                                             | State                                      |
| ---------------------------------------------------------------- | ------------------------------------------ |
| `screenshots/library-1440x900-light.png`, `…-dark.png`           | Demo library, 1440×900                     |
| `screenshots/library-1440x900-light-full.png`, `…-dark-full.png` | Demo library, full page                    |
| `screenshots/library-1024x768-light.png`, `…-dark.png`           | Demo library, 1024×768                     |
| `screenshots/library-768x1024-light.png`, `…-dark.png`           | Demo library, 768×1024                     |
| `screenshots/library-390x844-light.png`, `…-dark.png`            | Demo library, 390×844                      |
| `screenshots/library-320x740-light.png`, `…-dark.png`            | Demo library, 320×740                      |
| `screenshots/library-personal-1440x900-light.png`, `…-dark.png`  | Personal route with the creation actions   |
| `screenshots/library-editor-1440x900-light.png`, `…-dark.png`    | Manual point editor open                   |
| `screenshots/library-error-1440x900-light.png`, `…-dark.png`     | Loader error and the alternate-source link |

## 11. Regression coverage

Existing focused tests were run before any change and pass. Their assertions are the protected baseline for the later tasks.

| Suite                                                     | Result    |
| --------------------------------------------------------- | --------- |
| `tests/unit/data/achievement-search.test.ts`              | 10 passed |
| `tests/unit/data/loaders.test.ts`                         | 12 passed |
| `tests/unit/data/writers.test.ts`                         | 7 passed  |
| `tests/unit/data/sample-library.test.ts`                  | 3 passed  |
| `tests/e2e/library.spec.ts`                               | 5 passed  |
| `tests/e2e/library-editing.spec.ts`                       | 8 passed  |
| `tests/e2e/library-baseline.spec.ts` (added in this task) | 7 passed  |

`tests/e2e/library-baseline.spec.ts` was added because four current facts were not protected by any test: the page reading order, the summary counts and their independence from the filters, the point anatomy (status, provenance, metric evidence, distinct tag and skill chips with their click-to-filter behaviour), and the group kind/title/date-range format.

## 12. Open items for the later tasks

- Task 02 must reconcile the shared palette with `docs/UI_Tasks_home.md` in one place. The library cannot be called pixel-accepted until that decision is explicit.
- Task 04 needs a sticky offset that respects the 60px topbar, and the 111px topbar at 320px.
- Task 09 and Task 10 need the create actions to keep working when the library is read-only. The current implementation hides the whole toolbar for demo data, so a restyled control must stay absent, not merely disabled.
- Tasks 13, 19, 21, 23, and 24 need a richer fixture than the demo library. The demo library has 13 points, 2 metrics, no disabled point, no point without a source label, and no point without tags. A synthetic fixture with those cases is needed before the metric, status, and overflow-chip layouts can be reviewed honestly.
- The `View details` action, the category chips, the sort control, and the overflow menu all need a decision in their own tasks; none of them may ship as a dead control.
