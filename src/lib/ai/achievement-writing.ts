import { z } from "zod";

export const AchievementWritingInputSchema = z
  .object({
    sources: z
      .array(
        z
          .object({
            id: z.string(),
            text: z.string().max(8000),
            factualConstraints: z.array(z.string().max(8000)).max(10),
          })
          .strict(),
      )
      .max(10),
    skills: z.array(z.string().max(160)).max(10),
    draftText: z.string().max(8000),
    instruction: z.string().trim().min(1).max(2000),
    destination: z.string().max(400),
    targetLines: z.number().int().min(1).max(8).optional(),
  })
  .strict();
export const AchievementWritingResultSchema = z
  .object({ text: z.string().trim().min(1).max(3000) })
  .strict();
export type AchievementWritingInput = z.infer<
  typeof AchievementWritingInputSchema
>;
export type AchievementWritingResult = z.infer<
  typeof AchievementWritingResultSchema
>;
export type AchievementWritingOperation = "edit" | "merge" | "create";

export function numericClaims(value: string): string[] {
  return [
    ...new Set(
      (
        value.match(/\b\d[\d,.]*(?:\s?(?:%|percent|per cent)|[kKmMbB]\b)?/gi) ??
        []
      ).map((claim) => {
        const normalized = claim
          .toLowerCase()
          .replace(/per\s?cent/g, "%")
          .replace(/[,\s]/g, "")
          .replace(/[.,]+$/, "");
        const compact = normalized.match(/^([\d.]+)([kmb])$/);
        return compact
          ? String(
              Number(compact[1]) *
                ((
                  { k: 1000, m: 1000000, b: 1000000000 } as Record<
                    string,
                    number
                  >
                )[compact[2]] ?? 1),
            )
          : normalized;
      }),
    ),
  ];
}

export function validateWritingFacts(
  input: AchievementWritingInput,
  output: AchievementWritingResult,
): string | null {
  const evidence = [
    input.draftText,
    ...input.sources.flatMap((source) => [
      source.text,
      ...source.factualConstraints,
    ]),
  ].join(" ");
  const allowed = numericClaims(evidence);
  const generated = numericClaims(output.text);
  if (generated.some((claim) => !allowed.includes(claim)))
    return "The suggestion introduced an unsupported number. Retry or edit the wording manually.";
  const required = numericClaims(
    [input.draftText, ...input.sources.map((source) => source.text)].join(" "),
  );
  if (required.some((claim) => !generated.includes(claim)))
    return "The suggestion omitted a supplied metric. Retry with a shorter instruction while preserving the metrics.";
  if (/```|\\(?:begin|end|item|section)\b/.test(output.text))
    return "The suggestion contained formatting instead of a resume achievement. Try again.";
  return null;
}
