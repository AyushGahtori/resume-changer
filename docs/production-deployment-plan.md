# Firebase and Vercel production deployment

## Approved scope

- Publish the application on Vercel with sign-in and independent user accounts.
- Use Firebase for authentication and durable account data.
- Import the owner's existing local JSON data into the verified account
  `gahtoriayush24@gmail.com` only. Preserve referenced generation artifacts.
- Preserve the existing resume selection, drafting, rendering, and page-fit behavior.
- Keep private data, credentials, and migration payloads outside Git and CI artifacts.
- Provide a working release pipeline and verify the deployed user workflow.

The latest instruction supersedes the earlier private, single-owner deployment.
The implementation starts at main commit `f16e73c` on
`codex/task-31-firebase-vercel-production`.

## Baseline findings

- The existing quality workflow checks formatting, lint, types, unit/integration
  tests, production build, and browser tests. Separate live checks cover Gemini
  and the real PDF compiler.
- Personal library and history currently use server-local JSON files. A linked
  worktree discovers the primary checkout's ignored data directory.
- Generation artifacts currently use local files. Serverless deployment requires
  durable private storage and authenticated downloads.
- API routes currently have no account boundary. The hosted application must
  authorize every private read, write, AI request, and compilation request.
- Browser drafts, analysis caches, and editing sessions currently use shared
  local-storage keys. Those keys must be scoped to the signed-in user.
- PDFs require Tectonic, its cached TeX packages, and Poppler. The deployment must
  provide and exercise a compatible compiler environment before release.
- Vercel CLI 65.2.0 is available through npx but was signed out. No Vercel project
  link exists in this checkout. Firebase authentication/project discovery is pending.
- The primary local data directory contains `resume-library.json`,
  `generation-history.json`, and a `generations` directory. Contents remain private.

## Implementation sequence

### 1. Establish deployment resources

- [x] Fetch latest main and create a focused implementation branch.
- [x] Record the final account model and owner migration destination.
- [x] Authenticate Firebase and Vercel using their interactive login flows.
- [x] Resolve the intended Firebase project and database, including edition and
      region, before configuring the data model.
- [x] Resolve the intended Vercel team/project and production branch.
- [x] Establish separate production and test/preview resource configuration.
- [x] Configure environment variables without exposing credential values.

### 2. Authentication and account isolation

- [x] Add Firebase sign-in, sign-out, loading, and account-error states matching
      the existing theme. Use Google sign-in as the initial provider.
- [x] Verify identity on the server. Use protected, HttpOnly sessions, revocation
      checks, same-origin mutation checks, and a bounded session lifetime.
- [x] Protect pages and every private API route; reject unauthenticated API calls
      before loading personal data or calling a provider.
- [x] Use the verified Firebase UID as the account key. Never accept an account
      identity or storage prefix from an untrusted request.
- [x] Scope browser drafts, analysis, and generation/edit sessions by UID and
      clear in-memory private state when switching or signing out.
- [ ] Test signed-out access, expired/revoked sessions, account switching, and
      attempts to read or mutate another account's records.

### 3. Durable account storage

- [x] Introduce a storage boundary while retaining explicit local operation for
      development and existing tests. Hosting must never fall back to shared disk.
- [x] Store validated libraries and generation metadata under account ownership;
      use transactions/revisions to prevent concurrent update loss.
- [ ] Store generated files privately; download only after account authorization.
- [x] Create empty account onboarding and validated library JSON import/export.
- [x] Add cloud-access rules and tests. FirebaseServerApp access
      retains the user identity and is checked by the same rules.
- [x] Add bounded AI/compilation usage and request limits enforced across instances.
- [ ] Test CRUD, concurrent writes, malformed imports, deletion, missing artifacts,
      storage failures, and two-user isolation with fictional data.

### 4. Production PDF and AI runtime

- [x] Supply a pinned Linux Tectonic binary and the template's required TeX cache,
      or a verified authenticated compiler service if bundling is unsuitable.
- [ ] Measure the resulting function package against Vercel's actual deployment
      limits; include only required runtime assets.
- [ ] Verify page counting and PDF text measurement in the deployed runtime.
- [ ] Bound temporary files, compiler concurrency, input sizes, and total request
      duration. Preserve the existing template and evidence validation.
- [ ] Exercise manual generation, Auto Tailor, editing/recompilation, PDF preview,
      export, and saved-history reopening against the hosted runtime.

### 5. Owner data migration

- [x] Validate local JSON with the application's schemas; inventory record counts
      and SHA-256 hashes without logging personal content.
- [ ] Resolve the verified owner account by exact email and record its UID.
- [x] Create a local backup and an idempotent import manifest. Do not replace an
      existing nonmatching cloud library/history silently.
- [ ] Import the library, history, and referenced LaTeX/PDF artifacts to that UID.
- [ ] Verify counts, source IDs, file hashes, and an authenticated read-back.
- [ ] Verify another account cannot access imported content.

### 6. Release and operations

- [x] Add deployment configuration and setup/runbook documentation.
- [x] Keep preview environments isolated from production personal data.
- [ ] Run meaningful authentication/storage regressions plus the repository's
      required quality gate and real PDF integration checks.
- [ ] Add a pipeline that releases the reviewed commit after required checks,
      stages a production candidate, verifies it, and promotes the tested build.
- [ ] Verify deployed configuration, authorized authentication domains, private
      caching behavior, server error reporting, rollback, and data recovery.
- [ ] Publish the production URL and report actual verification results and any
      remaining operational limits. Do not label an incomplete deployment ready.

## Verification boundaries

Automated tests use fictional accounts, libraries, and outputs. Live provider tests
retain their actual pass/fail status; provider quota errors are not converted into
success. Personal JSON is used only for the authorized owner migration after the
destination identity and private-storage access have been verified.

## Work log

- 2026-10-25: Created the isolated worktree at latest main, established the task
  branch, and recorded hosting gaps. User finalized public multi-user scope,
  selected Firebase, and explicitly authorized migrating current local JSON data
  into the account identified above. No cloud resources or personal records have
  been created or uploaded yet.

- Subsequent setup: both CLIs are authenticated. Created Firebase project
  `resume-changer-ayush-prod`, web app `1:642436453923:web:b3ef7fb88196f3deb74396`,
  and the named Enterprise Native database `resume-changer` in `europe-west3`.
  Database deletion protection is enabled and the API reports free-tier eligibility.
- The owner chose to keep Firebase on its free plan. Firebase Cloud Storage needs
  Blaze billing, so generated PDFs instead use the private Vercel Blob Hobby store
  `resume-changer-production` (`store_VM9Rczion9FP9dqD`) in `fra1`, connected only
  to the production environment. No paid plan was enabled. Hobby quota exhaustion
  can pause storage; this deployment does not promise unlimited capacity.
- Created and linked Vercel project `resume-changer`
  (`prj_9HlL8EmOJl9qQC4Iie8bTWkk4bS1`) under `ayushs-projects-ab23dbca`.
  Google authentication is enabled. Remote Firestore rules are still deny-all;
  the account-specific rules in the working tree are not yet released.
- Implemented authentication/session groundwork, account-bound API guards,
  account-specific browser drafts, cloud library/history repositories, private file
  access, account import/export UI, and a local owner-backup builder. These remain
  under integration review; no personal data has been uploaded.
- Server database access uses FirebaseServerApp with the verified user's ID token
  and remains subject to database rules. No Firebase administrator credential is
  installed in the app. History intentionally uses bounded Core queries because
  Pipeline rules cannot enforce `request.query.limit`. Metadata, LaTeX content,
  and private PDF bytes have separate storage paths.
- Upgraded vulnerable dependencies and patched compatible transitive packages.
  The complete npm audit currently reports zero known vulnerabilities.
- Initial verification: 14 cloud/security unit tests pass; 10 real Firestore
  emulator attack tests pass. The Java 21 emulator runtime is kept in ignored
  `.runtime/java`. The rules suite must be expanded and rerun after further changes.
- Built a pinned, checksum-verified Linux Tectonic package and warmed the template
  cache: 78.6 MB. All four actual packaged-runtime tests passed on Linux, including
  page counting/overflow without Poppler and simultaneous-user output isolation.
  The isolated Linux verification checkout is `/tmp/resume-production.SMQsbw`
  inside the Debian WSL distribution. It contains fictional fixtures only.
- Remaining integration work includes atomic database usage-proof enforcement,
  private file deletion/retry consistency, account-switch retry regressions,
  bounded request deadlines, security headers, the hosted-account browser flow,
  CI/release configuration, deployed runtime measurements, and the authorized
  owner migration with authenticated read-back. Full repository checks have not
  yet been run on this implementation.

- The authenticated HTTP integration suite now passes against real local Auth and
  Firestore emulators. The Google popup browser flow also passes, including
  empty-account onboarding and sign-out. A concurrent-edit regression is being
  added. Production build passes; full existing browser regression suite is running.
- Prepared an ignored, owner-bound migration backup: 2 jobs, 1 project, 25
  achievement points, 100 skills, 3 credentials, and 3 saved PDFs. Source hashes
  were checked. No owner data has been uploaded.
- Firestore deployment caught an edition mismatch in index configuration before
  publication: Enterprise uses explicit dense indexes and does not support Standard
  field-index overrides. Updated configuration to the detected Enterprise edition.

- Current verification: all 775 unit tests pass, plus subsequent compiler-capacity
  and session-cancellation regressions. Formatting/lint/types passed before the
  final concurrency hardening. The existing 570-test browser suite has reached
  its final cases without failures. Actual packaged Linux PDF tests pass again
  with the hosted command boundary, using 78.6 MB of runtime assets.
- The account concurrency regression exposed an optimistic-transaction conflict
  reported as a rule rejection rather than an aborted transaction. Added a bounded
  retry only after a fresh authorized read proves the library revision advanced.
  Timestamp recognition now tolerates SDK instances from separate route bundles.
- Browser emulator tests now stub an optional cosmetic CDN script and wait for
  the widget's click handlers, avoiding dependence on third-party CDN timing.
- Firebase rules and explicit Enterprise indexes are deployed. Vercel has only
  production app/provider configuration. Blob uses its connected store ID and
  short-lived OIDC; the automatically created static-token environment variable
  was removed. No Firebase administrator secret is used by the app.

- All 570 existing Playwright browser regressions passed (20.8 minutes locally).
  The seven account HTTP/browser tests pass after concurrency and sign-out
  hardening. The final browser import regression now also uses a fictional JSON
  upload. Linux packaged PDF verification passes with the two-slot bounded pool.
- Split CI browser regressions into four independent shards so the same complete
  suite can finish faster without sharing fixture data between runners. Added
  required setup for Chromium in the separate account-security job.
- The owner backup is still local only. Remaining release work is candidate
  deployment, actual function/Blob verification, account sign-in and verified owner
  import, GitHub release gates, and promotion of the tested build.
- Candidate verification caught an upload exclusion bug before publication:
  unanchored `data/` removed application modules under `src/lib/data`, and local
  build caches were not explicitly excluded. Anchored private-data exclusions at
  the repository root, excluded all local build outputs, and added a packaging
  regression that checks both sensitive exclusions and required source inputs.

- The owner signed into the staged production app. The import UI verified the
  exact destination email, imported all 25 points/100 skills/3 credentials and
  three saved resumes, and verified authenticated library/LaTeX/PDF read-back
  hashes. Original JSON hashes are unchanged. The receipt and screenshot are in
  ignored `.runtime` files, and no personal records entered Git or CI.
- A real anonymous Firestore request for the imported library was denied (403).
  Signed-out app API requests are denied (401). The deployed functions execute in
  Frankfurt; candidate bundle metadata reports roughly 41–43 MB function outputs.
- A browser console check caught Firebase's unapplied OAuth domain list despite
  a successful provider deployment. Applied the exact owned domains through the
  CLI's authenticated management client, then independently read them back.
  Added a pinned, repeatable domain-sync/check command and regressions.
- Added a bounded authenticated PDF readiness check in Settings. It compiles only
  fictional fixture evidence, returns readiness metadata, and leaves history
  unchanged. This enables verification of the actual hosted compiler without
  creating test resumes in the owner's account.

- The separate readiness route exceeded Hobby's 12-function deployment limit. Moved the same authenticated, quota-bound fictional check into the existing POST compiler endpoint. The real bundled Linux compiler verifies this exact fixture; no paid upgrade is required.

- Removed the blanket per-route maxDuration override after Vercel's deployment check still hit the Hobby function-packaging cap. Hobby Fluid Compute already defaults to 300 seconds, matching the app's 250-second request budget; leaving routes unconfigured lets Next.js/Vercel bundle compatible routes together.
