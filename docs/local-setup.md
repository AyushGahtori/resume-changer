# Local Setup

This guide runs the application locally, including Gemini-powered JD analysis and achievement suggestions, plus the local LaTeX-to-PDF service.

## Requirements

- Git
- Node.js `>=22.13.0` (Node.js 24 recommended for the PDF.js measurement dependency)
- npm (included with Node.js)
- Chromium for Playwright browser tests
- [Tectonic](https://tectonic-typesetting.github.io/book/latest/installation/), the local LaTeX compiler
- Poppler's `pdfinfo` utility, used to verify the one-page limit

The Node.js range accommodates PDF.js, which measures visible PDF text and page utilization without another external executable.

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

Copy `.env.example` to `.env.local`, then set `GEMINI_API_KEY` to a Google AI Studio key. JD analysis and achievement suggestions use this server-side provider. The default model is `gemini-3.6-flash`; use `GEMINI_MODEL` to override it. Select `AI_PROVIDER=mock` to use deterministic local responses without an API key or network request. Restart the dev server after changing environment values. The key is server-only and `.env.local` is ignored by Git.

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

The external integrations are checked automatically by the `Live integration checks` GitHub Actions workflow on pull requests and pushes to `main`. To run them locally, configure `GEMINI_API_KEY`, install Tectonic and `pdfinfo`, then run:

```bash
npm run test:ai-live
npm run test:pdf-live
```

These commands fail when their required credentials or tools are missing instead of reporting a skipped pass. The Gemini test sends only a synthetic job description. The PDF test compiles the real sample resume, checks page-limit rejection and invalid-LaTeX handling, and first warms Tectonic's package cache because the application compiler only uses cached packages. GitHub Actions reads `GEMINI_API_KEY` from repository secrets; never add it to workflow source or commit `.env.local`.

## Local Files And Secrets

The app uses a server-side Gemini key when `AI_PROVIDER=gemini`; keep it local. Task 05 created the owner's real resume library locally at `/data/resume-library.json`. The tracked `examples/sample-resume-library.json` remains fictional and is for tests or intentional demo mode only:

- Keep API keys in a local `.env.local` file; never commit the real file or paste a key into source code.
- Keep personal resume data and generated files in local-only data/storage directories. These paths are ignored by Git.
- Use fake demo content in tests and examples. Do not use a real resume as a fixture.
- Do not silently use demo content when the local personal file is missing or fails validation; surface a clear setup or data error instead.
- Commit only a sanitized `.env.example` when configuration documentation is added; it must contain placeholders, never real credentials.
- Review `git status` before staging so private files are not included accidentally.

The project plan's Task 25 can expand setup instructions after the remaining AI workflow tasks exist.

### Personal data in Git worktrees

Git ignores `data/`, so a new clone or worktree does not receive a copy of
`data/resume-library.json`. When running from a linked Git worktree without its
own library, the app automatically uses the primary checkout's personal library,
library backups, and generation history. Library edits made there update that
shared personal library. A library present in the current worktree takes
precedence, including when it is invalid and needs repair.

To choose a different data location, set `RESUME_LIBRARY_ROOT` in the running
checkout's `.env.local` to the absolute folder containing `data/`, then restart
the server. For example, `RESUME_LIBRARY_ROOT=C:/path/to/resume-changer` reads
`C:/path/to/resume-changer/data/resume-library.json`. This explicit setting
disables automatic discovery, even if the configured file is missing. Demo
mode always reads the fictional example from the running checkout.

## Common Problems

- **`data/resume-library.json` was not found:** Check that the personal library exists in the running checkout or its primary Git checkout. For another location, configure `RESUME_LIBRARY_ROOT` as described above and restart. A fresh clone needs your personal data restored separately, or you can explicitly select fictional demo data.
- **Port 3000 is already in use:** Stop the other server or use the alternate port printed by Next.js.
- **Playwright cannot find Chromium:** Run `npx playwright install chromium` and retry the E2E command.
- **Dependencies appear inconsistent:** Run `npm ci` from the repository root to recreate `node_modules` from the lockfile.
- **A check fails after a change:** Read the first reported file and line, fix the underlying issue, then rerun the failed command before opening or updating a PR.

## Output quality and page fitting

Auto Tailor can select, draft and compile a measured result in one request. The
backend keeps structured achievement metrics, discloses inferred framework usage,
and reports full/partial requirement coverage against the final content. Page
fitting uses PDF.js text bounds with a six-compilation limit; visible word count
is an estimate rather than proof of page fill. An underfilled result or unavailable
measurement is reported explicitly. Model failures retain source wording plus
recorded metrics. The fixed template typography is unchanged.
