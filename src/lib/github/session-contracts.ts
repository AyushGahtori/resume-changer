import { z } from "zod";

export const SESSION_CONTRACT_VERSION = 1;
export const SessionRequestSchema = z
  .object({
    version: z.literal(SESSION_CONTRACT_VERSION),
    operationId: z.string().uuid(),
    state: z.string().max(3_800_000).nullable(),
    path: z
      .string()
      .max(512)
      .regex(
        /^\/api\/github\/(?:imports(?:\/[a-zA-Z0-9_./-]+)?(?:\?measurementResultId=[a-zA-Z0-9_-]+)?|jobs\/[a-zA-Z0-9_-]+)$/,
      )
      .refine(
        (path) =>
          !path.split(/[/?]/).some((part) => part === "." || part === ".."),
      ),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]),
    body: z.unknown().optional(),
  })
  .strict();
export type SessionRequest = z.infer<typeof SessionRequestSchema>;

export const SessionEventSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("checkpoint"), state: z.string().max(3_800_000) })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      state: z.string().max(3_800_000).nullable(),
      status: z.number().int().min(200).max(599),
      body: z.unknown(),
    })
    .strict(),
]);
export type SessionEvent = z.infer<typeof SessionEventSchema>;
