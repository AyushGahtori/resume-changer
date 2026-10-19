import { StudioDocumentSchema, type StudioDocument } from "./studio-document";
import { z } from "zod";

const RevisionSchema = z
  .object({
    id: z.string().min(1),
    document: StudioDocumentSchema,
    label: z.string().max(200),
    at: z.string(),
  })
  .strict();
export const StudioHistorySchema = z
  .object({
    past: z.array(RevisionSchema).max(40),
    present: StudioDocumentSchema,
    future: z.array(RevisionSchema).max(40),
  })
  .strict();
export type StudioHistory = z.infer<typeof StudioHistorySchema>;
export type StudioHistoryAction =
  | { type: "change"; document: StudioDocument; label: string; at?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "restore"; history: StudioHistory };

export function studioHistoryReducer(
  history: StudioHistory,
  action: StudioHistoryAction,
): StudioHistory {
  if (action.type === "restore")
    return StudioHistorySchema.parse(action.history);
  if (action.type === "change") {
    const document = StudioDocumentSchema.parse(action.document);
    if (JSON.stringify(document) === JSON.stringify(history.present))
      return history;
    return {
      past: [
        ...history.past,
        {
          id: `revision-${crypto.randomUUID()}`,
          document: history.present,
          label: action.label,
          at: action.at ?? new Date().toISOString(),
        },
      ].slice(-40),
      present: document,
      future: [],
    };
  }
  if (action.type === "undo" && history.past.length) {
    const revision = history.past[history.past.length - 1];
    return {
      past: history.past.slice(0, -1),
      present: revision.document,
      future: [
        { ...revision, document: history.present },
        ...history.future,
      ].slice(0, 40),
    };
  }
  if (action.type === "redo" && history.future.length) {
    const revision = history.future[0];
    return {
      past: [...history.past, { ...revision, document: history.present }].slice(
        -40,
      ),
      present: revision.document,
      future: history.future.slice(1),
    };
  }
  return history;
}
