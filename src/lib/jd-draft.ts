import { z } from "zod";

export const JD_DRAFT_STORAGE_KEY = "resume-changer.jd-draft.v1";
export const MAX_JD_CHARACTERS = 30_000;

export const JobDescriptionDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    jobDescription: z.string(),
    company: z.string(),
    roleTitle: z.string(),
    jobUrl: z.string(),
  })
  .strict();

export type JobDescriptionDraft = z.infer<typeof JobDescriptionDraftSchema>;
export type DraftFields = Omit<JobDescriptionDraft, "schemaVersion">;
export type DraftErrors = Partial<Record<keyof DraftFields, string>>;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const EMPTY_DRAFT: JobDescriptionDraft = {
  schemaVersion: 1,
  jobDescription: "",
  company: "",
  roleTitle: "",
  jobUrl: "",
};

export function estimateTokenCount(text: string) {
  return Math.ceil(text.length / 4);
}

export function validateDraft(draft: DraftFields): DraftErrors {
  const errors: DraftErrors = {};

  if (!draft.jobDescription.trim()) {
    errors.jobDescription = "Enter a job description before saving.";
  } else if (draft.jobDescription.length > MAX_JD_CHARACTERS) {
    errors.jobDescription = `Keep the description under ${MAX_JD_CHARACTERS.toLocaleString()} characters.`;
  }

  if (draft.jobUrl.trim()) {
    try {
      const url = new URL(draft.jobUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        errors.jobUrl = "Enter an HTTP or HTTPS link.";
      }
    } catch {
      errors.jobUrl = "Enter a valid job link.";
    }
  }

  return errors;
}

export function readDraft(storage: DraftStorage) {
  let raw: string | null;
  try {
    raw = storage.getItem(JD_DRAFT_STORAGE_KEY);
  } catch {
    return { draft: EMPTY_DRAFT, state: "unavailable" as const };
  }

  if (!raw) return { draft: EMPTY_DRAFT, state: "empty" as const };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { draft: EMPTY_DRAFT, state: "invalid" as const };
  }

  const parsed = JobDescriptionDraftSchema.safeParse(value);
  if (!parsed.success) {
    return { draft: EMPTY_DRAFT, state: "invalid" as const };
  }

  return { draft: parsed.data, state: "restored" as const };
}

export function writeDraft(storage: DraftStorage, draft: JobDescriptionDraft) {
  const parsed = JobDescriptionDraftSchema.safeParse(draft);
  if (!parsed.success) return false;

  try {
    storage.setItem(JD_DRAFT_STORAGE_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(storage: DraftStorage) {
  try {
    storage.removeItem(JD_DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
