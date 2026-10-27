# GitHub App setup for phase-one

The integrated page is on `phase-one`. Main and Production are unchanged. Real imports require your own GitHub App; the Codex GitHub connection is separate and cannot provide the website's credentials.

## Prepared registration

Run `node scripts/prepare-github-app.mjs https://YOUR-STABLE-PREVIEW-ORIGIN "Resume Changer Preview"`. Open the returned `registrationUrl` in your signed-in GitHub browser. This prepares the form; it does not create an App or print credentials.

[Open the prepared phase-one Preview registration form](https://github.com/settings/apps/new?name=Resume+Changer+Preview&description=Import+selected+repository+evidence+into+reviewed+resume+achievements.&url=https%3A%2F%2Fresume-changer-git-phase-one-ayushs-projects-ab23dbca.vercel.app&callback_urls%5B%5D=https%3A%2F%2Fresume-changer-git-phase-one-ayushs-projects-ab23dbca.vercel.app%2Fapi%2Fgithub%2Fconnection%2Fcallback&public=false&webhook_active=false&request_oauth_on_install=false&contents=read&pull_requests=read&metadata=read). Check these settings in your GitHub account before creating the App.

The form requests repository **Contents: read**, **Pull requests: read**, and **Metadata: read**. No write permissions or account administration are needed. Webhooks are disabled. The callback is exactly `/api/github/connection/callback` on that Preview origin. Begin authorization from the website's Connect button, so the session, state and PKCE checks exist before the callback.

Use a separate Preview App restricted to its owner initially. Install it only on selected repositories. Keep user access-token expiration enabled. A later public release needs its own App, callback and server configuration; it is not part of this branch's Preview test.

GitHub documents this registration mechanism in [Registering a GitHub App using URL parameters](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters).

## Credentials and runtime prerequisites

After creating the App, GitHub supplies the App ID, Client ID, client secret, and a downloadable private key. These belong in server secret storage only, with distinct Preview and Production values. Never put them in `NEXT_PUBLIC_*`, commit them, paste them into chat, or include them in diagnostics. `GITHUB_APP_CALLBACK_URL` and the app origin are public server configuration.

Registration alone does **not** enable live imports. The current default services deliberately return unavailable until a runtime factory provides the encrypted credential vault, durable authorization metadata, real App token exchange, trusted per-account contexts and transport. The local backend/worker assembly is implemented. Vercel additionally needs a hosted durable persistence and worker adapter; it must never use the local filesystem store or a browser-owned job loop. Existing Firebase billing settings are unchanged.

The Gate C integration test substitutes only the external GitHub/AI boundaries and uses the real local stores, selector, queue, worker, API handlers and approval writer with fictional data. This verifies the assembled workflow; it does not claim a real App connection or hosted worker is configured.

## Enablement checklist

- Register/install the Preview App using the prepared form.
- Configure the server-only exchange and encrypted vault bindings; verify permissions again when issuing a repository-scoped installation token.
- Provide durable hosted adapters before enabling imports on Vercel.
- Verify the complete Preview journey with a deliberately selected repository: connect → pin → select PRs/files → consent → background result → confirm → save.
- Verify another account cannot read the import, jobs, answers, notifications or saved achievements.
- Keep the feature unavailable until those checks pass. Do not promote this branch to Production automatically.
