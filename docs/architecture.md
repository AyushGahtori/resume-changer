# Architecture Overview

## Product Shape

Resume Changer is planned as a local-first web application for preparing a resume against one job description at a time. The user supplies a JD and a reusable library of verified experience. The app helps select and phrase the most relevant material while keeping the user in control of the final resume.

The current repository is the initial Next.js shell. The components below describe the intended v1 architecture; later roadmap tasks add these capabilities incrementally.

## Main Components

- **Web application:** Next.js App Router with TypeScript and Tailwind CSS. Pages and UI state live in the frontend; server-only work belongs in route handlers or server actions.
- **Validated data layer:** JSON files are the planned v1 source of truth. Zod schemas will validate user data and AI response contracts before application code uses them.
- **Achievement library:** Stable IDs connect each achievement point to its source job, project, skill, license, or certificate. Tags and related skills help search and selection.
- **AI provider boundary:** A provider interface keeps JD analysis, achievement selection, resume drafting, and limited LaTeX repair independent from a specific vendor. Gemini is the first planned adapter; tests should use a mock provider rather than real paid API calls.
- **Resume renderer:** A deterministic renderer places validated structured content into a controlled Jake-style LaTeX template. AI should return structured content where possible, leaving template structure and escaping to application code.
- **PDF compiler:** A local compiler such as Tectonic is planned to run server-side in a temporary directory with timeouts and captured diagnostics. Shell escape should remain disabled.
- **Local outputs and history:** Generated LaTeX, PDFs, and history are planned to remain on the user's machine in the first version.

## Intended Data Flow

```text
Job description + validated achievement library
                    |
                    v
       JD analysis and requirement signals
                    |
                    v
        Select achievement IDs with sources
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

## Key Decisions

- **Local-first v1:** Keep resume data, JDs, generated files, and history on the user's machine. Hosting and multi-user access are out of scope until explicitly reconsidered.
- **JSON before a database:** Use readable local JSON for the first version and validate it at the boundary. A database is not required for the initial personal workflow.
- **Provider abstraction:** Use a Gemini adapter first, while keeping vendor-specific requests inside that adapter. Do not couple the selection or rendering logic to Gemini response formats.
- **AI for judgment, code for guarantees:** AI may interpret a JD and rank or rewrite supported points; deterministic code validates IDs, applies the template, escapes content, and controls compilation.
- **User review:** Show selected points and generated content before final export, with controls to override the AI's choices.

## Planned Boundaries

- UI components should not read or write data files directly.
- Data loaders and writers should be the only modules that access local JSON files.
- Provider adapters should be called only from server-side code; API keys must never be exposed to the browser.
- LaTeX rendering and compilation should be separate so structured content can be tested without invoking a compiler.
- Unit tests should cover schemas, selection rules, renderers, and provider parsing. Integration and Playwright tests should cover cross-component and user workflows with deterministic fixtures and mocked AI responses.
