import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { publishGithubPreviewSecrets } from "./lib/github-preview-secrets.mjs";
import {
  githubAppManifest,
  consumeManifestCallback,
  previewOrigin,
} from "./lib/github-app-manifest.mjs";

const cliIndex = process.argv.indexOf("--vercel-cli");
const cli = cliIndex >= 0 ? process.argv[cliIndex + 1] : undefined;
if (!cli)
  throw new Error("Pass the installed Vercel CLI path with --vercel-cli.");
const state = randomBytes(32).toString("base64url");
let consumed = false,
  localOrigin,
  stage = "waiting for GitHub callback";
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (
    request.headers.host !== new URL(localOrigin).host ||
    request.socket.remoteAddress !== "127.0.0.1"
  ) {
    response.writeHead(403);
    response.end("Local setup only.");
    return;
  }
  try {
    if (request.method !== "GET") throw new Error("Use GET.");
    if (request.url === "/") {
      const manifest = githubAppManifest(`${localOrigin}/callback`);
      response.end(
        `<title>Connect the Preview GitHub App</title><h1>Create your Preview GitHub App</h1><p>Read-only access to repositories you choose. GitHub generates the credentials; this local helper stores them directly as encrypted phase-one Preview settings in Vercel.</p><form method="POST" action="https://github.com/settings/apps/new"><input type="hidden" name="state" value="${escape(state)}"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button>Create App on GitHub</button></form>`,
      );
      return;
    }
    if (consumed) throw new Error("This setup link has already been used.");
    const code = consumeManifestCallback(request.url, state);
    consumed = true;
    stage = "exchanging GitHub App manifest";
    const converted = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "resume-changer-setup",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!converted.ok)
      throw new Error("GitHub App registration could not be completed.");
    const app = await converted.json();
    if (
      !Number.isSafeInteger(app.id) ||
      typeof app.client_id !== "string" ||
      typeof app.client_secret !== "string" ||
      typeof app.pem !== "string" ||
      !app.pem.includes("PRIVATE KEY") ||
      !/^[-a-z0-9]+$/.test(app.slug)
    )
      throw new Error("GitHub returned an incomplete App configuration.");
    const entries = {
      GITHUB_APP_ID: String(app.id),
      GITHUB_APP_CLIENT_ID: app.client_id,
      GITHUB_APP_CLIENT_SECRET: app.client_secret,
      GITHUB_APP_PRIVATE_KEY: app.pem,
      GITHUB_APP_CALLBACK_URL: `${previewOrigin}/api/github/connection/callback`,
      GITHUB_APP_SLUG: app.slug,
      GITHUB_VAULT_KEY: randomBytes(32).toString("base64"),
      GITHUB_HOSTED_NAMESPACE: "phase-one",
      GITHUB_RUNTIME_ENABLED: "1",
    };
    stage = "storing phase-one Preview credentials";
    publishGithubPreviewSecrets(entries, cli);
    stage = "starting phase-one Preview rebuild";
    const rebuild = spawnSync(
      process.execPath,
      [
        cli,
        "redeploy",
        new URL(previewOrigin).hostname,
        "--environment",
        "preview",
        "--no-wait",
        "--scope",
        "ayushs-projects-ab23dbca",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    const rebuilding = rebuild.status === 0;
    response.end(
      `<title>GitHub App created</title><h1>App created and credentials stored securely</h1><p>${rebuilding ? "The phase-one Preview is rebuilding with the new credentials." : "Rebuild the phase-one Preview from Vercel to apply the new credentials."} Next, install it on the repositories you want to test.</p><a href="https://github.com/apps/${escape(app.slug)}/installations/new">Choose repositories and install</a>`,
    );
    console.log(
      JSON.stringify({
        state: "configured",
        appId: app.id,
        installationUrl: `https://github.com/apps/${app.slug}/installations/new`,
      }),
    );
  } catch {
    response.writeHead(400);
    response.end(
      "Setup could not complete. Check this helper's status; no credentials have been printed. Restart setup for a fresh registration attempt.",
    );
    console.error(
      JSON.stringify({
        state: "failed",
        stage,
        credentialsPrinted: false,
        message: "GitHub App setup failed.",
      }),
    );
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
localOrigin = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ setupUrl: localOrigin, expiresInMinutes: 30 }));
setTimeout(() => server.close(), 30 * 60 * 1000).unref();
