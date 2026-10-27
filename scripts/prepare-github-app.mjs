import { pathToFileURL } from "node:url";

/** Produces public registration settings only. It never creates an App or accepts credentials. */
export function githubAppRegistration(origin, name = "Resume Changer Preview") {
  const site = new URL(origin);
  if (
    site.origin !== origin ||
    site.username ||
    site.password ||
    (site.protocol !== "https:" &&
      !(
        site.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(site.hostname)
      ))
  ) {
    throw new Error(
      "Use an exact HTTPS app origin, or a localhost HTTP origin.",
    );
  }
  if (!name.trim() || name.length > 34)
    throw new Error("Use an App name of 1–34 characters.");
  const callback = new URL("/api/github/connection/callback", site).href;
  const registration = new URL("https://github.com/settings/apps/new");
  const settings = {
    name,
    description:
      "Import selected repository evidence into reviewed resume achievements.",
    url: origin,
    "callback_urls[]": callback,
    public: "false",
    webhook_active: "false",
    request_oauth_on_install: "false",
    contents: "read",
    pull_requests: "read",
    metadata: "read",
  };
  for (const [key, value] of Object.entries(settings))
    registration.searchParams.set(key, value);
  return {
    registrationUrl: registration.href,
    callbackUrl: callback,
    permissions: { contents: "read", pull_requests: "read", metadata: "read" },
    environment: "Preview / local only",
    requiresServerSecrets: [
      "GITHUB_APP_ID",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_PRIVATE_KEY",
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const origin = process.argv[2];
  if (!origin)
    throw new Error(
      "Usage: node scripts/prepare-github-app.mjs https://YOUR-PREVIEW-ORIGIN [App name]",
    );
  process.stdout.write(
    JSON.stringify(githubAppRegistration(origin, process.argv[3]), null, 2) +
      "\n",
  );
}
