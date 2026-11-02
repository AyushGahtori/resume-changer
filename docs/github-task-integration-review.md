# Referenced GitHub task work: integration review

## Scope and baseline

Reviewed the eight chats referenced by the owner and their actual uncommitted worktrees. Integration comparison baseline: `phase-one` at `ff3ee210709a349c00b230b4942e830592721624`. Original worktrees and the unrelated primary checkout remain untouched. The review checkout is on `codex/github-session-review`.

The referenced chats did not implement the nine tasks in `docs/github-integration-session-plan.md`. They used the older thirty-task `github_integration_plan/task.md`, usually because the requested session-plan file was missing from their base checkout. The session plan existed only as an uncommitted file in the original phase-one checkout. This review includes that plan in version control so future handoffs can name an actual committed specification.

All eight task submissions were uncommitted at inspection time. Merging their branch HEADs alone would not include their implementation files. Several use different native interfaces from the assembled feature already present in phase-one.

## Disposition by referenced chat

| Referenced task                           | Actual submitted work                                     | Integration disposition                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: `01a18c69-1521-7ab2-8a9e-71ec62aef538` | Alternate library v1/v2 schemas and migration             | Do not replace the current schema. Candidate exports different snapshot, claim and metric shapes; phase-one writers consume its existing integrated types. Current loaders already report unsupported versions. This is not the session-contract task.                 |
| 2: `01a18c69-2d47-7762-bc5a-f9575d52dfa2` | Alternate GitHub HTTP client                              | Do not replace the current adapter. Candidate uses exception-based responses, different context/credential contracts and different response metadata. Existing inspection bridges consume the Result-based client. This is not the browser memory-owner task.          |
| 3: `01a18c69-3ad6-7951-8696-b1764edd7d2f` | Alternate authorization and credential interfaces         | Do not replace the configured access core or encrypted-vault contracts. Candidate expects different injected stores and handle format; hosted wiring uses the current scoped vault. This is not the request-scoped reader task.                                        |
| 4: `01a18c69-4dfe-7300-a0be-02d3ada5a092` | Alternate repository inventory                            | Do not replace the inventory implementation wholesale. Candidate exports `createBoundedInventory` and different result types; assembled inspection uses `buildRepositoryInventory`. No completed-file memory queue or abandoned-reservation repair is implemented.     |
| 5: `01a18c69-5c6a-7e83-b4f6-d84bda5c4c61` | PR pagination correction on the actual phase-one baseline | Compatible. Preserve explicit `hasNextPage: false` for a complete 30-item page while keeping unknown full pages partial. Bring its two regression tests, including historical merged-PR paths, into the review branch. This does not implement foreground AI analysis. |
| 6: `01a18c69-78e8-7ae2-98a8-c48d500a46c8` | Alternate selector, evidence and file-policy modules      | Do not replace existing core modules blindly. Selection/result contracts differ from the assembled adapters. No controller acceptance-receipt or retry-guard correction is implemented.                                                                                |
| 8: `01a18c69-9be7-75e1-847c-26b50444ba0e` | Alternate measurement catalog and engine                  | Do not replace the existing measurement API. Candidate exports `validateMeasurement`/`renderMeasurement`; current services consume `validateMeasurementAnswer`/`deriveMeasurementResult`/`renderMetricClause`. It does not retire durable source storage.              |
| 9: `01a18c69-a86b-7093-b71f-6b366d0ff386` | Filesystem-backed durable staged import/cache store       | Do not replace the hosted store. Candidate directly uses filesystem operations instead of the current durable-state storage boundary. It preserves source staging rather than removing it and is not an integrated acceptance task.                                    |

No session-plan Task 7 approval/save handoff was referenced. Do not infer its completion from another task number or an old existing branch.

These dispositions are integration-readiness findings from interface/call-site comparison and the available handoffs. They do not claim an exhaustive security audit of every alternate implementation. Unmerged work is preserved for future focused ports if a specific improvement is established.

## Compatible change under test

Task 5's pagination correction is small and uses the existing PR reader interface. The assembled inspection adapter already supplies explicit pagination metadata. An exactly full final page should therefore be complete, not automatically partial merely because it contains 30 rows. Unknown pagination still stays conservative, and malformed entries can still make the result partial.

Validation recorded so far:

- Focused PR tests: 17 passed.
- Full unit/integration suite: 1,306 passed, 3 skipped, across 151 test files.
- TypeScript and scoped ESLint: passed.
- Changed-file formatting: passed.
- Fresh optimized Next.js build with the separate worker: passed.
- Assembled Chromium/browser/API/separate-worker journey: 1 passed, including explicit confirmed-draft save. GitHub and AI boundaries were synthetic; this is not a real hosted GitHub/model acceptance run.

## Subsequent session redesign

The owner selected “Complete the agreed session-based redesign, reusing useful work.” Integration proceeded in the attached review worktree, based on the existing assembled `phase-one` feature. This explicit integration instruction supersedes the original per-task worktree/main prerequisite for this combined review; main was not used as a dumping ground for incomplete prerequisites.

The compatible Task 5 correction was retained. The alternate, uncommitted task implementations were preserved in their own worktrees rather than merged wholesale into incompatible interfaces. The session redesign reuses the already assembled authorization, screening, selector, extractor, measurement and approval modules behind request-local memory. See `github-session-contract.md` for the final design and `github-session-acceptance.md` for current verification and remaining live gates. The earlier validation counts above describe the compatibility baseline, not the new session acceptance run.
