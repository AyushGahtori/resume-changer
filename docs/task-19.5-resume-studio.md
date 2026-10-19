# Task 19.5 — Resume Studio

The branch starts at `aff0e2a`, after syncing `main` with `origin/main`.

## Audit and root causes

- Auto Tailor's compiled-result path bypassed initialization of the old review arrays. A valid PDF could consequently appear beside a review claiming that no bullets existed.
- The Apply handler required the separate review bullet selection even for a skill edit.
- The old update flow committed new LaTeX and cleared the PDF before the replacement PDF had compiled.
- The Skills UI exposed the entire library as checkboxes. Its selected state also mixed requested skills with the subset actually rendered.
- Generation setup, AI proposals, JD analysis, generated content, and section controls all accumulated in the same column.

## Editing foundation

`StudioDocument` is the shared editing format for manual, suggested, guided, and automatic generation. It retains stable bullet IDs, destinations, source achievement IDs, original wording, skills, section choices, and the summary. Existing generation metadata is normalized when the studio opens.

The current compiled resume, working draft, and AI suggestion have separate states. Deterministic edits do not call the AI provider. Apply sends a draft snapshot to `/api/resume/edit`; the server validates sources and destinations, renders the approved template, compiles it, and checks page count and PDF text bounds. The client replaces the current LaTeX/PDF only when the entire request succeeds.

The history reducer keeps up to forty reversible edits. Undo and redo include merged-source relationships, additions, removals, text, ordering, and section or skill changes. The browser stores both the applied session and unfinished draft separately. Refresh offers restoration, and malformed or unrelated saved sessions are rejected.

Starting a new generation starts a new editor session. Applying an edit retains the current session and its undo history. Unfinished Imagination creation text and selected context have a separate restore offer; changing context cancels an in-flight request and invalidates its old suggestion.

## Skills and layout

The Skills manager groups the actual library taxonomy into searchable accordions and selectable chips. Included, staged, available, recommended, and capacity-limited states have textual labels.

The width service compiles specimen text using the approved template. It measures full skill names, separators, bold row labels, and glyph samples from the PDF. The two-row packing function preserves all selected skills and tries another arrangement when simple placement fails. It never drops a chosen skill to make an edited resume fit. Final compilation remains the authority for page count and clipping.

Measured skill text is checked against PDF text extraction; unsupported names are marked unavailable. Priority controls reorder skills without calling AI, and an ordering-only edit is counted as a pending change.

Achievement line estimates use the measured glyph widths and are marked approximate. AI suggestions also receive an isolated LaTeX line check. One rewrite may be requested if a target is exceeded; an unmet target is reported without truncating facts.

## Achievement workflows

- Manual edits use a focused dialog and enter the draft only after Save draft.
- AI edit, merge, and create operations use distinct prompt definitions and a compact validated output contract. They receive selected context rather than the full resume, JD, or LaTeX.
- Suggestions require explicit acceptance. Numerical claims, missing metrics, unexpected output fields, and known technologies absent from the connected context are checked on the server.
- Merges are restricted to one company or project and at most three original source achievements. The graph and keyboard connection controls preserve provenance and leave the Achievement Library intact.
- Available achievements are filtered separately from included points and can be staged in their original destination.
- Visible destination tiles support dragging unused points; Add buttons provide the keyboard and touch alternative. Source-backed points cannot move to an unrelated employer or project. User-authored points without connected sources may change destination.
- The same Imagination Canvas is used by Resume Studio and the Achievement Library. It supports manual authoring, selected achievement/skill context, a ten-item boundary, AI review, and library/resume save destinations.
- The library's existing detailed entry form remains available for structured metric and provenance entry.
- Auto Tailor's generation coverage and inference notes appear in Job match. The summary is editable in Overview, while the source comparison and approval flow remain available through Generation settings.

## Interface

Generation setup gives way to the editing workspace after a resume is produced. The studio provides section navigation, a draft action bar, source evidence disclosure, and a persistent preview. Orange identifies editing and apply actions; violet identifies Imagination and connections. Both existing light and dark themes are supported.

The preview supports fitting to width/page, zoom, fullscreen, downloads, and a keyboard-operable panel-width control. Smaller screens stack the workspace and preview; the creation canvas becomes a full-screen sheet. Native modal dialogs provide focus containment and Escape cancellation. Reduced-motion preferences disable decorative animation.

## Validation record

- Draft, provenance, history, skill-packing, deterministic rendering, session parsing, prompt, API, and measurement unit tests have been added.
- The real compiler tests caught a marker-font dependency in the first measurement implementation. The probes now use the existing resume font, and the new real font-width and achievement-line checks pass.
- Final unit/integration run: **245 passed**, with three opt-in live Gemini tests skipped. This includes seven real compiler integration checks. A further real-renderer check confirmed that a partially unsupported skill name is reported unavailable.
- Final complete Chromium browser run: **47 passed**. It covers existing Manual, Suggest Points, Guided Tailor, Auto Tailor, library and JD workflows, plus skill application, manual/AI edits, compiler failures, native merge/insertion dragging, provenance, ordering, hidden sections, contextual creation, recovery, regeneration, preview controls, keyboard resize, and mobile layout.
- TypeScript, repository-wide ESLint, changed-file Prettier, and `git diff --check` passed. The production Next.js build passed with isolated `.next-test` output. Browser runs also use isolated output and synthetic temporary library data.
- Desktop Studio and mobile Imagination screenshots were inspected. No horizontal overflow was found in the tested mobile layout.
- The repository-wide formatting command still reports formatting differences in untouched baseline files; those unrelated files were left as they were. Live paid AI requests were not used for these checks.

These factual checks are guardrails around a writing tool. A user still reviews the wording; the application cannot prove an arbitrary semantic claim from prose alone.
