import { afterEach, describe, expect, it, vi } from "vitest";

const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock("../../../src/lib/cloud/api-fetch", () => ({ apiFetch: fetcher }));

import type { JobAnalysisResult } from "../../../src/lib/ai/contracts";
import { JD_ANALYSIS_STORAGE_KEY } from "../../../src/lib/jd-analysis-cache";
import {
  deleteSavedJobRequest,
  loadSavedJobs,
  readSavedJob,
  rememberImportedAnalysis,
} from "../../../src/lib/jobs/saved-job-client";

const analysis = {
  targetTitle: "Platform Engineer",
  seniority: "Mid level",
  requiredQualifications: ["TypeScript"],
  preferredQualifications: [],
  responsibilities: ["Build APIs"],
  toolsAndPlatforms: ["Node.js"],
  domainConcepts: ["Distributed systems"],
  atsTerms: ["backend"],
  inferredContext: [],
  terminology: [],
} satisfies JobAnalysisResult;

const legacy = {
  schemaVersion: 1,
  company: "Example Systems",
  roleTitle: "Platform Engineer",
  jobDescription: "Build distributed services.",
  analysis,
};

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const storedJob = {
  id: "job-imported",
  company: legacy.company,
  roleTitle: legacy.roleTitle,
  jobUrl: "https://example.com/jobs/1",
  jobDescription: legacy.jobDescription,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  analysis,
};

afterEach(() => {
  fetcher.mockReset();
});

describe("saved job client", () => {
  it("does not re-save a legacy analysis with an empty link", async () => {
    const posts: unknown[] = [];
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json({ job: storedJob });
      }
      return json({ jobs: [] });
    });

    await loadSavedJobs(
      memoryStorage({
        [JD_ANALYSIS_STORAGE_KEY]: JSON.stringify(legacy),
      }),
    );
    await loadSavedJobs(
      memoryStorage({
        [JD_ANALYSIS_STORAGE_KEY]: JSON.stringify({ ...legacy, jobUrl: "" }),
      }),
    );

    expect(posts).toHaveLength(2);
    expect(posts[0]).not.toHaveProperty("jobUrl");
    expect(posts[1]).not.toHaveProperty("jobUrl");
  });

  it("keeps a non-empty link when importing a legacy analysis", async () => {
    let posted: { jobUrl?: string } | undefined;
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as { jobUrl?: string };
        return json({ job: storedJob });
      }
      return json({ jobs: [] });
    });

    await loadSavedJobs(
      memoryStorage({
        [JD_ANALYSIS_STORAGE_KEY]: JSON.stringify({
          ...legacy,
          jobUrl: "https://jobs.example/platform",
        }),
      }),
    );

    expect(posted?.jobUrl).toBe("https://jobs.example/platform");
  });

  it("imports a legacy analysis once", async () => {
    fetcher.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ job: storedJob });
      return json({ jobs: [] });
    });
    const storage = memoryStorage({
      [JD_ANALYSIS_STORAGE_KEY]: JSON.stringify({
        ...legacy,
        jobUrl: "https://jobs.example/platform",
      }),
    });
    rememberImportedAnalysis(storage, legacy);

    await loadSavedJobs(storage);

    expect(fetcher.mock.calls.some((call) => call[1]?.method === "POST")).toBe(
      false,
    );
  });

  it("rejects an empty or unparseable delete response", async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(deleteSavedJobRequest("job-1")).rejects.toThrow(
      /could not be deleted/,
    );

    fetcher.mockResolvedValueOnce(new Response("{", { status: 200 }));
    await expect(deleteSavedJobRequest("job-1")).rejects.toThrow(
      /could not be deleted/,
    );

    fetcher.mockResolvedValueOnce(json({ deleted: true }));
    await expect(deleteSavedJobRequest("job-1")).resolves.toBeUndefined();
  });

  it("uses the saved-job-not-found sentence only for a 404", async () => {
    fetcher.mockResolvedValueOnce(json({ error: "Missing" }, 404));
    await expect(readSavedJob("job-1")).rejects.toThrow("Missing");

    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(readSavedJob("job-1")).rejects.toThrow("Saved job not found.");

    fetcher.mockResolvedValueOnce(json({ error: "Too many requests." }, 429));
    await expect(readSavedJob("job-1")).rejects.toThrow("Too many requests.");

    fetcher.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(readSavedJob("job-1")).rejects.toThrow(
      "The saved job could not be loaded.",
    );

    fetcher.mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(readSavedJob("job-1")).rejects.toThrow(
      "The saved job could not be loaded.",
    );

    fetcher.mockResolvedValueOnce(json({ job: storedJob }));
    await expect(readSavedJob("job-1")).resolves.toMatchObject({
      id: "job-imported",
    });
  });
});
