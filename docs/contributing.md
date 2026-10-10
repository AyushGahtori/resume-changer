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
npx prettier --check README.md docs/index.md docs/architecture.md docs/local-setup.md docs/contributing.md
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Install Playwright Chromium first if it is missing: `npx playwright install chromium`. Inspect test failures, fix the cause, and rerun the relevant checks. Do not report a check as passing if it was not run successfully.

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

## After Merge

Confirm the PR is merged, then return to `main`, pull the merged result, and verify the working tree is clean before starting another task:

```bash
git switch main
git pull --ff-only origin main
git status --short --branch
```

See [What A Good Test Should Check](project-plan.md#4-what-a-good-test-should-check) for the test-quality checklist and [Local Setup](local-setup.md) for environment commands.
