import { describe, expect, it } from "vitest";
import {
  clearJobAnalysisCache,
  JD_ANALYSIS_STORAGE_KEY,
  readJobAnalysisCache,
  writeJobAnalysisCache,
} from "../../src/lib/jd-analysis-cache";

const draft = {
  company: "Example Systems",
  roleTitle: "Platform Engineer",
  jobUrl: "",
  jobDescription: "Build distributed services.",
};

const analysis = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["Python"],
  preferredQualifications: [],
  responsibilities: ["Build distributed services"],
  toolsAndPlatforms: ["Python"],
  domainConcepts: ["Distributed systems"],
  atsTerms: ["Platform engineering"],
  inferredContext: [],
  terminology: [],
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("job analysis cache", () => {
  it("restores an analysis only for the same saved role and description", () => {
    const storage = memoryStorage();
    expect(writeJobAnalysisCache(storage, draft, analysis)).toBe(true);
    expect(readJobAnalysisCache(storage, draft)).toEqual(analysis);
    expect(
      readJobAnalysisCache(storage, {
        ...draft,
        jobDescription: "A different role.",
      }),
    ).toBeNull();
  });

  it("ignores malformed or schema-invalid cache data", () => {
    const storage = memoryStorage();
    storage.setItem(JD_ANALYSIS_STORAGE_KEY, "{");
    expect(readJobAnalysisCache(storage, draft)).toBeNull();
    storage.setItem(
      JD_ANALYSIS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, ...draft, analysis: {} }),
    );
    expect(readJobAnalysisCache(storage, draft)).toBeNull();
  });

  it("clears the cached analysis safely", () => {
    const storage = memoryStorage();
    writeJobAnalysisCache(storage, draft, analysis);
    expect(clearJobAnalysisCache(storage)).toBe(true);
    expect(readJobAnalysisCache(storage, draft)).toBeNull();
  });
});
