# Production operations

## Services and environments

The public Next.js application runs on Vercel in Frankfurt. Firebase Google
Authentication identifies users; the named Firestore Enterprise Native database
`resume-changer` in `europe-west3` stores account records. Generated PDFs use a
private Vercel Blob store in `fra1`. Firebase stays on Spark and Vercel stays on
Hobby. Storage and service quotas can interrupt availability; there is no promise
of unlimited free capacity.

Only production receives real Firebase configuration, the server-only Gemini
secret, and the private Blob connection. Preview deployments have no production
credentials. Never add owner backups or personal JSON to Git, build inputs, test
fixtures, CI artifacts, or preview configuration.

For ordinary development use `RESUME_APP_MODE=local`. Hosted execution forces
Firebase mode and fails closed if configured as local. Automated browser tests
force local mode and fictional fixtures. Security tests use only a `demo-` project
and loopback emulators; those settings are rejected on Vercel.

## Release checks

`Quality checks` runs formatting, lint, types, dependency auditing, unit tests,
build, and browser regressions. `Account security` runs real Firebase rule attacks,
authenticated HTTP tests, and Google-popup browser tests. `Hosted PDF runtime`
packages and exercises the actual Linux compiler offline, without Poppler.
The existing real PDF and live Gemini jobs remain visible separately. Provider
quota failures retain their true status and must not be reported as an AI pass.

Vercel is connected to `AyushGahtori/resume-changer`, production branch `main`.
Merge reviewed changes after the required GitHub checks. Do not release personal
data to previews. Database rules/indexes need their own verified deployment:

```powershell
npx -y firebase-tools@15.34.1 deploy --only firestore --project resume-changer-ayush-prod
```

Firebase CLI 15.34.1 enables the provider but does not apply `authorizedDomains`
from `firebase.json`. Apply and verify the exact website domains explicitly:

```powershell
npm exec --yes --package=firebase-tools@15.34.1 -- node scripts/sync-auth-domains.mjs --project resume-changer-ayush-prod --apply
```

Omit `--apply` for a read-only configuration check. This command uses the pinned
CLI's existing login and refuses a project that differs from `.firebaserc`. It
reads the backend setting back and fails if the requested list was not applied.
The production website and protected project alias must both be authorized.
The approved `phase-one` Preview uses the existing Firebase account configuration,
so its stable branch hostname must also be explicitly authorized. Share
`https://resume-changer-git-phase-one-ayushs-projects-ab23dbca.vercel.app/sign-in`
for interactive testing. An immutable deployment URL has a different hostname;
authorize it separately before sharing a Google sign-in link. Never authorize
all `vercel.app` domains or remove existing production entries to enable a Preview.
The previously shared `resume-changer-1a9nxylqw-ayushs-projects-ab23dbca.vercel.app`
is retained explicitly so that link works too. New Preview builds under the
stable branch hostname do not require another Firebase domain change.

This administrative operation uses the operator's CLI login. No administrator
key is stored in the application or repository. Rule changes require
`npm run test:security` first. Enterprise indexes use explicit dense indexes,
with no Standard-edition field overrides.

For a release candidate, inspect the linked project and commit, then stage a
production build with `vercel deploy --prod --skip-domain`. Verify that exact
deployment before `vercel promote <deployment-url>`. A rollback returns traffic
to the previous known-good production deployment; check authentication, data
compatibility, and PDF access after rollback. Never roll back to the original
shared-filesystem application on the public site.

## Account and file boundaries

Every private API verifies the Firebase token signature, project, issuer, expiry,
Google provider, verified email, and current backend account/revocation state.
The HttpOnly cookie lasts at most one hour. Mutations require same-origin access
and an intended-account header matching the verified UID. Browser drafts are
namespaced by account; sign-out clears that account's cached drafts.

Database access uses FirebaseServerApp with the user's ID token and remains
subject to Security Rules. Root accounts cannot be listed. Libraries and history
use transactions, revisions, strict envelope schemas, size bounds, and atomic
usage-counter proofs. History pages contain at most 50 records. Bounded Core
queries are used deliberately because Pipeline rules cannot enforce query limits.
Library payloads are opaque JSON to Firestore rules; the app applies full schema,
cross-reference, depth, collection-size, byte-size, and URL-protocol validation
before use. Direct SDK writes can corrupt only that user's bounded payload;
malformed records fail closed in the app.

PDF paths are derived from the verified UID, generation ID, and SHA-256. There
are no public Blob URLs in API responses. Downloads pass through authenticated
routes and verify file hashes. Each saved PDF is at most 2 MB. Current daily
per-account ceilings are 20 AI requests, 60 compilations, 120 library mutations,
60 history mutations, and 30 PDF uploads. New requests to a depleted service
return an error; no provider quota result is silently called AI-generated.

History deletion removes access and records a permanent generation tombstone
atomically. A private deletion job removes all versions after a grace period,
retrying on later history access if storage is unavailable. The UI reports pending
cleanup truthfully. This is not a time-guaranteed background erasure service.
Failed uploads/saves can leave bounded private orphan files; operators should
periodically reconcile account prefixes against saved metadata, after allowing
in-flight requests to finish. Never delete an unverified prefix or active hash.

Compilers receive no application credentials, use random isolated temporary
directories, the fixed template and a formatting-command allowlist, Tectonic's
untrusted/offline mode, bounded output, and time limits. Files are removed after
each request. Hosted requests share a 250-second processing budget inside the
300-second function limit.

The Settings page also provides **Check PDF service**. It compiles a fictional
one-page sample through the actual hosted runtime, consumes the account's compile
allowance, and leaves saved history and private source data unchanged. Use it
before promoting a candidate; a successful build alone does not verify runtime
asset tracing or compiler execution.

## Migration and recovery

Prepare the owner's backup locally with the schema-validated backup script.
Check the destination email and source/artifact hashes. Sign into the actual app
as that email, import through Settings, and verify the authenticated read-back.
An identical saved-generation import is idempotent; a conflicting ID is rejected.
Library replacement requires an explicit checkbox. Keep the original files and
ignored backup until the owner verifies the cloud records and PDFs.

Users can export their library and download saved LaTeX/PDF outputs. Store those
backups somewhere private. Free-tier configuration does not include point-in-time
recovery or automated off-site backups. Deleting a Firebase Auth user does not
automatically erase their Firestore subcollections or Blob prefix: an operator
must verify the UID and complete account-data cleanup before removing identity.
Self-service account erasure is a follow-up feature, not an existing guarantee.

## Monitoring and incident handling

Check Vercel failures/latency and Blob usage, Firebase authentication errors and
database usage, and Gemini provider quota. Logs should contain diagnostic codes,
not resumes, prompts, tokens, or personal imports. Never publish pulled environment
files or authenticated browser recordings. If abuse exhausts free allowances,
pause expensive endpoints or public onboarding while investigating; per-user
quotas do not prevent an attacker from creating many Google accounts. App Check,
stronger edge rate limits and global service budgets should be evaluated before
a broad public launch. These tests establish specific boundaries, not a guarantee
against every possible attack.
