"use client";

import { apiFetch } from "@/lib/cloud/api-fetch";
import { readStoredJobAnalysisEntry } from "@/lib/jd-analysis-cache";
import type { AnalysisCacheStorage } from "@/lib/jd-analysis-cache";
import {
  normalizeJobText,
  type SavedJobRecord,
  type SavedJobSummary,
} from "@/lib/jobs/saved-job";
import type { JobAnalysisResult } from "@/lib/ai/contracts";

const IMPORTED_ANALYSIS_KEY = "resume-changer.saved-jobs-imported.v1";
export const SELECTED_SAVED_JOB_KEY = "resume-changer.selected-job.v1";

export type SaveAnalyzedJobInput = {
  company: string;
  roleTitle: string;
  jobUrl: string;
  jobDescription: string;
  analysis: JobAnalysisResult;
};

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as {
    job?: SavedJobRecord;
    jobs?: SavedJobSummary[];
    error?: string;
  };
}

export async function listSavedJobSummaries() {
  const response = await apiFetch("/api/job-analyses");
  const body = await readJson(response);
  if (!response.ok || !body.jobs) {
    throw new Error(body.error || "Saved job analyses could not be loaded.");
  }
  return body.jobs;
}

export async function readSavedJob(id: string) {
  const response = await apiFetch(
    `/api/job-analyses/${encodeURIComponent(id)}`,
  );
  const body = await readJson(response);
  if (!response.ok || !body.job) {
    throw new Error(body.error || "Saved job not found.");
  }
  return body.job;
}

export async function saveAnalyzedJob(input: SaveAnalyzedJobInput) {
  const response = await apiFetch("/api/job-analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company: input.company,
      roleTitle: input.roleTitle,
      jobUrl: input.jobUrl,
      jobDescription: input.jobDescription,
      analysis: input.analysis,
    }),
  });
  const body = await readJson(response);
  if (!response.ok || !body.job) {
    throw new Error(
      body.error || "This analysis was not added to your saved jobs.",
    );
  }
  return body.job;
}

export async function deleteSavedJobRequest(id: string) {
  const response = await apiFetch(
    `/api/job-analyses/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const body = await readJson(response);
    throw new Error(body.error || "The saved job could not be deleted.");
  }
}

function importMarker(entry: {
  company: string;
  roleTitle: string;
  jobDescription: string;
}) {
  return [
    normalizeJobText(entry.company),
    normalizeJobText(entry.roleTitle),
    normalizeJobText(entry.jobDescription),
  ].join("\n");
}

export async function loadSavedJobs(storage: AnalysisCacheStorage) {
  const jobs = await listSavedJobSummaries();
  const legacy = readStoredJobAnalysisEntry(storage);
  if (!legacy?.company.trim()) return jobs;
  const marker = importMarker(legacy);
  let alreadyImported = false;
  try {
    alreadyImported = storage.getItem(IMPORTED_ANALYSIS_KEY) === marker;
  } catch {
    alreadyImported = false;
  }
  if (alreadyImported) return jobs;
  try {
    const saved = await saveAnalyzedJob({
      company: legacy.company,
      roleTitle: legacy.roleTitle,
      jobUrl: "",
      jobDescription: legacy.jobDescription,
      analysis: legacy.analysis,
    });
    try {
      storage.setItem(IMPORTED_ANALYSIS_KEY, marker);
    } catch {
      /* The account copy is already stored. */
    }
    return [
      {
        id: saved.id,
        company: saved.company,
        roleTitle: saved.roleTitle,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      },
      ...jobs.filter((job) => job.id !== saved.id),
    ];
  } catch {
    return jobs;
  }
}
