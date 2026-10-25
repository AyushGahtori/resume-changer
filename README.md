# Resume Changer

Resume Changer is a workspace for tailoring a resume to a specific job description (JD), with a hosted account mode and local development mode. Its achievement library organizes source evidence so selected and rewritten resume content remains traceable to the user's work.

Provide a JD, analyze its requirements, select and tailor relevant achievements, review the proposed content, and export a verified one-page PDF. Gemini sits behind a provider interface, with explicit handling when AI is unavailable.

## Current Status

The app includes Google sign-in, private account libraries and history, JD analysis, Auto Tailor, a review/editing studio, PDF preview, and import/export. Hosted data uses account-scoped Firestore records and private PDF storage; local mode retains the JSON workflow. See the [production runbook](docs/production-runbook.md) for deployment, security boundaries, quotas, and recovery, and the [project plan](docs/project-plan.md) for the implementation sequence.

## Quick Start

Requirements: Node.js `>=22.13.0` (24 recommended) and npm. The Node.js range follows the `engines` field in `package.json` and accommodates the PDF.js dependency used for page-fill measurement.

```bash
git clone https://github.com/AyushGahtori/resume-changer.git
cd resume-changer
npm ci
npm run dev
```

Open <http://localhost:3000> in a browser. Demo data can be used without a personal resume library. Configure a Gemini API key in `.env.local` to use JD analysis and AI achievement suggestions; setup details are in the [setup guide](docs/setup-guide.md) and the shorter [local setup guide](docs/local-setup.md).

PDF output additionally needs a local LaTeX compiler (Tectonic) and Poppler's `pdfinfo`. The [setup guide](docs/setup-guide.md) covers installing them and warming the compiler's package cache.

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
npm run test:ai-live # Verify the real Gemini API (needs GEMINI_API_KEY)
npm run test:pdf-live # Verify the real Tectonic and pdfinfo toolchain
npm run test:security # Firebase rule attacks and account flows (Java 21 + Chromium)
npm run test:pdf-bundled # Verify the prepared Linux production PDF runtime
```

## Product Principles

- Preserve truth: AI may select and rewrite supported facts, but must not invent experience, dates, skills, certificates, or metrics.
- Keep generated content traceable to achievement IDs so the user can verify its source.
- Keep local development explicit and hosted account data isolated by verified user identity.
- Keep AI providers behind a shared interface rather than coupling product logic to one vendor.
- Keep the Jake-style LaTeX structure controlled by the application.

## Documentation

Start at the [documentation index](docs/index.md) for the architecture, setup guide, contributor workflow, and project plan. The [setup guide](docs/setup-guide.md) is the complete reference for configuring Gemini, installing the PDF toolchain, understanding cost and token behavior, and adding another provider such as DeepSeek.
