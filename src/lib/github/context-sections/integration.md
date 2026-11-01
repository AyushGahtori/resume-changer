# Task 05 integration notes

## Acceptance record

- **Problem:** the current source reader rejects safe text above 64 KiB before section extraction. This module evaluates bounded reads up to 256 KiB and returns exact, screened excerpts without changing the production cap.
- **Owned files:** `src/lib/github/context-sections/**`, `tests/unit/github/context-sections/**`, and `tests/fixtures/github/context-sections/**`.
- **Exported API:** `createContextSectionReader`, `extractContextSections`, `inspectBoundedText`, the pinned-read/section DTOs, and the baseline/experimental limit constants from `index.ts`.
- **Scope exclusions:** no edits to `EVIDENCE_LIMITS`, GitHub transport, inventory, public contracts, session/provider wiring, production configuration, or stored source data.
- **Base SHA:** `bdaf1380ba99f6d7a80040574e0d788ff3b22d17` (the plan commit, whose parent is the reviewed feature baseline `8a3be18e2e6b346146ea3bea3c811ec1667755c5`).
- **Branch:** `codex/github-context-task-05-section-reader`.
- **Managed worktree:** `C:\Users\Ayush\.codex\worktrees\github-context-task-05-section-reader\re_changer`.
- **Source root used:** `C:\Users\Ayush\Documents\ChatGPT\re_changer`. The managed worktree tool rejected the plan's sibling worktree path because it was outside this chat's allowed workspace roots. The new worktree was still created from the exact required `bdaf138` commit; no source working-tree changes were copied.

## Read and safety model

`PinnedBlobSource` is the only transport boundary. A production implementation must authorize the repository, resolve the file from the requested immutable commit tree, use the fixed GitHub API origin, and enforce its streamed byte, shared request, deadline, and cancellation budgets before yielding bytes. The module independently checks returned repository/commit/path/blob identity, Git blob hash, actual size, strict UTF-8, binary controls, path policy, line length, and the complete bounded body for credential patterns before exposing any excerpt. Failure messages contain no source text or credential values.

The reader instance is request/tab-session scoped. Metadata admission, streamed bytes (256 KiB/file; 512 KiB/run), decoded UTF-16 memory (512 KiB/file), and model excerpts (12,000 bytes/200 lines) have separate limits. It clears its raw byte copy and decoded source reference after section construction. It checks live repository access before every cache hit, in-flight reuse, or source read; the transport adapter must recheck authorization when opening the blob to close the check/use race. It reads files sequentially, deduplicates identical in-flight requests inside an authorization namespace, and caches only completed verified section results in bounded memory. It has no filesystem, database, provider, or network dependency. A failed file does not discard already completed entries in a multi-file read.

Large declarations that do not fit are emitted as explicitly partial signatures; smaller nested declarations remain separately available. Markdown is divided at headings and paragraph boundaries. Every excerpt carries the immutable repository/commit/blob identity, exact one-based source line range, and SHA-256 of its excerpt. Planning language stays labeled as planned documentation; it is not converted into observed implementation claims.

## Baseline comparison and production integration

The reviewed baseline reader uses a 64 KiB response ceiling and calls `inspectFileContent`, whose current policy also rejects files larger than 64 KiB. This module's 256 KiB ceiling is experimental. Boundary and representative-file fixtures compare eligibility at 64 KiB and 256 KiB; these results are not a recommendation to change production limits.

For final assembly, implement a `PinnedBlobSource` adapter over the existing authorized transport only after a separate review of upstream wire bytes, decoded bytes, concurrent requests, memory, deadlines, and the combined session/payload limits. The baseline `createGithubClient.getText` adapter currently enforces the 64 KiB evidence limit for selected files, so it cannot be passed through unchanged for a 256 KiB production read. Do not raise `EVIDENCE_LIMITS` or select a larger production value from these unit tests alone. Keep ordinary imports on the existing production reader until the transport and combined budget changes are authorized and measured.

## Fixture inventory and checks

The task tests generate only synthetic safe text: 63/64/65 KiB text, 100 KiB Markdown, a 116 KiB component with nested declarations, exact/over 256 KiB streams, decoded-memory admission, invalid UTF-8, binary controls, end-of-file secret canaries, metadata lies, hash mismatch, authorization revocation, cancellation, duplicate reads, cache clearing, and a partial multi-file failure. The source adapter is a fake async byte stream; tests make no GitHub or model calls.

The bounded secret-pattern list is task-local to preserve this module's ownership boundary. Reconcile it with the baseline scanner during final assembly so the two policies do not drift; the task has not modified the shared policy.

## Verification

- `npm test -- --run tests/unit/github/context-sections/context-sections.test.ts` — passed, 15 tests.
- `npm run typecheck` — passed for the repository.
- `node node_modules/eslint/bin/eslint.js src/lib/github/context-sections tests/fixtures/github/context-sections tests/unit/github/context-sections` — passed.
- `node node_modules/prettier/bin/prettier.cjs --check src/lib/github/context-sections tests/fixtures/github/context-sections tests/unit/github/context-sections` — passed.

Vitest printed the repository's existing Vite `configLoader: 'native'` compatibility warning; the test run completed successfully. No production transport or caller is wired to this experimental reader.
