# Resume-JD Tailor Project Plan

## 1. Project Summary

This project is a local-first resume tailoring web application that helps the user create a more ATS-targeted resume for a specific job description without manually rewriting the whole resume each time. The user starts with their existing resume format, written in a compact Jake-style LaTeX structure, and combines it with a pasted job description plus a structured JSON library of their real achievements. That JSON library acts like an Achievement Points Hashmap: it stores reusable, source-traceable facts from the user's jobs, projects, skills, licenses, and certificates so the app can choose from known experience instead of inventing new content.

The intended workflow is that the user pastes a JD, the app analyzes what the company is asking for, compares those requirements against the achievement library, selects the strongest matching points, rewrites only those selected points into resume-ready language, places them into the existing Jake-style resume structure, compiles the LaTeX into a PDF, and shows the final result in the browser. The user should be able to review what was selected, understand why it was selected, override the AI's choices when needed, and export the final `.tex`, `.pdf`, and generation metadata for later reference.

The main product goal is truthful tailoring, not fake optimization. The AI may draft new resume bullet points by combining or reframing facts from one or more existing job or project achievement points in light of the JD. Every claim must remain supported by its source points, and each generated bullet must be traceable to one or more achievement IDs. The AI may include JD-relevant skills that are missing from the current resume when those skills are present in the user's skill data or evidenced by their achievements. It must not invent jobs, projects, companies, dates, metrics, certificates, or unsupported skills or responsibilities.

For the first version, this is a personal local tool rather than a hosted SaaS product. The app should run locally, store data in JSON files, and keep the user's resume data, job descriptions, generated LaTeX, PDFs, and history on the user's machine. The technical stack for v1 is Next.js, TypeScript, JSON-backed storage, Zod validation, a Jake-style LaTeX rendering pipeline, local PDF compilation, and a Gemini-first AI provider adapter. The AI layer should be built behind a provider interface so Gemini can be used first while leaving room to add DeepSeek or another provider later without rewriting the rest of the application.

## 2. Core Architecture

- Frontend: Next.js App Router, TypeScript, Tailwind CSS.
- Backend: Next.js route handlers/server actions for local file access, AI calls, LaTeX rendering, and PDF compilation.
- Data storage: JSON files in the project data directory for v1.
- Validation: Zod schemas for all JSON inputs and AI response contracts.
- AI provider: Gemini-first adapter through a generic provider interface; DeepSeek can be added later without rewriting the app.
- Resume rendering: Jake-style LaTeX template with strict placeholders and server-side rendering.
- PDF compilation: local LaTeX compiler such as Tectonic, run inside a controlled temp directory with timeout and error capture.
- Testing: unit tests for schemas/renderers/adapters, integration tests for generation flows, and Playwright smoke tests for the UI.

## 3. Mandatory Workflow For Every Task

Every task below must follow this workflow unless the task explicitly says otherwise.

1. Start from `main`.
2. Pull the latest remote changes: `git pull --ff-only origin main`.
3. Create a focused branch named `codex/task-XX-short-name`.
4. Read the relevant docs and code before editing.
5. Implement only the scope of the current task.
6. Add or update tests for every new function, utility, API route, or user-visible behavior.
7. Run the full quality gate before pushing: lint, typecheck, unit tests, and any relevant integration or Playwright tests.
8. Review the diff manually and remove unrelated changes.
9. Push the branch and open a PR, or merge to `main` only after checks pass and the work is reviewed.
10. After merge, confirm `main` is clean and up to date before starting the next task.

Until the repo has scripts, each task should also add or update the missing script it depends on. Once scripts exist, the expected quality commands are:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

## 4. What A Good Test Should Check

A good test checks one clear behavior and makes a failure understandable. Use the points below when deciding what to test; not every individual test needs to cover every point. Choose the checks that fit the code and risk being tested.

- **Expected result:** Does the code return or display the right result for normal input?
- **Important edge cases:** What happens with empty or missing input, unusually large values, and boundary conditions?
- **Invalid input:** Is invalid or unsupported input rejected or handled safely and clearly?
- **Side effects:** Does the code save, send, or change only what it is supposed to?
- **Errors:** Does a failure produce the expected error result instead of crashing or appearing successful?
- **Permissions and privacy:** Can users access only what they are allowed to, and are secrets and private data kept out of outputs?
- **Connections between parts:** Do components, API routes, storage, and external dependencies work together correctly?
- **User-visible behavior:** Can a user complete the important flow and understand its result?
- **Regression risk:** Would the test catch a previously fixed bug if it returned?
- **Repeatability:** Does the test give the same result each run without depending on real APIs, timing, or leftover data?
- **Useful scope:** Does the test focus on observable behavior instead of copying the implementation line by line?

Use proportionate coverage: a pure utility may need normal, invalid, and boundary inputs; a feature spanning storage and UI may also need integration, error, privacy, and end-to-end checks. A passing test is evidence for the behavior it covers, not proof that the whole application is bug-free.

## 5. Task Roadmap

Task boundaries represent cohesive deliverables, not arbitrary layers. Build a complete user-facing workflow in one task when its screens and supporting behavior naturally belong together; keep tasks separate when they establish independently useful foundations, isolate meaningful risks, or represent distinct AI stages.

### Task 01: Initialize The Next.js Application

Create the base Next.js project with TypeScript, App Router, Tailwind CSS, ESLint, Prettier or equivalent formatting rules, and a clean default folder structure. The goal is to establish a stable foundation that every later task can build on without debating framework setup. Remove starter content that does not belong to the product and replace it with a minimal app shell placeholder.

Implementation must include package scripts for `dev`, `build`, `lint`, `typecheck`, `test`, and `test:e2e` even if some test commands start with placeholder configurations. Add initial test tooling such as Vitest for unit tests and Playwright for browser smoke tests. The task is complete when the app starts locally, builds successfully, and has a clean baseline for future work.

Required workflow: update `main`, create `codex/task-01-init-nextjs`, implement the app foundation only, add the initial test/config files, run all available quality commands, review the diff, then push or merge only after checks pass.

### Task 02: Add Project Documentation Foundation

Create the first documentation set for the project: README, architecture overview, local setup instructions, contribution workflow, and task execution rules. These docs should explain what the app does, what it intentionally does not do, how to run it locally, and how each feature task should be handled. The documentation must be written so a new engineer can understand the product without reading the original chat.

Implementation should include a short explanation of the Achievement Points Hashmap, the JD-to-resume flow, the local-first v1 decision, and the Gemini-first provider strategy. Add a docs index that links to the project plan, architecture notes, and future setup guides. This task is complete when a new contributor can clone the repo, install dependencies, run checks, and understand the planned build sequence.

Required workflow: update `main`, create `codex/task-02-docs-foundation`, edit documentation only, add documentation linting if available, run all quality commands, manually review docs for clarity, then push or merge only after checks pass.

### Task 03: Define JSON Schemas For Resume Data

Create the formal data contracts for profile and contact information, education, jobs, projects, achievement points, skills, licenses, certificates, resume preferences, and generation history. Use Zod schemas and inferred TypeScript types so the same contract validates local JSON and powers app code. Education must support a joint program listing multiple institutions, and skills must be stored separately from the subset currently shown on the resume.

Each job and project owns an ordered list of source achievement points. Points may store tags, links to skill IDs, optional source-backed metrics, enabled status, and provenance identifying whether the information came from a resume, LinkedIn, user notes, project documentation, or direct user input. A metric must retain its supporting evidence; an empty metric list is valid. Skill records must indicate whether the skill appears on the current resume and may link to achievement evidence. Generated bullets belong to generation history and must reference the source achievement IDs used to compose them.

Define stable IDs, required and optional fields, month-precision career dates, ISO credential dates, and human-readable validation messages. Include a closed resume-section type and a one-page maximum preference. Add schema tests for valid data, joint education, skills omitted from the current resume but present in the library, missing fields, duplicate IDs, invalid or reversed dates, blank achievement text, missing metric evidence, invalid cross-references, unsupported section types, and generated bullets with unselected sources. Do not add the user's private resume as a fixture; use clearly synthetic test data. The task is complete when the contracts and inferred types are exported from a clear module for later app tasks.

Required workflow: update `main`, create `codex/task-03-json-schemas`, add schemas and focused tests, run lint/typecheck/unit tests, review generated types and error messages, then push or merge only after checks pass.

### Task 04: Add Sample Achievement Library

Create a realistic sample data set that demonstrates how the Achievement Points Hashmap should be written. Use fake/demo data, not private personal data. The sample must include at least two jobs, multiple achievement points per job, skills connected to points, certificates/licenses, and at least two projects with multiple points each.

Each sample point should focus on a different resume angle, such as system design, AWS, CI/CD, performance, leadership, backend work, frontend work, automation, or reliability. The sample data should be valid against the schemas from Task 03 and useful for demos and tests. The task is complete when sample JSON loads successfully and gives later UI/AI tasks enough realistic data to work with.

Required workflow: update `main`, create `codex/task-04-sample-achievements`, add sample JSON and validation tests, avoid real secrets or personal data, run all quality commands, inspect the sample for realism and schema compliance, then push or merge only after checks pass.

### Task 05: Build Data Loading And Validation Utilities

Implement server-side utilities that load local JSON files, validate them with the schemas, and return typed data or clear validation errors. These utilities are the only layer that should read raw data files directly, so later features do not duplicate parsing logic. Support two deliberately separate sources: the tracked fictional `examples/sample-resume-library.json` for automated tests and an explicit demo mode, and the owner's ignored `/data/resume-library.json` for local development with real resume information. When the personal file is missing or invalid, show an actionable error; never silently substitute fictional data.

As part of this task, create `/data/resume-library.json` locally from the owner's supplied resume PDF, LinkedIn screenshots, and written work notes. Extract supported profile, education, job, project, skill, and credential details with source provenance. Preserve metrics only when a supplied source supports them; do not invent achievements or numbers. If sources disagree about a title, date, metric, or other fact, keep the conflict visible for the owner to resolve instead of silently choosing a value. The owner's explicitly clarified joint education details should be represented in the private file. Review the resulting data with the owner before treating it as verified.

Implement functions for loading profile data, achievement data, template metadata, and generation history, with an explicit personal-versus-demo source choice. Local development should use the personal library by default once it exists; demo mode should be an intentional choice. Unit tests must use only synthetic fixtures and must never read, snapshot, or commit `/data/resume-library.json`. Cover valid files, malformed JSON, missing files, schema failures, duplicate IDs, source selection, and friendly error formatting. The task is complete when app code can depend on typed loader results, the local personal library validates, and all personal data remains ignored by Git.

Required workflow: update `main`, create `codex/task-05-personal-data-loaders`, create and validate the ignored personal library locally, implement typed loaders and synthetic-only tests in the appropriate test folder, verify `git status` does not include personal data, run lint/typecheck/unit tests, review edge cases, then push or merge only after checks pass.

### Task 06: Build The Application Shell And JD Workspace

Create the first usable application shell and the complete local-first JD entry workflow together. Add navigation for the JD workspace, achievement library, resume generation, history, and settings, plus a responsive work-focused layout with useful empty states. The JD workspace must collect the job description, company, role title, and optional job link, and persist drafts locally.

Show character count and an estimated token count, validate empty and oversized JD input, and support restoring or clearing a saved draft. Do not call an AI provider or analyze the JD in this task; this task ends when the user can enter, save, and revisit JD context inside the real application shell. Add Playwright coverage for navigation, responsive rendering, input validation, draft persistence, and clearing.

Required workflow: update `main`, create `codex/task-06-app-shell-jd-workspace`, implement the shell and JD workflow as one usable feature, add focused unit and Playwright tests, run all quality commands, inspect desktop/mobile behavior, then push or merge only after checks pass.

### Task 07: Build The Searchable Achievement Library

Create one read-only library browsing experience that groups jobs and their achievement points, projects and their points, credentials, and skills, while making search and filtering part of that same experience. Show point IDs, source provenance, tags, linked skills, and enabled/disabled status so users can inspect what the library contains before editing or AI selection is available.

Load the owner's validated personal library by default in local development and show actionable missing/invalid-data errors. Provide an intentional switch to the fictional demo library; never silently fall back. Search point text, tags, skills, job names, project names, and credential names. Add source type, enabled status, skill, tag, and job/project filters; results should update immediately, retain stable ordering, show active filters, and offer a reset action. Automated tests must use synthetic data only and cover grouped/empty states, source switching, combined filters, no results, errors, reset, and responsive behavior.

The task is complete when the owner can browse either data source and narrow a large library without editing JSON. Required workflow: update `main`, create `codex/task-07-achievement-library-search`, implement browsing and search together, add unit and Playwright tests, verify personal data remains outside tests and Git, run all quality commands, inspect desktop/mobile behavior, then push or merge only after checks pass.

### Task 08: Add Local Achievement Editing

Create an editing experience for adding and updating achievement points in the local JSON-backed library. The editor should allow changing text, tags, skills, metrics, enabled status, and source assignment. It must validate changes before saving and show friendly errors instead of corrupting the data file.

Implementation should use server-side write actions or API routes with schema validation. The task should include a backup or safe-write strategy so failed saves do not destroy existing data. Tests must cover successful edits, validation failures, duplicate IDs, cancelled edits, and persistence after reload. The task is complete when users can maintain their achievement library from the app.

Required workflow: update `main`, create `codex/task-08-achievement-editing`, implement safe local editing with tests, run all quality commands, manually test save/reload/error cases, then push or merge only after checks pass.

### Task 09: Add The Jake-Style Template And Deterministic Renderer

Use the user's current one-page resume as the visual and content-density reference for establishing the production template. Match its compact serif presentation, centered identity/contact header, summary placement, ruled section headings, aligned dates, grouped skills, credential rows, and section order. Implement those characteristics as reusable template markup with controlled placeholders for contact details, education, experience, projects, skills, and credentials; do not copy the personal resume's filled-in content into the template. Keep template markup separate from resume data so later generation can fill it deterministically. The template should target the same compact one-page feel, with actual page count verified by the PDF task.

Expose a typed function such as `renderResumeLatex(input)` that resolves selected achievement IDs, follows section preferences, groups skills, omits empty optional sections, and centralizes LaTeX escaping. Tests must cover required sections, normal output, empty optional sections, special characters, unknown IDs, disabled points, and stable rendering. The task is complete when structured data can produce valid LaTeX without an AI call.

Required workflow: update `main`, create `codex/task-09-latex-template-renderer`, add the template, renderer, and focused tests together, run all quality commands, inspect rendered LaTeX manually, then push or merge only after checks pass.

### Task 10: Add Manual Generation And LaTeX Preview

Complete the first end-to-end manual generation flow using the existing JD workspace and achievement library. Let the user select enabled achievement points, submit JD metadata and selected IDs to a server endpoint, and receive LaTeX from the deterministic renderer. Do not call AI or compile a PDF in this task.

Validate request payloads, reject unknown or disabled IDs, return structured errors, and include basic generation metadata. The page must show loading, success, and error states; display the generated LaTeX; and support copying or downloading the `.tex` file while preserving the user's selection. Tests must cover API validation and renderer failures plus the user flow from selecting points through viewing/downloading output. The task is complete when a user can manually create and export a complete LaTeX resume from local data.

Required workflow: update `main`, create `codex/task-10-manual-generation-preview`, implement the endpoint and connected UI as one workflow, add API/unit/Playwright tests, run all quality commands, inspect the request/response and browser flow, then push or merge only after checks pass.

### Task 11: Add Local PDF Compilation Service

Implement server-side PDF compilation from generated LaTeX. Use a local compiler such as Tectonic and run it in a temporary working directory with strict timeout and captured logs. The service should return the compiled PDF path or a structured compile error.

Implementation must protect against unsafe compiler options and should not enable shell escape. Verify the resulting PDF page count and treat more than one page as a generation failure that can return a structured layout diagnostic. Do not solve overflow by shrinking text below the approved template typography. Tests should include a known-good one-page template, an overflowing two-page document, invalid LaTeX, timeout handling, missing compiler behavior, and cleanup of temporary files. The task is complete when the app can turn generated `.tex` into a PDF locally, enforce the one-page cap, and report actionable failures.

Required workflow: update `main`, create `codex/task-11-pdf-compile-service`, implement compiler wrapper and tests, run all quality commands, verify compilation manually on the sample resume, then push or merge only after checks pass.

### Task 12: Add Browser PDF Preview

Create the UI for previewing the compiled PDF inside the web app. The preview should update after a successful compile and show helpful error output when compilation fails. Users should be able to download the PDF and return to the LaTeX view if they need to inspect source.

Implementation should use the compilation service from Task 11 and avoid duplicating compile logic in the UI. Add Playwright coverage for successful preview, failed compile state, and PDF download availability. The task is complete when the local app feels like an end-to-end resume generator without AI.

Required workflow: update `main`, create `codex/task-12-pdf-preview`, implement preview UI and tests, run all quality commands, manually verify PDF rendering in the browser, then push or merge only after checks pass.

### Task 13: Add AI Provider Interface And Gemini Adapter

Create a provider abstraction that hides the specific AI vendor from the rest of the app. The first implementation should use Gemini through an environment variable API key. The interface should support JD analysis, achievement selection, resume drafting, and LaTeX repair as separate operations.

Implementation should include strict request/response types, a mock provider, and a server-only prompt builder that composes short, versioned instruction modules with typed task inputs. Keep base instructions in source files; load the Jake-style LaTeX template from its dedicated template file at runtime and supply it as a separate request context when needed. Do not paste the full template into a monolithic prompt source file. The model should return validated structured content for the deterministic renderer, rather than owning uncontrolled template structure. Do not wire AI into the main generation flow yet; this task establishes the adapter and prompt-construction boundaries. Tests must cover provider selection, missing API key behavior, mock responses, failed API calls, prompt assembly, and response parsing.

The task is complete when Gemini can be called from isolated server-side code, prompt content is assembled from testable modules and runtime data, and the rest of the app depends only on the generic provider interface.

Required workflow: update `main`, create `codex/task-13-ai-provider-gemini`, add adapter and tests with mocked network calls, document required env vars, run all quality commands, avoid committing secrets, then push or merge only after checks pass.

### Task 14: Add JD Analysis AI Step

Implement the first AI-powered operation: analyzing a JD into structured role signals. The output should include target title, seniority, required and preferred qualifications, responsibilities, tools/platforms, domain concepts, and important ATS terms, while distinguishing explicit requirements from inferred context. This lets the app reason about the JD before selecting resume points.

Implementation must force structured JSON output and validate it with Zod. Capture useful synonyms and equivalent terminology for matching, but do not instruct the model to stuff keywords or claim qualifications. The product goal is truthful relevance and ATS-readable wording, not evading or gaming screening systems. The UI should show the analysis result so the user can inspect what the AI understood. Tests should use the mock provider and cover valid analysis, invalid model output, missing fields, required-versus-preferred distinctions, and retry/error states.

Required workflow: update `main`, create `codex/task-14-jd-analysis`, implement AI operation and tests, run all quality commands, manually test with a sample JD, then push or merge only after checks pass.

### Task 15: Add AI Achievement Selection

Implement AI selection of the most relevant job and project achievement points for the JD. The AI should receive the JD analysis and validated library, compare direct keyword matches and meaning-level evidence, then return selected achievement IDs, section allocation, requirement coverage, confidence, and concise reasoning. Selection should be driven by relevance and available one-page content budget, not a fixed number of bullets per role. A skill absent from the current resume may be selected from the skills library only when the user's data supports it. This task recommends which existing evidence to include; it does not rewrite bullet wording or inject JD keywords into bullet text.

Implementation must validate that every returned ID exists and is enabled. Add fallback behavior when the AI selects too many, too few, or invalid points, while preserving coverage of the strongest requirements. The UI should show selected source points and let the user review the reasoning before drafting. Tests must cover semantic and exact-term matches, missing requirements, invalid IDs, duplicate IDs, disabled points, source diversity, content-budget limits, and mock provider failures. The task is complete when the app can recommend supported content from the library and explain its match to the JD. Keyword-aware rewriting belongs to the drafting tasks below, not this selection operation.

Required workflow: update `main`, create `codex/task-15-ai-achievement-selection`, implement selection logic and tests, run all quality commands, manually review selected sample points against a sample JD, then push or merge only after checks pass.

### Task 16: Add AI Resume Draft Generation

**Problems this task must solve:** Task 15 selects source achievements, but the current handoff does not preserve enough of its reasoning for drafting. Guided Tailor receives the JD, analysis, and selected IDs, yet it does not receive an explicit requirement-to-evidence map or the requirements that remained uncovered. Consequently, selection and drafting behave like separate steps instead of a coordinated workflow: selection can concentrate on one job, omit a relevant project, or miss an indirectly supported requirement; drafting then cannot tell which gaps it should try to address or why a particular source was chosen. For example, a Python/ML requirement may remain uncovered even when the library contains an ML achievement whose source or linked skills support Python. The system must not solve this by inserting unsupported technologies or claiming qualifications the source does not establish.

Implement AI-assisted resume drafting that turns selected points and JD analysis into concise, resume-ready bullets. Define an explicit, structured handoff from analysis and selection into drafting. It must include the active JD identity, requirement IDs and text, each selected achievement's stable ID and source group (job/project/education/credential), the requirement(s) it supports, linked skill evidence, selection rationale or confidence where available, and the requirements still uncovered with the reason they are uncovered (no evidence found, evidence not selected, or uncertain match). Keep this context tied to the exact active JD so stale analysis or another saved JD cannot be mixed into the draft. Guided Tailor must use the handoff to propose wording that naturally reflects supported JD terminology, prioritize relevant unselected evidence only through an explicit user-reviewed add/replace action, and identify requirements that cannot be addressed from available evidence. It must not assume it can silently add points that the user did not select.

Selection should aim for a representative set of relevant evidence across available jobs and projects instead of taking every point from one source group. Where the evidence supports it and the page budget permits, prefer contributions from multiple relevant roles and at least one relevant project; treat the user's example of roughly three or four bullets per relevant job and one or two project bullets as a target to evaluate, not a hard quota. Relevance, evidence strength, user choice, and the fixed one-page budget take precedence over diversity targets. The review must make omitted sources and unresolved requirements visible so users can understand the tradeoff.

The product must offer two clearly separate workflows with distinct controls and state:

- **Guided Tailor:** after the user chooses source achievements, propose JD-aligned rewrites one point at a time. Show the original and proposed wording together, identify relevant JD terms newly reflected in the proposal, explain the evidence behind each change, and let the user accept, reject, or edit each proposal before rendering. Keep the original wording unless the user approves a replacement. Do not silently apply generated text.
- **Auto Tailor:** analyze the JD, select supported source achievements, tailor their wording, and prepare the resume without requiring per-point review or approval. Make this hands-off behavior an explicit mode the user chooses, separate from Guided Tailor; show a clear completion/overflow result and preserve source provenance in the generated output metadata/review data.

In both modes, use only supported facts. Inject JD terminology naturally only when the source evidence supports the same meaning; never append keyword lists, invent qualifications, or inflate the user's experience. The prompt must state the objective, input definitions, matching rules, evidence limits, output schema, section rules, and one-page content budget as distinct labeled instructions. Each request uses the JD and structured resume data; it does not resend the complete filled-in resume LaTeX or the production template source. The AI returns structured resume content and source IDs only, never LaTeX or presentation settings. The deterministic renderer inserts that content into the approved template. The template's font family and size, line and section spacing, margins, bullet spacing, and other presentation settings are locked and must remain unchanged between generations. If content overflows, prioritize or shorten supported content, then report overflow if it still does not fit; never silently alter the approved formatting.

Use an accomplishment pattern informed by career-center guidance: action, specific task or method, and result or impact. Quantify only when a source point provides a metric; when no number is supported, write a concrete qualitative result rather than inventing one. A generated bullet may synthesize multiple existing job or project points, but must cite every supporting point and may not add employers, roles, dates, certificates, metrics, or unsupported skills. Relevant skills omitted from the current resume may be added only from the user's library or evidence.

Define a one-page content budget based on the approved template's fixed section and typography constraints. AI may prioritize, combine, and shorten points to fit, but may not omit required facts silently or change the template's font, spacing, margins, or other presentation settings. Guided Tailor tests must verify the requirement/evidence handoff is scoped to the active JD; selected achievements retain correct source groups and requirement links; unresolved gaps and their reasons survive the handoff; a supported indirect match (for example, an ML achievement with linked Python evidence) can be recognized without fabricating a claim; source-group diversity is preferred only when relevance and budget allow; proposals are displayed beside their exact originals; only user-approved wording reaches the renderer; rejected/unreviewed proposals leave source wording unchanged; and relevant added JD terms remain evidence-supported. Include cases where all evidence comes from one role, a relevant project exists, no relevant project exists, and the page budget prevents the preferred source mix. Auto Tailor tests must verify the explicit hands-off path selects and drafts without per-point approval while enforcing the same evidence, handoff, source-ID, and layout contracts. Both paths must be tested for normal drafts, supported multi-point synthesis, missing or invalid source IDs, fabricated metrics or skills, overlong bullets, budget handling, unsupported sections, stale/mismatched JD analysis, malformed responses, and confirmation that model output cannot change presentation settings. The system must not claim success before PDF page-count validation. Career writing references: [MIT Career Advising & Professional Development](https://capd.mit.edu/resources/career-toolkit-crafting-an-effective-resume/) and [UC San Diego Career Center](https://careers.ucsd.edu/resources/guides/resume.html).

Required workflow: update `main`, create `codex/task-16-ai-resume-draft`, implement drafting and validation with tests, run all quality commands, manually inspect sample output for truthfulness and formatting, then push or merge only after checks pass.

### Task 17: Add LaTeX Validation Layer

Create validation checks for generated LaTeX before compilation. The validator should check required sections, balanced braces where practical, forbidden commands, missing contact block, unsafe LaTeX commands, and obvious template corruption. This reduces compile failures and protects the local environment.

Implementation should run automatically before PDF compilation and return actionable messages. Tests must include valid LaTeX, missing sections, unsafe commands, broken placeholders, special characters, and malformed output. The task is complete when unsafe or structurally broken LaTeX is blocked before reaching the compiler.

Required workflow: update `main`, create `codex/task-17-latex-validation`, implement validator and tests, run all quality commands, manually test bad examples, then push or merge only after checks pass.

### Task 18: Add AI LaTeX Repair Loop

Implement a limited repair loop that sends compile or validation errors back to the AI provider and asks for a corrected version. The loop should have a small maximum attempt count and should preserve the same selected achievements and template structure. The app must show the user when a repair was needed.

Implementation should include structured repair prompts, error log trimming, retry limits, and failure reporting when repair cannot fix the document. Preserve the selected evidence and one-page cap during repair. If compilation reports multiple pages, first reduce lower-ranked content or tighten wording within supported facts; do not silently shrink typography or drop essential evidence. Tests must cover successful first compile, repair after validation error, repair after compile error, page overflow, repeated failure, and no infinite retries. The task is complete when common LaTeX and layout issues can be fixed without hiding serious failures or exceeding one page.

Required workflow: update `main`, create `codex/task-18-latex-repair-loop`, implement repair orchestration and tests, run all quality commands, manually test with intentionally broken LaTeX, then push or merge only after checks pass.

### Task 19: Build The Review Workspace And Manual Overrides

Create the main review workspace as the point where the AI-assisted flow becomes understandable and correctable. Provide separate, clearly labeled **Guided Tailor** and **Auto Tailor** entry points; do not collapse them into one ambiguous generation button. Guided Tailor must make per-point comparison, term/evidence rationale, accept/reject/edit, and regeneration straightforward, with the original text always recoverable. Auto Tailor must communicate that point selection and wording happen without per-point approval, then present the completed result and any overflow or validation errors. Show the JD analysis, selected source achievements, generated resume content, LaTeX, and PDF preview together. For each generated bullet, show its source achievement IDs and enough source context to inspect them, especially when it synthesizes multiple points.

In this same workspace, let the user include or exclude generated bullets, reorder bullets within a job or project, and choose whether projects or credentials appear. Apply overrides to generation state and refresh the LaTeX/PDF without losing the review context. Provide loading, error, and completed states for each stage. Playwright tests should cover the mocked happy path, source-ID visibility for synthesized bullets, AI/compile failures, include/exclude, reorder, section toggles, and regeneration after edits. The task is complete when users can audit and correct the generated resume before exporting it.

Required workflow: update `main`, create `codex/task-19-review-and-overrides`, implement the review screen and correction controls together, add unit and Playwright coverage, run all quality commands, manually inspect the full flow, then push or merge only after checks pass.

### Task 20: Add Export Package

Implement export actions for the final `.tex`, `.pdf`, and generation metadata. Metadata should include JD title/company, timestamp, selected achievement IDs, AI provider name, and validation/repair status. This makes each generated resume reproducible later.

Implementation should provide clear file names and avoid leaking API keys or internal logs into exported metadata. Tests must cover export file naming, metadata shape, missing PDF behavior, and generated content availability. The task is complete when a user can save everything needed to understand or reproduce a resume generation.

Required workflow: update `main`, create `codex/task-20-export-package`, implement export logic and tests, run all quality commands, manually verify downloaded files, then push or merge only after checks pass.

### Task 21: Add Local Generation History

Store generation history locally so the user can revisit previous outputs. Each history item should include company, role, date, selected achievement IDs, generated LaTeX path or content reference, PDF reference, provider used, and final status. The history should be searchable and safe to delete.

Implementation should use JSON storage for v1 and validate history entries with the same schema discipline as other data. Tests must cover saving history, loading history, corrupted history handling, deleting an entry, and opening a previous generation. The task is complete when users do not lose previous resume versions between sessions.

Required workflow: update `main`, create `codex/task-21-generation-history`, implement history storage/UI/tests, run all quality commands, manually verify persistence across app reloads, then push or merge only after checks pass.

### Task 22: Expand Unit And Integration Test Coverage

Review the codebase and add missing tests for critical logic built so far. This task is intentionally focused on quality rather than new features. Areas to prioritize are schema validation, file loaders, template rendering, AI response validation, compiler handling, and generation orchestration.

Implementation should identify risky untested modules and add tests that catch regressions before future UI polish begins. Update test utilities and fixtures if they make the suite easier to maintain. The task is complete when core business logic has meaningful coverage and the test suite is stable enough for CI.

Required workflow: update `main`, create `codex/task-22-test-coverage`, add tests only unless a small bug fix is required to make tests pass, run all quality commands, inspect coverage output if configured, then push or merge only after checks pass.

### Task 23: Add Playwright End-To-End Coverage

Create browser-level tests for the most important user flows. These should use mocked AI responses so the tests are reliable and do not consume API credits. Cover entering a JD, viewing JD analysis, reviewing selected achievements, generating LaTeX, compiling PDF, applying manual overrides, and exporting output.

Implementation should make tests deterministic with stable fixtures and isolated local data. Add CI-friendly Playwright configuration and avoid relying on real external APIs. The task is complete when the main user journey is protected by automated browser tests.

Required workflow: update `main`, create `codex/task-23-playwright-e2e`, implement E2E tests and fixtures, run all quality commands including Playwright, review failure screenshots if any, then push or merge only after checks pass.

### Task 24: Add CI Pipeline

Create the continuous integration pipeline for the repository. The CI should install dependencies, check formatting if configured, lint, typecheck, run unit/integration tests, and run Playwright smoke tests. It should fail fast on broken code and give clear logs.

Implementation should use GitHub Actions unless the repo later chooses another platform. Cache dependencies where appropriate, but keep the workflow easy to understand. The live integration workflow should run the Gemini API smoke test with a repository secret and the real Tectonic/pdfinfo tests on pull requests; missing credentials or tools must fail rather than silently skip. Configure these named checks as required branch-protection checks. The task is complete when every PR gets automatic quality feedback before merge.

Required workflow: update `main`, create `codex/task-24-ci-pipeline`, add CI config and any needed scripts, run the same commands locally first, push the branch, confirm CI runs successfully, then merge only after checks pass.

### Task 25: Add Setup Guide For Real Gemini Usage And Future DeepSeek Support

Write the final v1 setup guide for configuring the Gemini API key, running the app, compiling PDFs, and understanding cost/token behavior. Include a short explanation of how to switch to another provider later, especially DeepSeek, through the provider interface. This task should make the project usable by the owner without reading source code.

Implementation should document environment variables, local compiler installation, troubleshooting common API errors, missing compiler errors, and how to keep private resume data out of Git. Add a sample `.env.example` without secrets. The task is complete when a user can set up the real app locally and generate a resume from their own data.

Required workflow: update `main`, create `codex/task-25-setup-provider-docs`, add docs and sample env files only, run all quality commands, manually follow the setup guide on a clean checkout if possible, then push or merge only after checks pass.

## 6. Definition Of Done For V1

The v1 application is complete when a user can run the app locally, paste a JD, load their JSON achievement library, ask Gemini to select relevant points, review and override the selection, generate Jake-style LaTeX, compile a PDF, preview it, export the result, and find the generation later in local history. The system must preserve truthfulness by grounding every generated bullet in selected achievement IDs and must provide tests around the important business logic.

## 7. Important Product Rules

- The AI must not invent new jobs or projects, companies, dates, metrics, certificates, or unsupported facts. It may draft new job or project resume points by combining or reframing existing achievement points against the JD; every new point must remain traceable to its supporting source IDs. It may add JD-relevant skills that are absent from the current resume when they are supported by the user's skills data or demonstrated achievements; a keyword appearing in the JD alone is not evidence that the user has that skill.
- The final resume should stay close to the provided Jake-style structure.
- JSON is the source of truth for v1.
- The app should be local-first until the owner explicitly decides to deploy it.
- Gemini is the first provider, but the code should not be hardwired to Gemini everywhere.
- Every new feature must include tests in the same task that creates the feature.
- The project should grow task by task, not through one large uncontrolled implementation.

## 8. Future Feature Plan

These ideas are outside v1 and should be considered only after the 25 planned tasks are complete and reviewed.

### Achievement Point Quality Score And Suggestions

Add an optional quality review for each achievement point. A transparent backend calculation should assess useful writing signals such as clarity, action, specificity, relevance to the target role, and whether a concrete outcome or supported metric is present, then show an understandable score with targeted suggestions for improving the point. Suggestions may help the user make a point clearer or more relevant, but must not fabricate responsibilities, skills, metrics, or outcomes; any suggested factual detail must be confirmed by the user before it is used. Treat the score as writing guidance, not a prediction of ATS ranking, hiring decisions, or guaranteed resume performance.

### Import An Existing Resume PDF

Add a website flow that accepts a user's existing resume PDF, extracts its text and section structure, and helps convert the content into the app's profile, education, work, project, skill, credential, and achievement records. For Jake-style input, inspect the visual layout and identify reusable template characteristics so the user can keep their preferred format. Show extracted content for user correction before saving; never treat OCR or parsing output as verified facts without review.

Keep the original PDF and imported data private. Local cache/storage is the initial option consistent with v1. Firebase or another signed-in cloud store is an unresolved future architecture choice, not a commitment; decide it only after defining authentication, data ownership, encryption, deletion, and migration requirements.

### Resume Template Import And Conversion

Explore converting an uploaded resume into editable LaTeX and preserving the selected Jake-style template as a reusable user template. Evaluate parser accuracy, visual comparison, unsupported layouts, and user correction before choosing whether to generate LaTeX directly or map the PDF into the existing deterministic template. Keep this feature separate from the core generation prompt: load an approved template at runtime through the prompt builder only when model context is needed.

### Saved Job Description Library

Allow users to save multiple job descriptions locally and revisit them without losing the current draft. Each entry should keep its company, role title, optional job URL, description, created/updated timestamps, and any cached analysis tied to that exact entry. Selecting an entry must load exactly one active JD and its matching analysis; never combine descriptions or reuse an analysis belonging to another JD. Provide search or filtering, clear active-state indication, safe rename/delete actions, and a readable detail view.

Explore a compact vertical edge rail with a wave-like progress/selection animation based on the supplied visual reference. The rail should make saved JDs easy to scan and move between, then open the selected description in a well-fitted detail panel. Adapt the visual treatment to Resume Changer rather than copying unrelated product chrome. Support keyboard and touch navigation, tooltips or labels where needed, and reduced-motion preferences. Store descriptions locally for v1 and make clear that they remain in this browser. This is separate from Task 21's history of generated resume outputs.

### ATS Readiness Review

Add an optional post-generation review that checks the final resume content for practical ATS-readability signals: expected sections and contact details, readable text extraction from the PDF, relevant JD terminology supported by the resume, and common parsing or layout risks. Show a transparent summary with specific items to inspect or improve; let the user decide whether to change the resume. Do not promise ATS passage, ranking, interviews, or hiring outcomes, and do not encourage keyword stuffing or unsupported claims. Test the review against known-good and intentionally problematic LaTeX/PDF fixtures, including cases where a term is absent because the user's evidence does not support it.

## Task 16 output-quality follow-up

Implementation is tracked in [the output-quality plan](../plan.md). Selection and
drafting must retain structured metrics and source context, support related
multi-point synthesis, rank job evidence above projects and declared skills, and
allow one substantial bullet to cover several requirements. Bullet counts per
role are preferences, never hard caps. Disclosed compatible-framework inferences
are allowed when a concrete method and a declared framework support the inference;
they remain distinguishable from confirmed project history. Validation must
prevent information loss as well as invented metrics. Use visible content word
counts for estimates and actual PDF text bounds for one-page filling, with fixed
typography and globally ranked mixed skills rows. Every behavior requires tests.
