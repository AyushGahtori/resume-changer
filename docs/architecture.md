# Architecture Overview

## Product Shape

Resume Changer is planned as a local-first web application for preparing a resume against one job description at a time. The user supplies a JD and a reusable library of verified experience. The app helps select and phrase the most relevant material while keeping the user in control of the final resume.

The current repository is the initial Next.js shell. The components below describe the intended v1 architecture; later roadmap tasks add these capabilities incrementally.

## Main Components

- **Web application:** Next.js App Router with TypeScript and Tailwind CSS. Pages and UI state live in the frontend; server-only work belongs in route handlers or server actions.
- **Validated data layer:** JSON files are the planned v1 source of truth. Zod schemas will validate profile, joint-university education, jobs, projects, skills, credentials, achievement points, resume preferences, history, and AI response contracts before application code uses them. Keep the tracked fictional example at `examples/sample-resume-library.json` separate from the owner's ignored `/data/resume-library.json`; local development uses the personal library by default, while demo mode is explicit and automated tests always use synthetic fixtures.
- **Achievement library:** Stable IDs connect each achievement point to its source job or project. Skills are stored independently from whether they appear on the current resume; skill claims can link to achievement evidence. Optional metrics retain source evidence and are omitted when no supported number exists.
- **AI provider boundary:** A provider interface keeps JD analysis, achievement selection, resume drafting, and limited LaTeX repair independent from a specific vendor. Gemini is the first planned adapter; tests should use a mock provider rather than real paid API calls.
- **Prompt builder:** Server-only, versioned prompt modules combine the relevant instruction set, typed task data, and approved template context at request time. The full LaTeX template lives in its own file and is loaded by a helper; it is not duplicated inside a long base prompt. The model returns structured content for the deterministic renderer.
- **Resume renderer:** A deterministic renderer places validated structured content into a controlled Jake-style LaTeX template. It owns section order, text escaping, and template structure.
- **PDF compiler:** A local compiler such as Tectonic is planned to run server-side in a temporary directory with timeouts and captured diagnostics. Shell escape should remain disabled. The compiled PDF is checked to contain exactly one page; overflow is returned as a structured layout error.
- **Local outputs and history:** Generated LaTeX, PDFs, and history are planned to remain on the user's machine in the first version.

## Intended Data Flow

```text
Job description + validated achievement library
                    |
                    v
       JD analysis and requirement signals
                    |
                    v
    Prompt builder + runtime template context
                    |
                    v
        Select evidence IDs within budget
                    |
                    v
       User review and manual adjustments
                    |
                    v
    Structured resume content -> LaTeX renderer
                    |
                    v
         Validate -> compile -> preview/export
```

Every generated resume bullet should point back to one or more selected achievement IDs. Reject or flag selections that do not exist in the validated library or are disabled. Treat model output as untrusted input: validate its structure, escape text for LaTeX, and never pass model-provided shell commands to the compiler.

## Tailoring Prompt Contract

Use a small set of versioned, task-specific instruction modules rather than one opaque thousand-line prompt. Assemble each request from clearly labeled parts: objective, input definitions, JD requirements, achievement evidence, matching and prioritization rules, truth constraints, output schema, and layout budget. Keep reusable policy in code and inject the current JD, selected source points, user skill library, and template as separate runtime data.

The matching flow should:

1. Separate explicit required qualifications from preferred qualifications and contextual terms in the JD.
2. Match achievement points by both meaning and terminology, including valid synonyms; rank the strength of evidence instead of rewarding keyword repetition alone.
3. Choose the most relevant combination of job and project points for the role and available page space. There is no fixed number of bullets per job.
4. Allow a generated bullet to combine or reframe several selected source points, while returning every source ID used.
5. Add a JD-relevant skill that is absent from the current resume only when it is present in the user's skills library or evidenced by their achievements. The JD alone is not evidence that the user has a skill.
6. Preserve employers, titles, dates, projects, metrics, and certificates as supplied. Never invent a percentage to make a bullet sound stronger; if a source has no metric, use a concrete qualitative result or describe the work clearly.

Resume bullets should generally communicate an action, a specific task or method, and a result or impact. Quantification is useful when it is available and supportable, but should not be forced into every bullet. See the [MIT resume guidance](https://capd.mit.edu/resources/career-toolkit-crafting-an-effective-resume/) and the [UC San Diego bullet-point guidance](https://careers.ucsd.edu/resources/guides/resume.html).

The goal is truthful relevance and clear machine-readable structure so ATS systems and people can identify qualifications. Do not frame the product as bypassing screening systems, and do not keyword-stuff unrelated skills. The user reviews selections and generated wording before export.

## One-Page Enforcement

One page is a hard v1 limit. The resume data carries `maxPages: 1`, and the prompt receives a content budget derived from the approved template's sections and typography. The AI can select fewer points, combine supported evidence, and shorten wording to fit, but it does not decide whether the PDF fits. After deterministic rendering, the PDF compiler measures page count; anything above one page returns a structured overflow error. A retry can trim lower-ranked content or tighten phrasing while preserving sources. Do not shrink type below the template's readable minimum or silently discard key evidence to claim compliance.

## Resume PDF Import (Future)

After v1, a user may upload an existing resume PDF for text/layout extraction, review, and mapping into the validated profile and achievement library. Extraction must remain a draft until the user confirms the facts. Converting the PDF into editable LaTeX and storing imported templates locally or in a future authenticated Firebase/cloud store are open design choices, not v1 commitments.

## Key Decisions

- **Local-first v1:** Keep resume data, JDs, generated files, and history on the user's machine. Hosting and multi-user access are out of scope until explicitly reconsidered.
- **Separate personal and demo data:** Use the owner's ignored local resume library during development. Keep tracked examples and automated test fixtures fictional, and never silently substitute demo data when personal data is missing or invalid.
- **JSON before a database:** Use readable local JSON for the first version and validate it at the boundary. A database is not required for the initial personal workflow.
- **Provider abstraction:** Use a Gemini adapter first, while keeping vendor-specific requests inside that adapter. Do not couple the selection or rendering logic to Gemini response formats.
- **AI for judgment, code for guarantees:** AI may interpret a JD and rank or rewrite supported points; deterministic code validates IDs, applies the template, escapes content, and controls compilation.
- **User review:** Show selected points and generated content before final export, with controls to override the AI's choices.
- **One-page output:** Let model judgment prioritize content, but let deterministic PDF page-count validation decide whether the final artifact meets the one-page limit.

## Planned Boundaries

- UI components should not read or write data files directly.
- Data loaders and writers should be the only modules that access local JSON files.
- Provider adapters should be called only from server-side code; API keys must never be exposed to the browser.
- LaTeX rendering and compilation should be separate so structured content can be tested without invoking a compiler.
- The backend should build prompts at runtime from small versioned instructions and typed inputs; secrets and private resume data must remain server-side.
- Unit tests should cover schemas, selection rules, renderers, and provider parsing. Integration and Playwright tests should cover cross-component and user workflows with deterministic fixtures and mocked AI responses.
