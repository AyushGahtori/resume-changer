/**
 * Pure helpers for the optional "Paste from URL" action on the job-description
 * editor.
 *
 * The home page UI plan (docs/UI_Tasks_home.md, Task 17) shows a compact
 * "Paste from URL" affordance next to the job-description metrics, but only
 * allows it to ship when an approved, safe extraction capability exists. The
 * backend for that capability does not exist yet: there is no extraction
 * route, and the AI provider is never asked to fetch a URL. Fetching an
 * arbitrary user-supplied URL from the browser or the server would introduce
 * an SSRF-prone proxy, so the control stays hidden until a backend task
 * defines the network policy, validation, errors, and tests.
 *
 * The server resolves whether the capability is enabled and passes the result
 * down as a prop. Everything in this module is pure and client-safe so the
 * request handling can be unit tested with mocked responses.
 *
 * See the "Job Description URL Extraction" future feature in
 * docs/project-plan.md for the backend work that would ship the service.
 */

/** Route the extraction control calls when a service is approved. */
export const JD_URL_EXTRACTION_ROUTE = "/api/jd/extract";

export type ExtractionRequestResult =
  { ok: true; jobDescription: string } | { ok: false; error: string };

export type ExtractionUrlValidation =
  { valid: true; url: string } | { valid: false; error: string };

/**
 * Validates a user-supplied job URL before it could be sent to an extraction
 * service. Only absolute HTTP(S) URLs are accepted; other schemes such as
 * `javascript:`, `file:`, or `data:` are rejected.
 *
 * This is deliberately a *client-side* check. It exists to give fast feedback
 * and to make the accepted input contract explicit, not to make a request
 * safe: a server-side extractor must repeat the validation and enforce its own
 * network restrictions regardless of what the client checks.
 */
export function validateExtractionUrl(value: string): ExtractionUrlValidation {
  const trimmed = value.trim();
  if (!trimmed) {
    return { valid: false, error: "Enter the link to the job description." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Enter a valid job link." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, error: "Enter an HTTP or HTTPS link." };
  }

  return { valid: true, url: parsed.toString() };
}

/**
 * Posts a validated job URL to the extraction service and normalizes the
 * response.
 *
 * The `fetchImpl` dependency is injected so the request can be tested with
 * mocked responses without issuing a real request. Any failure resolves to a
 * readable message rather than throwing, so the caller can render it without
 * a try/catch and without exposing a raw network error.
 */
export async function requestJobDescriptionExtraction(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractionRequestResult> {
  let response: Response;
  try {
    response = await fetchImpl(JD_URL_EXTRACTION_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return {
      ok: false,
      error: "Could not reach the extraction service. Try again.",
    };
  }

  let payload: { jobDescription?: string; error?: string } = {};
  try {
    payload = (await response.json()) as {
      jobDescription?: string;
      error?: string;
    };
  } catch {
    payload = {};
  }

  if (!response.ok) {
    return {
      ok: false,
      error:
        payload.error ||
        (response.status === 404
          ? "The extraction service is not available yet. Paste the job description instead."
          : "Could not read that job description. Try again."),
    };
  }

  if (!payload.jobDescription) {
    return {
      ok: false,
      error: "No job description was found at that link.",
    };
  }

  return { ok: true, jobDescription: payload.jobDescription };
}
