# Resume Changer: non-AI traffic testing implementation handoff

Revised 11 November 2026. This document replaces the earlier short plan. Implement the phases in order; this is a plan, not evidence that the implementation or load test has already run.

## 1. Decisions, boundaries, and free-tier findings

### 1.1 Intended outcome

Build useful manual library-entry forms, then run 1,000 distinct fictional users against a local production build with Firebase Auth and Firestore emulators. Maintain a rolling pool of 100 sessions after ramp-up. Support 120 as a separate local profile.

Use 950 API users and 50 browser users in the 1,000-user run. Each user finishes with a profile, twelve skills, two jobs with five achievements each, and two projects with five achievements each. Mark a user completed only after authenticated read-back proves the expected data persisted.

All newly exposed form fields are optional. Partial entries must save. Validate a provided value's format, rather than demanding a value. Keep internal IDs, account ownership, payload bounds, and existing achievement-text validation.

The first implementation includes manual entry, local synthetic identities, fixtures, a mixed browser/API runner, offline quota estimation, reporting, resume, cleanup, and tests. It does not include public guest access, hosted custom authentication, paid upgrades, cloud load execution, PDF compilation, GitHub import, or AI calls. JD analysis calls the AI provider and is excluded.

### 1.2 What was checked

- Live read-only Firebase metadata: project `resume-changer-ayush-prod`, billing disabled; database `resume-changer`, `FIRESTORE_NATIVE`, `ENTERPRISE`, `europe-west3`, `freeTier: true`, deletion protection enabled.
- Repository deployment configuration: Vercel Frankfurt (`fra1`); the runbook documents Hobby. Remaining production usage counters were not verified.
- The app stores each account's entire library as one JSON payload. A library mutation transaction writes that library document and the account's library usage document.

### 1.3 Hosting policy and resource limits

Vercel's published policy permits load testing only on Enterprise with advance coordination. The v1 runner must reject every non-loopback target before making a request. Do not disable protections or rotate IPs.

Relevant published Vercel Hobby allowances include 1 million CDN requests, 1 million function invocations, 4 active CPU hours, 360 provisioned-memory GB-hours, 100 GB fast data transfer, and 10 GB fast origin transfer. These figures are reference limits, not verified remaining balances.

The configured Firestore Enterprise Native edition has a free allowance of 50,000 read units/day, 40,000 write units/day, 50,000 real-time update units/day, 1 GiB storage, and 10 GiB outbound/month. Enterprise reads use 4 KiB tranches and writes use 1 KiB tranches.

Firebase lists account creation at 100 accounts/hour/IP. Demo Firebase projects use `demo-` IDs and have no live resources. Use an exact demo ID and explicit local emulator endpoints.

### 1.4 Corrected workload arithmetic

Save all twelve skills with one explicit Save skills operation.

| Successful operation per user  | Count | Library/usage document writes |
| ------------------------------ | ----: | ----------------------------: |
| Save profile                   |     1 |                             2 |
| Save twelve skills together    |     1 |                             2 |
| Create jobs                    |     2 |                             4 |
| Create projects                |     2 |                             4 |
| Save achievements individually |    20 |                            40 |
| Total mutations                |    26 |                            52 |

On a fresh account, initial account creation and empty-library initialization add approximately three document writes. This gives approximately 55,000 successful document writes for 1,000 fresh users, before retries, edits, or cleanup. Even the minimum 52,000 mutation writes exceeds 40,000 write units. This arithmetic is a code-based estimate, not a provider bill.

Free-tier rule for v1: the full simulation consumes zero Vercel or live Firebase workload. No automatic plan changes, resource creation, cloud account provisioning, or cloud cleanup.

## 2. Manual forms, optional fields, and APIs

Extend the existing Achievement Library. Preserve its layout, themes, action styles, inline editor behavior, and read-only demo state.

| Surface          | Fields                                                                                                | Save behavior                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Edit profile     | Name, headline, resume contact email, phone, location; expandable link URLs                           | One explicit profile save; no change to the authentication email    |
| Add/Edit job     | Company, title, start month, end month, Current role; optional employment type, location, description | One metadata save; preserve achievements                            |
| Add/Edit project | Name, role, URL, description; optional start/end months and Ongoing project                           | One metadata save; preserve achievements and repository attachments |
| Add skills       | Optional comma/newline-separated skill names                                                          | Merge named skills in one save; do not remove existing skills       |

Use Save and Cancel, disabled duplicate submission while pending, inline errors, and a success announcement only after a successful server response. No asterisks, `required`, or `aria-required=true` on these new inputs. Opening and cancelling a form must cause no mutation. An empty new job or project, an empty skills input, or an unchanged profile is a successful no-op.

In both supported library schema versions, missing or blank profile `fullName`, job company/title, and project name normalize to `""`. Job `employmentType`, `startDate`, and `endDate` are optional. Missing end date means unknown. `endDate: null` means explicitly current or ongoing. Use `Untitled job`, `Untitled project`, or `Your profile` only as presentation labels.

| Endpoint                        | Request                     | Response               |
| ------------------------------- | --------------------------- | ---------------------- |
| `PATCH /api/library/profile`    | `{ changes }`               | `{ profile, changed }` |
| `PUT /api/library/jobs/:id`     | `{ changes }`               | `{ job, changed }`     |
| `PUT /api/library/projects/:id` | `{ changes }`               | `{ project, changed }` |
| `PUT /api/library/skills`       | `{ items: [{ id, name }] }` | `{ skills, changed }`  |

Return 201 for an actual new job or project, 200 for an update or no-op, 400 for malformed fields, 401/403 for authentication or ownership failures, 409 for record conflicts, 413 for payload bounds, and 429 for the account quota. For a no-op creation, return `job: null` or `project: null` and `changed: false`.

Use `protectAccountRoute`, same-origin checks, `X-Workspace-Account`, `apiFetch`, and `commitLibraryMutation`. When a cloud mutation returns `persist: false`, do not write the library or usage document. Preserve the 120 library mutations per account window.

## 3. Local environment, identities, fixtures, and traffic runner

The runner, fixtures, emulator config, and browser sign-in helper live in `dev/load-test/`. That folder is developer tooling. It is not a product surface, and the sign-in helper is not part of the committed app routes. The local load-test build copies it into place and removes it when the build finishes.

Suggested files:

- `dev/load-test/run.mjs`
- `dev/load-test/{bootstrap.cjs,outbound-guard.cjs,config,safety,fixtures,auth,api-driver,browser-driver,scheduler,report,estimate}.mjs`
- `dev/load-test/firebase.json`
- `dev/load-test/fixtures/catalog.json`
- `dev/load-test/browser-auth/page.tsx`

Defaults:

```text
baseURL=http://127.0.0.1:3020
RESUME_APP_MODE=firebase
NEXT_DIST_DIR=.next-load-test
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-resume-changer-loadtest
NEXT_PUBLIC_FIREBASE_DATABASE_ID=(default)
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
FIRESTORE_EMULATOR_HOST=127.0.0.1:8088
RESUME_LOAD_TEST=1
AI_PROVIDER=mock
```

Launch Next with `node --require <bootstrap> <next-cli> <build-or-start>`. The bootstrap loads environment config from an empty directory and blocks non-loopback transports. Start emulators with `--project demo-resume-changer-loadtest --config dev/load-test/firebase.json`. Preflight requires a loopback target, the demo project, matching emulator endpoints, and a local safety response. If a port is occupied, stop and report it.

Authenticate through the Auth emulator `accounts:signInWithIdp` flow with `user-<number>@example.test`. Record the UID the emulator returns. Browser contexts sign in through the helper copied from `dev/load-test/browser-auth` for that local build only. The helper and safety response return 404 unless the local demo configuration and `RESUME_LOAD_TEST=1` are present. The deployed app does not include the helper.

Fixtures are static. The default seed is 42. Each user's PRNG seed comes from the run seed and user number. Select two jobs, two projects, and twelve skills. Ten percent of users leave optional contact fields and some dates blank.

Default scheduler:

```json
{
  "users": 1000,
  "concurrency": 100,
  "browserPercent": 5,
  "seed": 42,
  "apiRps": 20,
  "startsPerSecond": 1
}
```

Ramp through 5, 20, 50, then the configured pool, with sixty seconds at each intermediate target. Admit one new session per second. A shared leaky bucket spaces application API starts at least 50 ms apart for 20 RPS, with no stored burst credits. Browser concurrency is `ceil(concurrency * browserPercent / 100)`.

## 4. Failure handling, estimates, and artifacts

In the local load-test runtime, allow the session, read-only history and library, new metadata, and manual point endpoints only. Deny AI, generation, compilation, resume editing, and GitHub import before a handler runs. Provider construction throws in this mode.

GET requests may retry once. Do not blindly retry a mutation. Reconcile a timeout by reading the library. Resume refuses a changed target, seed, fixture hash, user total, or project. SIGINT stops admissions, waits up to thirty seconds, and never labels the run passed.

`--estimate` reports an estimated lower bound only. It is not a bill and not permission to run remotely.

Each run writes under `.runtime/load-test/<run-id>/`: `config.json`, `manifest.json`, `events.ndjson`, `summary.json`, `report.md`, and capped browser failure screenshots. Do not store tokens, cookies, or real emails.

Commands:

```text
npm run test:load:estimate -- --users 1000 --seed 42
npm run test:load:smoke
npm run test:load -- --users 1000 --concurrency 100 --browser-percent 5 --seed 42
npm run test:load -- --users 1000 --concurrency 120 --browser-percent 5 --seed 42
npm run test:load -- --resume <run-id>
npm run test:load:cleanup -- --run-id <run-id>
```

Exit codes: 0 passed, 1 failed assertions or performance criteria, 2 configuration or preflight refusal, 3 interrupted or timed out.

## 5. Acceptance

Phase A covers optional schemas, readers, writers, no-op persistence, and API tests. Phase B covers the library forms. Phase C covers the isolated runtime. Phase D covers the scheduler, reporting, and recovery. Phase E runs formatting, typecheck, lint, unit tests, security tests, the production build, the estimate, smoke, and then the explicit local profiles.

A full local profile passes only when 1,000 distinct users complete, with 950 API users and 50 browser users, zero AI or external requests, API p95 below two seconds, p99 below five seconds, and unexpected application errors below 1%. A local emulator run is not evidence that the hosted free deployment can serve the same concurrency. Hosted execution remains disabled.
