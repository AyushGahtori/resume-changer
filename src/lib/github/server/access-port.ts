import {
  RepositoryScopeSchema,
  RepositorySummarySchema,
  err,
  ok,
  type ExecutionContext,
  type RepositoryScope,
  type Result,
} from "../contracts";
import type { GithubAccessPort } from "../ports";
import type { GithubAccess, GithubRepositorySummary } from "./access-core";

/** Keep credential capabilities inside the native access service, outside browser DTOs. */
export function createGithubAccessPort(deps: {
  access: GithubAccess;
  callbackOrigin: string;
  resolveScope(
    repository: GithubRepositorySummary,
    context: ExecutionContext,
  ): Promise<Result<RepositoryScope>>;
}): GithubAccessPort {
  return {
    async beginConnection(_input, context) {
      const result = await deps.access.beginConnection({
        sessionId: context.access.sessionId,
        callbackOrigin: deps.callbackOrigin,
      });
      if (!result.ok) return result;
      const state = new URL(result.value.authorizationUrl).searchParams.get(
        "state",
      );
      return state
        ? ok({ authorizationUrl: result.value.authorizationUrl, state })
        : err({
            code: "unavailable",
            message: "GitHub authorization state is unavailable.",
            retryable: false,
          });
    },
    async completeAuthorization(input, context) {
      const result = await deps.access.completeAuthorization({
        ...input,
        sessionId: context.access.sessionId,
        callbackOrigin: deps.callbackOrigin,
      });
      return result.ok
        ? ok({
            accountId: String(result.value.account.id),
            connectedAt: result.value.connectedAt,
          })
        : result;
    },
    async listAccessibleRepositories(input, context) {
      if (input.cursor)
        return err({
          code: "invalid-input",
          message: "Refresh the repository list to start again.",
          retryable: false,
        });
      const result = await deps.access.listAccessibleRepositories({
        sessionId: context.access.sessionId,
      });
      return result.ok
        ? ok({
            repositories: result.value.repositories.map((r) =>
              RepositorySummarySchema.parse({
                repositoryId: r.id,
                owner: r.owner,
                name: r.name,
                canonicalUrl: r.url,
                visibility: r.visibility,
                defaultBranch: null,
                permission: "read",
              }),
            ),
            nextCursor: null,
          })
        : result;
    },
    async authorizeRepository(input, context) {
      const result = await deps.access.authorizeRepository({
        ...input,
        sessionId: context.access.sessionId,
      });
      if (!result.ok) return result;
      const resolved = await deps.resolveScope(
        result.value.repository,
        context,
      );
      if (!resolved.ok) return resolved;
      const scope = RepositoryScopeSchema.safeParse(resolved.value),
        repository = result.value.repository;
      if (
        !scope.success ||
        scope.data.repositoryId !== repository.id ||
        scope.data.owner !== repository.owner ||
        scope.data.name !== repository.name ||
        scope.data.visibility !== repository.visibility ||
        scope.data.canonicalUrl !== repository.url
      )
        return err({
          code: "forbidden",
          message: "The pinned repository does not match its authorization.",
          retryable: false,
        });
      return ok({ scope: scope.data });
    },
    async disconnect(_input, context) {
      const result = await deps.access.disconnect({
        sessionId: context.access.sessionId,
      });
      return result.ok
        ? ok({ disconnected: true, upstreamRevocation: "not-requested" })
        : result;
    },
  };
}
