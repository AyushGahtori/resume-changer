import { AsyncLocalStorage } from "node:async_hooks";
import { relative, isAbsolute, sep } from "node:path";
import type { DurableStateStorage } from "./state";

export const SESSION_BYTES = 4 * 1024 * 1024;
export type SessionMemory = {
  uid: string;
  id: string;
  signal: AbortSignal;
  files: Record<string, string>;
  storage: DurableStateStorage;
  services?: Promise<import("./composition").GithubServerServices>;
  checkpoint?: () => Promise<void>;
};
const sessions = new AsyncLocalStorage<SessionMemory>();
export const currentImportSession = () => sessions.getStore();

/** Request-local working data. Never shared through a process-global cache. */
export function createSessionMemory(input: {
  uid: string;
  id: string;
  signal: AbortSignal;
  files?: Record<string, string>;
}): SessionMemory {
  const files = Object.assign(Object.create(null), input.files ?? {}) as Record<
    string,
    string
  >;
  const queues = new Map<string, Promise<unknown>>();
  function key(root: string, target: string) {
    const path = relative(root, target);
    const normalized = path.split(sep).join("/");
    const mapped = normalized.startsWith(".github-import-measurements/")
      ? "data/github-measurements/" +
        normalized.slice(".github-import-measurements/".length)
      : normalized;
    if (
      !isAbsolute(root) ||
      !path ||
      isAbsolute(path) ||
      path.startsWith("..") ||
      !mapped.startsWith("data/github-")
    )
      throw new Error("Invalid session state path.");
    return mapped;
  }
  const memory: SessionMemory = {
    ...input,
    files,
    storage: {
      kind: "durable",
      async assertPath(root, target) {
        key(root, target);
      },
      async read(root, target, maximum) {
        const text = files[key(root, target)];
        if (text === undefined)
          throw Object.assign(new Error("Session data missing."), {
            code: "ENOENT",
          });
        if (Buffer.byteLength(text) > maximum)
          throw new Error("Session data exceeds limit.");
        return text;
      },
      async write(root, target, text) {
        const path = key(root, target);
        const total = Object.entries(files).reduce(
          (sum, [k, v]) => sum + (k === path ? 0 : Buffer.byteLength(v)),
          Buffer.byteLength(text),
        );
        if (total > SESSION_BYTES)
          throw new Error(
            "The temporary import is full. Narrow the selection.",
          );
        files[path] = text;
      },
      async withLock(root, target, work) {
        const path = key(root, target);
        const previous = queues.get(path) ?? Promise.resolve();
        const result = previous.catch(() => {}).then(work);
        queues.set(path, result);
        try {
          return await result;
        } finally {
          if (queues.get(path) === result) queues.delete(path);
        }
      },
    },
  };
  return memory;
}

export function withImportSession<T>(
  memory: SessionMemory,
  work: () => Promise<T>,
) {
  return sessions.run(memory, work);
}
