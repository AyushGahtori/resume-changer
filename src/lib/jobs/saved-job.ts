import { z } from "zod";
import { JobAnalysisResultSchema } from "../ai/contracts";
import { StableIdSchema } from "../schemas/resume-data";

export const MAX_SAVED_JOBS = 40;
export const MAX_SAVED_JOB_BYTES = 120_000;
export const SAVED_JOBS_DATA_PATH = "data/saved-job-analyses.json";

const companyName = z.string().trim().min(1).max(160);
const roleTitle = z.string().trim().max(160);
const jobDescription = z.string().trim().min(1).max(30_000);

export const SavedJobRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: StableIdSchema.max(200),
    company: companyName,
    roleTitle,
    jobUrl: z.string().trim().max(2_000),
    jobDescription,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    analysis: JobAnalysisResultSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type SavedJobRecord = z.infer<typeof SavedJobRecordSchema>;

export const SaveSavedJobInputSchema = z
  .object({
    company: z.string().trim().min(1).max(160),
    roleTitle: z.string().trim().max(160).optional(),
    jobUrl: z.string().trim().max(2_000).optional(),
    jobDescription: z.string().trim().min(1).max(30_000),
    analysis: JobAnalysisResultSchema,
  })
  .strict();

export type SaveSavedJobInput = z.infer<typeof SaveSavedJobInputSchema>;

export type SavedJobSummary = {
  id: string;
  company: string;
  roleTitle: string;
  updatedAt: string;
  createdAt: string;
};

export function savedJobSummary(record: SavedJobRecord): SavedJobSummary {
  return {
    id: record.id,
    company: record.company,
    roleTitle: record.roleTitle,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  };
}

export function savedJobDocumentPath(uid: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new Error("Invalid account.");
  }
  const parsedId = StableIdSchema.max(200).safeParse(id);
  if (!parsedId.success) throw new Error("Invalid saved job.");
  return ["accounts", uid, "jobAnalyses", parsedId.data] as const;
}

export function normalizeJobText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function jobUrlError(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "Enter an HTTP or HTTPS link.";
    }
  } catch {
    return "Enter a valid job link.";
  }
  return null;
}
