import {
  protectGithubRoute,
  githubErrorResponse,
  githubResultResponse,
  parseGithubId,
} from "@/lib/github/server/next-boundary";

export const GET = protectGithubRoute(
  async (
    request,
    context,
    services,
    route: { params: Promise<{ id: string; draftId: string }> },
  ) => {
    const { id, draftId } = await route.params;
    const query = new URL(request.url).searchParams;
    const resultId = query.get("measurementResultId");
    if (
      !parseGithubId(id) ||
      !parseGithubId(draftId) ||
      (resultId !== null && !parseGithubId(resultId)) ||
      [...query.keys()].some((key) => key !== "measurementResultId") ||
      query.getAll("measurementResultId").length > 1
    ) {
      return githubErrorResponse({
        code: "invalid-input",
        message: "The measurement preview reference is invalid.",
        retryable: false,
      });
    }
    return githubResultResponse(
      await services.measurements.preview(
        {
          importId: id,
          draftId,
          ...(resultId ? { measurementResultId: resultId } : {}),
        },
        context,
      ),
    );
  },
);
