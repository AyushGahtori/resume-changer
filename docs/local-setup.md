# Local Setup

This guide runs the current application foundation on your machine. Later tasks will add private resume data, AI calls, and PDF compilation; this guide does not configure those unfinished features.

## Requirements

- Git
- Node.js `^18.18.0`, `^19.8.0`, or `>=20.0.0`
- npm (included with Node.js)
- Chromium for Playwright browser tests

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

The current placeholder does not require an API key or personal data. Task 05 will create the owner's real resume library locally at `/data/resume-library.json`; later development tasks should use it by default. The tracked `examples/sample-resume-library.json` remains fictional and is for tests or intentional demo mode only. When future tasks add those features:

- Keep API keys in a local `.env.local` file; never commit the real file or paste a key into source code.
- Keep personal resume data and generated files in local-only data/storage directories. These paths are ignored by Git.
- Use fake demo content in tests and examples. Do not use a real resume as a fixture.
- Do not silently use demo content when the local personal file is missing or fails validation; surface a clear setup or data error instead.
- Commit only a sanitized `.env.example` when configuration documentation is added; it must contain placeholders, never real credentials.
- Review `git status` before staging so private files are not included accidentally.

The project plan's Task 25 adds the complete provider and PDF compiler setup instructions after those features exist.

## Common Problems

- **Port 3000 is already in use:** Stop the other server or use the alternate port printed by Next.js.
- **Playwright cannot find Chromium:** Run `npx playwright install chromium` and retry the E2E command.
- **Dependencies appear inconsistent:** Run `npm ci` from the repository root to recreate `node_modules` from the lockfile.
- **A check fails after a change:** Read the first reported file and line, fix the underlying issue, then rerun the failed command before opening or updating a PR.
