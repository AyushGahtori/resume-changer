import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
}));

vi.mock("@/lib/data/loaders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/data/loaders")>();
  return { ...actual, loadResumeLibrary: mocks.load };
});

import { POST } from "@/app/api/generate/route";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { DataLoadError } from "@/lib/data/loaders";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
const firstPointId = library.jobs[0].points[0].id;

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    dataSource: "demo",
    company: "Example Systems",
    roleTitle: "Platform Engineer",
    jobUrl: "https://example.com/roles/platform-engineer",
    jobDescription: "Build reliable platform services with AWS and Docker.",
    selectedAchievementIds: [firstPointId],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(structuredClone(library));
});

describe("POST /api/generate", () => {
  it("returns the generated LaTeX and its metadata", async () => {
    const response = await post(validRequest());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.latex).toContain(
      "\\documentclass[letterpaper,10pt]{article}",
    );
    expect(payload.latex).toContain("\\section*{Experience}");
    expect(payload.metadata).toMatchObject({
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      dataSource: "demo",
      selectedAchievementIds: [firstPointId],
    });
  });

  it("loads the library for the requested data source", async () => {
    await post(validRequest({ dataSource: "personal" }));

    expect(mocks.load).toHaveBeenCalledWith({ source: "personal" });
  });

  it("rejects a request body that is not valid JSON", async () => {
    const response = await post("{not-json");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("rejects an empty job description with field-level issues", async () => {
    const response = await post(validRequest({ jobDescription: "" }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBe(
      "Check the job details and selected achievements.",
    );
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "jobDescription" }),
      ]),
    );
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("rejects a request with no selected achievements", async () => {
    const response = await post(validRequest({ selectedAchievementIds: [] }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Check the job details and selected achievements.",
    });
  });

  it("rejects a job link that is not an HTTP or HTTPS URL", async () => {
    const response = await post(
      validRequest({ jobUrl: "javascript:alert(1)" }),
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "jobUrl" })]),
    );
  });

  it("returns 400 when the selection names an unknown achievement", async () => {
    const response = await post(
      validRequest({ selectedAchievementIds: ["achievement-does-not-exist"] }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown achievement ID: achievement-does-not-exist.",
    });
  });

  it("returns 400 when the selection names a disabled achievement", async () => {
    const disabled = structuredClone(library);
    disabled.jobs[0].points[0].enabled = false;
    mocks.load.mockResolvedValue(disabled);

    const response = await post(validRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: `Achievement ID is disabled: ${firstPointId}.`,
    });
  });

  it("returns 400 when a selected skill does not exist", async () => {
    const response = await post(
      validRequest({ selectedSkillIds: ["skill-does-not-exist"] }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unknown skill ID: skill-does-not-exist.",
    });
  });

  it("returns 409 when the resume library cannot be read", async () => {
    mocks.load.mockRejectedValue(
      new DataLoadError("missing-file", "data/resume-library.json"),
    );

    const response = await post(validRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("data/resume-library.json"),
    });
  });

  it("hides unexpected internal errors behind a generic response", async () => {
    mocks.load.mockRejectedValue(new Error("private filesystem detail"));

    const response = await post(validRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The resume could not be generated. Try again.",
    });
  });

  it("applies tailored achievement text overrides to the rendered resume", async () => {
    const response = await post(
      validRequest({
        achievementTextOverrides: [
          {
            achievementId: firstPointId,
            text: "Reworded synthetic achievement for the route test.",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.latex).toContain(
      "Reworded synthetic achievement for the route test.",
    );
  });
});
