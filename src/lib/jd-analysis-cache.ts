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

export function readJobAnalysisCache(
  storage: AnalysisCacheStorage,
  draft: DraftFields,
): JobAnalysisResult | null {
  let raw: string | null;
  try {
    raw = storage.getItem(JD_ANALYSIS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = AnalysisCacheSchema.safeParse(value);
  if (!parsed.success) return null;

  const current = normalizedDraft(draft);
  if (
    parsed.data.company !== current.company ||
    parsed.data.roleTitle !== current.roleTitle ||
    parsed.data.jobDescription !== current.jobDescription
  ) {
    return null;
  }
  return parsed.data.analysis;
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
