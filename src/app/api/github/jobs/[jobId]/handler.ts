import {
  githubResultResponse,
  parseGithubId,
  protectGithubRoute,
} from "../../../../../lib/github/server/next-boundary";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ jobId: string }> };

export const GET = protectGithubRoute(
  async (_request, context, services, route: RouteContext) => {
    const { jobId: rawJobId } = await route.params;
    const jobId = parseGithubId(rawJobId);
    if (!jobId) {
      return Response.json(
        {
          error: {
            code: "invalid-input",
            message: "The job ID is invalid.",
            retryable: false,
          },
        },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return githubResultResponse(
      await services.status.getJob({ jobId, context }),
    );
  },
);
