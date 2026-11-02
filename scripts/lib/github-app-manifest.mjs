export const previewOrigin =
  "https://resume-changer-git-phase-one-ayushs-projects-ab23dbca.vercel.app";
export function githubAppManifest(localCallback) {
  const callback = new URL(localCallback);
  if (
    callback.origin !== `http://127.0.0.1:${callback.port}` ||
    callback.pathname !== "/callback" ||
    callback.search ||
    callback.hash
  )
    throw new Error("Use the local one-time setup callback.");
  return {
    name: "Resume Changer Phase One Ayush",
    url: previewOrigin,
    redirect_url: callback.href,
    callback_urls: [`${previewOrigin}/api/github/connection/callback`],
    public: false,
    request_oauth_on_install: false,
    hook_attributes: {
      active: false,
      url: `${previewOrigin}/api/github/webhook`,
    },
    default_permissions: {
      contents: "read",
      pull_requests: "read",
      metadata: "read",
    },
    default_events: [],
  };
}
export function consumeManifestCallback(url, expectedState) {
  const parsed = new URL(url, "http://127.0.0.1");
  if (
    parsed.pathname !== "/callback" ||
    parsed.searchParams.getAll("state").length !== 1 ||
    parsed.searchParams.get("state") !== expectedState ||
    parsed.searchParams.getAll("code").length !== 1 ||
    !/^[a-zA-Z0-9_-]{20,256}$/.test(parsed.searchParams.get("code") ?? "")
  )
    throw new Error("Invalid or expired GitHub setup callback.");
  return parsed.searchParams.get("code");
}
