import { z } from "zod";
import { start } from "workflow/api";
import { hostedAdmin } from "./admin";
import { createHostedJobOwners } from "./job-owners";
import { createFirestoreStateStorage } from "./firestore-state";
import {
  createHostedAccessStore,
  createHostedCredentialVault,
} from "./credential-store";
import { createGithubAuthorizationExchange } from "./github-exchange";
import { fetchPinnedGithub, resolveGithubAddresses } from "./network";
import { hostedGithubConfigured } from "./config";
import { createGithubAccess } from "../access-core";
import { createGithubAccessPort } from "../access-port";
import { createGithubBackendRuntime } from "../backend-runtime";
import {
  composeGithubServices,
  newGithubRequestContext,
  type GithubServerServices,
} from "../composition";
import { configureDurableStateStorage } from "../state";
import { createJobStore } from "../jobs/store";
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
  type JobRecord,
} from "../../contracts";
import type { GithubCredentialScope } from "../credentials-core";
import { githubImportWorkflow } from "../../../../workflows/github-import";

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
  return (pending ??= buildRuntime());
}
async function buildRuntime() {
  console.info("GitHub runtime startup.", { stage: "module-loaded" });
  const { db, auth, namespace } = hostedAdmin(),
    personalRoot = getPersonalDataRoot(),
    now = () => new Date();
  console.info("GitHub runtime startup.", { stage: "admin-ready" });
  const storage = createFirestoreStateStorage(db, namespace);
  configureDurableStateStorage(storage);
  const vault = createHostedCredentialVault(
    db,
    namespace,
    process.env.GITHUB_VAULT_KEY!,
  );
  console.info("GitHub runtime startup.", { stage: "vault-ready" });
  const jobs = createJobStore({ rootDir: personalRoot, clock: { now } });
  const owners = createHostedJobOwners(db, namespace, (uid) =>
    auth.getUser(uid),
  );
  let backend: ReturnType<typeof createGithubBackendRuntime>;
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
  const store = createHostedAccessStore(
    db,
    namespace,
    async (sessionId, repositoryId) => {
      // Repository authorization is checked freshly per request/run, so there is no
      // repository-list cache to evict. Disconnect invalidates all staged excerpts.
      if (repositoryId) return;
      const uid = sessionId.replace(/^account-/, "");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid) || sessionId !== `account-${uid}`)
        throw new Error("Invalid account session.");
      const ctx = context(uid, [], new AbortController().signal);
      const result =
        await backend.ports.imports.invalidateAuthorizationNamespace(
          { authorizationNamespace: ctx.access.authorizationNamespace },
          ctx,
        );
      if (!result.ok) throw new Error("Staged cache cleanup failed.");
    },
  );
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
  console.info("GitHub runtime startup.", { stage: "exchange-ready" });
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
      async cancelJobs(sessionId) {
        const uid = sessionId.replace(/^account-/, "");
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid))
          throw new Error("Invalid session.");
        for (const id of await owners.list(uid)) {
          const job = await jobs.get({ jobId: id });
          if (
            job.ok &&
            (job.value.state === "queued" || job.value.state === "running")
          ) {
            const result = await jobs.requestCancel({ jobId: id });
            if (!result.ok) throw new Error("Job cancellation failed.");
          }
        }
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
  async function dispatchJob(job: JobRecord, ctx: ExecutionContext) {
    const uid = ctx.access.accountId;
    if (
      !uid ||
      ctx.access.sessionId !== `account-${uid}` ||
      ctx.access.authorizationNamespace !== `firebase:${uid}`
    )
      throw new Error("Invalid hosted job owner.");
    const loaded = await backend.ports.imports.get({ id: job.importId }, ctx);
    if (!loaded.ok) throw new Error("The job import is unavailable.");
    await owners.bind(job, ctx, loaded.value.scope.repositoryId);
    await start(githubImportWorkflow, [job.id], {
      region: "fra1",
      experimental_retention: 0,
    });
  }
  console.info("GitHub runtime startup.", { stage: "backend-start" });
  backend = createGithubBackendRuntime({
    personalRoot,
    now,
    access: accessPort,
    workerAvailable: () => true,
    dispatchJob,
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
    async jobContext(job) {
      const owner = await owners.resolve(job);
      return ok(
        context(owner.uid, [owner.repositoryId], new AbortController().signal),
      );
    },
  });
  const services = composeGithubServices({ ...backend, personalRoot, now });
  console.info("GitHub runtime startup.", { stage: "ready" });
  return {
    services,
    async runJob(jobId: string) {
      if (!(await owners.exists(jobId)))
        throw new Error("The workflow job owner is unavailable.");
      const recovery = await backend.ports.runner.recover();
      if (!recovery.ok) throw new Error("Job recovery is unavailable.");
      const result = await backend.ports.runner.runOnce({ jobId });
      if (!result.ok && result.error.code !== "unavailable")
        throw new Error("The hosted import worker failed.");
      const job = await jobs.get({ jobId });
      if (!job.ok) throw new Error("The workflow job is unavailable.");
      return job.value.state !== "queued" && job.value.state !== "running";
    },
  };
}
