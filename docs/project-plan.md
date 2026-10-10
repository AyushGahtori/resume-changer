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

Implement server-side utilities that load local JSON files, validate them with the schemas, and return typed data or clear validation errors. These utilities are the only layer that should read raw data files directly, so later features do not duplicate parsing logic. The goal is to make local JSON storage feel reliable even before a database exists.

Implementation should include functions for loading profile data, achievement data, template metadata, and generation history. Tests must cover valid files, malformed JSON, missing files, schema failures, duplicate IDs, and friendly error formatting. The task is complete when all app code can depend on typed loader results instead of raw JSON imports.

Required workflow: update `main`, create `codex/task-05-data-loaders`, implement utilities with tests in the appropriate test folder, run lint/typecheck/unit tests, review edge cases, then push or merge only after checks pass.

### Task 06: Create The Application Shell

Build the first real UI shell with a restrained, work-focused layout. The app should have navigation for JD input, achievement library, resume generation, history, and settings. This task should not implement the full behavior of those pages yet; it should create the structure that later tasks will fill in.

The UI should feel like a productivity tool, not a landing page. Use a sidebar or top navigation, a main workspace area, responsive layout behavior, and simple empty states. Add a Playwright smoke test that confirms the app loads and the main navigation destinations are reachable. The task is complete when users can move around the skeleton app cleanly on desktop and mobile.

Required workflow: update `main`, create `codex/task-06-app-shell`, implement only layout/navigation/empty states, add unit or Playwright tests for navigation, run all quality commands, visually inspect the app, then push or merge only after checks pass.

### Task 07: Add JD Input Workspace

Create the page where the user pastes a job description. The page should support a large text area, company name, role title, optional job link, and local draft persistence. It should also show basic stats such as character count and estimated token count so the user understands how large the input is.

Implementation should keep the JD state local-first and avoid calling AI yet. Add validation for empty JD text and overly large inputs. Tests should cover text entry, draft persistence, clearing the JD, and validation messages. The task is complete when a user can reliably enter and save the JD context that later generation tasks will consume.

Required workflow: update `main`, create `codex/task-07-jd-input`, implement the JD page and tests, run lint/typecheck/unit tests/Playwright tests, inspect form behavior manually, then push or merge only after checks pass.

### Task 08: Add Achievement Library Viewer

Build a read-only UI for browsing the Achievement Points Hashmap. The viewer should group points by jobs, projects, certificates/licenses, and skills. It should show enough detail for the user to understand what each point is about without editing anything yet.

Implementation should load validated sample data through the data loader layer and render schema errors clearly if the JSON is invalid. The viewer should display point IDs, source names, tags, skills, and enabled/disabled status. Tests should cover grouped rendering, empty groups, invalid data state, and responsive layout. The task is complete when the user can inspect the achievement library visually.

Required workflow: update `main`, create `codex/task-08-achievement-viewer`, implement read-only display and tests, run all quality commands, manually inspect sample data rendering, then push or merge only after checks pass.

### Task 09: Add Achievement Search And Filters

Implement search and filtering for the achievement library. A new engineer doing this task should add text search across point text, tags, skills, job names, project names, and certificate names. Filters should include source type, enabled status, skill, tag, and job/project source.

The goal is to help users quickly find which points may match a JD before AI selection exists. The UI should update results immediately, show active filters, and provide a clear reset action. Tests must cover search matching, no-result states, combined filters, reset behavior, and stable result ordering. The task is complete when a user can narrow hundreds of achievement points without touching JSON manually.

Required workflow: update `main`, create `codex/task-09-achievement-search`, add pure filter/search functions with unit tests, connect them to the UI, add Playwright coverage for common filter flows, run all quality commands, review UX on desktop/mobile, then push or merge only after checks pass.

### Task 10: Add Local Achievement Editing

Create an editing experience for adding and updating achievement points in the local JSON-backed library. The editor should allow changing text, tags, skills, metrics, enabled status, and source assignment. It must validate changes before saving and show friendly errors instead of corrupting the data file.

Implementation should use server-side write actions or API routes with schema validation. The task should include a backup or safe-write strategy so failed saves do not destroy existing data. Tests must cover successful edits, validation failures, duplicate IDs, cancelled edits, and persistence after reload. The task is complete when users can maintain their achievement library from the app.

Required workflow: update `main`, create `codex/task-10-achievement-editing`, implement safe local editing with tests, run all quality commands, manually test save/reload/error cases, then push or merge only after checks pass.

### Task 11: Add Jake-Style LaTeX Template

Add the base Jake-style resume template as a local template file with controlled placeholders for contact details, education, experience, projects, skills, and certificates. The template must preserve the compact single-page resume style and avoid AI-generated structural drift. This is where the app establishes the resume format that all later generation must respect.

Implementation should separate template structure from resume content so the AI does not need to write boilerplate every time. Add tests that render the template with known data and verify required sections exist. The task is complete when the app can generate deterministic LaTeX from structured data without using AI.

Required workflow: update `main`, create `codex/task-11-latex-template`, add the template and rendering tests, run lint/typecheck/unit tests, inspect rendered LaTeX manually, then push or merge only after checks pass.

### Task 12: Build Deterministic Resume Renderer

Implement a non-AI renderer that takes selected achievement IDs and structured profile data, then produces a complete LaTeX resume. This creates a reliable baseline before AI is introduced. The renderer should handle section ordering, bullet escaping, skill grouping, and missing optional sections.

Implementation should expose a typed function such as `renderResumeLatex(input)` and keep all string escaping centralized. Tests must cover normal rendering, empty optional sections, LaTeX special characters, unknown achievement IDs, disabled points, and stable output snapshots where useful. The task is complete when the app can produce valid `.tex` from manually selected points.

Required workflow: update `main`, create `codex/task-12-deterministic-renderer`, implement renderer utilities and tests, run all quality commands, review sample output, then push or merge only after checks pass.

### Task 13: Add Manual Resume Generation Endpoint

Create a server endpoint that accepts JD metadata and manually selected achievement IDs, then returns generated LaTeX using the deterministic renderer. This endpoint becomes the first backend contract between the UI and resume generation system. It should not call AI yet.

Implementation must validate request payloads, reject unknown IDs, return structured errors, and include basic generation metadata. Add API route tests for success, invalid payloads, missing data, and renderer failures. The task is complete when the frontend can request LaTeX from selected local data through a stable API.

Required workflow: update `main`, create `codex/task-13-manual-generation-api`, add API route and tests, run lint/typecheck/unit/integration tests, inspect request/response contracts, then push or merge only after checks pass.

### Task 14: Add LaTeX Preview And Download UI

Build the UI that displays generated LaTeX and lets the user download it as a `.tex` file. The page should connect the JD input, achievement selection, and manual generation endpoint. It should show loading states, error states, and a clear copy/download action.

Implementation should keep the first version simple: no PDF compile yet, only LaTeX output. Tests should cover generating from selected points, displaying errors, copying or downloading output, and preserving selected IDs. The task is complete when users can manually select points and export a complete LaTeX resume.

Required workflow: update `main`, create `codex/task-14-latex-preview-download`, implement UI and tests, run all quality commands, manually test the browser flow, then push or merge only after checks pass.

### Task 15: Add Local PDF Compilation Service

Implement server-side PDF compilation from generated LaTeX. Use a local compiler such as Tectonic and run it in a temporary working directory with strict timeout and captured logs. The service should return the compiled PDF path or a structured compile error.

Implementation must protect against unsafe compiler options and should not enable shell escape. Verify the resulting PDF page count and treat more than one page as a generation failure that can return a structured layout diagnostic. Do not solve overflow by shrinking text below the approved template typography. Tests should include a known-good one-page template, an overflowing two-page document, invalid LaTeX, timeout handling, missing compiler behavior, and cleanup of temporary files. The task is complete when the app can turn generated `.tex` into a PDF locally, enforce the one-page cap, and report actionable failures.

Required workflow: update `main`, create `codex/task-15-pdf-compile-service`, implement compiler wrapper and tests, run all quality commands, verify compilation manually on the sample resume, then push or merge only after checks pass.

### Task 16: Add Browser PDF Preview

Create the UI for previewing the compiled PDF inside the web app. The preview should update after a successful compile and show helpful error output when compilation fails. Users should be able to download the PDF and return to the LaTeX view if they need to inspect source.

Implementation should use the compilation service from Task 15 and avoid duplicating compile logic in the UI. Add Playwright coverage for successful preview, failed compile state, and PDF download availability. The task is complete when the local app feels like an end-to-end resume generator without AI.

Required workflow: update `main`, create `codex/task-16-pdf-preview`, implement preview UI and tests, run all quality commands, manually verify PDF rendering in the browser, then push or merge only after checks pass.

### Task 17: Add AI Provider Interface And Gemini Adapter

Create a provider abstraction that hides the specific AI vendor from the rest of the app. The first implementation should use Gemini through an environment variable API key. The interface should support JD analysis, achievement selection, resume drafting, and LaTeX repair as separate operations.

Implementation should include strict request/response types, a mock provider, and a server-only prompt builder that composes short, versioned instruction modules with typed task inputs. Keep base instructions in source files; load the Jake-style LaTeX template from its dedicated template file at runtime and supply it as a separate request context when needed. Do not paste the full template into a monolithic prompt source file. The model should return validated structured content for the deterministic renderer, rather than owning uncontrolled template structure. Do not wire AI into the main generation flow yet; this task establishes the adapter and prompt-construction boundaries. Tests must cover provider selection, missing API key behavior, mock responses, failed API calls, prompt assembly, and response parsing.

The task is complete when Gemini can be called from isolated server-side code, prompt content is assembled from testable modules and runtime data, and the rest of the app depends only on the generic provider interface.

Required workflow: update `main`, create `codex/task-17-ai-provider-gemini`, add adapter and tests with mocked network calls, document required env vars, run all quality commands, avoid committing secrets, then push or merge only after checks pass.

### Task 18: Add JD Analysis AI Step

Implement the first AI-powered operation: analyzing a JD into structured role signals. The output should include target title, seniority, required and preferred qualifications, responsibilities, tools/platforms, domain concepts, and important ATS terms, while distinguishing explicit requirements from inferred context. This lets the app reason about the JD before selecting resume points.

Implementation must force structured JSON output and validate it with Zod. Capture useful synonyms and equivalent terminology for matching, but do not instruct the model to stuff keywords or claim qualifications. The product goal is truthful relevance and ATS-readable wording, not evading or gaming screening systems. The UI should show the analysis result so the user can inspect what the AI understood. Tests should use the mock provider and cover valid analysis, invalid model output, missing fields, required-versus-preferred distinctions, and retry/error states.

Required workflow: update `main`, create `codex/task-18-jd-analysis`, implement AI operation and tests, run all quality commands, manually test with a sample JD, then push or merge only after checks pass.

### Task 19: Add AI Achievement Selection

Implement AI selection of the most relevant job and project achievement points for the JD. The AI should receive the JD analysis and validated library, compare direct keyword matches and meaning-level evidence, then return selected achievement IDs, section allocation, requirement coverage, confidence, and concise reasoning. Selection should be driven by relevance and available one-page content budget, not a fixed number of bullets per role. A skill absent from the current resume may be selected from the skills library only when the user's data supports it.

Implementation must validate that every returned ID exists and is enabled. Add fallback behavior when the AI selects too many, too few, or invalid points, while preserving coverage of the strongest requirements. The UI should show selected source points and let the user review the reasoning before drafting. Tests must cover semantic and exact-term matches, missing requirements, invalid IDs, duplicate IDs, disabled points, source diversity, content-budget limits, and mock provider failures. The task is complete when the app can recommend supported content from the library and explain its match to the JD.

Required workflow: update `main`, create `codex/task-19-ai-achievement-selection`, implement selection logic and tests, run all quality commands, manually review selected sample points against a sample JD, then push or merge only after checks pass.

### Task 20: Add AI Resume Draft Generation

Implement AI-assisted resume drafting that turns selected points and JD analysis into concise, resume-ready bullets. The prompt must state the objective, input definitions, matching rules, evidence limits, output schema, section rules, and one-page content budget as distinct labeled instructions. It should improve truthful JD alignment and machine readability without promising to bypass ATS or stuffing unrelated terms. The Jake-style template is loaded by the prompt builder at runtime as a separate context input; the AI returns structured content and source IDs, and the deterministic renderer produces the final LaTeX.

Use an accomplishment pattern informed by career-center guidance: action, specific task or method, and result or impact. Quantify only when a source point provides a metric; when no number is supported, write a concrete qualitative result rather than inventing one. A generated bullet may synthesize multiple existing job or project points, but must cite every supporting point and may not add employers, roles, dates, certificates, metrics, or unsupported skills. Relevant skills omitted from the current resume may be added only from the user's library or evidence.

Define a one-page content budget based on the actual template's section and typography constraints. AI may prioritize, combine, and shorten points to fit, but may not omit required facts silently, alter the template's font to an unreadable size, or claim success before PDF page-count validation. Tests must cover normal drafts, supported multi-point synthesis, missing or invalid source IDs, fabricated metrics or skills, overlong bullets, budget handling, unsupported sections, and malformed responses. Career writing references: [MIT Career Advising & Professional Development](https://capd.mit.edu/resources/career-toolkit-crafting-an-effective-resume/) and [UC San Diego Career Center](https://careers.ucsd.edu/resources/guides/resume.html).

Required workflow: update `main`, create `codex/task-20-ai-resume-draft`, implement drafting and validation with tests, run all quality commands, manually inspect sample output for truthfulness and formatting, then push or merge only after checks pass.

### Task 21: Add LaTeX Validation Layer

Create validation checks for generated LaTeX before compilation. The validator should check required sections, balanced braces where practical, forbidden commands, missing contact block, unsafe LaTeX commands, and obvious template corruption. This reduces compile failures and protects the local environment.

Implementation should run automatically before PDF compilation and return actionable messages. Tests must include valid LaTeX, missing sections, unsafe commands, broken placeholders, special characters, and malformed output. The task is complete when unsafe or structurally broken LaTeX is blocked before reaching the compiler.

Required workflow: update `main`, create `codex/task-21-latex-validation`, implement validator and tests, run all quality commands, manually test bad examples, then push or merge only after checks pass.

### Task 22: Add AI LaTeX Repair Loop

Implement a limited repair loop that sends compile or validation errors back to the AI provider and asks for a corrected version. The loop should have a small maximum attempt count and should preserve the same selected achievements and template structure. The app must show the user when a repair was needed.

Implementation should include structured repair prompts, error log trimming, retry limits, and failure reporting when repair cannot fix the document. Preserve the selected evidence and one-page cap during repair. If compilation reports multiple pages, first reduce lower-ranked content or tighten wording within supported facts; do not silently shrink typography or drop essential evidence. Tests must cover successful first compile, repair after validation error, repair after compile error, page overflow, repeated failure, and no infinite retries. The task is complete when common LaTeX and layout issues can be fixed without hiding serious failures or exceeding one page.

Required workflow: update `main`, create `codex/task-22-latex-repair-loop`, implement repair orchestration and tests, run all quality commands, manually test with intentionally broken LaTeX, then push or merge only after checks pass.

### Task 23: Build The End-To-End Review Workspace

Create a review screen that shows the JD analysis, selected achievement points, generated resume content, LaTeX source, and PDF preview in one workflow. For every generated bullet, show the source achievement IDs (and enough source context to inspect them), especially when a bullet synthesizes multiple points. The user should be able to understand why the resume was generated the way it was before exporting it. This is the main working screen of the product.

Implementation should organize information clearly without heavy decoration. The screen should support loading, error, and completed states for each generation step. Playwright tests should cover the happy path with a mocked provider, source-ID visibility for synthesized bullets, and the failure path for AI or compile errors. The task is complete when the app has a coherent JD-to-PDF workflow and the user can audit generated claims back to their source data.

Required workflow: update `main`, create `codex/task-23-review-workspace`, implement workflow UI and tests, run all quality commands, manually inspect the full flow, then push or merge only after checks pass.

### Task 24: Add Manual Override Controls

Allow the user to override AI decisions before final PDF generation. The user should be able to include or exclude selected bullets, reorder bullets inside a job/project, and choose whether certificates or projects appear in the final resume. This keeps the AI helpful but not fully in control.

Implementation should update the generation input state and rerender LaTeX/PDF after changes. Tests must cover include/exclude behavior, reorder behavior, regeneration after overrides, and persistence while staying on the page. The task is complete when the user can correct AI selection without editing JSON manually.

Required workflow: update `main`, create `codex/task-24-manual-overrides`, implement controls and tests, run all quality commands, manually test override flows, then push or merge only after checks pass.

### Task 25: Add Export Package

Implement export actions for the final `.tex`, `.pdf`, and generation metadata. Metadata should include JD title/company, timestamp, selected achievement IDs, AI provider name, and validation/repair status. This makes each generated resume reproducible later.

Implementation should provide clear file names and avoid leaking API keys or internal logs into exported metadata. Tests must cover export file naming, metadata shape, missing PDF behavior, and generated content availability. The task is complete when a user can save everything needed to understand or reproduce a resume generation.

Required workflow: update `main`, create `codex/task-25-export-package`, implement export logic and tests, run all quality commands, manually verify downloaded files, then push or merge only after checks pass.

### Task 26: Add Local Generation History

Store generation history locally so the user can revisit previous outputs. Each history item should include company, role, date, selected achievement IDs, generated LaTeX path or content reference, PDF reference, provider used, and final status. The history should be searchable and safe to delete.

Implementation should use JSON storage for v1 and validate history entries with the same schema discipline as other data. Tests must cover saving history, loading history, corrupted history handling, deleting an entry, and opening a previous generation. The task is complete when users do not lose previous resume versions between sessions.

Required workflow: update `main`, create `codex/task-26-generation-history`, implement history storage/UI/tests, run all quality commands, manually verify persistence across app reloads, then push or merge only after checks pass.

### Task 27: Expand Unit And Integration Test Coverage

Review the codebase and add missing tests for critical logic built so far. This task is intentionally focused on quality rather than new features. Areas to prioritize are schema validation, file loaders, template rendering, AI response validation, compiler handling, and generation orchestration.

Implementation should identify risky untested modules and add tests that catch regressions before future UI polish begins. Update test utilities and fixtures if they make the suite easier to maintain. The task is complete when core business logic has meaningful coverage and the test suite is stable enough for CI.

Required workflow: update `main`, create `codex/task-27-test-coverage`, add tests only unless a small bug fix is required to make tests pass, run all quality commands, inspect coverage output if configured, then push or merge only after checks pass.

### Task 28: Add Playwright End-To-End Coverage

Create browser-level tests for the most important user flows. These should use mocked AI responses so the tests are reliable and do not consume API credits. Cover entering a JD, viewing JD analysis, reviewing selected achievements, generating LaTeX, compiling PDF, applying manual overrides, and exporting output.

Implementation should make tests deterministic with stable fixtures and isolated local data. Add CI-friendly Playwright configuration and avoid relying on real external APIs. The task is complete when the main user journey is protected by automated browser tests.

Required workflow: update `main`, create `codex/task-28-playwright-e2e`, implement E2E tests and fixtures, run all quality commands including Playwright, review failure screenshots if any, then push or merge only after checks pass.

### Task 29: Add CI Pipeline

Create the continuous integration pipeline for the repository. The CI should install dependencies, check formatting if configured, lint, typecheck, run unit/integration tests, and run Playwright smoke tests. It should fail fast on broken code and give clear logs.

Implementation should use GitHub Actions unless the repo later chooses another platform. Cache dependencies where appropriate, but keep the workflow easy to understand. The task is complete when every PR gets automatic quality feedback before merge.

Required workflow: update `main`, create `codex/task-29-ci-pipeline`, add CI config and any needed scripts, run the same commands locally first, push the branch, confirm CI runs successfully, then merge only after checks pass.

### Task 30: Add Setup Guide For Real Gemini Usage And Future DeepSeek Support

Write the final v1 setup guide for configuring the Gemini API key, running the app, compiling PDFs, and understanding cost/token behavior. Include a short explanation of how to switch to another provider later, especially DeepSeek, through the provider interface. This task should make the project usable by the owner without reading source code.

Implementation should document environment variables, local compiler installation, troubleshooting common API errors, missing compiler errors, and how to keep private resume data out of Git. Add a sample `.env.example` without secrets. The task is complete when a user can set up the real app locally and generate a resume from their own data.

Required workflow: update `main`, create `codex/task-30-setup-provider-docs`, add docs and sample env files only, run all quality commands, manually follow the setup guide on a clean checkout if possible, then push or merge only after checks pass.

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

These ideas are outside v1 and should be considered only after the 30 planned tasks are complete and reviewed.

### Import An Existing Resume PDF

Add a website flow that accepts a user's existing resume PDF, extracts its text and section structure, and helps convert the content into the app's profile, education, work, project, skill, credential, and achievement records. For Jake-style input, inspect the visual layout and identify reusable template characteristics so the user can keep their preferred format. Show extracted content for user correction before saving; never treat OCR or parsing output as verified facts without review.

Keep the original PDF and imported data private. Local cache/storage is the initial option consistent with v1. Firebase or another signed-in cloud store is an unresolved future architecture choice, not a commitment; decide it only after defining authentication, data ownership, encryption, deletion, and migration requirements.

### Resume Template Import And Conversion

Explore converting an uploaded resume into editable LaTeX and preserving the selected Jake-style template as a reusable user template. Evaluate parser accuracy, visual comparison, unsupported layouts, and user correction before choosing whether to generate LaTeX directly or map the PDF into the existing deterministic template. Keep this feature separate from the core generation prompt: load an approved template at runtime through the prompt builder only when model context is needed.
