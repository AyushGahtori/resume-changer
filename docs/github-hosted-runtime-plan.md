# Live GitHub import on phase-one

Scope: owner-managed GitHub App and hosted execution on the existing `phase-one` Preview. Main and Production stay unchanged; Firebase remains on its free plan. Repository code is never executed.

## Status

- [x] Implement branch-scoped App secret publication and a localhost GitHub App manifest setup helper.
- [x] Add an installation link so the owner can grant the App access to one or more selected repositories.
- [x] Add Firestore durable state with bounds, checksums, transaction locks and fencing.
- [x] Add encrypted credential storage, OAuth exchange/refresh, one-repository installation tokens, and server-side access metadata.
- [x] Bind background jobs to verified Firebase accounts and dispatch opaque job IDs through Vercel Workflow.
- [x] Provision a least-privilege Firebase service account for Preview and verify Firestore plus Auth lookup access without changing billing.
- [x] Add emulator security tests, provisioning tests and GitHub exchange tests.
- [ ] Owner creates the GitHub App and installs it on selected repositories.
- [ ] Rebuild Preview with the App secrets and verify the real connect → import → approve → save journey.

## Design boundaries

The existing local algorithms and contracts are shared. On Vercel, GitHub state routes to Firestore and fails closed when the durable adapter is missing. Browser rules deny internal collections. App secrets are stored only as sensitive `phase-one` Preview environment variables; the Firebase service account has conditional access to the selected Firestore database and a custom role containing only `firebaseauth.users.get`.

Vercel Workflow receives an opaque job ID only. The application job store still owns leases, fencing, budgets, cancellation, provider outcome and approval semantics. A retry cannot trigger another model call after an uncertain provider result. Repository access tokens are limited to one selected repository and read scopes.

Firestore state is gzip-compressed and capped at 700,000 compressed bytes per record to stay below Firestore's 1 MiB document limit. Expired job results follow existing retention behavior. Multiple selected repositories are supported as grants, while each import is scoped to one repository and a pinned revision.

## Validation

Automated unit tests use synthetic values. Emulator security tests exercise account isolation, ownership, encrypted credentials, stale workers, and browser-denied internal collections. The Vercel Preview service identity's Firestore transaction and Firebase Auth lookup were also tested against fictional probes, then the probes were removed. These checks do not prove the GitHub App has been created or installed; the two unchecked owner and Preview acceptance steps remain required.
