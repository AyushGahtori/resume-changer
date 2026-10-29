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
