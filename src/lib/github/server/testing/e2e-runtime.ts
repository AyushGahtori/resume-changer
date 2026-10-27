import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createGithubBackendRuntime } from "../backend-runtime";
import { composeGithubServices, newGithubRequestContext } from "../composition";
import {
  createUnavailableBudgetLedger,
  createUnavailableGithubPorts,
} from "../unavailable";
import { ok, type RepositoryScope } from "../../contracts";
import { isGithubImportHarnessEnabled } from "../../test-harness";

const commit = "a".repeat(40),
  tree = "b".repeat(40);
const files = {
  "package.json": JSON.stringify({
    name: "fictional-publishing",
    dependencies: { express: "5.0.0" },
    scripts: { test: "vitest" },
  }),
  "README.md":
    "# Fictional publishing API\nValidates publishing requests and caches published content.\n",
  "src/publish.ts":
    "export function validatePublish(input: string) {\n if (!input.trim()) throw new Error('Missing content');\n return input.trim();\n}\n",
  "tests/publish.test.ts":
    "it('rejects blank input', () => {\n expect(() => validatePublish('')).toThrow();\n});\n",
};
const blob = (text: string) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");

/** Explicit, local-only synthetic external boundaries for the real Gate C backend. */
export async function createE2eGithubServices({
  personalRoot,
  now,
}: {
  personalRoot: string;
  now: () => Date;
}) {
  if (
    !isGithubImportHarnessEnabled(process.env) ||
    process.env.GITHUB_IMPORT_E2E_BACKEND !== "1" ||
    dirname(resolve(personalRoot)) !== resolve(tmpdir()) ||
    !/^resume-changer-playwright-data-\d+$/.test(basename(personalRoot))
  )
    throw new Error("The synthetic backend requires an isolated E2E root.");
  const library = JSON.parse(
    await readFile(join(personalRoot, "data/resume-library.json"), "utf8"),
  );
  const scope: RepositoryScope = {
    repositoryId: "42",
    owner: "example",
    name: "publishing",
    canonicalUrl: "https://github.com/example/publishing",
    visibility: "public",
    ref: "main",
    commitSha: commit,
    selectedPaths: [],
    selectedPullRequestNumbers: [],
    contributionStatement: "Describe your contribution before analysis.",
    identitySource: "user-provided",
  };
  const context = (signal = new AbortController().signal) =>
    newGithubRequestContext({
      personalRoot,
      sessionId: "e2e-session",
      authorizationNamespace: "e2e:user",
      grantedRepositoryIds: ["42"],
      signal,
      budget: createUnavailableBudgetLedger(),
      now,
    });
  const unavailable = createUnavailableGithubPorts();
  let approvalFactory: Parameters<
    typeof createGithubBackendRuntime
  >[0]["approvalFactory"] = () => unavailable.approval;
  // Next supplies its guarded writer; the separate Node worker only prepares/extracts.
  if (process.env.NEXT_RUNTIME === "nodejs")
    approvalFactory = (await import("../../../data/writers"))
      .createGithubApprovalPort;
  const runtime = createGithubBackendRuntime({
    personalRoot,
    now,
    approvalFactory,
    workerAvailable: () => true,
    ownsProject: async (id) =>
      library.projects.some((p: { id: string }) => p.id === id),
    authorize: async () => true,
    requestContext: async ({ signal }) => ok(context(signal)),
    jobContext: async () => ok(context()),
    access: {
      async beginConnection() {
        const state = randomBytes(32).toString("base64url"),
          url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", "e2e-github-app");
        url.searchParams.set(
          "redirect_uri",
          process.env.GITHUB_APP_CALLBACK_URL!,
        );
        url.searchParams.set("state", state);
        url.searchParams.set("scope", "offline_access");
        url.searchParams.set(
          "code_challenge",
          randomBytes(32).toString("base64url"),
        );
        url.searchParams.set("code_challenge_method", "S256");
        return ok({ authorizationUrl: url.href, state });
      },
      async completeAuthorization() {
        return ok({
          accountId: "fictional-account",
          connectedAt: now().toISOString(),
        });
      },
      async listAccessibleRepositories() {
        return ok({
          repositories: [
            {
              repositoryId: "42",
              owner: "example",
              name: "publishing",
              canonicalUrl: scope.canonicalUrl,
              visibility: "public",
              defaultBranch: "main",
              permission: "read",
            },
          ],
          nextCursor: null,
        });
      },
      async authorizeRepository() {
        return ok({ scope });
      },
      async disconnect() {
        return ok({ disconnected: true, upstreamRevocation: "not-requested" });
      },
    },
    transport: () => ({
      credentials: { getAccessToken: async () => null },
      resolveAddresses: async () => ["140.82.112.6"],
      fetch: async (url) => {
        if (url.pathname === "/repos/example/publishing")
          return Response.json({
            id: 42,
            name: "publishing",
            full_name: "example/publishing",
            owner: { login: "example" },
            default_branch: "main",
            private: false,
            visibility: "public",
          });
        if (url.pathname.includes("/commits/"))
          return Response.json({
            sha: commit,
            commit: { tree: { sha: tree } },
          });
        if (url.pathname.includes("/git/trees/"))
          return Response.json({
            sha: tree,
            truncated: false,
            tree: Object.entries(files).map(([path, text]) => ({
              path,
              sha: blob(text),
              mode: "100644",
              type: "blob",
              size: Buffer.byteLength(text),
            })),
          });
        if (url.pathname.endsWith("/pulls"))
          return Response.json([
            {
              id: 7007,
              number: 7,
              title: "Validate publishing requests",
              state: "closed",
              merged_at: "2026-10-20T12:00:00Z",
              updated_at: "2026-10-20T12:00:00Z",
              user: { login: "example" },
              head: {
                sha: commit,
                ref: "validation",
                repo: {
                  id: 42,
                  full_name: "example/publishing",
                  name: "publishing",
                  owner: { login: "example" },
                },
              },
              base: {
                sha: commit,
                ref: "main",
                repo: {
                  id: 42,
                  full_name: "example/publishing",
                  name: "publishing",
                  owner: { login: "example" },
                },
              },
            },
          ]);
        if (url.pathname.endsWith("/pulls/7/files"))
          return Response.json([
            {
              filename: "src/publish.ts",
              status: "modified",
              sha: blob(files["src/publish.ts"]),
              additions: 4,
              deletions: 1,
              changes: 5,
            },
          ]);
        if (url.pathname.endsWith("/pulls/7"))
          return Response.json({
            id: 7007,
            number: 7,
            title: "Validate publishing requests",
            body: "Fictional fixture",
            state: "closed",
            merged_at: "2026-10-20T12:00:00Z",
            merge_commit_sha: commit,
            updated_at: "2026-10-20T12:00:00Z",
            user: { login: "example" },
            head: {
              sha: commit,
              ref: "validation",
              repo: {
                id: 42,
                full_name: "example/publishing",
                name: "publishing",
                owner: { login: "example" },
              },
            },
            base: {
              sha: commit,
              ref: "main",
              repo: {
                id: 42,
                full_name: "example/publishing",
                name: "publishing",
                owner: { login: "example" },
              },
            },
            changed_files: 1,
            commits: 1,
          });
        const text = Object.values(files).find((text) =>
          url.pathname.endsWith(blob(text)),
        );
        return new Response(text ?? "", { status: text ? 200 : 404 });
      },
    }),
    provider: {
      async extractRepositoryAchievements(input) {
        const data = JSON.parse(
          input.prompt.split("INPUT_DATA_JSON\n").at(-1)!,
        );
        const id = data.evidence.find(
          (e: { path: string }) => e.path === "src/publish.ts",
        ).id;
        await new Promise((r) => setTimeout(r, 1200));
        return {
          text: JSON.stringify({
            projectSummary: "Input validation in a fictional publishing API.",
            claims: [
              {
                text: "The publishing function rejects blank content.",
                evidenceIds: [id],
                usesContributionStatement: true,
                limitations: [],
              },
            ],
            drafts: [
              {
                text: "Implemented publishing input validation and added a regression assertion for blank content.",
                claimIndexes: [0],
                limitations: [],
              },
            ],
            questionSuggestions: [],
            limitations: [],
          }),
          model: "synthetic-source-extractor",
          finishReason: "STOP",
          usage: {
            promptTokens: 500,
            cachedTokens: 0,
            outputTokens: 150,
            reasoningTokens: 0,
            totalTokens: 650,
          },
        };
      },
    },
  });
  return composeGithubServices({ ...runtime, personalRoot, now });
}
