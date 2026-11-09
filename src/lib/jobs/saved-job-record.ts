import { createHash, randomBytes } from "node:crypto";
import {
  jobUrlError,
  MAX_SAVED_JOB_BYTES,
  MAX_SAVED_JOBS,
  normalizeJobText,
  SaveSavedJobInputSchema,
  type SavedJobRecord,
} from "./saved-job";
import { SavedJobError } from "./saved-job-error";

export function jobFingerprint(input: {
  company: string;
  roleTitle: string;
  jobDescription: string;
}) {
  return createHash("sha256")
    .update(
      [
        normalizeJobText(input.company),
        normalizeJobText(input.roleTitle),
        normalizeJobText(input.jobDescription),
      ].join("\n"),
      "utf8",
    )
    .digest("hex");
}

export function savedJobByteLength(record: SavedJobRecord) {
  return Buffer.byteLength(JSON.stringify(record));
}

export function createSavedJobId() {
  return `job-${randomBytes(8).toString("hex")}`;
}

export function checkedSavedJobInput(input: unknown) {
  const parsed = SaveSavedJobInputSchema.safeParse(input);
  if (!parsed.success) {
    const company = parsed.error.issues.some((issue) =>
      issue.path.includes("company"),
    );
    throw new SavedJobError(
      "invalid",
      company
        ? "Enter a company name before saving this analysis."
        : "The saved job could not be stored. Check the company, role, and description.",
    );
  }
  const jobUrl = parsed.data.jobUrl?.trim() ?? "";
  const urlError = jobUrlError(jobUrl);
  if (urlError) throw new SavedJobError("invalid", urlError);
  return {
    company: parsed.data.company.trim(),
    roleTitle: parsed.data.roleTitle?.trim() ?? "",
    jobUrl,
    jobDescription: parsed.data.jobDescription.trim(),
    analysis: parsed.data.analysis,
  };
}

export function nextSavedJob(input: unknown, records: SavedJobRecord[]) {
  const fields = checkedSavedJobInput(input);
  const fingerprint = jobFingerprint(fields);
  const existing = records.find((record) => record.fingerprint === fingerprint);
  const now = new Date().toISOString();
  const next: SavedJobRecord = existing
    ? { ...existing, ...fields, fingerprint, updatedAt: now }
    : {
        schemaVersion: 1,
        id: createSavedJobId(),
        ...fields,
        fingerprint,
        createdAt: now,
        updatedAt: now,
      };
  if (savedJobByteLength(next) > MAX_SAVED_JOB_BYTES) {
    throw new SavedJobError("too-large", "This analysis is too large to save.");
  }
  if (!existing && records.length >= MAX_SAVED_JOBS) {
    throw new SavedJobError(
      "limit",
      "Delete an older saved job before saving another. This account already has 40 saved analyses.",
    );
  }
  return next;
}
