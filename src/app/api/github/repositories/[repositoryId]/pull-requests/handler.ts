import {
  protectGithubRoute,
  githubErrorResponse,
  githubResultResponse,
} from "@/lib/github/server/next-boundary";

export const GET = protectGithubRoute(
  async (
    request,
    context,
    services,
    route: { params: Promise<{ repositoryId: string }> },
  ) => {
    const { repositoryId } = await route.params;
    if (!/^\d{1,30}$/.test(repositoryId) || new URL(request.url).search)
      return githubErrorResponse({
        code: "invalid-input",
        message: "Choose a valid repository to inspect pull requests.",
        retryable: false,
      });
    const granted = await services.access.authorizeRepository(
      { repositoryId },
      context,
    );
    if (!granted.ok) return githubErrorResponse(granted.error);
    const authorized = {
      ...context,
      access: {
        ...context.access,
        grantedRepositoryIds: [
          ...new Set([
            ...context.access.grantedRepositoryIds,
            granted.value.scope.repositoryId,
          ]),
        ],
      },
    };
    return githubResultResponse(
      await services.pullRequests.listCandidates({
        scope: granted.value.scope,
        context: authorized,
      }),
    );
  },
);
