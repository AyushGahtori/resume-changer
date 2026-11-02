# GitHub context redesign: ten independent implementation tasks

Date: 31 October 2026. Status: **planning only; implementation is not authorized by this document**.

## 1. Outcome and scope

Help a user explain the project and their contribution through a short adaptive interview, optionally attach up to five screenshots, and prepare representative, traceable evidence before they approve AI achievement generation. Improve the file inventory UI and diagnose interrupted analysis without guessing its cause.

“I built everything” is a valid ownership answer. It must select a whole-project discovery mode; it must not be interpreted as a meaningful description of the project's purpose. Keep project identity, personal contribution, and additional notes as distinct structured inputs.

This plan covers both the questionnaire/UI redesign and the repository retrieval redesign. It does not authorize implementation, a paid model call, a production deployment, or a trained ranking model. Use an in-house, deterministic retrieval pipeline first; evaluate AI reranking only if measured failures justify it.

## 2. Exact code and worktree locations

| Item                                                  | Location / revision                                                                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last pushed feature baseline                          | `phase-one`, commit `8a3be18e2e6b346146ea3bea3c811ec1667755c5`                                                                                                              |
| Source checkout used to create this planning worktree | `C:/Users/Ayush/.codex/worktrees/github-session-review/re_changer`                                                                                                          |
| Source checkout branch                                | `codex/github-evidence-diagnostics-ui`, HEAD at the same baseline                                                                                                           |
| Existing uncommitted drafts                           | Source checkout above: inventory messages, status UI, safe diagnostics, and associated tests. These drafts are **not pushed** and were not copied by Git worktree creation. |
| Planning worktree                                     | `C:/Users/Ayush/.codex/worktrees/github-context-redesign-plan/re_changer`                                                                                                   |
| Planning branch                                       | `codex/github-context-redesign-plan`, created from the exact baseline above                                                                                                 |
| Feature branch checkout                               | `C:/Users/Ayush/.codex/worktrees/github-phase-one/re_changer`                                                                                                               |

The planning worktree was created with the managed `create_worktree` tool from the source checkout, using the exact baseline SHA. No application changes were made here. The original dirty checkout remains intact.

**Mandatory instruction for EVERY task below:** create a separate managed worktree from this planning checkout's agreed committed baseline, then create `codex/github-context-task-NN-<name>` there. Record the source root, base SHA, new branch, and returned absolute workspace path in the task's acceptance notes. Work only in that returned path. Do not create a task from `main`: it lacks the reviewed GitHub/session feature baseline. Do not use another task branch as a prerequisite or copy another task's unfinished code. Do not run a destructive reset/clean against any checkout.

Before creating task worktrees, the coordinator must record one common `PLAN_BASE_SHA` that includes the reviewed plan if it has been committed. Otherwise use `8a3be18e2e6b346146ea3bea3c811ec1667755c5` and provide this document as the specification. Committing or pushing this plan is a separate explicit action; this document is not a claim that it has happened.

Tasks 08 and 09 may inspect the existing local drafts as reference, but must implement/test against the common baseline independently. Neither task depends on those uncommitted drafts being committed.

## 3. Why the previous selection was inadequate

A public, AI-disabled reproduction at repository revision `4fc28cdbc015aff12f2e08b15428c63e4f9a040e`, with contribution `entire project.`, selected 12 files and 651 lines. Of those, 434 lines came from three tests. The other nine files were page/route files, including a small canvas wrapper. README, package metadata, core AI, storage, and PDF implementations were absent.

Verified weaknesses to address:

1. No distinct whole-project discovery mode.
2. Category/filename scores stand in for implementation importance.
3. Alphabetical tie-breaking clusters similar route files.
4. A fixed 12-path bundle treats small wrappers and substantial implementations equally.
5. Overview context has no guaranteed allocation; a nonempty role statement can satisfy the purpose check.
6. `@/...` imports are recognized but resolved as relative paths despite this project's configured `@/* -> ./src/*` mapping.
7. Related-file expansion is one pass with three reserved slots, rather than a bounded dependency traversal.
8. A 64 KiB reading limit rejects large files before section extraction. `resume-generator.tsx` at the reproduced revision is 118,889 bytes.
9. Tests and wrappers have no bundle-level diversity/token allocation policy.
10. Selection stops without checking coverage of the project's major features.

The interrupted paid-analysis attempt is a **separate unresolved incident**. The existing runner normalizes some errors into `interrupted`; the session response hides the underlying reason. Request records show session HTTP requests reached Vercel, but an outer streaming HTTP 200 does not establish application success. No detailed runtime error was returned by the log queries. Do not claim timeout, provider rejection, memory exhaustion, or file blocking as the established cause.

## 4. Making the ten tasks independent

These are independently buildable feature modules, not ten sequential patches. Their common prerequisite is this written contract, not another implementation task.

- Each task owns a distinct new directory and its own tests. Use structural ports and contract fixtures declared below. A developer must be able to compile and test their branch without importing files produced by another task.
- Put task-local schema/port definitions in the owned directory until final assembly. They must conform to this specification. Do not introduce a shared generated contract package whose creation would block other tasks.
- Each module supplies a production-capable adapter where its baseline permits one, plus an isolated harness. Fixture adapters must stay clearly test-only and must never become hosted fallbacks.
- Avoid simultaneous edits to `contracts.ts`, `import-workspace.tsx`, the catch-all API dispatcher, provider interfaces, global styles, or package manifests. Describe required wiring/schema/dependency changes in a task-owned `integration.md`; final assembly owns those shared edits.
- Contract disagreements are specification questions. Record and resolve them centrally; do not silently invent incompatible fields or force another task to import your branch.
- A task's standalone completion does not mean its feature is deployed. **Final assembly and release necessarily happen after the modules exist.** The release procedure at the end is intentionally not described as an independent eleventh feature task.

Every task's acceptance notes must include: problem, owned files, exported API, scope exclusions, exact fixtures, commands/results, safety checks relevant to the change, integration instructions, known limitations, and screenshots for UI work.

## 5. Shared product and data contract — frozen specification

### 5.1 Interview and contribution context

- Version: `project-context-v1`. All identifiers are stable, bounded strings; all source identities bind to repository ID and commit SHA.
- `ProjectContext`: primary project kind, secondary tags, project purpose, ownership (`whole-project | selected-areas | shared | unsure`), confirmed capabilities, contributed areas, contribution details, optional notes, and answer history. Explicitly record whether a fact is user-reported, repository-inferred, or confirmed by the user.
- `Answer`: node ID, option IDs, optional custom answer, and catalog version. Store answers by stable IDs, never UI list indexes.
- A question node has a prompt, four normal options plus a final custom-answer option, selection mode, allowed declarative conditions, information targets, and candidate next-node edges. Allow multi-select when the domain genuinely overlaps: AI, ML, and web are not mutually exclusive facts.
- Graph: a directed acyclic graph with one root, multiple outgoing edges, conditional branches and joins. Back navigation uses answer history, not graph cycles. No arbitrary executable expressions in catalog data.
- Normal completion: **5–10 questions, at most 10 presented questions per interview**. Questions may be skipped with “Not sure / Skip.” Do not invent answers to meet the minimum. Explain an early finish when no relevant questions remain. Do not ask irrelevant padding questions.
- The opening node asks what the project is about, using broad choices and custom entry. Confirm any metadata suggestion. Ownership is a separate early question; “I built the whole project from scratch” is a first-class answer.
- A dashboard-specific question is eligible only after dashboard existence is confirmed by the user or by a repository suggestion the user accepts. Similar rules apply to ML training, APIs, mobile apps, etc.
- Per-node custom answer: maximum **500 Unicode code points**. Always-visible extra-context field: maximum **500 Unicode code points**, with a live counter. This resolves the sketch's character/word ambiguity. Custom answers supplement structured options; they are not mandatory essays.
- Separate project purpose from personal ownership. A whole-project answer does not by itself prove authorship or establish measured outcomes.

### 5.2 Discovery, ranking and evidence ports

Use task-local types implementing these logical contracts:

```text
Discover(repositoryIdentity, inventory, boundedReader) -> ProjectMap
ReadSections(fileIdentity, intent, readBudget) -> ScreenedSections
BuildGraph(projectMap, screenedSections, config) -> DependencyGraph
Rank(projectMap, graph, context, selectedSections) -> RankedCandidates
Select(rankedCandidates, context, evidenceBudget) -> EvidenceBundle
Evaluate(bundle, expectedFeatureMap) -> QualityReport
```

- `ProjectMap`: detected packages, confirmed/suggested capabilities, candidate overview/config paths, entrypoints, candidate roles and exclusion reasons. No runtime execution and no assertion that a filename proves a feature works.
- `ScreenedSection`: stable ID; repository, commit and blob identity; exact path and line range; content hash; excerpt; role; screening result; warnings; read-byte and excerpt/token estimates.
- `DependencyGraph`: bounded nodes/edges; import/export relationships; configured alias provenance; unresolved edges; wrapper signals. Do not fabricate edges from unresolved names.
- `RankedCandidate`: candidate/section ID; total score; named score components; feature targets; expected incremental coverage; duplicate relationships; estimated token cost; uncertainty flags.
- `EvidenceBundle`: exact sections, selected file identities, covered/missing feature areas, limitations, algorithm versions and consent hash. README/documentation context and implementation proof have distinct roles.
- `QualityReport`: per-feature evidence links, missing critical areas, test/wrapper share, duplicate share, token/byte/request/latency metrics, and deterministic selection identity. No unqualified “90% understanding” claim.
- Do not change existing public file/line/token caps independently. Evaluate larger file-count/read budgets in isolated experiments. Final values require measured review, schema updates and a combined payload/memory calculation.
- In-house selection makes **zero provider calls**. Initial selection should adapt to missing coverage, not just sort static file scores once.

### 5.3 Screenshots and consent

- Optional **0–5 user-uploaded screenshots**. Repository images remain excluded from automatic code retrieval. These are separate input sources with separate UI explanations.
- Accept JPEG, PNG and WebP after actual decode/type validation; reject SVG, animated images and unsupported formats. Never fetch an arbitrary user-supplied image URL.
- Initial engineering limits to validate: input up to 8 MiB/image, at most 16 megapixels/image; process one image at a time; resize to at most 1,280 pixels on the longest side without upscaling; target at most 200 KiB/image and 750 KiB total compressed images. If readability cannot be maintained, explain the tradeoff and allow removal rather than silently destroying detail.
- Decode/re-encode to remove metadata. Revoke object URLs and release originals/canvases on replacement, removal, discard and unmount. Keep processed images in tab memory; no localStorage, IndexedDB, Firestore, Blob storage or durable upload cache.
- Do not put image bytes into the encrypted checkpoint capsule. Use a separately bounded request attachment mechanism at final analysis time. Account for capsule size, multipart/base64 overhead and images together against the actual configured application request bound. The current session reader bounds requests at 4,100,000 bytes; its token can already reach 3,800,000 characters. Five images cannot simply be appended without a combined admission check.
- If the combined request cannot fit, require fewer/smaller screenshots or a newly prepared smaller source bundle. Do not silently truncate approved evidence or raise platform limits to make the test pass.
- The server validates the actual image dimensions/type/byte totals independently of the client. Authentication, same-origin checks, authorization, cancellation and request budgets apply before model submission.
- Exact-evidence consent covers the prepared source, structured interview answers, extra notes and screenshot hashes. Replacing any of these invalidates approval. No provider request during interview, compression or preparation.
- Screenshots support visual/interface observations, not backend implementation, deployment reliability, performance metrics or personal authorship. Show visual evidence provenance without storing raw images in saved achievements.
- Verify the configured provider/model's image support during implementation. A text-only provider must give an explicit unsupported-image outcome or offer a newly approved text-only run; never silently discard the screenshots or switch providers.

### 5.4 UI and animation specification

- Two distinct input surfaces: the adaptive interview and an always-available “Anything else about your project or contribution?” notes field. On desktop (approximately 1,024px and above), use a main interview card plus a side notes card. At smaller widths, stack them in reading order. Screenshot thumbnails form a separate optional panel below.
- Show one question at a time. Default to explicit Continue so a selection does not unexpectedly move focus; custom text and multi-select require Continue. Back preserves still-valid answers. Changing an earlier answer prunes inapplicable descendants and explains what changed.
- Animate question changes with 160–220ms opacity/translation transitions, maximum 8px movement; option feedback 100–150ms; panel expansion 180–240ms; progress transition 150–200ms. Avoid bouncing, autoplay carousels, large screen movement or animation that blocks input.
- `prefers-reduced-motion`: no directional movement, no animated progress and immediate or brief opacity-only updates. No essential information conveyed by animation alone.
- Progress is truthful: display “Question 3 · up to 10” while the route is uncertain; show “3 of 7 currently planned” only when explicitly provisional. Announce branch-length changes politely. Do not present a fixed percentage that can silently move backwards. Show completed/remaining applicable items on the review screen.
- Radio groups: arrow-key navigation; multi-select: checkboxes; visible focus; accessible labels and descriptions. On Continue/Back, focus the new question heading; do not steal focus while typing notes. Announce progress once per navigation, not on every keystroke. Preserve scroll position appropriately.
- Cover light/dark themes and widths 320, 390, 768, 1,024 and 1,440px. Support touch targets of at least 44px, zoom/reflow, long/custom answers and interrupted network states. Reuse the repository's design tokens and CSS modules; no new animation/UI library solely for this feature.

## Task 01 — Adaptive question catalog and graph engine

**Why:** asking one open-ended question puts project discovery work on the user. A structured, branching interview should ask relevant questions without conflating ownership and purpose.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-01-interview-engine` from `PLAN_BASE_SHA`.

**Own:** `src/lib/github/context-interview/**`, `tests/unit/github/context-interview/**`, `tests/fixtures/github/context-interview/**`. Do not edit workspace UI or global contracts.

**Implement:**

1. Define and validate the versioned node/answer/context schemas from Section 5.1. Build a reviewed initial bank of approximately 60 nodes across shared project/ownership questions and web/mobile, AI/ML/data, backend/automation, developer-tool and other/custom branches. Each node needs a reason it is useful and explicit information targets.
2. Implement pure `nextQuestion`, `applyAnswer`, `goBack`, `pruneInvalidAnswers`, `reviewContext` and completion functions. Choose eligible unanswered nodes by missing information, branch relevance and stable tie-breaks. Reuse join nodes; never require a binary tree.
3. Include whole-project ownership, solo/team distinction, intended users, core capabilities, main technical work and evidence/limitations. Ask outcome questions without pressuring users to invent numbers.
4. Treat repository hints as suggestions. Custom answers must not execute rules or become instructions. Use bounded declarative conditions with an operator allowlist.
5. Validate root reachability, references, cycles, conflicting conditions, duplicate IDs, dead ends, question limits, catalog migrations and safe handling of unknown answers. Provide deterministic context serialization suitable for consent binding.

**Independent testing:** synthetic answer transcripts only; no task-04 discovery code and no AI. Test solo whole-project, team dashboard contribution, ML without a dashboard, AI web app with overlapping tags, custom/unknown project, skips, backtracking and malicious catalog data. Verify the 10-question cap and meaningful completion with skips. Changing ownership must invalidate incompatible follow-ups while preserving unrelated answers.

**Done when:** every reachable route is valid; the same catalog/input gives the same next node and context; irrelevant dashboard questions are absent; all user-reported claims retain provenance. Export the engine plus JSON fixtures for Task 02 without requiring Task 02 to exist.

## Task 02 — Animated interview, notes and review UI

**Why:** make explaining the project approachable and accessible, while keeping ownership and purpose separate.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-02-interview-ui` from `PLAN_BASE_SHA`.

**Own:** `src/components/github-import/context-interview/**`, `tests/unit/github/context-interview-ui/**`, `tests/e2e/github-context-interview.spec.ts`, task-owned UI fixtures. Do not implement the graph engine or modify global workspace composition.

**Implement:**

1. Build a controlled interview component against a structural engine port matching Section 5.1. Include a scripted fixture port with branches/joins; do not import Task 01 or hardcode its unfinished code.
2. Implement the exact layout, durations, reduced-motion behaviour, keyboard/focus handling and adaptive-progress rules in Section 5.4. Add the separate 500-code-point notes field with counter, optional purpose clarification, and a final editable answer summary.
3. Present four normal choices and a last custom-answer choice per question; reveal the bounded text input when custom is selected. Support “Not sure / Skip” as a secondary action. Make single/multi-select explicit. Never replace a valid whole-project ownership answer with a required essay.
4. Show preparation/analysis steps separately from interview progress. Changing answers must emit a context revision event; the enclosing integration must invalidate old evidence consent.
5. Provide loading, invalid catalog/port response, empty route, branch change, browser Back, unsaved-session expiry and retry-without-answer-loss states. No source or answers in browser persistent storage.

**Independent testing:** run with scripted port transcripts for 5-, 7- and 10-question routes, route shortening/lengthening, multiselect, custom entry, edits and skips. Test both themes at all five widths, 200% zoom, keyboard-only navigation, focus after transitions, reduced motion, emoji limits, slow port responses and accidental double clicks. Capture the opening, mid-branch, notes and review states. Assert zero provider calls.

**Done when:** the interview is fully usable with its fixture port, all motion rules are verified, progress never claims certainty it lacks, and integration instructions map context changes to consent invalidation.

## Task 03 — Optional screenshot input and bounded multimodal boundary

**Why:** users can illustrate their interfaces without automatic repository image scraping or durable upload storage.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-03-screenshots` from `PLAN_BASE_SHA`.

**Own:** `src/components/github-import/context-screenshots/**`, `src/lib/github/context-screenshots/**`, matching unit/E2E fixtures. Document baseline route/provider wiring in `integration.md`; do not edit shared provider/dispatcher files concurrently.

**Implement:**

1. Build add/remove/replace, drag/drop and file-picker controls for 0–5 screenshots. Show thumbnails, processing status, compressed dimensions/size and a deliberate preview before approval. Use the Section 5.3 limits and session lifetime.
2. Implement bounded sequential decode, compression and metadata removal with cancellation. Use a worker when supported; provide a responsive bounded fallback. Measure readability of UI labels rather than optimizing file size alone.
3. Supply server-side actual-byte/type/dimension validation, aggregate request admission, attachment hashing and a multimodal provider adapter behind structural ports. Write an explicit wire-format proposal and reject an oversized combined capsule/attachment request before dispatch.
4. Include image identities in consent and invalidate approval on edits. Never send originals automatically, execute SVG, persist images, or infer nonvisual implementation facts.
5. Provide a fake provider capturing exactly what would be submitted. The real adapter must fail closed for unsupported models and support abort. Record image-token usage only when the provider reports it; compression bytes are not a token-cost guarantee.

**Independent testing:** generated fictional dashboard/mobile/chart screenshots, a readable tiny-label sample, an oversized image, corrupt bytes, MIME spoofing, six-image selection, excessive dimensions, metadata, cancellation, replacement, reload/discard and a nearly full checkpoint capsule. Test server validation separately from the browser. Assert no uploads/provider calls before approval, no raw images in stored achievements, and object URL cleanup. Test a text-only provider explicitly.

**Done when:** the standalone UI and request/provider harness demonstrate the exact approved images, safe request admission and no persistent staging. Production wiring remains an assembly step, not an assumption that Task 02 exists.

## Task 04 — Project discovery, overview documents and configuration map

**Why:** whole-project context needs an overview and feature/package map before ranking implementation files.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-04-project-map` from `PLAN_BASE_SHA`.

**Own:** `src/lib/github/context-discovery/**`, matching unit fixtures/tests and task-owned integration notes. Use a bounded-reader port, not Task 05's implementation.

**Implement:**

1. Discover root/package README variants, architecture/design summaries, manifests, workspace boundaries, language/framework configuration and entrypoints. Always attempt an eligible root README and relevant package README; if absent, unsafe or unreadable, record why rather than block the entire project or silently omit it.
2. Do not include every README in a large repository. Deduplicate repetitive package docs and select overview sections related to the chosen project/package. Never follow README hyperlinks or image URLs as network instructions.
3. Parse configuration as bounded data, including JSONC where necessary. Produce validated alias mappings with provenance; reject traversal, external targets, prototype pollution and unsupported constructs without executing config code.
4. Produce capability suggestions and a package/feature map. Separate confidence from fact and distinguish a planning document from implemented behaviour. Use language/framework-independent fallback behaviour for unknown repositories.
5. Return explicit exclusion reasons and distinguish total inventory, eligible files and selected evidence. Images under `docs/` must not be counted as usable overview text merely because their directory is documentation.

**Independent testing:** small TS app, multi-package monorepo, Python ML repo, backend CLI, empty repository, generated docs tree, missing README, nested README duplication, malicious README links, tsconfig JSONC/extends fixtures, unsupported dynamic config and unsafe aliases. Use a fake reader and fixed inventories. No GitHub network or other task module is required.

**Done when:** outputs identify overview candidates, package boundaries and validated configuration deterministically, with explicit uncertainty. A fake whole-project run attempts README/manifest discovery even if there are many route files.

## Task 05 — Bounded larger-text reading and source section extraction

**Why:** rejecting a 100 KiB source/document before examining any useful section loses important context; sending the entire file is also unnecessary.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-05-section-reader` from `PLAN_BASE_SHA`.

**Own:** `src/lib/github/context-sections/**`, matching tests/fixtures and reader integration notes. Do not silently change baseline `EVIDENCE_LIMITS`, fetch policy or public contracts.

**Implement:**

1. Separate metadata admission, bounded download bytes, decoded-memory limits and model-excerpt limits. Evaluate a **256 KiB per-text-file** ceiling in an isolated experimental reader, with a separate total byte/request/deadline budget. Compare at least the baseline 64 KiB and experimental ceiling before proposing production values.
2. Retain host restrictions, authorization, pinned blob/hash verification, binary checks, full bounded-text secret screening, cancellation and streamed byte enforcement. Never select only a safe-looking prefix of an otherwise unverified or oversized download.
3. Extract meaningful code declarations and document sections with exact line ranges. For a huge component/function, provide bounded nested units/signatures and dependencies with an explicit partial-context label; do not represent an isolated nested fragment as a complete function.
4. Prefer purpose/current-code-map/relevant sections over copying entire UI task plans. Preserve documented/planned/observed distinctions. Keep large JSON/report parsing schema-aware; arbitrary reports do not establish measurements.
5. Cache only completed, verified reads/sections in request/tab-session memory. Retain completed files on partial batch failure. Deduplicate in-flight reads by authorization namespace, repo, commit/blob and parser/safety versions. Bound concurrency and cache bytes; cache hits never bypass authorization. No Firestore source staging.

**Independent testing:** 63/64/65 KiB boundaries, 100 KiB Markdown, a 116 KiB component analogue, exactly/over 256 KiB, malicious content near the end, tiny/huge lines, nested declarations, invalid UTF-8, binary masquerading as text, hash mismatch, response size lies, cancellation, duplicate requests and later-file failure. Verify exact excerpts/hashes, aggregate bytes, memory cleanup and zero provider calls.

**Done when:** the experimental reader recovers useful bounded sections from large safe files, refuses unsafe/over-budget inputs and reports partial context honestly. Production limit recommendations include measurements and do not assume Task 07 has changed bundle limits.

## Task 06 — Dependency-aware, explainable in-house ranking

**Why:** filename/category scores and broken alias handling select wrappers while missing their implementations.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-06-local-ranking` from `PLAN_BASE_SHA`.

**Own:** `src/lib/github/context-ranking/**`, unit graph/ranking fixtures/tests and integration notes. Consume project-map/section structural fixtures; do not import Tasks 04 or 05.

**Implement:**

1. Build a bounded dependency graph from supplied import/export/configuration data. Correctly resolve configured `@/* -> src/*`, relative/index imports and package boundaries. An alias is applied only when configuration supports it; do not universally guess that every `@/` means `src/`.
2. Identify thin wrappers/re-exports and use them to find implementation targets. Rank public behaviour, relevant domain logic, data flow and missing feature coverage above repeated adapters. Avoid globally prioritizing a widely imported trivial utility simply because it has high fan-in.
3. Export a deterministic ranking function with named components: scope relevance, feature gain, implementation depth, dependency relevance, provenance/confidence, redundancy and estimated token cost. Recompute incremental value against the already selected set.
4. Keep overview, implementation and verification roles separate. Tests remain eligible; mocked tests must not count as actual provider/database implementation. Respect user pins and explicit scope within safety and budget constraints.
5. Use bounded static parsing, never execute repository code. If introducing a parser, justify runtime availability/bundle cost and document the dependency change for assembly. Provide clear fallback behaviour for unsupported languages rather than pretending to resolve them.
6. Version scores/graph rules, return a human-readable reason for each rank, and make ties stable without relying on directory order as an importance signal.

**Independent testing:** wrapper-heavy Next-style app, configured/custom/missing aliases, deep chain/cycle, barrel exports, shared trivial utility, duplicate code, changed contribution scope, ML pipeline and unsupported-language fixtures. Verify high-value target implementations outrank wrappers, deterministic results under shuffled inventories, traversal bounds and no provider calls. Do not use a learned model or external embeddings.

**Done when:** important dependencies are discoverable and rankings explain what new information a candidate adds. Report mistakes and counterexamples, not only passing examples.

## Task 07 — Coverage-aware evidence bundle allocation

**Why:** a good candidate ranking still needs a balanced evidence bundle; twelve superficially relevant files can omit the project's core engine.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-07-bundle-allocation` from `PLAN_BASE_SHA`.

**Own:** `src/lib/github/context-bundle/**`, unit allocation fixtures/tests and integration notes. Use supplied ranked-candidate fixtures; do not require Task 06.

**Implement:**

1. Select sections using marginal feature coverage and token cost. Allocate explicit overview/configuration, primary implementation and supporting verification roles. Define an initial experimental allocation around 15% overview, 70% implementation and 15% verification, with borrowing when a role has no useful evidence. These are tunable defaults, not fabricated confidence percentages.
2. For general overview mode, evaluate a soft 10–15% test-token allocation. Test-focused user contributions can override it explicitly. Do not ban `.test`/`.spec` files or require tests where none exist. Tests must not crowd out the feature implementation they supposedly verify.
3. Preserve pins and exact source provenance. Prefer one representative wrapper when useful, not many near-identical wrappers. Deduplicate overlapping sections/content before charging the model budget.
4. Keep existing live caps as the baseline adapter. Compare alternative file-count/read allocations offline under a fixed token budget; do not independently raise the existing 12-file public schema. Surface missing critical features when the budget cannot cover them.
5. Produce a coverage review explaining represented features, missing areas, omitted files and limits. Allow user adjustment followed by fresh preparation/consent. Do not call the bundle “90% understood”; a coverage score must name its denominator and evidence.
6. Use whole-project context to orient the model while restricting achievement claims to the user's confirmed contribution scope. Complete coverage never establishes sole authorship or measured performance.

**Independent testing:** supplied candidates for a full-stack resume app, monorepo, docs-heavy repo, test-heavy repo, no-test repo, explicit testing contribution and impossible-budget pins. Check feature diversity, missing-critical warnings, borrowing, duplicates, deterministic identities and admission limits. Compare a 651-line wrapper/test baseline with a balanced candidate set at comparable token cost.

**Done when:** the output explains every inclusion/omission, cannot exceed its budgets, and improves feature coverage over fixed top-N selection in the agreed fixtures. No dependency on another task's code or live AI output.

## Task 08 — Evidence inventory and preparation UI repair

**Why:** generic red blocks and hundreds of yellow notices obscure what users can actually do.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-08-evidence-ui` from `PLAN_BASE_SHA`.

**Own:** `src/components/github-import/context-evidence-ui/**`, standalone tests/fixtures/E2E harness and an adapter specification for existing `EvidencePanel`/inventory boundaries. Existing local drafts are optional reference only.

**Implement:**

1. Display distinct reasons for unsupported binary/image files, excessive text size, credential-like filename rules, unsafe paths, symlinks/submodules and actual content screening. A filename rule must not falsely claim a real secret was found. Preserve structured backend reasons through the adapter instead of inferring them solely in the UI.
2. Show one neutral full-bundle notice above the list. Unselected eligible files remain ordinary rows with a disabled add action and accessible explanation. Do not repeat a warning card for every safe file.
3. Default to a useful selected-evidence view, with searchable eligible/all/excluded views and reason counts. Keep excluded files inspectable as metadata; do not offer source inspection that bypasses exclusion rules. Distinguish inventory totals from eligible/selected counts.
4. Show overview/implementation/verification allocations and missing-feature notes using structural fixture data. Preserve exact excerpt preview, source path/SHA/range, removal/replacement and stale-selection feedback.
5. Use the Section 5.4 accessibility/theme/width rules. Limit animation to disclosure/selection feedback with reduced-motion support. Keep search typing responsive on at least a 10,000-entry synthetic inventory through bounded rendering/pagination; do not render thousands of expanded cards by default.

**Independent testing:** mixed 100 KiB docs, PNGs, `.env.example`, unsafe paths and eligible files; full bundle; removed selection freeing a slot; 10,000 entries; no eligible files; search/filter states; source preview; keyboard replacement; both themes/all five widths. Assert one limit notice and truthful distinct reasons. Use fixture bundles, not Task 07.

**Done when:** users can distinguish excluded files from files outside the current bundle and understand the next action without reading repeated alerts. Document how baseline inventory flags reach this component.

## Task 09 — Interrupted analysis diagnostics and truthful lifecycle UI

**Why:** preparation succeeded, but analysis stopped; current normalization hides why and the sidebar can falsely say analysis never started.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-09-analysis-diagnostics` from `PLAN_BASE_SHA`.

**Own:** `src/lib/github/context-run-status/**`, `src/components/github-import/context-run-status/**`, tests and an explicit baseline runner/session integration patch description. Do not change retry/lease/provider semantics to conceal an unknown failure. Existing local diagnostic/UI drafts are optional reference only.

**Implement:**

1. Model preparation, awaiting approval, submitting, analyzing, interrupted/unknown outcome, failed, ready-with-drafts, ready-with-zero-drafts and saved separately. Combine busy state, lifecycle and attempt markers; the existence of a prepared bundle must not override a later interruption.
2. State only known facts. Replace unsupported “local worker stopped” claims with an outcome-unknown explanation. Keep model/token usage unknown when unreported. Never claim the request was not sent merely because no result arrived.
3. Record content-free stages and allowlisted error categories before normalization discards them. Correlate operation/run IDs; record bounded elapsed time, attempt number, abort/deadline state, and numeric upstream status when safely available. Never log prompts, source, image bytes, credentials, exception messages/stacks or raw provider responses.
4. Distinguish provider failure, validation failure, budget admission, result staging, final acknowledgement, authorization and deadline/cancellation. Preserve idempotency, paid-attempt receipts and outcome-unknown protection. No automatic paid retry.
5. Use one consistent status interpretation in the main panel and sidebar. Retry preparation must be distinguished from approving a new AI call; changed evidence requires fresh review. Preserve zero-draft and save-only-with-drafts behaviour.
6. Document the original incident as unresolved unless new evidence confirms it. Finish the independently testable instrumentation before requesting an owner-approved traced reproduction. Do not replay real evidence through the model on behalf of the user.

**Independent testing:** fake provider success/zero output, 401/403-like provider rejection, rate limit, timeout, malformed output, budget failure, result-store failure, lost stream acknowledgement, stale versions, cancellation and double clicks. Assert consistent UI states and provider-call counts. Inject canary secrets/source into errors and prove logs omit them. Verify original run/capsule identities are not exposed across accounts.

**Done when:** injected failures identify the correct safe stage/category, the UI never contradicts the attempt marker, and a reviewable traced-reproduction procedure exists. “Exact live root cause confirmed” is a separate conditional outcome, not a checkbox satisfied by instrumentation alone.

## Task 10 — Offline quality benchmark and contract conformance harness

**Why:** we need evidence that the proposed system selects better context before relying on it in a paid generation flow.

**Worktree/branch:** follow Section 2; use `codex/github-context-task-10-quality-harness` from `PLAN_BASE_SHA`.

**Own:** `tests/github-context-quality/**`, `tests/fixtures/github/context-quality/**`, a task-owned benchmark runner under `scripts/github-context-quality/**`, and benchmark documentation. Do not import modules that exist only on other task branches.

**Implement:**

1. Provide port conformance suites for the Section 5 contracts and a reference baseline adapter to the existing selector. Candidate implementations can register an adapter later without changing expected results. Detect empty/no-op adapters so fixture success cannot be mistaken for production integration.
2. Curate fictional repositories with reviewer-defined feature maps and traceable expected evidence: wrapper-heavy full-stack app; test-heavy app; Python ML pipeline; monorepo; large-doc/large-function repo; malicious/unsafe repo; unknown project type. Include questionnaire transcripts and optional image fixtures as distinct inputs.
3. Add a source-free regression manifest for the public reproduced SHA listing its 12 paths, 651 lines and test share. Ordinary CI uses synthetic analogues or explicitly reviewed fixtures, never live GitHub or paid AI. Do not copy private user source into repository fixtures.
4. Measure per-feature implementation coverage, overview presence, unresolved dependencies, wrapper/test/duplicate token share, provenance correctness, selected tokens, downloaded bytes, request count, latency and bounded-memory behaviour. Report raw denominators and critical gaps; do not equate test coverage with project-context coverage.
5. Define failure cases that defeat simplistic scores: famous filenames with irrelevant contents, huge central components, generic `page` test matches, mocked services, repeated README templates and high-fan-in trivial utilities. Compare static top-N, role-balanced and marginal-coverage strategies on the same budget.
6. Add synthetic consent/privacy contract checks: zero AI calls before approval; image/context edits invalidate consent; identical approved submission is idempotent; only confirmed achievements are saved; no source/screenshots enter persistent staging. These use fake ports and do not require Task 03 or Task 09.

**Independent testing:** the harness itself must detect deliberate broken implementations, reproduce baseline weaknesses and emit deterministic machine-readable plus human-readable reports. Run offline with provider/network calls configured to fail immediately. A later owner-approved live evaluation is separate and explicitly costed.

**Done when:** a developer can test any task's adapter against the common contracts and compare retrieval quality without another task branch. Record baseline results honestly; do not weaken expected feature maps to make a candidate pass.

## 6. Required verification per task

Every task follows this same independent workflow in its own worktree:

1. Confirm the common base SHA and read the relevant baseline code and repository instructions. Record ownership and preserve unrelated changes.
2. Implement only the owned module and fixture/adapter tests. Supply `integration.md` for shared-file edits rather than racing another task on the same file.
3. Run focused Vitest tests, TypeScript checking, ESLint for owned files and Prettier. Use the repository's installed toolchain/lockfile; do not install or upgrade packages casually to work around failures.
4. UI tasks run their standalone Playwright harness against an optimized build, verify both themes/all five widths plus keyboard/reduced motion, and capture screenshots. If a harness route is needed, keep it isolated/local-only like the existing GitHub test harness; it must not become an authenticated-user bypass on Preview.
5. Run broader applicable tests when changing a baseline adapter. Keep production/test timeouts unchanged unless a separately diagnosed requirement justifies a change. Do not run heavy build/browser/unit suites simultaneously and then classify load-related timeouts as product defects.
6. End with clean, reviewable commits only when implementation has been authorized. Do not push, merge, deploy, discard the source drafts or change production without the authorized release workflow.

Useful baseline commands, scoped appropriately per task:

```powershell
npm run typecheck
npx vitest run <owned-test-files>
npx eslint <owned-paths>
npx prettier --check <owned-paths>
npm test
npm run lint
npm run format:check
$env:PLAYWRIGHT_PORT = '3041'
node scripts/test-github-journey.mjs
```

Use unique local ports/data roots for concurrent worktrees. Existing commands do not automatically discover a newly added standalone harness; document the exact config/command. Run the Firebase security emulator suite when Java is available; explicitly record unavailable checks instead of claiming they passed.

## 7. Final assembly and release gate — after independent tasks

This is required coordination, not a claim that integration is dependency-free.

1. Review all module exports and contract tests against the frozen specification. Integrate into a separate worktree from the latest authorized `phase-one` baseline, preserving newer work. Decide whether to reuse any earlier local drafts only after a diff review.
2. Wire interview -> project context -> project map -> bounded sections -> dependency/ranking -> balanced bundle -> exact consent -> provider -> review/save. Connect optional screenshots through the bounded attachment adapter. Replace fixture ports; prove the hosted path uses real implementations.
3. Resolve shared schemas, algorithm versions, configured limits, request-envelope constraints and provider interfaces together. Version selection/cache identities when retrieval semantics change. Old tab-held bundles must not silently acquire a new interpretation or new consent.
4. Verify a fresh import end to end: whole-project solo answer; a partial/team contribution; no screenshots; five screenshots; larger text; missing README; no tests; unavailable provider; interrupted attempt; zero drafts; explicit save; discard/reload; expired evidence; cancellation; duplicate submission. Confirm account isolation, receipt idempotency and no persistent source/image staging.
5. Compare quality on the agreed feature maps at equal model-token budgets. An initial target may be evidence for at least 9 of 10 agreed feature areas, but all critical areas must be represented and documented-only coverage cannot substitute for implementation proof. Report omissions and uncertainty; do not display a universal “90% project understanding” badge.
6. Complete full unit/integration tests, lint, typecheck, formatting, fresh build, browser verification and available security tests. Capture actual compressed-image readability, payload bounds and representative source/feature coverage. Do not count synthetic success as a live provider success.
7. Only after authorization, commit/integrate/push to `phase-one`, verify the exact Preview commit/alias and authenticated boundaries. Keep `main` and Production unchanged. A real model test requires the owner to review and approve the exact final source/context/images. A traced interruption reproduction must likewise be deliberate and must not trigger hidden paid retries.

## 8. Open decisions to validate, not silently assume

- Larger text and file-count budgets: choose after experiments and combined capsule/payload/memory measurements; do not copy every proposed number into production.
- Ranking weights and test share: tune against held-out feature maps, including testing-focused contributions. No trained model/LLM ranker in the first implementation.
- Screenshot fidelity and image-token costs: benchmark actual configured model behaviour separately from upload compression. Keep images optional.
- Interview bank wording and route lengths: run usability checks with a solo developer, a team contributor and a nontechnical user. Do not make a user prove the application contains a dashboard before explaining what they built.
- Original interrupted attempt: the exact cause remains unknown until recoverable evidence or a consented traced attempt establishes it. UI and retrieval repairs must not be presented as a proven fix for that incident.
