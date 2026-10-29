export function safeGithubInstallationUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/apps\/[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?\/installations\/new$/.test(
        url.pathname,
      )
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
export function githubInstallationUrl(slug: string | undefined) {
  return slug
    ? safeGithubInstallationUrl(
        `https://github.com/apps/${slug}/installations/new`,
      )
    : undefined;
}
