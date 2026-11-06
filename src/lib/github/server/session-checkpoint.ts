import { sealImportSession } from "./session-envelope";
import type { SessionMemory } from "./session-memory";

export function sessionFileBytes(files: Record<string, string>): number {
  let total = 0;
  for (const value of Object.values(files)) total += Buffer.byteLength(value);
  return total;
}

/**
 * File reads used to seal the whole session every time. Seal again only after
 * retained bytes double, which keeps transferred checkpoints under about 2x
 * the latest snapshot. A forced checkpoint still publishes immediately.
 */
export function shouldSealFileCheckpoint(
  sealedBytes: number,
  currentBytes: number,
): boolean {
  if (currentBytes <= sealedBytes) return false;
  if (sealedBytes <= 0) return true;
  return currentBytes >= sealedBytes * 2;
}

export function createSessionCheckpointer(
  memory: SessionMemory,
  emit: (state: string) => void,
) {
  let sealedBytes = 0;
  const publish = () => {
    emit(sealImportSession(memory));
    sealedBytes = sessionFileBytes(memory.files);
  };
  return {
    checkpoint: async () => {
      publish();
    },
    checkpointFile: async () => {
      if (shouldSealFileCheckpoint(sealedBytes, sessionFileBytes(memory.files)))
        publish();
    },
  };
}
