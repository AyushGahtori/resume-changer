import { z } from "zod";
import { hostedAdmin } from "./admin";
import {
  createHostedAccessStore,
  createHostedCredentialVault,
} from "./credential-store";
import { createGithubAuthorizationExchange } from "./github-exchange";
import { fetchPinnedGithub, resolveGithubAddresses } from "./network";
import { hostedGithubConfigured } from "./config";
import { currentImportSession } from "../session-memory";
import { createGithubAccess } from "../access-core";
import { createGithubAccessPort } from "../access-port";
import { createGithubBackendRuntime } from "../backend-runtime";
import {
  composeGithubServices,
  newGithubRequestContext,
  type GithubServerServices,
} from "../composition";
import { createUnavailableBudgetLedger } from "../unavailable";
import { createAiProvider } from "../../../ai/provider-factory-core";
import { getPersonalDataRoot } from "../../../data/root";
import { createGithubApprovalPort } from "../../../data/writers";
import { accountFromRequest } from "../../../cloud/server-account";
import { getCloudLibrary } from "../../../cloud/library-store";
import {
  err,
  ok,
  RepositoryScopeSchema,
  type ExecutionContext,
} from "../../contracts";
import type { GithubCredentialScope } from "../credentials-core";

const denied = () =>
  err<never>({
    code: "forbidden",
    message: "This GitHub import is unavailable for this account.",
    retryable: false,
  });
let pending:
  | Promise<{
      services: GithubServerServices;
      runJob(jobId: string): Promise<boolean>;
    }>
  | undefined;
export function getHostedGithubRuntime() {
  if (!hostedGithubConfigured())
    throw new Error("The hosted GitHub runtime is not configured.");
  return currentImportSession() ? buildRuntime() : (pending ??= buildRuntime());
}
async function buildRuntime() {
  const { db, namespace } = hostedAdmin(),
    personalRoot = getPersonalDataRoot(),
    now = () => new Date();
  const vault = createHostedCredentialVault(
    db,
    namespace,
    process.env.GITHUB_VAULT_KEY!,
  );
  const context = (uid: string, repositoryIds: string[], signal: AbortSignal) =>
    newGithubRequestContext({
      personalRoot,
      sessionId: `account-${uid}`,
      authorizationNamespace: `firebase:${uid}`,
      accountId: uid,
      grantedRepositoryIds: repositoryIds,
      signal,
      budget: createUnavailableBudgetLedger(),
      now,
    });
  const store = createHostedAccessStore(db, namespace, async () => {
    // Every request checks current credentials/grants. Tab-held evidence is never
    // an authorization grant; disconnect must not reopen legacy source stores.
  });
  const callback = new URL(process.env.GITHUB_APP_CALLBACK_URL!);
  if (
    callback.protocol !== "https:" ||
    callback.pathname !== "/api/github/connection/callback" ||
    callback.origin !== process.env.RESUME_APP_ORIGIN
  )
    throw new Error("The GitHub callback must match the approved app origin.");
  const exchange = createGithubAuthorizationExchange({
    appId: process.env.GITHUB_APP_ID!,
    clientId: process.env.GITHUB_APP_CLIENT_ID!,
    clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
  });
  const access = createGithubAccess({
    config: {
      clientId: process.env.GITHUB_APP_CLIENT_ID!,
      callbackUrl: callback.href,
    },
    store,
    credentialVault: vault,
    github: exchange,
    clock: { now },
    cancellation: {
      async cancelJobs() {
        // There are no durable imports to enumerate. Revoked grants stop future
        // requests; the browser aborts its own active foreground request.
      },
    },
  });
  const authorizations = new WeakMap<
    ExecutionContext,
    Map<string, Promise<boolean>>
  >();
  const activeRepository = new WeakMap<ExecutionContext, string>();
  async function authorize(ctx: ExecutionContext, repositoryId: string) {
    if (!ctx.access.grantedRepositoryIds.includes(repositoryId)) return false;
    let saved = authorizations.get(ctx);
    if (!saved) {
      saved = new Map();
      authorizations.set(ctx, saved);
    }
    if (!saved.has(repositoryId))
      saved.set(
        repositoryId,
        access
          .authorizeRepository({
            sessionId: ctx.access.sessionId,
            repositoryId,
          })
          .then((result) => result.ok),
      );
    const allowed = await saved.get(repositoryId)!;
    if (allowed) activeRepository.set(ctx, repositoryId);
    return allowed;
  }
  async function repositoryToken(ctx: ExecutionContext, repositoryId: string) {
    const grant = (await store.listRepositoryGrants(ctx.access.sessionId)).find(
      (g) => g.repositoryId === repositoryId,
    );
    if (!grant || Date.parse(grant.expiresAt) <= Date.now())
      throw new Error("Repository credentials expired.");
    const scope: GithubCredentialScope = {
      sessionId: ctx.access.sessionId,
      purpose: "repository",
      repositoryId,
    };
    const secrets = await vault.read(grant.credentialHandle, scope);
    if (!secrets) throw new Error("Repository credentials are unavailable.");
    return secrets.accessToken;
  }
  const accessPort = createGithubAccessPort({
    access,
    callbackOrigin: callback.origin,
    async resolveScope(repository, ctx) {
      const token = await repositoryToken(ctx, repository.id),
        base = `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
      async function json(url: string) {
        const response = await fetch(url, {
          redirect: "error",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "resume-changer",
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error("Repository pinning failed.");
        return response.json();
      }
      const metadata = z
        .object({
          id: z.number().int().positive().safe(),
          default_branch: z.string().min(1).max(256),
        })
        .parse(await json(base));
      if (String(metadata.id) !== repository.id) return denied();
      const commit = z
        .object({ sha: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/) })
        .parse(
          await json(
            `${base}/commits/${encodeURIComponent(metadata.default_branch)}`,
          ),
        );
      return ok(
        RepositoryScopeSchema.parse({
          repositoryId: repository.id,
          owner: repository.owner,
          name: repository.name,
          canonicalUrl: repository.url,
          visibility: repository.visibility,
          ref: metadata.default_branch,
          commitSha: commit.sha,
          selectedPaths: [],
          selectedPullRequestNumbers: [],
          contributionStatement: "Describe your contribution before analysis.",
          identitySource: "github-account",
        }),
      );
    },
  });
  const backend = createGithubBackendRuntime({
    personalRoot,
    now,
    access: accessPort,
    workerAvailable: () => Boolean(currentImportSession()),
    authorize,
    provider: createAiProvider(),
    approvalFactory: createGithubApprovalPort,
    transport: (ctx) => ({
      resolveAddresses: resolveGithubAddresses,
      fetch: fetchPinnedGithub,
      credentials: {
        async getAccessToken() {
          const id = activeRepository.get(ctx);
          if (!id) throw new Error("A repository scope is required.");
          return repositoryToken(ctx, id);
        },
      },
    }),
    async ownsProject(id, ctx) {
      const account = await import("../../../cloud/server-account").then((m) =>
        m.requireCloudAccount(),
      );
      return (
        account.uid === ctx.access.accountId &&
        (await getCloudLibrary()).projects.some((project) => project.id === id)
      );
    },
    async requestContext(input) {
      const account = await accountFromRequest(input.request);
      if (input.accountId && account.uid !== input.accountId) return denied();
      const grants = await store.listRepositoryGrants(`account-${account.uid}`);
      return ok(
        context(
          account.uid,
          grants.map((g) => g.repositoryId),
          input.signal,
        ),
      );
    },
    async jobContext() {
      const session = currentImportSession();
      if (!session) return denied();
      const grants = await store.listRepositoryGrants(`account-${session.uid}`);
      return ok(
        context(
          session.uid,
          grants.map((g) => g.repositoryId),
          session.signal,
        ),
      );
    },
  });
  const services = composeGithubServices({ ...backend, personalRoot, now });
  return {
    services,
    async runJob(_jobId: string): Promise<boolean> {
      throw new Error(
        "Legacy background imports are retired. Start a new tab session.",
      );
    },
  };
}
