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
