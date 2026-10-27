import {
  githubResultResponse,
  parseGithubCursor,
  parseGithubLimit,
  protectGithubRoute,
} from "../../../../lib/github/server/next-boundary";

export const runtime = "nodejs";

export const GET = protectGithubRoute(async (request, context, services) => {
  const url = new URL(request.url);
  const cursor = parseGithubCursor(url.searchParams.get("cursor"));
  const limit = parseGithubLimit(url.searchParams.get("limit"), 50);
  if (cursor === false || limit === null) {
    return Response.json(
      {
        error: {
          code: "invalid-input",
          message: "The notification cursor or page size is invalid.",
          retryable: false,
        },
      },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return githubResultResponse(
    await services.notifications.list({ cursor, limit }, context),
  );
});
