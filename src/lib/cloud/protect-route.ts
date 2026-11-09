import "server-only";
import {
  AccountAccessError,
  assertAccountBinding,
  assertSameOrigin,
  getAppMode,
  readBoundedBody,
} from "./security";
import { accountContext, accountFromRequest } from "./server-account";
import { withRequestBudget } from "./request-budget";
import { protectedRouteFailureDetails } from "./route-failure";

function assertMutationOrigin(request: Request): void {
  if (getAppMode() !== "local") {
    assertSameOrigin(request);
    return;
  }
  const hostname = new URL(request.url).hostname;
  const loopback = hostname === "localhost" || hostname === "127.0.0.1";
  // Browsers send Origin on cross-site writes. Loopback unit tests and
  // same-machine tools omit it. assertSameOrigin still treats localhost and
  // 127.0.0.1 as the same site when an Origin header is present.
  if (
    loopback &&
    !request.headers.has("origin") &&
    !request.headers.has("sec-fetch-site")
  )
    return;
  assertSameOrigin(request);
}

function assertJsonMutation(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const raw = request.headers.get("content-type");
  if (!raw) {
    if (request.method === "DELETE") return;
    throw new AccountAccessError("Send a JSON request.", "FORBIDDEN", 403);
  }
  const mediaType = raw.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json") return;
  throw new AccountAccessError("Send a JSON request.", "FORBIDDEN", 403);
}

export function privateResponse(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function protectAccountRoute<Arguments extends unknown[]>(
  handler: (request: Request, ...context: Arguments) => Promise<Response>,
  options: {
    maxBytes?: number;
    usage?: "ai" | "compile" | "library" | "history";
  } = {},
) {
  return async function protectedRoute(
    request: Request,
    ...context: Arguments
  ): Promise<Response> {
    try {
      if (request.method !== "GET") assertMutationOrigin(request);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
        assertJsonMutation(request);
      if (getAppMode() === "local") return handler(request, ...context);
      const account = await accountFromRequest(request);
      assertAccountBinding(request, account.uid);
      let bounded = request;
      if (!["GET", "HEAD"].includes(request.method)) {
        const body = await readBoundedBody(
          request,
          options.maxBytes ?? 4_200_000,
        );
        bounded = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: new Uint8Array(body),
          signal: request.signal,
        });
      }
      return privateResponse(
        await accountContext.run(account, () =>
          withRequestBudget(async () => {
            if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
              const path = new URL(request.url).pathname;
              const action =
                options.usage ??
                (path.startsWith("/api/ai/")
                  ? "ai"
                  : path === "/api/compile" || path === "/api/resume/edit"
                    ? "compile"
                    : path.startsWith("/api/library/") ||
                        path.startsWith("/api/account/library")
                      ? "library"
                      : path.startsWith("/api/history")
                        ? "history"
                        : undefined);
              if (action === "ai" || action === "compile") {
                const { consumeAccountUsage } = await import("./usage");
                await consumeAccountUsage(action);
              }
            }
            return handler(bounded, ...context);
          }),
        ),
      );
    } catch (error) {
      if (error instanceof AccountAccessError) {
        return privateResponse(
          Response.json(
            { error: error.message, code: error.code },
            { status: error.status },
          ),
        );
      }
      console.error(
        "Private account API request failed.",
        protectedRouteFailureDetails(error),
      );
      return privateResponse(
        Response.json(
          {
            error: "The account service is temporarily unavailable.",
            code: "ACCOUNT_UNAVAILABLE",
          },
          { status: 503 },
        ),
      );
    }
  };
}
