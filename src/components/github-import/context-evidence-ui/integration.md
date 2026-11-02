# Evidence inventory UI adapter

This module is a standalone replacement surface for the current `EvidencePanel`. It does not change the shared import workspace or replace the production panel in this task. Final assembly can wire `ContextEvidenceUi` into that owner-controlled composition after the interview, inventory and bundle-allocation contracts are integrated.

## Mapping current boundaries

- `FileCandidate.selected` or `.pinned` maps to `state: "selected"`; a safe, eligible candidate maps to `state: "eligible"`.
- A blocked or needs-review candidate maps to `state: "excluded"` only with a structured exclusion reason. If an older response provides no reason, `adaptFileCandidate` keeps the generic reason explicit instead of claiming that content screening found a secret.
- `RepositoryFileCandidate.safetyFlags` maps as follows: `binary-candidate` to unsupported binary, `oversized` to excessive text size, `secret-candidate` to a credential-like filename rule, `symlink` to symlink, `submodule` to submodule, and `unsafe-path` to unsafe path. These are metadata flags; they do not assert that file content was inspected.
- `secret-content`, `unsafe-content` and instruction-like-content findings must arrive separately from the content-screening boundary. `adaptFileCandidate` accepts that structured finding as `screeningFinding`; it never infers it from a filename or extension.
- The current inventory builder omits an unsafe tree path instead of returning an entry. To show that path in the excluded view, assembly must pass a metadata-only exclusion record with `code: "unsafe-path"`. It must not fetch or expose source text for it.
- Excerpt previews are populated only from the already selected evidence bundle and retain the exact commit SHA, blob SHA, source range and excerpt hash. The component provides no inspect callback for eligible or excluded inventory rows.
- Task 07 allocation and missing-feature output map directly to `allocations` and `missingFeatures`. Keep inventory count, selected count and eligible count from their separate sources; do not derive a complete inventory from a partial response.
- A selection or snapshot revision mismatch maps to `stale: true` and/or `staleSelectionMessage`. The parent owns re-preparation and consent invalidation.

## Assembly requirements

The final workspace owner must pass repository and commit scoped IDs, the structured backend exclusion codes, exact selected excerpts and allocation provenance. Preserve the existing file and excerpt budget checks at the parent boundary. Keep the current production request/consent behavior; this view only presents data and emits add/remove/replace intents. The local-only harness is gated by `isGithubImportHarnessEnabled` and uses fictional fixtures with no network or provider calls.
