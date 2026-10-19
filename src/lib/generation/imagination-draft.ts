import { z } from "zod";
import { StableIdSchema, type ResumeLibrary } from "../schemas/resume-data";

export const ImaginationDraftSchema = z
  .object({
    groupId: StableIdSchema,
    text: z.string().max(8000),
    instruction: z.string().max(2000),
    selectedIds: z.array(StableIdSchema).max(10),
    skillIds: z.array(StableIdSchema).max(10),
    targetLines: z.number().int().min(1).max(4),
  })
  .strict();
export type ImaginationDraft = z.infer<typeof ImaginationDraftSchema>;

export function parseImaginationDraft(
  value: string | null,
  library: ResumeLibrary,
): ImaginationDraft | null {
  try {
    const parsed = ImaginationDraftSchema.safeParse(
      JSON.parse(value ?? "null"),
    );
    if (!parsed.success) return null;
    const draft = parsed.data;
    const group = [...library.jobs, ...library.projects].find(
      (item) => item.id === draft.groupId,
    );
    if (
      !group ||
      draft.selectedIds.length + draft.skillIds.length > 10 ||
      new Set(draft.selectedIds).size !== draft.selectedIds.length ||
      new Set(draft.skillIds).size !== draft.skillIds.length ||
      draft.selectedIds.some(
        (id) => !group.points.some((point) => point.id === id && point.enabled),
      ) ||
      draft.skillIds.some(
        (id) => !library.skills.some((skill) => skill.id === id),
      )
    )
      return null;
    return draft.text.trim() ||
      draft.selectedIds.length ||
      draft.skillIds.length
      ? draft
      : null;
  } catch {
    return null;
  }
}
