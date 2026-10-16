export type ResumeTailoringMode = "manual" | "guided" | "auto";
export type ResumeDraftingMode = "ai" | "originals-fallback";

export function getGenerationOriginNotice(
  tailoringMode: ResumeTailoringMode,
  draftingMode?: ResumeDraftingMode,
): string {
  if (tailoringMode === "manual") {
    return "Generated internally by Resume Changer from your selected evidence. AI did not rewrite the content.";
  }

  if (draftingMode === "originals-fallback") {
    return "Generated internally by Resume Changer from your source evidence. AI was unavailable, so the original wording was kept.";
  }

  if (draftingMode === "ai") {
    return "Generated internally by Resume Changer using AI-assisted wording.";
  }

  return "Generated internally by Resume Changer from your selected resume content.";
}
