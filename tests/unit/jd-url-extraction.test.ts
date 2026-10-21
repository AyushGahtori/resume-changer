import { describe, expect, it, vi } from "vitest";
import {
  JD_URL_EXTRACTION_ROUTE,
  requestJobDescriptionExtraction,
  validateExtractionUrl,
} from "../../src/lib/jd-url-extraction";

describe("extraction URL validation", () => {
  it("accepts absolute HTTP and HTTPS links", () => {
    expect(validateExtractionUrl("https://careers.example.com/job/12")).toEqual(
      {
        valid: true,
        url: "https://careers.example.com/job/12",
      },
    );
    expect(validateExtractionUrl("http://careers.example.com/job/12")).toEqual({
      valid: true,
      url: "http://careers.example.com/job/12",
    });
  });

  it("trims surrounding whitespace before validating", () => {
    expect(
      validateExtractionUrl("  https://careers.example.com/job/12  "),
    ).toEqual({
      valid: true,
      url: "https://careers.example.com/job/12",
    });
  });

  it("rejects an empty link with a prompt to enter one", () => {
    expect(validateExtractionUrl("")).toEqual({
      valid: false,
      error: "Enter the link to the job description.",
    });
    expect(validateExtractionUrl("   ")).toEqual({
      valid: false,
      error: "Enter the link to the job description.",
    });
  });

  it("rejects a link that is not a URL", () => {
    expect(validateExtractionUrl("careers.example.com/job")).toEqual({
      valid: false,
      error: "Enter a valid job link.",
    });
  });

  it("rejects non-HTTP schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<h1>hi</h1>",
      "ftp://careers.example.com/job",
    ]) {
      expect(validateExtractionUrl(value)).toEqual({
        valid: false,
        error: "Enter an HTTP or HTTPS link.",
      });
    }
  });
});

function jsonResponse(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("extraction request", () => {
  it("posts the URL to the extraction route and returns the description", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ jobDescription: "Build reliable fictional services." }),
    );

    const result = await requestJobDescriptionExtraction(
      "https://careers.example.com/job/12",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: true,
      jobDescription: "Build reliable fictional services.",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [route, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(route).toBe(JD_URL_EXTRACTION_ROUTE);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      url: "https://careers.example.com/job/12",
    });
  });

  it("reports a service error message from the response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: "That page could not be read." }, { status: 502 }),
    );

    const result = await requestJobDescriptionExtraction(
      "https://careers.example.com/job/12",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: false,
      error: "That page could not be read.",
    });
  });

  it("explains that the service is unavailable when the route is missing", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 404 }));

    const result = await requestJobDescriptionExtraction(
      "https://careers.example.com/job/12",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: false,
      error:
        "The extraction service is not available yet. Paste the job description instead.",
    });
  });

  it("reports a failure when the response carries no description", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));

    const result = await requestJobDescriptionExtraction(
      "https://careers.example.com/job/12",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: false,
      error: "No job description was found at that link.",
    });
  });

  it("reports a network failure without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await requestJobDescriptionExtraction(
      "https://careers.example.com/job/12",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: false,
      error: "Could not reach the extraction service. Try again.",
    });
  });

  it("survives a response that is not valid JSON", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not json", { status: 500 }),
    );

    const result = await requestJobDescriptionExtraction(
      "https://careers.example.com/job/12",
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual({
      ok: false,
      error: "Could not read that job description. Try again.",
    });
  });
});
