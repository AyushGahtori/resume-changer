# Temporary GitHub import contract

Implemented on the integration branch from `phase-one` baseline `fcf0dc98b3296770d622069767ca02aa75996d73`. The owner explicitly chose the complete session redesign after reviewing the older task handoffs. Main and the other task worktrees are preserved.

## Ownership and transport

The browser module `session-client.ts` is the single coordinator for the current tab. It owns one opaque workspace capsule, a request queue and abort controllers in JavaScript memory. React owns visible excerpts and edits. Nothing writes source or unsaved review data to persistent browser storage. Workspace/account teardown, discard, completion and full reload release these references. Ordinary Next.js navigation can retain the capsule while the workspace shell remains mounted.

`POST /api/github/session` accepts `{version:1, operationId, state, path, method, body?}`. `state` is null only for a new import. Only the bounded import/job operation paths are allowed; absolute URLs and traversal are rejected. Every request authenticates the current account, validates its account header/origin and checks current repository authorization. The response is private, uncached NDJSON:

- `{type:"checkpoint", state}` after each completely downloaded, screened file, and before a paid attempt.
- `{type:"result", state, status, body}` once. The body uses the existing validated domain DTOs.

Preparation and extraction execute inside that request. A successful foreground operation returns HTTP 200 in the result event with a full completed job DTO; there is no acceptance-only receipt to misparse or status URL to poll. Internal job IDs remain short-lived operation identifiers inside the capsule for compatibility with the existing validated service. They are not durable background tasks.

The coordinator serializes dependent operations and consumes intermediate checkpoints. UI submission guards synchronously reject duplicate preparation, analysis and save clicks. It never automatically retries a failed or uncertain AI call. A transport abort stops queued/local work and signals the request; an already submitted provider call may still consume credits. Current GitHub source reads remain sequential: there is no two-download mode in this implementation.

## Integrity and limits

Capsules contain bounded, compressed working state encrypted and authenticated with AES-256-GCM. A separate HKDF purpose key derives from the existing 32-byte `GITHUB_VAULT_KEY`; credentials themselves are never included. UID, random session ID, contract version, state and expiry are authenticated together. Local development uses a process-random key when no vault key is configured; server restart invalidates those local capsules.

The envelope expires after 20 minutes without an import action. It has a 3,800,000-character token cap and a bounded decompression limit. Aggregate working file contents are capped at 4 MiB, with the existing stricter source, file, excerpt, HTTP and model budgets retained. Limit violations fail closed. Decrypted data is restored to a fresh AsyncLocalStorage request scope. Filesystem-shaped storage calls are an adapter to request memory, including the measurement interview namespace; they do not write files or Firestore. Services, locks and ledgers are request-local, never an authoritative process-global source cache.

Each completely downloaded safe file is cached immediately under account/session, repository, blob SHA and parser/safety versions. A failed later file does not erase earlier completed downloads. Partial bodies are not resumable and may be fetched again. A replacement request marks any in-flight operation interrupted and gets a fresh bounded ledger, never an abandoned HTTP reservation. After successful analysis, full downloaded files are released; current excerpts and model drafts remain for review. Default sequential reads and one coordinator prevent duplicate in-session workers or overlapping mutation writes.

Returning the capsule does not make browser-provided evidence trusted: it must decrypt and authenticate for the current account before any existing import, consent, measurement, output or approval validators run. Revoked credentials/grants cannot be replaced by an old capsule. Changed selection hashes require renewed exact-evidence consent.

## Allowed durable records

- Existing Firebase authentication, account data and encrypted GitHub credentials remain.
- Account daily usage counters remain authoritative across tabs: AI admission uses the existing `ai` quota, preparation uses the `files` quota.
- One server-only receipt document per hashed account in `github-session-operations-<namespace>` contains at most 60 hashed operation entries. Each stores only `state` (`started` or `finished`) and an expiry timestamp. AI identity binds the session, selection and consent, independently of optimistic UI versions. Atomic admission blocks duplicate calls, including concurrent/lost-response replays. A crash leaves a conservative uncertain admission. Entries expire logically after 24 hours and are pruned at the next admission; an inactive account can retain its bounded source-free document. No source, excerpts, inventories, prompts, outputs, tokens or user text are stored there.
- Explicit save uses the existing atomic library mutation and approval receipt. Only selected, confirmed achievements and small revision/path/line/hash provenance references are saved. New evidence records omit raw `excerpt`; existing historical records remain readable. Lost save acknowledgements are idempotent.

Direct legacy import/job/notification HTTP endpoints return a restart response outside the isolated local compatibility harness. Hosted composition no longer configures the Firestore source-store adapter, binds job owners, dispatches Workflow, or reads legacy jobs to disconnect. Legacy Workflow invocations fail closed. Old source-store modules remain for historical/local tests, not the new production request path. Historical durable source deletion requires a separately reviewed cleanup; this release does not delete saved or staged customer records.

## Reload and recovery

Reload cannot recover unsaved evidence: the browser no longer has the capsule. Old import URLs explain that the temporary import ended and offer a new import. Memory checkpoints recover interrupted work only while that tab still holds them. There is no cross-device recovery, background completion notification, persistent source cache, or promise to recover an unknown model output. Provider-side retention is governed by the provider, not browser-memory cleanup.
