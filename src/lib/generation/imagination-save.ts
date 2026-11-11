import type { AchievementWritingOperation } from "../ai/achievement-writing";
import type { ResumeDataSource } from "../data/loaders";
import type { AchievementPoint } from "../schemas/resume-data";

export type ImaginationSaveDestination = "resume" | "library" | "both";

export function getImaginationSaveDestinations(
  source: ResumeDataSource,
  allowResume: boolean,
  hasLibraryDestination = true,
): ImaginationSaveDestination[] {
  const destinations: ImaginationSaveDestination[] = [];
  if (allowResume) destinations.push("resume");
  if (source === "personal" && hasLibraryDestination)
    destinations.push("library");
  if (allowResume && source === "personal" && hasLibraryDestination)
    destinations.push("both");
  return destinations;
}

export function getDefaultImaginationSaveDestination(
  source: ResumeDataSource,
  allowResume: boolean,
  hasLibraryDestination = true,
): ImaginationSaveDestination | null {
  const destinations = getImaginationSaveDestinations(
    source,
    allowResume,
    hasLibraryDestination,
  );
  return destinations.includes("resume") ? "resume" : (destinations[0] ?? null);
}

export function getImaginationTextToAccept(
  operation: AchievementWritingOperation,
  editorText: string,
  proposedText: string,
): string {
  return (operation === "create" ? editorText : proposedText).trim();
}

export const imaginationSaveCopy = {
  jobRequired:
    "A job or project is required before you can save an achievement.",
  sourceUnavailable: "No save destination is available for this data source.",
  skillOnly:
    "Connect an achievement to use this suggestion. Skills alone cannot be saved as a point.",
  resumeNeedsAchievement:
    "Connect an achievement before adding this point to the resume. What you type can still be saved to the library.",
  emptyAchievement: "Write or accept an achievement before saving.",
  unreadableResponse:
    "Imagination could not read the response. Your draft is preserved.",
  unreadableSave: "The achievement could not be saved. Try again.",
  suggestionPending:
    "Use the suggestion in the editor, or dismiss it, before saving.",
  askNeedsDraft: "Write a draft or connect an achievement before asking.",
  askNeedsJob: "A job or project is required before asking.",
  instructionTooLong: "Shorten the instruction to 500 characters or fewer.",
  saveNeedsText: "Write an achievement before saving.",
  saveNeedsDestination: "Choose where to save this achievement.",
  saveBusy: "Wait for Imagination to finish before saving.",
  pdfNote: "Your PDF updates only after Apply changes.",
  personalLibrarySwitch:
    "Switch to your personal library to save an achievement.",
} as const;

export type ImaginationAcceptance =
  | {
      ok: true;
      text: string;
      saveToLibrary: boolean;
      resumeSourceIds: string[] | null;
    }
  | { ok: false; error: string };

/** Choose the text Accept will store, and refuse a resume bullet with no achievement source. */
export function decideImaginationAcceptance(input: {
  operation: AchievementWritingOperation;
  editorText: string;
  proposedText: string;
  sourceAchievementIds: string[];
  connectedSkillCount: number;
  saveDestination: ImaginationSaveDestination | null;
  source: ResumeDataSource;
  hasLibraryDestination: boolean;
  allowResume: boolean;
  groupId: string;
}): ImaginationAcceptance {
  if (input.operation !== "create") {
    const text = getImaginationTextToAccept(
      input.operation,
      input.editorText,
      input.proposedText,
    );
    if (!text)
      return { ok: false, error: imaginationSaveCopy.emptyAchievement };
    return {
      ok: true,
      text,
      saveToLibrary: false,
      resumeSourceIds: input.sourceAchievementIds,
    };
  }

  if (input.source === "personal" && !input.hasLibraryDestination)
    return { ok: false, error: imaginationSaveCopy.jobRequired };
  if (!input.groupId)
    return {
      ok: false,
      error:
        input.source === "personal"
          ? imaginationSaveCopy.jobRequired
          : imaginationSaveCopy.sourceUnavailable,
    };
  if (!input.saveDestination)
    return { ok: false, error: imaginationSaveCopy.sourceUnavailable };

  const achievementCount = input.sourceAchievementIds.length;
  const proposal = input.proposedText.trim();
  const editor = input.editorText.trim();
  if (achievementCount === 0 && input.connectedSkillCount > 0)
    return { ok: false, error: imaginationSaveCopy.skillOnly };

  const text = achievementCount > 0 && proposal ? proposal : editor;
  if (!text) return { ok: false, error: imaginationSaveCopy.emptyAchievement };
  if (achievementCount === 0 && input.saveDestination !== "library")
    return { ok: false, error: imaginationSaveCopy.resumeNeedsAchievement };

  const saveToLibrary =
    input.saveDestination === "library" || input.saveDestination === "both";
  if (saveToLibrary && input.source !== "personal")
    return { ok: false, error: imaginationSaveCopy.personalLibrarySwitch };

  const placeOnResume =
    input.saveDestination !== "library" || !input.allowResume;
  return {
    ok: true,
    text,
    saveToLibrary,
    resumeSourceIds:
      placeOnResume && achievementCount > 0 ? input.sourceAchievementIds : null,
  };
}

export function isUnreadableResponseError(failure: unknown): boolean {
  if (failure instanceof SyntaxError) return true;
  const message = failure instanceof Error ? failure.message : "";
  return /unexpected token|unexpected end of json|failed to execute ['"]json/i.test(
    message,
  );
}

export function readableImaginationError(
  failure: unknown,
  fallback: string,
): string {
  if (isUnreadableResponseError(failure)) return fallback;
  if (failure instanceof Error && failure.message.trim())
    return failure.message.trim();
  return fallback;
}

export async function readImaginationPayload(
  response: { json: () => Promise<unknown> },
  unreadableMessage: string,
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await response.json();
  } catch (failure) {
    throw new Error(readableImaginationError(failure, unreadableMessage));
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(unreadableMessage);
  return value as Record<string, unknown>;
}

export function buildImaginationLibraryPoint(input: {
  parentType: "job" | "project";
  parentId: string;
  pointId: string;
  reviewedText: string;
  skillIds: string[];
  sourceAchievementIds: string[];
}): {
  parentType: "job" | "project";
  parentId: string;
  point: AchievementPoint;
} {
  const text = input.reviewedText.trim();
  if (!text) throw new Error("Write or accept an achievement before saving.");

  const skillIds = [...new Set(input.skillIds)];
  const sourceAchievementIds = [...new Set(input.sourceAchievementIds)];
  const point: AchievementPoint = {
    id: input.pointId,
    text,
    tags: [],
    skillIds,
    metrics: [],
    source: {
      type: "direct-user",
      label: "Reviewed in Imagination Canvas",
      reference: JSON.stringify({ sourceAchievementIds, skillIds }),
    },
    enabled: true,
  };

  return {
    parentType: input.parentType,
    parentId: input.parentId,
    point,
  };
}
