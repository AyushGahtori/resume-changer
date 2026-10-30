import { randomUUID } from "node:crypto";
import { protectAccountRoute } from "../../cloud/protect-route";
import {
  assertSameOrigin,
  getAppMode,
  readBoundedBody,
} from "../../cloud/security";
import { requireCloudAccount } from "../../cloud/server-account";
import { SessionRequestSchema, type SessionEvent } from "../session-contracts";
import {
  createSessionMemory,
  withImportSession,
  type SessionMemory,
} from "./session-memory";
import { openImportSession, sealImportSession } from "./session-envelope";
import { JobRecordSchema } from "../contracts";
import { claimSessionOperation } from "./session-operations";
import { resolveGithubConnectionSession } from "./connection-session";

function error(message: string, status = 410) {
  return Response.json(
    { error: { code: "needs-context", message, retryable: false } },
    { status },
  );
}
function abandonPriorWork(memory: SessionMemory) {
  for (const [path, text] of Object.entries(memory.files)) {
    if (path !== "data/github-jobs/jobs.json") continue;
    const document = JSON.parse(text);
    for (const job of document.jobs ?? []) {
      if (job.state !== "running" && job.state !== "queued") continue;
      job.state = job.kind === "analyze" ? "interrupted" : "failed";
      job.lease = null;
      job.executionFence++;
      job.failureCode =
        job.kind === "analyze"
          ? "provider-outcome-unknown"
          : "upstream-unavailable";
      job.failureRetryable = true;
      job.retryRequired = job.kind === "analyze";
      job.updatedAt = new Date().toISOString();
      job.version++;
    }
    memory.files[path] = JSON.stringify(document);
  }
}

function releaseDownloadedFiles(memory: SessionMemory) {
  for (const [path, text] of Object.entries(memory.files)) {
    if (!path.startsWith("data/github-imports/")) continue;
    const document = JSON.parse(text);
    document.cache = (document.cache ?? []).filter(
      (entry: { value: { kind: string } }) =>
        entry.value.kind !== "safe-content",
    );
    memory.files[path] = JSON.stringify(document);
  }
}

export const sessionImport = protectAccountRoute(async (request: Request) => {
  assertSameOrigin(request);
  let input;
  try {
    input = SessionRequestSchema.parse(
      JSON.parse(
        new TextDecoder().decode(await readBoundedBody(request, 4_100_000)),
      ),
    );
  } catch {
    return error("The temporary import request is invalid.", 400);
  }
  const uid =
    getAppMode() === "firebase"
      ? (await requireCloudAccount()).uid
      : (await resolveGithubConnectionSession(request))?.sessionId;
  if (!uid) return error("Connect GitHub before starting an import.", 403);
  let memory: SessionMemory;
  try {
    const saved = input.state ? openImportSession(input.state, uid) : null;
    if (
      !saved &&
      !(input.path === "/api/github/imports" && input.method === "POST")
    )
      return error(
        "This temporary import ended. Start a new import; unsaved evidence is not retained after reload.",
      );
    memory = createSessionMemory({
      uid,
      id: saved?.id ?? randomUUID(),
      files: saved?.files,
      signal: request.signal,
    });
    abandonPriorWork(memory);
  } catch {
    return error(
      "The temporary import expired or could not be verified. Start a new import.",
    );
  }
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  memory.signal = signal;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: SessionEvent) => {
        if (!closed && !signal.aborted)
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      memory.checkpoint = async () => {
        emit({ type: "checkpoint", state: sealImportSession(memory) });
      };
      void withImportSession(memory, async () => {
        try {
          // The existing validators, scoped inspectors and approval writer run against
          // request memory. No Workflow is dispatched and no source store is written.
          const { resolveGithubApiRoute } =
            await import("../../api/github-routes");
          const match = resolveGithubApiRoute(
            new URL(input.path, request.url).pathname
              .split("/")
              .filter(Boolean)
              .slice(1),
          );
          const handler = match?.methods[input.method];
          if (!handler) {
            emit({
              type: "result",
              state: sealImportSession(memory),
              status: 404,
              body: {
                error: {
                  code: "not-found",
                  message: "Unsupported import operation.",
                  retryable: false,
                },
              },
            });
            return;
          }
          let finish: undefined | (() => Promise<void>);
          if (input.method === "POST" && input.path.endsWith("/extract")) {
            const body = input.body as {
              selectionHash?: string;
              consentReference?: string;
              idempotencyKey?: string;
            };
            finish = await claimSessionOperation(
              uid,
              memory.id,
              JSON.stringify([
                body?.selectionHash,
                body?.consentReference ?? body?.idempotencyKey,
              ]),
              "ai",
            );
          }
          if (input.method === "POST" && input.path.endsWith("/inspect"))
            finish = await claimSessionOperation(
              uid,
              memory.id,
              input.operationId,
              "files",
            );
          const headers = new Headers(request.headers);
          headers.delete("content-length");
          const nested = new Request(new URL(input.path, request.url), {
            method: input.method,
            headers,
            signal,
            ...(input.method !== "GET"
              ? { body: JSON.stringify(input.body ?? {}) }
              : {}),
          });
          const response = await handler(nested);
          let body = await response.json();
          let status = response.status;
          if (response.status === 202) {
            const job = JobRecordSchema.parse(body.data);
            if (job.state !== "completed") {
              status = 422;
              body = {
                error: {
                  code: "upstream-error",
                  message:
                    job.kind === "prepare"
                      ? "Repository evidence could not be prepared. Completed file downloads are kept for retry."
                      : "Analysis did not complete. Review the outcome before starting another paid attempt.",
                  retryable: job.kind === "prepare",
                },
              };
            } else {
              body = { data: job };
              status = 200;
              if (job.kind === "analyze") releaseDownloadedFiles(memory);
            }
          }
          await finish?.();
          const clear =
            response.ok &&
            (input.method === "DELETE" || input.path.endsWith("/approve"));
          emit({
            type: "result",
            state: clear ? null : sealImportSession(memory),
            status,
            body,
          });
        } catch {
          emit({
            type: "result",
            state: sealImportSession(memory),
            status: 409,
            body: {
              error: {
                code: "interrupted",
                message:
                  "This operation could not be confirmed. Completed downloads remain in this tab. Do not automatically repeat an uncertain AI request.",
                retryable: false,
              },
            },
          });
        } finally {
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      }).catch(() => {
        abort.abort();
      });
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
