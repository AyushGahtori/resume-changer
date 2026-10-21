import "server-only";

/**
 * Server-side resolution of the "Paste from URL" capability.
 *
 * Task 17 of the home page UI plan allows the control only when an approved
 * safe extraction service exists. That service does not exist yet: there is
 * no `/api/jd/extract` route, and the AI provider is never asked to fetch a
 * URL. Fetching an arbitrary user-supplied URL without a reviewed network
 * policy would introduce an SSRF-prone proxy, so the capability resolves to
 * unavailable and the client renders nothing.
 *
 * The check lives on the server so the decision cannot be flipped by client
 * state. When the backend described in the "Job Description URL Extraction"
 * section of docs/project-plan.md ships, this becomes a check that the
 * approved service is actually reachable.
 */

export function isJdUrlExtractionAvailable(): boolean {
  return false;
}
