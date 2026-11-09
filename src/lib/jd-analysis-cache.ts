import { z } from "zod";
import { JobAnalysisResultSchema } from "./ai/contracts";
import type { DraftFields } from "./jd-draft";
import type { JobAnalysisResult } from "./ai/contracts";

export const JD_ANALYSIS_STORAGE_KEY = "resume-changer.jd-analysis.v1";

const AnalysisCacheSchema = z
  .object({
    schemaVersion: z.literal(1),
    company: z.string(),
    roleTitle: z.string(),
    jobDescription: z.string(),
    jobUrl: z.string().optional(),
    analysis: JobAnalysisResultSchema,
  })
  .strict();

export type AnalysisCacheStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function normalizedDraft(draft: DraftFields) {
  return {
    company: draft.company.trim(),
    roleTitle: draft.roleTitle.trim(),
    jobDescription: draft.jobDescription.trim(),
  };
}

export function readStoredJobAnalysisEntry(storage: AnalysisCacheStorage) {
  let raw: string | null;
  try {
    raw = storage.getItem(JD_ANALYSIS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = AnalysisCacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function readJobAnalysisCache(
  storage: AnalysisCacheStorage,
  draft: DraftFields,
): JobAnalysisResult | null {
  const stored = readStoredJobAnalysisEntry(storage);
  if (!stored) return null;

  const current = normalizedDraft(draft);
  if (
    stored.company !== current.company ||
    stored.roleTitle !== current.roleTitle ||
    stored.jobDescription !== current.jobDescription
  ) {
    return null;
  }
  return stored.analysis;
}

export function writeJobAnalysisCache(
  storage: AnalysisCacheStorage,
  draft: DraftFields,
  analysis: JobAnalysisResult,
): boolean {
  const parsedAnalysis = JobAnalysisResultSchema.safeParse(analysis);
  if (!parsedAnalysis.success) return false;

  const entry = AnalysisCacheSchema.safeParse({
    schemaVersion: 1,
    ...normalizedDraft(draft),
    jobUrl: draft.jobUrl.trim(),
    analysis: parsedAnalysis.data,
  });
  if (!entry.success) return false;

  try {
    storage.setItem(JD_ANALYSIS_STORAGE_KEY, JSON.stringify(entry.data));
    return true;
  } catch {
    return false;
  }
}

export function clearJobAnalysisCache(storage: AnalysisCacheStorage): boolean {
  try {
    storage.removeItem(JD_ANALYSIS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
