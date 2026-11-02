# GitHub App connection setup

The connection routes require an owner-managed GitHub App and server-side
composition. They do not accept a personal access token from the browser.

Configure the app's Client ID, Client Secret, and private key only in the
server environment or its secret manager. Set GITHUB_APP_CLIENT_ID and
GITHUB_APP_CALLBACK_URL for the server composition. Keep .env.local ignored
and never use NEXT_PUBLIC_ variables for credentials.

Register the exact callback URL /api/github/connection/callback. Disable
wildcard callback matching. For local HTTP development, use the same
http://localhost hostname and port in the browser and callback URL; local HTTP
is accepted only on loopback. For hosted use, configure RESUME_APP_ORIGIN and
an HTTPS callback on that exact origin. HTTPS uses a __Host- session cookie
with Secure; loopback HTTP uses an HttpOnly, SameSite=Lax cookie without
Secure because browsers reject Secure cookies on ordinary localhost
development.

Grant only the read permissions needed for repository metadata, contents, and
pull requests. Select the app's repository access deliberately and request
organization approval when GitHub requires it. GitHub account authorization,
app installation access, and a person's contribution are separate checks.

The access adapter must use an encrypted or OS-backed credential vault and
must cancel jobs and invalidate caches on local disconnect. If the credential
vault or app configuration is unavailable, the route reports unavailable;
credentials are never moved to browser storage. Local disconnect removes this
app's credentials only. Users can separately revoke authorization or uninstall
the app in GitHub settings.
