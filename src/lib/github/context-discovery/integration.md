# Task 04 handoff: project discovery map

## Problem

The existing pinned inventory has files, package hints and project types, but no deterministic project map that combines overview documents, workspace boundaries, static configuration, entrypoint candidates and capability suggestions. This module builds that map while keeping documentation and manifests distinct from proof that a feature works.

## Worktree and base

- Source checkout: `C:/Users/Ayush/Documents/ChatGPT/re_changer`
- Common `PLAN_BASE_SHA`: `bdaf1380ba99f6d7a80040574e0d788ff3b22d17` (the reviewed plan is committed there; the commit adds only the plan)
- Branch: `codex/github-context-task-04-project-map`
- Managed worktree: `C:/Users/Ayush/.codex/worktrees/github-context-task-04-project-map/re_changer`

## Owned files and API

- `src/lib/github/context-discovery/**`
- `tests/unit/github/context-discovery/**`
- `tests/fixtures/github/context-discovery/**`
- `src/lib/github/context-discovery/integration.md`
- Export: `discoverProjectMap({ repository, inventory, reader }): Promise<ProjectMapResult>`

The module uses task-local structural contracts. `inventory` conforms to the pinned repository inventory's file, package, project-type and revision fields. `reader` is an injected bounded reader; it receives the repository ID, owner/name, commit SHA, blob SHA and the per-file byte limit. No GitHub client, network adapter, AI/provider, UI, shared contract, API dispatcher or selector implementation is imported.

## Implemented behavior

- Attempts a canonical eligible root README and, when the pinned inventory has a selected package scope, a README for that package. It records missing/unreadable states, chooses one variant per package, deduplicates repeated content, and reports package READMEs outside the selected scope as exclusions. It returns relevant heading line hints without returning document text.
- Finds a bounded set of architecture/design/overview documents, manifests, workspace declarations and static language/framework configuration.
- Parses package manifests and JSONC without evaluating code. Alias mappings include the declaring config path and JSONC provenance. Local `extends` are bounded to five levels and must resolve to an eligible file in the pinned inventory.
- Rejects path traversal, absolute/external targets, encoded separators, prototype-polluting keys, unsupported wildcard syntax, symlinks, submodules, generated/vendor paths and unsafe inventory candidates.
- Returns package/entrypoint candidates and low/medium confidence capability/framework suggestions with evidence paths. Documentation explicitly labeled planning remains marked planning and is never used as implementation evidence.
- Preserves partial-inventory state, unvisited scopes and total/eligible/selected-evidence counts. Uses a language-agnostic fallback if project types are unknown.

## Exact fixtures

`tests/unit/github/context-discovery/discovery.test.ts` covers: a JSONC TypeScript app and aliases; a selected scope in a workspaces monorepo with a duplicate package README; Python/ML manifests; a Go backend CLI; an empty inventory; generated docs, vendored files and documentation images; localized README names and inherited local JSONC aliases; traversal/prototype/external-extends rejection; unreadable and over-limit README handling; a config-heavy repository that still attempts its root README; stale inventory identity; symlink and unsafe-file exclusions; planning documents; deterministic order; malformed identity; and the exact pinned identity passed to the fake reader.

`tests/fixtures/github/context-discovery/repositories.ts` supplies pinned synthetic repositories and a fake bounded reader. No fixture uses GitHub, private source, credentials, network access or an AI provider.

## Safety checks and limits

- Inventory size: at most 10,000 files.
- Reader: at most 64 KiB per file and 96 sequential reads per discovery call.
- Local configuration inheritance: at most five levels.
- Package map: at most 500 packages; overview candidates: at most 16; entrypoints: at most 128.
- Reader output must match the requested blob SHA and report bounded byte counts. Invalid or stale identities fail closed for that read.
- README links and image URLs are treated as inert text. Repository images are never returned as overview documents.
- No config scripts are executed. Dynamic JS/TS tool configs are surfaced as `static-only`.

## Integration instructions

Call `discoverProjectMap` after the repository has been pinned and its bounded inventory has passed the existing safety policy. Adapt the existing `RepositoryInventory` and a production bounded reader to the task-local structural ports. Pass the map to the section reader/ranker as overview candidates, package boundaries, static alias provenance, entrypoints and capability suggestions; keep the reader responsible for exact source screening, excerpt selection and consent. Treat all capabilities as suggestions, and never treat a manifest, README, plan or entrypoint name as proof of behavior or personal contribution.

Task 05 owns larger-text reading and exact section extraction. Final assembly owns the shared adapter and route wiring. No production route is changed by this task.

## Verification results

- `node node_modules/vitest/vitest.mjs run tests/unit/github/context-discovery/discovery.test.ts`: **16/16 passed** using the available Vitest 3.2.7.
- `node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution bundler --skipLibCheck src/lib/github/context-discovery/contracts.ts src/lib/github/context-discovery/discovery.ts src/lib/github/context-discovery/index.ts src/lib/github/context-discovery/jsonc.ts src/lib/github/context-discovery/path-safety.ts`: **passed**.
- `node node_modules/eslint/bin/eslint.js src/lib/github/context-discovery/contracts.ts src/lib/github/context-discovery/discovery.ts src/lib/github/context-discovery/index.ts src/lib/github/context-discovery/jsonc.ts src/lib/github/context-discovery/path-safety.ts tests/unit/github/context-discovery/discovery.test.ts tests/fixtures/github/context-discovery/repositories.ts`: **passed**.
- `node node_modules/prettier/bin/prettier.cjs --check src/lib/github/context-discovery/contracts.ts src/lib/github/context-discovery/discovery.ts src/lib/github/context-discovery/index.ts src/lib/github/context-discovery/jsonc.ts src/lib/github/context-discovery/path-safety.ts tests/unit/github/context-discovery/discovery.test.ts tests/fixtures/github/context-discovery/repositories.ts src/lib/github/context-discovery/integration.md`: **passed**.
- Full project `tsc --noEmit` was attempted. It reported unresolved modules from the shared dependency directory (`workflow`, Firebase, `jose`, `@vercel/blob` and related packages) and a Vitest API mismatch. The package lock specifies Vitest 5.0.5, while the linked directory contains 3.2.7. The task-owned strict check passes. Replacing the dependency junction to run a clean locked install was blocked by automatic review; no dependency directory was removed or changed.
- No screenshot applies to this non-UI task.

## Known limitations

- Workspace parsing intentionally supports static package.json/Lerna/pnpm patterns and bounded Cargo, Go and Gradle declarations; unsupported dynamic workspace definitions are not evaluated.
- Alias parsing supports JSONC `compilerOptions.baseUrl` and `paths`; package-based `extends`, traversal and dynamic configuration are reported as unresolved/unsupported.
- Capability suggestions use dependency and path markers only. They do not establish implemented behavior, deployment, performance outcomes or authorship.
- Overview section hints are deterministic heading locations, not the exact screened excerpts owned by Task 05.
