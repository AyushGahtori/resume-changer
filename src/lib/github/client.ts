import { createUnavailableImportClient } from "./server/unavailable";
import type { ImportClientPort } from "./ports";

export function createImportClient(_transport?: unknown): ImportClientPort {
  return createUnavailableImportClient();
}
