import { createServer } from "node:http";
import { createPrivateKey, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { publishGithubPreviewSecrets } from "./lib/github-preview-secrets.mjs";
import { previewOrigin } from "./lib/github-app-manifest.mjs";

const cliIndex = process.argv.indexOf("--vercel-cli");
const cli = cliIndex >= 0 ? process.argv[cliIndex + 1] : undefined;
if (!cli)
  throw new Error("Pass the installed Vercel CLI path with --vercel-cli.");

let localOrigin;
let stage = "validating submitted settings";
const state = randomBytes(32).toString("base64url");
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (
    request.headers.host !== new URL(localOrigin).host ||
    request.socket.remoteAddress !== "127.0.0.1"
  ) {
    response.writeHead(403).end("Local setup only.");
    return;
  }
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<title>Configure existing GitHub App</title><h1>Configure your existing Preview App</h1><p>In GitHub Developer settings, open the App you just created. Copy its App ID and Client ID, generate a fresh client secret, and download a new private key. These values are sent only to this local helper and stored as sensitive phase-one Preview settings.</p><form method="POST" action="/configure"><input type="hidden" name="state" value="${state}"><label>App ID <input name="appId" required pattern="[0-9]+"></label><br><label>Client ID <input name="clientId" required></label><br><label>Client secret <input name="clientSecret" type="password" required autocomplete="off"></label><br><label>App slug <input name="slug" required pattern="[-a-z0-9]+"></label><br><label>Private key PEM<br><textarea name="privateKey" required rows="14" cols="90" autocomplete="off"></textarea></label><br><button>Store Preview settings</button></form>`,
    );
    return;
  }
  if (request.method !== "POST" || request.url !== "/configure") {
    response.writeHead(404).end("Not found.");
    return;
  }
  let body = "";
  try {
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 64 * 1024)
        throw new Error("form too large");
    }
    const fields = new URLSearchParams(body);
    if (fields.get("state") !== state) throw new Error("state mismatch");
    const appId = fields.get("appId") ?? "";
    const clientId = fields.get("clientId") ?? "";
    const clientSecret = fields.get("clientSecret") ?? "";
    const privateKey = fields.get("privateKey") ?? "";
    const slug = fields.get("slug") ?? "";
    if (
      !/^\d+$/.test(appId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(clientId) ||
      clientSecret.length < 8 ||
      clientSecret.length > 512 ||
      !/^[-a-z0-9]{1,100}$/.test(slug) ||
      !privateKey.includes("PRIVATE KEY") ||
      privateKey.length > 32 * 1024
    )
      throw new Error("invalid App fields");
    createPrivateKey(privateKey);
    const entries = {
      GITHUB_APP_ID: appId,
      GITHUB_APP_CLIENT_ID: clientId,
      GITHUB_APP_CLIENT_SECRET: clientSecret,
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_APP_CALLBACK_URL: `${previewOrigin}/api/github/connection/callback`,
      GITHUB_APP_SLUG: slug,
      GITHUB_VAULT_KEY: randomBytes(32).toString("base64"),
      GITHUB_HOSTED_NAMESPACE: "phase-one",
      GITHUB_RUNTIME_ENABLED: "1",
    };
    stage = "publishing settings to Vercel Preview";
    publishGithubPreviewSecrets(entries, cli, undefined, true);
    stage = "starting the Preview rebuild";
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
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<title>Configured</title><h1>Credentials stored</h1><p>${rebuild.status === 0 ? "Preview rebuild started." : "Credentials were stored; start a phase-one Preview redeploy from Vercel."} Install the App on only the repositories you want to connect.</p><a href="https://github.com/apps/${slug}/installations/new">Choose repositories</a>`,
    );
    console.log(
      JSON.stringify({
        state: "configured",
        redeployStarted: rebuild.status === 0,
      }),
    );
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    const safeCode =
      typeof error.code === "string" && /^[A-Z0-9_-]{1,64}$/.test(error.code)
        ? error.code
        : null;
    const safeStatus = Number.isInteger(error.status) ? error.status : null;
    const safeKey =
      typeof error.key === "string" &&
      /^GITHUB_[A-Z0-9_]{1,80}$/.test(error.key)
        ? error.key
        : null;
    const safeDiagnostic =
      typeof error.diagnostic === "string"
        ? error.diagnostic.replace(/[<>]/g, "").slice(0, 240)
        : null;
    response.end(
      `Setup failed at: ${stage}. Safe status: ${safeStatus ?? "none"}. Safe code: ${safeCode ?? "none"}. Setting: ${safeKey ?? "none"}. Diagnostic: ${safeDiagnostic ?? "none"}. Credentials were not printed.`,
    );
    console.error(
      JSON.stringify({
        state: "failed",
        stage,
        status: safeStatus,
        code: safeCode,
        key: safeKey,
        diagnostic: safeDiagnostic,
        credentialsPrinted: false,
      }),
    );
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
localOrigin = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ setupUrl: localOrigin, expiresInMinutes: 30 }));
setTimeout(() => server.close(), 30 * 60 * 1000).unref();
