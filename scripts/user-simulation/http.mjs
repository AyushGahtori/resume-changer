/** A hosting challenge is not an application error and must not be retried. */
export function isHostingChallenge(status, headers) {
  const mitigated = headers?.get?.("x-vercel-mitigated");
  const challenge = headers?.get?.("x-vercel-challenge");
  const contentType = headers?.get?.("content-type") ?? "";
  return Boolean(
    mitigated ||
    challenge ||
    (contentType.includes("text/html") &&
      (status === 401 || status === 403 || status === 429)),
  );
}
