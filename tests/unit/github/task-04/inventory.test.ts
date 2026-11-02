import { describe, expect, it } from "vitest";
import {
  createRepositoryInspector,
  parseGithubRepositoryRoot,
  validateGithubRef,
  type GithubJsonClient,
  type GithubJsonResponse,
  type RepositorySnapshot,
  type Result,
} from "../../../../src/lib/github/server/repository";
import {
  buildRepositoryInventory,
  type RepositoryInventoryLimits,
} from "../../../../src/lib/github/server/inventory";
import {
  API_PACKAGE_SHA,
  COMMIT_SHA,
  DIRECTORY_SHA,
  FILE_SHA,
  MOBILE_PACKAGE_SHA,
  ROOT_TREE_SHA,
  commitMetadata,
  githubFailure,
  githubResponse,
  repositoryMetadata,
  treeDirectory,
  treeFile,
  treePage,
} from "./fixtures";

interface TestContext {
  runId: string;
  signal: AbortSignal;
  budgetLedger: { identity: string };
}

interface RecordedRequest {
  path: string;
  query?: Readonly<Record<string, string | number | boolean>>;
  context: TestContext;
}

type Handler = (
  request: RecordedRequest,
) => Result<GithubJsonResponse<unknown>>;

function createClient(handler: Handler) {
  const calls: RecordedRequest[] = [];
  const client: GithubJsonClient<TestContext> = {
    async getJson<T>(request: {
      path: string;
      query?: Readonly<Record<string, string | number | boolean>>;
      context: TestContext;
    }) {
      const recorded = request as RecordedRequest;
      calls.push(recorded);
      return handler(recorded) as Result<GithubJsonResponse<T>>;
    },
  };
  return { client, calls };
}

function testContext(): TestContext {
  return {
    runId: "synthetic-run-04",
    signal: new AbortController().signal,
    budgetLedger: { identity: "shared-budget-ledger" },
  };
}

function treeShaFromPath(path: string): string | undefined {
  return path.split("/git/trees/")[1]?.split("?")[0];
}

function isRecursive(request: RecordedRequest): boolean {
  return request.query?.recursive === 1;
}

function defaultSnapshot(
  overrides: Partial<RepositorySnapshot> = {},
): RepositorySnapshot {
  return {
    snapshotId: "github-snapshot-synthetic",
    repositoryId: 42,
    owner: "AyushGahtori",
    name: "resume-changer",
    url: "https://github.com/AyushGahtori/resume-changer",
    visibility: "public" as const,
    ref: "main",
    commitSha: COMMIT_SHA,
    treeSha: ROOT_TREE_SHA,
    ...overrides,
  };
}

function inventoryFrom(
  handler: Handler,
  options: {
    packagePath?: string;
    limits?: Partial<RepositoryInventoryLimits>;
  } = {},
) {
  const { client, calls } = createClient(handler);
  const snapshot = defaultSnapshot(
    options.packagePath ? { packagePath: options.packagePath } : {},
  );
  return {
    calls,
    run: () =>
      buildRepositoryInventory({
        snapshot,
        context: testContext(),
        client,
        limits: options.limits,
      }),
  };
}

describe("GitHub repository root and ref validation", () => {
  it.each([
    "http://github.com/acme/project",
    "https://github.com.evil.test/acme/project",
    "https://user@github.com/acme/project",
    "https://github.com:8443/acme/project",
    "https://github.com/acme/project/issues",
    "https://github.com/acme%2fteam/project",
    "https://github.com/acme/project?tab=readme",
    "https://github.com/acme/../project",
  ])("rejects unsafe or non-root repository URL %s", (url) => {
    expect(parseGithubRepositoryRoot(url).ok).toBe(false);
  });

  it("accepts repository roots and strips the optional .git suffix", () => {
    expect(
      parseGithubRepositoryRoot("https://github.com/acme/project.git"),
    ).toEqual({
      ok: true,
      value: { owner: "acme", name: "project" },
    });
  });

  it("accepts slash-separated refs and rejects encoded or traversal refs", () => {
    expect(validateGithubRef("feature/task-4")).toEqual({
      ok: true,
      value: "feature/task-4",
    });
    for (const ref of [
      "feature/%2e%2e/main",
      "feature//main",
      "../main",
      "feature/..",
      "main%2Fsecret",
    ]) {
      expect(validateGithubRef(ref).ok).toBe(false);
    }
  });
});

describe("createRepositoryInspector.resolveSnapshot", () => {
  it("resolves canonical identity and one immutable revision using the original context", async () => {
    const context = testContext();
    const { client, calls } = createClient((request) => {
      if (request.path === "/repos/old-owner/old-name") {
        return githubResponse(
          repositoryMetadata({
            id: 701,
            name: "renamed-project",
            full_name: "new-owner/renamed-project",
            owner: { login: "new-owner" },
            private: true,
          }),
        );
      }
      if (
        request.path ===
        `/repos/new-owner/renamed-project/commits/${encodeURIComponent("feature/task-4")}`
      ) {
        return githubResponse(commitMetadata());
      }
      return githubFailure("not-found");
    });
    const inspector = createRepositoryInspector({ client });

    const result = await inspector.resolveSnapshot({
      scope: {
        repositoryUrl: "https://github.com/old-owner/old-name.git",
        ref: "feature/task-4",
      },
      context,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      repositoryId: 701,
      owner: "new-owner",
      name: "renamed-project",
      url: "https://github.com/new-owner/renamed-project",
      visibility: "private",
      ref: "feature/task-4",
      commitSha: COMMIT_SHA,
      treeSha: ROOT_TREE_SHA,
    });
    expect(calls.map((call) => call.path)).toEqual([
      "/repos/old-owner/old-name",
      `/repos/new-owner/renamed-project/commits/${encodeURIComponent("feature/task-4")}`,
    ]);
    expect(calls.every((call) => call.context === context)).toBe(true);
  });

  it("uses an explicit ref when the repository has no default branch", async () => {
    const { client, calls } = createClient((request) =>
      request.path === "/repos/acme/project"
        ? githubResponse(repositoryMetadata({ default_branch: null }))
        : githubResponse(commitMetadata()),
    );
    const inspector = createRepositoryInspector({ client });
    const result = await inspector.resolveSnapshot({
      scope: {
        repositoryUrl: "https://github.com/acme/project",
        ref: "release/v2",
      },
      context: testContext(),
    });

    expect(result.ok).toBe(true);
    expect(calls[1].path).toContain("/commits/release%2Fv2");
  });

  it("returns a needs-context result when both the default branch and ref are missing", async () => {
    const { client, calls } = createClient(() =>
      githubResponse(repositoryMetadata({ default_branch: null })),
    );
    const inspector = createRepositoryInspector({ client });
    const result = await inspector.resolveSnapshot({
      scope: { repositoryUrl: "https://github.com/acme/project" },
      context: testContext(),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "needs-context" },
    });
    expect(calls).toHaveLength(1);
  });

  it("does not call GitHub for invalid refs or package traversal", async () => {
    const { client, calls } = createClient(() =>
      githubResponse(repositoryMetadata()),
    );
    const inspector = createRepositoryInspector({ client });

    const invalidRef = await inspector.resolveSnapshot({
      scope: {
        repositoryUrl: "https://github.com/acme/project",
        ref: "refs/heads/%2e%2e",
      },
      context: testContext(),
    });
    const invalidPackage = await inspector.resolveSnapshot({
      scope: {
        repositoryUrl: "https://github.com/acme/project",
        packagePath: "packages/../private",
      },
      context: testContext(),
    });

    expect(invalidRef).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(invalidPackage).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(calls).toHaveLength(0);
  });

  it("does not reveal whether an unavailable repository is private", async () => {
    const { client } = createClient(() => githubFailure("not-found"));
    const inspector = createRepositoryInspector({ client });
    const result = await inspector.resolveSnapshot({
      scope: { repositoryUrl: "https://github.com/acme/project" },
      context: testContext(),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "not-found",
        message: "The repository or revision is unavailable.",
      },
    });
  });
});

describe("bounded immutable repository inventory", () => {
  it("returns a distinct complete empty inventory instead of treating it as an error", async () => {
    const fixture = inventoryFrom((request) =>
      githubResponse(
        treePage(treeShaFromPath(request.path) ?? ROOT_TREE_SHA, []),
      ),
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      files: [],
      empty: true,
      complete: true,
      partial: false,
      projectTypes: ["unknown"],
      manualScopeAvailable: true,
    });
  });

  it("keeps useful source candidates when README is missing", async () => {
    const fixture = inventoryFrom(() =>
      githubResponse(
        treePage(ROOT_TREE_SHA, [
          treeFile("go.mod"),
          treeFile("cmd/server/main.go"),
          treeFile("internal/http/handler.go"),
        ]),
      ),
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((file) => file.path)).toEqual([
      "cmd/server/main.go",
      "go.mod",
      "internal/http/handler.go",
    ]);
    expect(result.value.projectTypes).toContain("go");
    expect(
      result.value.packages.find((item) => item.path === "")?.entrypointPaths,
    ).toContain("cmd/server/main.go");
  });

  it("recovers a truncated recursive response through bounded subtree reads", async () => {
    const fixture = inventoryFrom((request) => {
      const sha = treeShaFromPath(request.path) ?? ROOT_TREE_SHA;
      if (isRecursive(request)) {
        return githubResponse(
          treePage(ROOT_TREE_SHA, [treeDirectory("src", DIRECTORY_SHA)], true),
        );
      }
      if (sha === ROOT_TREE_SHA) {
        return githubResponse(
          treePage(ROOT_TREE_SHA, [
            treeDirectory("src", DIRECTORY_SHA),
            treeFile("README.md"),
          ]),
        );
      }
      if (sha === DIRECTORY_SHA) {
        return githubResponse(treePage(DIRECTORY_SHA, [treeFile("index.ts")]));
      }
      return githubFailure("not-found");
    });
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recursiveTruncationRecovered).toBe(true);
    expect(result.value.complete).toBe(true);
    expect(result.value.unvisitedScope).toEqual([]);
    expect(result.value.files.map((file) => file.path)).toEqual([
      "README.md",
      "src/index.ts",
    ]);
  });

  it("reports the skipped subtree when a depth cap prevents traversal", async () => {
    const fixture = inventoryFrom(
      (request) => {
        const sha = treeShaFromPath(request.path) ?? ROOT_TREE_SHA;
        if (isRecursive(request)) {
          return githubResponse(
            treePage(
              ROOT_TREE_SHA,
              [treeDirectory("level-one", DIRECTORY_SHA)],
              true,
            ),
          );
        }
        return githubResponse(
          sha === ROOT_TREE_SHA
            ? treePage(ROOT_TREE_SHA, [
                treeDirectory("level-one", DIRECTORY_SHA),
              ])
            : treePage(DIRECTORY_SHA, [
                treeDirectory("level-two", API_PACKAGE_SHA),
              ]),
        );
      },
      { limits: { maxDepth: 1 } },
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.partial).toBe(true);
    expect(result.value.complete).toBe(false);
    expect(result.value.limitReasons).toContain("depth-limit");
    expect(result.value.unvisitedScope).toContain("level-one");
  });

  it("stops at the entry limit and records the rest of the visited scope as skipped", async () => {
    const fixture = inventoryFrom(
      () =>
        githubResponse(
          treePage(ROOT_TREE_SHA, [
            treeFile("a.ts"),
            treeFile("b.ts"),
            treeFile("c.ts"),
          ]),
        ),
      { limits: { maxEntries: 2 } },
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.map((file) => file.path)).toEqual([
      "a.ts",
      "b.ts",
    ]);
    expect(result.value.usage.entriesRetained).toBe(2);
    expect(result.value.limitReasons).toContain("entry-limit");
    expect(result.value.unvisitedScope).toContain("c.ts");
  });

  it("stops before another tree request when the shared inventory request ceiling is reached", async () => {
    const fixture = inventoryFrom(
      (request) =>
        isRecursive(request)
          ? githubResponse(treePage(ROOT_TREE_SHA, [], true))
          : githubResponse(treePage(ROOT_TREE_SHA, [])),
      { limits: { maxTreeRequests: 1 } },
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fixture.calls).toHaveLength(1);
    expect(result.value.partial).toBe(true);
    expect(result.value.limitReasons).toContain("request-limit");
  });

  it("enforces the tree wire ceiling and returns a useful partial inventory", async () => {
    const fixture = inventoryFrom(
      () =>
        githubResponse(treePage(ROOT_TREE_SHA, [treeFile("src/index.ts")]), {
          wireBytes: 101,
        }),
      { limits: { maxTreeWireBytes: 100 } },
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files).toEqual([]);
    expect(result.value.partial).toBe(true);
    expect(result.value.limitReasons).toContain("wire-limit");
    expect(result.value.usage.treeWireBytes).toBe(101);
  });

  it("keeps the selected monorepo package and necessary root context only", async () => {
    const fixture = inventoryFrom(
      (request) => {
        const sha = treeShaFromPath(request.path) ?? ROOT_TREE_SHA;
        if (sha === ROOT_TREE_SHA) {
          return githubResponse(
            treePage(ROOT_TREE_SHA, [
              treeFile("README.md"),
              treeFile("package.json"),
              treeDirectory("packages", DIRECTORY_SHA),
              treeDirectory("tools", MOBILE_PACKAGE_SHA),
            ]),
          );
        }
        if (sha === DIRECTORY_SHA && !isRecursive(request)) {
          return githubResponse(
            treePage(DIRECTORY_SHA, [
              treeDirectory("api", API_PACKAGE_SHA),
              treeDirectory("mobile", MOBILE_PACKAGE_SHA),
            ]),
          );
        }
        if (sha === API_PACKAGE_SHA && isRecursive(request)) {
          return githubResponse(
            treePage(API_PACKAGE_SHA, [
              treeFile(
                "package.json",
                "1111111111111111111111111111111111111111",
              ),
              treeFile(
                "src/app/page.tsx",
                "2222222222222222222222222222222222222222",
              ),
              treeFile(
                "tests/api.test.ts",
                "3333333333333333333333333333333333333333",
              ),
              treeFile(
                "dist/bundle.min.js",
                "4444444444444444444444444444444444444444",
              ),
              treeFile(
                "weights.onnx",
                "5555555555555555555555555555555555555555",
                900_000,
              ),
              treeFile(
                "link",
                "6666666666666666666666666666666666666666",
                12,
                "120000",
              ),
              {
                path: "external",
                mode: "160000",
                type: "commit",
                sha: "7777777777777777777777777777777777777777",
              },
              treeFile(
                "notebooks/demo.ipynb",
                "8888888888888888888888888888888888888888",
              ),
            ]),
          );
        }
        return githubFailure("not-found");
      },
      { packagePath: "packages/api" },
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.value.files.map((file) => file.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("package.json");
    expect(paths).toContain("packages/api/src/app/page.tsx");
    expect(paths).not.toContain("packages/mobile/src/MainActivity.kt");
    expect(paths).not.toContain("tools/build.gradle");
    expect(result.value.packages.map((item) => item.path)).toContain(
      "packages/api",
    );
    expect(result.value.projectTypes).toContain("javascript-typescript");

    const byPath = new Map(result.value.files.map((file) => [file.path, file]));
    expect(byPath.get("packages/api/link")?.safetyFlags).toContain("symlink");
    expect(byPath.get("packages/api/link")?.eligibility).toBe("excluded");
    expect(byPath.get("packages/api/external")?.safetyFlags).toContain(
      "submodule",
    );
    expect(byPath.get("packages/api/weights.onnx")?.safetyFlags).toEqual(
      expect.arrayContaining([
        "binary-candidate",
        "oversized",
        "lfs-candidate",
      ]),
    );
    expect(
      byPath.get("packages/api/dist/bundle.min.js")?.safetyFlags,
    ).toContain("generated-candidate");
    expect(
      byPath.get("packages/api/notebooks/demo.ipynb")?.safetyFlags,
    ).toContain("notebook-unparsed");
    expect(
      result.value.files.every((file) => file.commitSha === COMMIT_SHA),
    ).toBe(true);
    expect(
      result.value.files.every(
        (file) => file.snapshotId === "github-snapshot-synthetic",
      ),
    ).toBe(true);
    expect(
      fixture.calls.every(
        (call) =>
          call.path.includes(ROOT_TREE_SHA) ||
          call.path.includes(DIRECTORY_SHA) ||
          call.path.includes(API_PACKAGE_SHA),
      ),
    ).toBe(true);
  });

  it("preserves evidence paths from the pinned tree SHA and never follows the moving ref", async () => {
    const { client, calls } = createClient((request) => {
      if (request.path.includes("/git/trees/")) {
        return githubResponse(
          treePage(ROOT_TREE_SHA, [treeFile("src/index.ts")]),
        );
      }
      return githubFailure("not-found");
    });
    const snapshot = defaultSnapshot();
    const inspector = createRepositoryInspector({ client });
    const result = await inspector.inventory({
      snapshot,
      context: testContext(),
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toContain(`/git/trees/${ROOT_TREE_SHA}`);
    expect(calls[0].path).not.toContain("main");
    if (!result.ok) return;
    expect(result.value.files[0]).toMatchObject({
      commitSha: COMMIT_SHA,
      path: "src/index.ts",
      blobSha: FILE_SHA,
    });
  });

  it("rejects a tree response that does not match the requested immutable tree SHA", async () => {
    const fixture = inventoryFrom(() =>
      githubResponse(treePage(DIRECTORY_SHA, [treeFile("src/index.ts")])),
    );
    const result = await fixture.run();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "upstream-error" },
    });
  });

  it("keeps unknown-size files manual-only for the downstream byte policy", async () => {
    const fixture = inventoryFrom(() =>
      githubResponse(
        treePage(ROOT_TREE_SHA, [
          {
            path: "src/unknown-size.ts",
            mode: "100644",
            type: "blob",
            sha: FILE_SHA,
          },
        ]),
      ),
    );
    const result = await fixture.run();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files[0]).toMatchObject({
      path: "src/unknown-size.ts",
      sizeBytes: null,
      eligibility: "manual-only",
    });
    expect(result.value.files[0].safetyFlags).toContain("size-unknown");
  });

  it("rejects malformed GitHub file modes instead of treating them as safe blobs", async () => {
    const fixture = inventoryFrom(() =>
      githubResponse(
        treePage(ROOT_TREE_SHA, [
          {
            path: "src/unknown-mode.ts",
            mode: "100777",
            type: "blob",
            sha: FILE_SHA,
            size: 20,
          },
        ]),
      ),
    );
    const result = await fixture.run();

    expect(result).toMatchObject({
      ok: false,
      error: { code: "upstream-error" },
    });
  });

  it("keeps stable inventory IDs for identical pinned tree entries", async () => {
    const run = () =>
      inventoryFrom(() =>
        githubResponse(treePage(ROOT_TREE_SHA, [treeFile("src/index.ts")])),
      ).run();
    const first = await run();
    const second = await run();

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.files[0].id).toBe(second.value.files[0].id);
  });
});
