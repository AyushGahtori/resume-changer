# Contributing And Task Workflow

Work through the numbered tasks in the [project plan](project-plan.md) in order. Each task should leave the repository in a usable state and include tests for the behavior it adds.

## Before Editing

Start from an up-to-date `main` branch and create a focused task branch:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/task-XX-short-name
```

Replace `XX` and `short-name` with the task number and a short description, such as `codex/task-03-json-schemas`. If the branch already exists, inspect its status and history before continuing rather than overwriting it.

## While Implementing

1. Read the relevant project-plan section, documentation, and existing code first.
2. Keep the change within the current task's scope.
3. Add or update tests for each new function, utility, route, and user-visible behavior.
4. Prefer deterministic tests with fake data. Mock AI providers and external services so routine tests do not consume credits or depend on network availability.
5. Keep personal resume data, API keys, generated PDFs, and private local files out of Git.

## Before Pushing

Run the quality commands from the repository root:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm run format:check` covers the sources, tests, scripts, docs, and GitHub Actions workflows, so it replaces the separate `npx prettier --check` invocation that earlier revisions of this guide used.

Install Playwright Chromium first if it is missing: `npx playwright install chromium`. Inspect test failures, fix the cause, and rerun the relevant checks. Do not report a check as passing if it was not run successfully.

The optional live integration checks need extra setup and are not part of the local gate:

```bash
npm run test:ai-live
npm run test:pdf-live
```

They fail when their credentials or tools are missing, so run them only when `GEMINI_API_KEY`, Tectonic, and `pdfinfo` are configured.

Review the exact changes before staging and pushing:

```bash
git status --short
git diff --check
git diff
```

Stage only files for the current task. Commit with a clear message, then push the task branch:

```bash
git add <task-files>
git commit -m "<type>: <short description>"
git push -u origin codex/task-XX-short-name
```

Open a pull request against `main`. Include a concise summary, tests actually run, and any known limitations. Keep the branch and PR focused; wait for checks and review before merging. Do not push feature work directly to `main`.

`main` requires three status checks before a pull request can merge: `local-quality`, `Gemini live API`, and `Real Tectonic and PDF toolchain`. A failing check names the broken step, so read its log rather than rerunning the same command blindly.

## After Merge

Confirm the PR is merged, then return to `main`, pull the merged result, and verify the working tree is clean before starting another task:

```bash
git switch main
git pull --ff-only origin main
git status --short --branch
```

See [What A Good Test Should Check](project-plan.md#4-what-a-good-test-should-check) for the test-quality checklist and [Local Setup](local-setup.md) for environment commands. The [Setup Guide](setup-guide.md) is the complete reference for configuring Gemini, installing the PDF toolchain, and running the app against real data.
