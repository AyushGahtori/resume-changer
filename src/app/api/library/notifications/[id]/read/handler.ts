import {
  githubResultResponse,
  parseGithubId,
  protectGithubRoute,
} from "../../../../../../lib/github/server/next-boundary";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export const POST = protectGithubRoute(
  async (_request, context, services, route: RouteContext) => {
    const { id: rawId } = await route.params;
    const notificationId = parseGithubId(rawId);
    if (!notificationId) {
      return Response.json(
        {
          error: {
            code: "invalid-input",
            message: "The notification ID is invalid.",
            retryable: false,
          },
        },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return githubResultResponse(
      await services.notifications.markRead({ notificationId }, context),
    );
  },
);
