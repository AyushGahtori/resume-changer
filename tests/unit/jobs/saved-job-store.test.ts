import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JobAnalysisResult } from "@/lib/ai/contracts";
import { savedJobDocumentPath } from "@/lib/jobs/saved-job";
import { SavedJobError } from "@/lib/jobs/saved-job-error";
import {
  deleteSavedJob,
  getSavedJob,
  listSavedJobs,
  saveSavedJob,
} from "@/lib/jobs/saved-job-store";

const roots: string[] = [];

const analysis = {
  targetTitle: "Backend Engineer",
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

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "saved-jobs-"));
  roots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  return root;
}

function input(
  company: string,
  roleTitle = "Backend Engineer",
  jobDescription = "Build APIs for the product.",
) {
  return {
    company,
    roleTitle,
    jobUrl: "https://example.com/jobs/1",
    jobDescription,
    analysis,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("saved job analyses", () => {
  it("keeps two roles at one company and updates the same posting in place", async () => {
    const rootDir = await createRoot();
    const first = await saveSavedJob(input("BJAK", "Backend Engineer"), {
      rootDir,
    });
    const second = await saveSavedJob(input("BJAK", "Data Engineer"), {
      rootDir,
    });
    const updated = await saveSavedJob(
      input("bjak", "backend engineer", "  Build   APIs for the product. "),
      { rootDir },
    );

    expect(second.id).not.toBe(first.id);
    expect(updated.id).toBe(first.id);
    expect(updated.analysis).toEqual(analysis);
    expect((await listSavedJobs({ rootDir })).map((job) => job.id)).toEqual([
      updated.id,
      second.id,
    ]);
  });

  it("rejects a blank company and an unsafe job link", async () => {
    const rootDir = await createRoot();
    await expect(saveSavedJob(input("   "), { rootDir })).rejects.toMatchObject(
      {
        code: "invalid",
      },
    );
    await expect(
      saveSavedJob(
        { ...input("BJAK"), jobUrl: "javascript:alert(1)" },
        {
          rootDir,
        },
      ),
    ).rejects.toBeInstanceOf(SavedJobError);
  });

  it("rejects the 41st job and an oversized analysis", async () => {
    const rootDir = await createRoot();
    for (let index = 0; index < 40; index += 1) {
      await saveSavedJob(
        input(`Company ${index}`, "Role", `Description ${index}`),
        {
          rootDir,
        },
      );
    }
    await expect(
      saveSavedJob(input("Company 40", "Role", "Description 40"), { rootDir }),
    ).rejects.toMatchObject({ code: "limit" });

    const huge = {
      ...analysis,
      requiredQualifications: Array.from({ length: 100 }, () =>
        "x".repeat(500),
      ),
      responsibilities: Array.from({ length: 100 }, () => "y".repeat(500)),
      atsTerms: Array.from({ length: 100 }, () => "z".repeat(500)),
    };
    await expect(
      saveSavedJob({ ...input("Overflow Co"), analysis: huge }, { rootDir }),
    ).rejects.toMatchObject({ code: "too-large" });
  });

  it("skips a corrupt record and still returns the valid jobs", async () => {
    const rootDir = await createRoot();
    const saved = await saveSavedJob(input("BJAK"), { rootDir });
    const file = join(rootDir, "data", "saved-job-analyses.json");
    const stored = JSON.parse(await readFile(file, "utf8")) as {
      entries: unknown[];
    };
    stored.entries.push({ corrupt: true });
    await writeFile(file, JSON.stringify(stored));

    expect((await listSavedJobs({ rootDir })).map((job) => job.id)).toEqual([
      saved.id,
    ]);
    const again = await saveSavedJob(input("Other Co", "Role", "Other work."), {
      rootDir,
    });
    const rewritten = JSON.parse(await readFile(file, "utf8")) as {
      entries: unknown[];
    };
    expect(rewritten.entries).toContainEqual({ corrupt: true });
    expect(await getSavedJob(again.id, { rootDir })).toMatchObject({
      company: "Other Co",
    });
  });

  it("keeps one account path from reading another account id", () => {
    expect(savedJobDocumentPath("alice", "job-a1b2c3d4")).toEqual([
      "accounts",
      "alice",
      "jobAnalyses",
      "job-a1b2c3d4",
    ]);
    expect(savedJobDocumentPath("bob", "job-a1b2c3d4")[1]).toBe("bob");
    expect(() => savedJobDocumentPath("../alice", "job-a1b2c3d4")).toThrow(
      /Invalid account/,
    );
    expect(() => savedJobDocumentPath("alice", "../secret")).toThrow(
      /Invalid saved job/,
    );
  });

  it("deletes one job and leaves the other role at that company", async () => {
    const rootDir = await createRoot();
    const first = await saveSavedJob(input("BJAK", "Backend Engineer"), {
      rootDir,
    });
    const second = await saveSavedJob(input("BJAK", "Data Engineer"), {
      rootDir,
    });
    await deleteSavedJob(first.id, { rootDir });
    expect((await listSavedJobs({ rootDir })).map((job) => job.id)).toEqual([
      second.id,
    ]);
    await expect(getSavedJob(first.id, { rootDir })).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
