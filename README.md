# Resume Changer

Resume Changer is a local-first workspace for tailoring a resume to a specific job description (JD). It is designed around an Achievement Points Hashmap: a structured library of verified experience that the app can select from when preparing a targeted resume. The goal is to improve relevance while keeping every statement grounded in the user's real work.

The planned workflow is to provide a JD, analyze its requirements, select relevant points from the achievement library, review the proposed content, render it in a Jake-style LaTeX template, compile a PDF, and export the result. The planned AI integration starts with Gemini behind a provider interface so another provider, such as DeepSeek, can be added later.

## Current Status

The app includes a local achievement library, job-description workspace, deterministic LaTeX generation, and local PDF preview. Task 13 establishes a server-side Gemini provider and versioned prompt foundation; AI operations are not yet connected to the resume-builder workflow. See the [project plan](docs/project-plan.md) for the implementation sequence.

## Quick Start

Requirements: Node.js `^18.18.0`, `^19.8.0`, or `>=20.0.0` and npm. These versions follow the installed Next.js package's engine requirement.

```bash
git clone https://github.com/AyushGahtori/resume-changer.git
cd resume-changer
npm ci
npm run dev
```

Open <http://localhost:3000> in a browser. No API key or personal resume data is needed for the current placeholder app.

For a clean checkout, install the Playwright Chromium browser once before running the browser test:

```bash
npx playwright install chromium
```

## Common Commands

```bash
npm run dev          # Start the local development server
npm run build        # Create a production build
npm run start        # Serve the production build
npm run format:check # Check source and configuration formatting
npm run lint         # Run ESLint
npm run typecheck    # Check TypeScript types
npm test             # Run Vitest unit tests
npm run test:e2e     # Run Playwright browser tests
```

The current unit test is only a test-runner smoke check. The browser test confirms that the initial workspace loads. Feature tasks should replace or extend these with behavior-focused tests.

## Product Principles

- Preserve truth: AI may select and rewrite supported facts, but must not invent experience, dates, skills, certificates, or metrics.
- Keep generated content traceable to achievement IDs so the user can verify its source.
- Keep the first version local-first, with JSON as the planned source of truth.
- Keep AI providers behind a shared interface rather than coupling product logic to one vendor.
- Keep the Jake-style LaTeX structure controlled by the application.

## Documentation

Start at the [documentation index](docs/index.md) for the architecture, local setup, contributor workflow, and project plan.
