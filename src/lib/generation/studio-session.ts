import { z } from "zod";
import type { ManualGenerationResult } from "./manual-generation";

const SessionSchema = z
  .object({
    jobSignature: z.string(),
    pdfBase64: z.string().max(4_000_000).nullable(),
    generation: z
      .object({
        latex: z.string().min(1).max(150_000),
        metadata: z
          .object({
            id: z.string(),
            generatedAt: z.string(),
            dataSource: z.enum(["personal", "demo"]),
            company: z.string(),
            roleTitle: z.string(),
            jobUrl: z.string(),
            tailoringMode: z.enum(["manual", "guided", "auto"]),
            selectedAchievementIds: z.array(z.string()),
            renderedSkillIds: z.array(z.string()),
            generatedBullets: z.array(
              z
                .object({
                  achievementId: z.string(),
                  sourceAchievementIds: z.array(z.string()),
                  text: z.string(),
                })
                .passthrough(),
            ),
            sourceProvenance: z.array(
              z.object({
                achievementId: z.string(),
                section: z.enum(["experience", "projects"]),
                groupId: z.string(),
                groupTitle: z.string(),
                originalText: z.string(),
                renderedText: z.string(),
              }),
            ),
            visibleWordCount: z.number(),
          })
          .passthrough(),
      })
      .strict(),
  })
  .strict();

export function parseStudioSession(
  value: string | null,
  jobSignature: string,
  source: "personal" | "demo",
): { generation: ManualGenerationResult; pdfBase64: string | null } | null {
  if (!value) return null;
  try {
    const parsed = SessionSchema.safeParse(JSON.parse(value));
    if (
      !parsed.success ||
      parsed.data.jobSignature !== jobSignature ||
      parsed.data.generation.metadata.dataSource !== source
    )
      return null;
    if (parsed.data.pdfBase64 && !parsed.data.pdfBase64.startsWith("JVBERi0"))
      return null;
    return {
      generation: parsed.data.generation as ManualGenerationResult,
      pdfBase64: parsed.data.pdfBase64,
    };
  } catch {
    return null;
  }
}
