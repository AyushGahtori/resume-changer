# Task 01 interview engine handoff

## Problem and result

The former one-prompt project description left the user to discover relevant implementation details and could confuse project ownership with purpose. This module provides a versioned 60-question catalog, bounded declarative routing, answer/context schemas, deterministic interview state transitions, context review, explicit answer migration, and JSON transcript fixtures.

## Baseline and worktree

- Source checkout: C:/Users/Ayush/Documents/ChatGPT/re_changer
- Source branch at task start: codex/imagination-canvas-integration
- Agreed committed baseline: bdaf1380ba99f6d7a80040574e0d788ff3b22d17
- Task branch: codex/github-context-task-01-interview-engine
- Managed worktree: C:/Users/Ayush/.codex/worktrees/github-context-task-01-interview-engine/re_changer
- No application changes were copied from another task branch or the dirty source checkout.

The managed-worktree tool only accepted the task's project workspace as its source root, so creation used that repository with the exact committed plan ref above. The planning checkout and task checkout resolve to the same Git commit. The task checkout starts clean at that commit before these owned files were added.

## Owned files

- src/lib/github/context-interview/**
- tests/unit/github/context-interview/**
- tests/fixtures/github/context-interview/**

No workspace UI, global contract, shared provider, API dispatcher, package manifest, or persistent storage file is owned here.

## Exported API

Import from src/lib/github/context-interview:

- DEFAULT_QUESTION_CATALOG and DEFAULT_QUESTION_COUNT
- validateQuestionCatalog
- createInterviewState, nextQuestion, applyAnswer, and goBack
- pruneInvalidAnswers, reviewContext, and serializeProjectContext
- setExtraNotes and setRepositorySuggestionDisposition
- migrateAnswers, getInterviewCompletion, and isInterviewComplete
- Versioned schemas and TypeScript types from types.ts

All state transitions are pure: they return new state and do not write browser or server persistence. Repository suggestions remain marked repository-inferred; only an explicit accepted disposition contributes a user-confirmed fact.

## Fixture and test coverage

tests/fixtures/github/context-interview/transcripts.v1.json contains synthetic solo, team, model/data, overlapping-area, and custom-project transcripts for the independent UI harness. tests/unit/github/context-interview/engine.test.ts exercises the full catalog and malformed graph/state cases.

## Verification

- npx vitest run tests/unit/github/context-interview/engine.test.ts — passed, 14 tests.
- npm run typecheck — passed.
- npx eslint src/lib/github/context-interview/types.ts src/lib/github/context-interview/catalog.ts src/lib/github/context-interview/engine.ts src/lib/github/context-interview/index.ts tests/unit/github/context-interview/engine.test.ts — passed.
- npx prettier --check src/lib/github/context-interview/types.ts src/lib/github/context-interview/catalog.ts src/lib/github/context-interview/engine.ts src/lib/github/context-interview/index.ts src/lib/github/context-interview/integration.md tests/unit/github/context-interview/engine.test.ts tests/fixtures/github/context-interview/transcripts.v1.json — passed.

The task worktree had no installed dependencies. Validation used an ignored local junction to a checkout with the same package-lock hash; no package manifest or lockfile was changed.

## Integration notes and limitations

Task 02 can import the engine port directly after integration, or use the transcript JSON as an independent controlled-component fixture. The UI must store only the returned in-memory state for the active interview and invalidate prepared consent when answers, accepted suggestions, or notes change.

This module does not read GitHub, interpret repository source, call an AI provider, save achievements, or persist interview state. A repository suggestion's source identity must include the repository ID and pinned commit SHA. A text-only model or a hosted runtime still needs separate screenshot/provider and session-boundary work. The initial question wording is implemented and fixture-reviewed; usability review with solo, team, and nontechnical users remains part of final assembly.

## Scope and safety

Catalog conditions are JSON data with a fixed operator allowlist. Custom text is never evaluated as a condition or executable rule. Unknown versions, nodes, or option IDs fail clearly unless an explicit migration maps them. A skipped answer is distinct from an inferred answer. The question cap is ten presented questions, including skips.
