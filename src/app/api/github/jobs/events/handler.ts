import {
  githubErrorResponse,
  githubResultResponse,
  parseGithubCursor,
  parseGithubLimit,
  protectGithubRoute,
} from "../../../../../lib/github/server/next-boundary";

export const runtime = "nodejs";

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(done, milliseconds);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      done();
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export const GET = protectGithubRoute(async (request, context, services) => {
  const url = new URL(request.url);
  const cursor = parseGithubCursor(
    request.headers.get("last-event-id") ?? url.searchParams.get("cursor"),
  );
  const limit = parseGithubLimit(url.searchParams.get("limit"));
  if (cursor === false || limit === null) {
    return Response.json(
      {
        error: {
          code: "invalid-input",
          message: "The status cursor or page size is invalid.",
          retryable: false,
        },
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const read = (after: string | null) =>
    services.events.read({ context, cursor: after, limit });
  const first = await read(cursor);
  if (!first.ok) return githubErrorResponse(first.error);
  if (url.searchParams.get("mode") === "poll")
    return githubResultResponse(first);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let currentCursor = cursor;
      let page: typeof first.value | null = first.value;
      try {
        while (!request.signal.aborted && Date.now() - startedAt < 25_000) {
          if (page === null) {
            const next = await read(currentCursor);
            if (!next.ok) {
              controller.enqueue(
                encoder.encode(
                  `event: status-error\ndata: ${JSON.stringify({ error: next.error })}\n\n`,
                ),
              );
              break;
            }
            page = next.value;
          }

          const currentPage = page;
          page = null;
          for (const event of currentPage.events) {
            if (event.cursor === currentCursor) continue;
            currentCursor = event.cursor;
            controller.enqueue(
              encoder.encode(
                `id: ${event.cursor}\nevent: message\ndata: ${JSON.stringify({ data: event })}\n\n`,
              ),
            );
          }
          if (currentPage.nextCursor) currentCursor = currentPage.nextCursor;
          if (currentPage.hasMore && currentPage.events.length > 0) continue;
          if (currentPage.events.length === 0)
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          await pause(750, request.signal);
          const next = await read(currentCursor);
          if (!next.ok) {
            controller.enqueue(
              encoder.encode(
                `event: status-error\ndata: ${JSON.stringify({ error: next.error })}\n\n`,
              ),
            );
            break;
          }
          page = next.value;
        }
      } catch {
        // The browser resumes from the last durable cursor after a disconnect.
      } finally {
        try {
          controller.close();
        } catch {
          // The stream may already have been cancelled by the browser.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
