# GitHub App setup for phase-one

The hosted GitHub runtime is implemented on `phase-one` Preview. Main and Production remain unchanged. The remaining live step is creating an owner-managed GitHub App and installing it on selected repositories.

## Start the local setup helper on Windows

Run PowerShell from the repository checkout, not `C:\Users\Ayush`:

```powershell
Set-Location 'C:\Users\Ayush\.codex\worktrees\github-phase-one\re_changer'
$vercelCli = 'C:\Users\Ayush\AppData\Local\npm-cache\_npx\67eb4586ca667318\node_modules\vercel\dist\index.js'
node scripts/setup-github-app.mjs --vercel-cli $vercelCli
```

The helper prints a temporary `http://127.0.0.1:<port>` address. Open it on this computer, click **Create App on GitHub**, and confirm the App in your GitHub account. GitHub returns the generated credentials directly to the local helper, which stores them as sensitive `phase-one` Preview environment values and starts a Preview rebuild. It never prints the secrets. Keep the terminal and helper open until setup completes.

If the Vercel CLI path changes, locate its installed `dist/index.js` under `%LOCALAPPDATA%\npm-cache\_npx\` and use that path. Do not paste credentials into chat or create them as `NEXT_PUBLIC_*` values.

## Repository access

After GitHub creates the App, choose **Only select repositories** to install it on one repository or several repositories. Resume Changer lists the granted repositories; each import is pinned to one repository. The App asks only for **Contents: read**, **Pull requests: read**, and **Metadata: read**. It does not need write access. Reconnect GitHub to update the selected repository set later.

## Hosting and checks

The Preview runtime stores private state in server-only Firestore collections, encrypts GitHub credentials, and dispatches work through Vercel Workflow. A dedicated Firebase service identity has conditional access to the selected Firestore database and only the Firebase Auth user-lookup permission; Firebase remains on the free plan. Do not promote this Preview configuration to Production.

Automated tests use fictional repositories and emulator data. They cannot substitute for the final real Preview journey after App creation: connect GitHub, select a repository, pin its revision, review evidence, analyze, approve, and save. Verify account isolation and disconnect cleanup during that journey.

## Required Vercel Node loader option

On the exact `phase-one` Preview environment, set `NODE_OPTIONS=--experimental-require-module` and rebuild. The hosted build rejects an enabled GitHub runtime without this setting. Keep it scoped to this branch; do not change Production.

Firebase Admin 14 loads `jwks-rsa` 4, which synchronously requires the ESM-only `jose` 6 package. Vercel disables Node's require(ESM) capability by default. This caused `ERR_REQUIRE_ESM` before GitHub service initialization, even though credentials were present. The regular local Node runtime enabled the capability, so earlier local tests and builds passed. The regression now loads the real Firebase Admin auth/Firestore packages in a child Node process and checks the hosted configuration guard.

### Immediate “Connection expired” after authorization

The live callback diagnostics showed a returned code, a present state cookie and an exact state match, but the parser rejected additional query parameters before consuming the pending authorization. No GitHub connection or token had been created: this was callback parsing, not token expiry. The parser now ignores unused response parameters as required by [OAuth 2.0 section 4.1.2](https://www.rfc-editor.org/rfc/rfc6749#section-4.1.2). They are never forwarded to the access service or reflected in the redirect. Session binding, exact state matching, duplicate-parameter rejection, callback origin validation, PKCE and single-use pending authorization remain enforced.

The OAuth token and refresh requests explicitly negotiate `Accept: application/json`, as [GitHub documents](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps). The REST API media type remains on REST requests. A credential-free probe with fictional client credentials returned plain text for the REST media type and JSON for `application/json`; the regression checks the OAuth request's content negotiation. This was a separate interoperability issue found while tracing the exchange.

See [Vercel's Node configuration](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration#experimental-nodejs-require-of-es-module) and the [jwks-rsa v4 release notes](https://github.com/auth0/node-jwks-rsa/blob/master/CHANGELOG.md).
