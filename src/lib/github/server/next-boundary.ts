import "server-only";
import { protectAccountRoute } from "../../cloud/protect-route";
import { ProtectedRouteFailure } from "../../cloud/route-failure";
import { requireCloudAccount } from "../../cloud/server-account";
import { assertSameOrigin, getAppMode } from "../../cloud/security";
import { getGithubServices, type GithubServerServices } from "./composition";
import type { DomainError, ExecutionContext, Result } from "../contracts";

export type GithubRouteHandler<Arguments extends unknown[] = []> = (
  request: Request,
  context: ExecutionContext,
  services: GithubServerServices,
  ...arguments_: Arguments
) => Promise<Response>;

export function protectGithubRoute<Arguments extends unknown[] = []>(
  handler: GithubRouteHandler<Arguments>,
) {
  return protectAccountRoute(
    async (request: Request, ...arguments_: Arguments) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method))
        assertSameOrigin(request);
      let services: GithubServerServices;
      try {
        services = await getGithubServices();
      } catch (error) {
        throw new ProtectedRouteFailure("github-services", error);
      }
      const accountId =
        getAppMode() === "firebase"
          ? (await requireCloudAccount()).uid
          : undefined;
      const contextResult = await services.createContext({
        request,
        accountId,
        signal: request.signal,
      });
      if (!contextResult.ok) return githubErrorResponse(contextResult.error);
      return handler(request, contextResult.value, services, ...arguments_);
    },
  );
}

export function githubErrorResponse(error: DomainError): Response {
  const status: Record<DomainError["code"], number> = {
    "invalid-input": 400,
    forbidden: 403,
    unavailable: 503,
    "not-found": 404,
    "version-conflict": 409,
    "limit-exceeded": 413,
    "rate-limited": 429,
    "needs-context": 422,
    "invalid-evidence": 422,
    "io-error": 503,
    cancelled: 409,
    interrupted: 409,
    "upstream-error": 502,
  };
  return Response.json(
    { error },
    {
      status: status[error.code],
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}

export function githubSuccessResponse<T>(
  data: T,
  options: { status?: number; version?: number } = {},
): Response {
  return Response.json(
    {
      data,
      ...(options.version === undefined ? {} : { version: options.version }),
    },
    {
      status: options.status ?? 200,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    },
  );
}

export function githubResultResponse<T>(
  result: Result<T>,
  options: { status?: number; version?: number } = {},
): Response {
  return result.ok
    ? githubSuccessResponse(result.value, options)
    : githubErrorResponse(result.error);
}

export function parseGithubId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null;
}

export function parseGithubCursor(value: string | null): string | null | false {
  if (value === null || value === "") return null;
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value) ? value : false;
}

export function parseGithubLimit(
  value: string | null,
  fallback = 100,
): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return limit >= 1 && limit <= 100 ? limit : null;
}
