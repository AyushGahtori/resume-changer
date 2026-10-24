import { z } from "zod";

export const ACHIEVEMENT_WRITING_MODES = [
  "make_shorter",
  "more_technical",
  "improve_clarity",
  "emphasize_engineering_impact",
  "improve_action_verbs",
  "reduce_repetition",
] as const;

export const AchievementWritingModeSchema = z.enum(ACHIEVEMENT_WRITING_MODES);
export type AchievementWritingMode = z.infer<
  typeof AchievementWritingModeSchema
>;

export const ACHIEVEMENT_WRITING_MODE_DIRECTIVES = {
  make_shorter:
    "Reduce the word count and remove nonessential phrasing. Preserve every supported fact, attribution, technology, and numerical metric.",
  more_technical:
    "Use precise technical terms already present in the connected evidence. Do not add implementation details or technologies that the evidence does not state.",
  improve_clarity:
    "Make the statement easier to understand by clarifying cause and effect and removing ambiguity while preserving supported details.",
  emphasize_engineering_impact:
    "Lead with the supported engineering change and its stated effect. Do not imply scale, results, or ownership that the evidence does not state.",
  improve_action_verbs:
    "Prefer a direct, specific action verb grounded in the supplied work. Do not inflate the user's responsibility or ownership.",
  reduce_repetition:
    "Remove repeated words and overlapping clauses while retaining distinct facts, metrics, technologies, and outcomes.",
} satisfies Record<AchievementWritingMode, string>;

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
    writingMode: AchievementWritingModeSchema.optional(),
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
