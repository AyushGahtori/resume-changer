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
      if (getAppMode() === "local") return handler(request, ...context);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
        assertSameOrigin(request);
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
      console.error("Account request could not be authorized.", {
        code: "ACCOUNT_REQUEST_FAILED",
      });
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
