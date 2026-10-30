"use client";
import { apiFetch } from "../cloud/api-fetch";
import { SessionEventSchema } from "./session-contracts";

let state: string | null = null;
let generation = 0;
let account: string | undefined;
let queue: Promise<unknown> = Promise.resolve();
const active = new Set<AbortController>();

export function resetImportSession(nextAccount?: string) {
  generation++;
  state = null;
  if (nextAccount !== undefined) account = nextAccount;
  for (const controller of active) controller.abort();
  active.clear();
}
export function bindImportSessionAccount(uid: string) {
  if (account !== uid) resetImportSession(uid);
}
export function hasImportSession() {
  return state !== null;
}
export function cancelImportRequest() {
  generation++;
  for (const controller of active) controller.abort();
  active.clear();
}

/** One tab owns the opaque verified workspace. Nothing is written to browser storage. */
export function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const path =
    typeof input === "string"
      ? input
      : input instanceof Request
        ? input.url
        : input.toString();
  if (
    !path.startsWith("/api/github/imports") &&
    !/^\/api\/github\/jobs\/[a-zA-Z0-9_-]+$/.test(path)
  )
    return apiFetch(input, init);
  const method = init.method ?? "GET";
  if (path === "/api/github/imports" && method === "POST") resetImportSession();
  const epoch = generation,
    operationId = crypto.randomUUID();
  const work = async () => {
    if (epoch !== generation || init.signal?.aborted)
      throw new DOMException("Session ended", "AbortError");
    const abort = new AbortController();
    active.add(abort);
    try {
      const response = await apiFetch("/api/github/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: init.signal
          ? AbortSignal.any([init.signal, abort.signal])
          : abort.signal,
        body: JSON.stringify({
          version: 1,
          operationId,
          state,
          path,
          method,
          ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
        }),
      });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("application/x-ndjson")
      ) {
        if (response.status === 410 && epoch === generation) state = null;
        return response;
      }
      const reader = response.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "",
        total = 0,
        finished: Response | undefined;
      function event(line: string) {
        if (!line.trim()) return;
        if (line.length > 4_200_000 || finished)
          throw new Error("Invalid session response.");
        const value = SessionEventSchema.parse(JSON.parse(line));
        if (epoch !== generation)
          throw new DOMException("Session ended", "AbortError");
        if (value.type === "checkpoint") state = value.state;
        else if (value.type === "result") {
          state = value.state;
          finished = Response.json(value.body, { status: value.status });
        } else throw new Error("Invalid session response.");
      }
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.length;
          if (total > 64 * 1024 * 1024)
            throw new Error("Session response too large.");
          buffer += decoder.decode(part.value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            event(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
          }
          if (buffer.length > 4_200_000)
            throw new Error("Session response too large.");
        }
        buffer += decoder.decode();
        if (buffer.trim()) event(buffer);
        if (!finished)
          throw new Error(
            "The operation response was lost. Review its outcome before retrying AI analysis.",
          );
        return finished;
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } finally {
      active.delete(abort);
    }
  };
  const result = queue.catch(() => {}).then(work);
  queue = result;
  return result;
}
