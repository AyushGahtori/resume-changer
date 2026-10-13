# Local Setup

This guide runs the application locally, including the Gemini provider boundary and local LaTeX-to-PDF service. AI operations are not yet connected to the resume-builder workflow.

## Requirements

- Git
- Node.js `^18.18.0`, `^19.8.0`, or `>=20.0.0`
- npm (included with Node.js)
- Chromium for Playwright browser tests
- [Tectonic](https://tectonic-typesetting.github.io/book/latest/installation/), the local LaTeX compiler
- Poppler's `pdfinfo` utility, used to verify the one-page limit

The Node.js range comes from the installed Next.js package's engine declaration.

## Clone And Install

```bash
git clone https://github.com/AyushGahtori/resume-changer.git
cd resume-changer
npm ci
```

`npm ci` installs the exact dependency versions recorded in `package-lock.json`.

## Run The App

```bash
npm run dev
```

Visit <http://localhost:3000>. Stop the development server with `Ctrl+C` in its terminal.

Tectonic and `pdfinfo` must be available on `PATH`. If either executable has a nonstandard location, set `TECTONIC_BINARY` or `PDFINFO_BINARY` in `.env.local` to its full path and restart the app. The compiler runs with Tectonic's untrusted-input mode and uses locally cached package resources only; it does not enable shell escape or accept compiler options from the request. A missing compiler, unavailable cached package, invalid LaTeX, or page overflow is reported as a compile error.

## Gemini Provider Setup

Copy `.env.example` to `.env.local`, then set `GEMINI_API_KEY` to a Google AI Studio key. The default model is `gemini-3.6-flash`; use `GEMINI_MODEL` to override it. Select `AI_PROVIDER=mock` to use deterministic local responses without an API key or network request. Restart the dev server after changing environment values. The key is server-only and `.env.local` is ignored by Git.

Google's free tier has limited model access and may use submitted content to improve Google products. Check the current [Gemini API pricing and data-use terms](https://ai.google.dev/gemini-api/docs/pricing) before sending personal resume information. Usage limits can change; the app does not promise unlimited free requests.

The service is available at `POST /api/compile` with a JSON body containing a `latex` string. A successful response is a one-page PDF. It is returned as the response body and is not persisted; temporary compilation files are removed after each request.

## Run Checks

```bash
npm run format:check
npx prettier --check README.md docs/index.md docs/architecture.md docs/local-setup.md docs/contributing.md
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright's browser installation is normally needed only once per machine (or when the Playwright version changes). The E2E script starts its own development server using the Playwright configuration.

## Local Files And Secrets

The app can use a server-side Gemini key when `AI_PROVIDER=gemini`; keep it local. Task 05 created the owner's real resume library locally at `/data/resume-library.json`. The tracked `examples/sample-resume-library.json` remains fictional and is for tests or intentional demo mode only:

- Keep API keys in a local `.env.local` file; never commit the real file or paste a key into source code.
- Keep personal resume data and generated files in local-only data/storage directories. These paths are ignored by Git.
- Use fake demo content in tests and examples. Do not use a real resume as a fixture.
- Do not silently use demo content when the local personal file is missing or fails validation; surface a clear setup or data error instead.
- Commit only a sanitized `.env.example` when configuration documentation is added; it must contain placeholders, never real credentials.
- Review `git status` before staging so private files are not included accidentally.

The project plan's Task 25 can expand setup instructions after the remaining AI workflow tasks exist.

## Common Problems

- **Port 3000 is already in use:** Stop the other server or use the alternate port printed by Next.js.
- **Playwright cannot find Chromium:** Run `npx playwright install chromium` and retry the E2E command.
- **Dependencies appear inconsistent:** Run `npm ci` from the repository root to recreate `node_modules` from the lockfile.
- **A check fails after a change:** Read the first reported file and line, fix the underlying issue, then rerun the failed command before opening or updating a PR.
