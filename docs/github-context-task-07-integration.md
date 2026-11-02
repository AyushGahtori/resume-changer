# Task 07 integration notes: coverage-aware bundle allocation

## Module boundary

Import the standalone allocator from `src/lib/github/context-bundle`. It accepts ranked candidates and expected feature targets as task-local structural types; it does not import Task 06 or change the shared GitHub contracts.

```ts
const budget = createBaselineBundleBudget({
  filesPerRequest: GITHUB_IMPORT_POLICY.filesPerRequest,
  inputTokensPerImport: GITHUB_IMPORT_POLICY.inputTokensPerImport,
  linesPerFilePerRequest: GITHUB_IMPORT_POLICY.linesPerFilePerRequest,
  linesPerRequest: GITHUB_IMPORT_POLICY.linesPerRequest,
  selectedCharactersPerFile: GITHUB_IMPORT_POLICY.selectedCharactersPerFile,
  selectedCharactersTotal: GITHUB_IMPORT_POLICY.selectedCharactersTotal,
  sectionsPerPreparedSelection: BASELINE_MAX_SECTIONS,
  reservedInputTokens: estimatedNonSectionInputTokens,
});

const bundle = allocateEvidenceBundle({
  repositoryId,
  commitSha,
  candidates,
  features,
  context,
  budget,
  adjustments,
});
```

`createBaselineSelectionAdapterInput` is a convenience for the same adapter flow. Supply limits from the live policy at the integration boundary; it clamps file count to 12 and section count to 300. Do not duplicate or raise these values in a host path. The allocator separately enforces the supplied per-file and aggregate line/character limits.

## Candidate and feature mapping

- Map only sections that have completed the bounded reader's safety screening. Each section needs repository ID, pinned commit SHA, path, blob SHA, exact line range, excerpt, and the SHA-256 of that excerpt.
- Map Task 06 role, feature targets, token estimate, rank score, wrapper signal, uncertainty flags, and duplicate relationships into `RankedCandidate`. Emit all known overlap/near-duplicate group IDs. This module also catches exact excerpt duplicates and line-range overlap within a file.
- Expected feature IDs must be stable and every candidate feature target must exist in the supplied feature map. Mark critical implementation areas explicitly; documentation and test candidates should use overview and verification roles respectively.
- `isWrapper` candidates remain eligible as one representative of application wiring, but do not count as implementation proof or satisfy critical implementation coverage. User pins may include additional wrappers explicitly.

## Limits and final request admission

The allocator is a deterministic planning step. `tokenCost` must use the same estimator semantics as the host's prepared-selection budget. Reserve estimated tokens for prompts, structured context, pull-request metadata, and any approved image attachments before allocating source sections. The host must still run its existing final request admission against the fully assembled payload; this module does not authorize a provider request or relax transport/memory limits.

`createBaselineBundleBudget` takes the lower of caller-provided live caps and the recorded baseline for:

- 12 files per request (it hard clamps larger values to 12);
- 36,000 input tokens per import, less tokens reserved for non-section payload;
- 200 lines per file and 1,500 lines per request;
- 12,000 selected characters per file and 80,000 total;
- at most 300 evidence sections.

The adapter does not assume the full 36,000 tokens are available to repository excerpts. A stricter live cap or a non-section token reservation lowers the source budget. Offline allocation experiments may pass alternative limits directly to `allocateEvidenceBundle`, but those values do not change the live adapter.

## Review and consent wiring

Render `selectedSections`, `selectedFileIdentities`, `coverage`, `missingCriticalFeatureIds`, `omittedCandidates`, `roleAllocations`, `testAllocation`, and `limitations` in the review surface. Keep all omission reasons and exact source provenance available to the user. Pins that cannot fit appear in `unfulfilledPinnedCandidateIds`; never silently drop them or exceed a hard cap. A new pin/exclusion must rerun allocation and produce a fresh `selectionIdentity` before approval.

`consentHash` is deliberately `null` here. The enclosing approval flow should bind explicit user approval to the selection identity, structured context revision, screenshot hashes (if present), repository/commit, and the exact final request. The allocator itself has no approval state and makes zero provider calls.

`claimEvidenceFeatureIds` contains only features both confirmed in the user's contribution context and represented by selected implementation sections. It is a scope input for later review, not an authorship finding or an automatic achievement claim. A whole-project context may orient discovery, but it never widens this list by itself. Repository evidence also cannot establish sole authorship or measured results.

## Known boundary cases

- Pins take precedence when feasible. If pinned content is byte-identical to an already selected excerpt, the bundle keeps the extra pinned source identity as an alias and transmits the excerpt once. Pinned distinct overlapping sections remain separate sections and are fully charged; the user is warned if those pins cannot fit.
- Unpinned overlapping or duplicate groups select at most one representative. If separate overlapping sections carry distinct useful facts, the upstream sectioner should provide a merged exact section; otherwise the coverage review will show the omitted candidate and any resulting critical gap.
- Token costs and feature mappings are supplied estimates. This module does not verify an upstream ranker's evidence claims, model tokenization, or a live provider's payload accounting.
- `consentHash` stays null until an explicit consent adapter is implemented during final assembly.
