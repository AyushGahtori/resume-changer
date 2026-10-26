import { describe, expect, it } from "vitest";
import {
  createPrContextReader,
  PR_CONTEXT_LIMITS,
  type GithubReadResponse,
  type GithubResult,
  type PrExecutionContext,
  type PrGithubClient,
} from "@/lib/github/server/pr-context";
import { createPrSignals } from "@/lib/github/server/pr-signals";
import {
  BASE_SHA,
  CURRENT_SHA,
  HEAD_SHA,
  makeChangedFile,
  makeContext,
  makePullRequest,
  makeScope,
} from "./fixtures";

interface RequestArgs {
  path: string;
  query?: Readonly<Record<string, string | number>>;
  context: PrExecutionContext;
}

type Handler = (
  request: RequestArgs,
) => Promise<GithubResult<GithubReadResponse<unknown>>>;

function makeGithub(handler: Handler): {
  github: PrGithubClient;
  calls: RequestArgs[];
} {
  const calls: RequestArgs[] = [];
  const github: PrGithubClient = {
    async getJson<T>(request: RequestArgs) {
      calls.push(request);
      return (await handler(request)) as GithubResult<GithubReadResponse<T>>;
    },
  };
  return { github, calls };
}

function success(
  data: unknown,
  options: { attempts?: number; hasNextPage?: boolean } = {},
) {
  return {
    ok: true as const,
    value: {
      data,
      status: 200,
      attempts: options.attempts,
      hasNextPage: options.hasNextPage,
    },
  };
}

function failure(
  code: "unavailable" | "limit-exceeded" | "forbidden" | "not-found",
) {
  return {
    ok: false as const,
    error: {
      code,
      message: "The pull request data is not available.",
      retryable: code === "unavailable",
    },
  };
}

function unwrap<T>(result: GithubResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function filesPage(page: number, count = 30): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) =>
    makeChangedFile({
      filename: `src/core/file-${page}-${index}.ts`,
      patch: "Ignored patch content",
    }),
  );
}

describe("GitHub pull request context", () => {
  it("lists one bounded state=all page and keeps body text out of candidate summaries", async () => {
    const { github, calls } = makeGithub(async () =>
      success([makePullRequest(12, { title: "A".repeat(200) })]),
    );
    const reader = createPrContextReader({ github });
    const context = makeContext();
    const result = unwrap(
      await reader.listCandidates({ scope: makeScope(), context }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: "/repos/acme/resume-changer/pulls",
      query: {
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: 30,
        page: 1,
      },
      context,
    });
    expect(result.historyScope).toBe("bounded-recent-list");
    expect(result.partial).toBe(false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("A".repeat(200));
    expect(result.items[0]?.titleForPrompt).toHaveLength(
      PR_CONTEXT_LIMITS.titlePromptCharacters,
    );
    expect(JSON.stringify(result)).not.toContain("Untrusted body content");
    expect(JSON.stringify(result)).not.toContain("html_url");
    expect(result.attribution).toBe("unconfirmed");
  });

  it("caps candidate summaries and reports a truncated or full-sized page as partial", async () => {
    const rows = Array.from({ length: 31 }, (_, index) =>
      makePullRequest(index + 1),
    );
    const { github } = makeGithub(async () => success(rows));
    const reader = createPrContextReader({ github });

    const result = unwrap(
      await reader.listCandidates({
        scope: makeScope(),
        context: makeContext(),
      }),
    );

    expect(result.items).toHaveLength(PR_CONTEXT_LIMITS.candidateSummaries);
    expect(result.partial).toBe(true);
    expect(result.limitations).toContain(
      "recent-list-does-not-search-older-history",
    );
  });

  it("keeps fork, revision, rename, deletion, and merge-state identity separate from the current snapshot", async () => {
    const pr = makePullRequest(9, {
      title: "Dashboard integration",
      state: "closed",
      merged: false,
      merged_at: null,
      merge_commit_sha: null,
      co_authors: [{ id: 8, login: "pair-contributor" }],
      body: "Co-authored-by: pair-contributor@example.invalid",
      base: {
        ref: "main",
        sha: BASE_SHA,
        repo: { id: 42, name: "resume-changer", owner: { login: "acme" } },
      },
      head: {
        ref: "work/dashboard",
        sha: HEAD_SHA,
        repo: {
          id: 77,
          name: "resume-changer",
          owner: { login: "contributor" },
        },
      },
    });
    const { github, calls } = makeGithub(async ({ path }) => {
      if (path.endsWith("/files")) {
        return success([
          makeChangedFile({
            filename: "src/lib/current-name.ts",
            previous_filename: "src/lib/original-name.ts",
            status: "renamed",
          }),
          makeChangedFile({
            filename: "src/lib/removed.ts",
            status: "removed",
          }),
        ]);
      }
      return success(pr);
    });
    const reader = createPrContextReader({ github });
    const result = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [9],
        context: makeContext(),
      }),
    );
    const selected = result.items[0];

    expect(calls.map((call) => call.path)).toEqual([
      "/repos/acme/resume-changer/pulls/9",
      "/repos/acme/resume-changer/pulls/9/files",
    ]);
    expect(selected?.state).toBe("closed");
    expect(selected?.mergeState).toBe("closed-unmerged");
    expect(selected?.base.repository).toMatchObject({
      id: 42,
      fullName: "acme/resume-changer",
    });
    expect(selected?.head.repository).toMatchObject({
      id: 77,
      fullName: "contributor/resume-changer",
    });
    expect(selected?.head.sha).toBe(HEAD_SHA);
    expect(selected?.currentSnapshotSha).toBe(CURRENT_SHA);
    expect(selected?.snapshotRelation).toBe("no-exact-match");
    expect(
      selected?.changedPaths.map((file) => [
        file.filename,
        file.previousFilename,
        file.status,
      ]),
    ).toEqual([
      ["src/lib/current-name.ts", "src/lib/original-name.ts", "renamed"],
      ["src/lib/removed.ts", null, "removed"],
    ]);
    expect(
      selected?.changedPaths.every(
        (file) =>
          file.evidenceKind === "historical-pr-metadata" &&
          !file.currentSnapshotContentVerified,
      ),
    ).toBe(true);
    expect(result.limitations).toContain(
      "pr-metadata-does-not-verify-current-snapshot-content",
    );
    expect(selected?.contribution).toEqual({
      status: "unconfirmed",
      reasonCode: "user-confirmation-required",
    });
    expect(JSON.stringify(result)).not.toContain("Untrusted body content");
    expect(JSON.stringify(result)).not.toContain("attacker.invalid");
  });

  it("uses merge metadata explicitly and never turns a bot author into contribution confirmation", async () => {
    const pr = makePullRequest(14, {
      title: "chore: Update dependencies",
      state: "closed",
      merged: true,
      merged_at: "2026-10-10T10:00:00Z",
      merge_commit_sha: "d".repeat(40),
      user: { id: 999, login: "dependabot[bot]", type: "Bot" },
    });
    const { github } = makeGithub(async ({ path }) =>
      path.endsWith("/files")
        ? success([
            makeChangedFile({
              filename: "package-lock.json",
              status: "modified",
            }),
          ])
        : success(pr),
    );
    const reader = createPrContextReader({ github });
    const result = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [14],
        context: makeContext(),
      }),
    );

    expect(result.items[0]?.mergeState).toBe("merged");
    expect(result.items[0]?.mergedAt).toBe("2026-10-10T10:00:00Z");
    expect(result.items[0]?.mergeCommitSha).toBe("d".repeat(40));
    expect(result.items[0]?.author.kind).toBe("bot");
    expect(result.items[0]?.contribution.status).toBe("unconfirmed");
    expect("contributionCount" in (result.items[0] ?? {})).toBe(false);
  });

  it("keeps documentation-only paths from becoming UI implementation hints", () => {
    const signals = createPrSignals({
      title: "feat: Dashboard integration",
      changedPaths: ["docs/dashboard.md"],
    });

    expect(signals.titleHints.map((hint) => hint.capability)).toContain(
      "web-ui",
    );
    expect(signals.pathHints.map((hint) => hint.capability)).toEqual([
      "documentation",
    ]);
    expect(signals.documentationOnly).toBe(true);
    expect(signals.titlePathMismatch).toBe(true);
  });

  it("produces multi-capability hints for a hybrid ML evaluation dashboard", () => {
    const signals = createPrSignals({
      title: "Model evaluation dashboard",
      changedPaths: [
        "src/app/dashboard/page.tsx",
        "src/ml/evaluation/report-reader.py",
        "tests/report-reader.test.py",
      ],
    });
    const pathCapabilities = new Set(
      signals.pathHints.map((hint) => hint.capability),
    );
    const titleCapabilities = new Set(
      signals.titleHints.map((hint) => hint.capability),
    );

    expect(pathCapabilities).toContain("web-ui");
    expect(pathCapabilities).toContain("ml-training");
    expect(titleCapabilities).toContain("reporting");
    expect(signals.titlePathMismatch).toBe(false);
  });

  it("uses path evidence when a vague or multilingual title has no known hint", () => {
    const signals = createPrSignals({
      title: "Mejora del panel de predicción",
      changedPaths: ["src/app/predictions/page.tsx", "src/models/train.py"],
    });

    expect(signals.titleHints.map((hint) => hint.capability)).toEqual([
      "unknown",
    ]);
    expect(signals.pathHints.map((hint) => hint.capability)).toContain(
      "web-ui",
    );
    expect(signals.pathHints.map((hint) => hint.capability)).toContain(
      "ml-training",
    );
  });

  it("keeps dependency-only and bot changes as weak hints, without claiming implementation or ownership", async () => {
    const pr = makePullRequest(15, {
      title: "chore: Update dependencies",
      user: { id: 999, login: "dependabot[bot]", type: "Bot" },
    });
    const { github } = makeGithub(async ({ path }) =>
      path.endsWith("/files")
        ? success([
            makeChangedFile({
              filename: "package-lock.json",
              status: "modified",
            }),
          ])
        : success(pr),
    );
    const reader = createPrContextReader({ github });
    const result = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [15],
        context: makeContext(),
      }),
    );

    expect(result.items[0]?.author.kind).toBe("bot");
    expect(result.items[0]?.signals.titlePathMismatch).toBe(true);
    expect(
      result.items[0]?.signals.pathHints.map((hint) => hint.capability),
    ).toEqual(["unknown"]);
    expect(result.attribution).toBe("unconfirmed");
  });

  it("allows a PR-free repository and an explicit no-PR selection", async () => {
    const { github, calls } = makeGithub(async () => success([]));
    const reader = createPrContextReader({ github });
    const context = makeContext();
    const candidates = unwrap(
      await reader.listCandidates({ scope: makeScope(), context }),
    );
    const selected = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [],
        context,
      }),
    );

    expect(candidates.items).toEqual([]);
    expect(candidates.partial).toBe(false);
    expect(selected.items).toEqual([]);
    expect(selected.partial).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("counts transport-reported retries against the PR sub-budget", async () => {
    const { github, calls } = makeGithub(async ({ path }) => {
      if (path.endsWith("/pulls"))
        return success([makePullRequest(41)], { attempts: 6 });
      if (path.endsWith("/files"))
        return success(filesPage(1), { attempts: 1, hasNextPage: true });
      return success(makePullRequest(41), { attempts: 1 });
    });
    const reader = createPrContextReader({ github });
    const context = makeContext();

    unwrap(await reader.listCandidates({ scope: makeScope(), context }));
    const selected = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [41],
        context,
      }),
    );

    expect(calls).toHaveLength(3);
    expect(selected.items[0]?.changedPaths).toHaveLength(
      PR_CONTEXT_LIMITS.fileRowsPerPage,
    );
    expect(selected.partial).toBe(true);
    expect(selected.limitations).toContain("pr-request-budget-exhausted");
  });

  it("returns a useful partial result when the candidate endpoint is unavailable", async () => {
    const { github } = makeGithub(async () => failure("unavailable"));
    const reader = createPrContextReader({ github });
    const result = unwrap(
      await reader.listCandidates({
        scope: makeScope(),
        context: makeContext(),
      }),
    );

    expect(result.items).toEqual([]);
    expect(result.partial).toBe(true);
    expect(result.limitations).toContain("recent-candidate-list-incomplete");
    expect(result.attribution).toBe("unconfirmed");
  });

  it("rejects invalid or excessive explicit selections before making requests", async () => {
    const { github, calls } = makeGithub(async () => success([]));
    const reader = createPrContextReader({ github });

    const tooMany = await reader.readSelected({
      scope: makeScope(),
      selectedNumbers: [1, 2, 3, 4],
      context: makeContext(),
    });
    const duplicate = await reader.readSelected({
      scope: makeScope(),
      selectedNumbers: [2, 2],
      context: makeContext(),
    });

    expect(tooMany).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
    expect(duplicate).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(calls).toHaveLength(0);
  });

  it("limits the combined PR API operations and retained changed paths", async () => {
    const { github, calls } = makeGithub(async ({ path, query }) => {
      if (path.endsWith("/pulls")) return success([makePullRequest(1)]);
      if (path.endsWith("/files")) {
        return success(filesPage(Number(query?.page ?? 1)), {
          hasNextPage: true,
        });
      }
      const number = Number(path.split("/").at(-1));
      return success(makePullRequest(number));
    });
    const reader = createPrContextReader({ github });
    const context = makeContext();

    unwrap(await reader.listCandidates({ scope: makeScope(), context }));
    const selected = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [1, 2, 3],
        context,
      }),
    );

    expect(calls).toHaveLength(PR_CONTEXT_LIMITS.httpAttempts);
    expect(selected.items).toHaveLength(3);
    expect(
      selected.items.reduce((sum, item) => sum + item.changedPaths.length, 0),
    ).toBe(PR_CONTEXT_LIMITS.changedPaths);
    expect(selected.partial).toBe(true);
    expect(selected.limitations).toContain("changed-path-pagination-truncated");
    expect(selected.limitations).toContain("changed-path-limit-reached");
  });

  it("keeps first-page paths and marks a missing second page partial", async () => {
    const { github, calls } = makeGithub(async ({ path, query }) => {
      if (path.endsWith("/files")) {
        return Number(query?.page) === 1
          ? success(filesPage(1, 5), { hasNextPage: true })
          : failure("unavailable");
      }
      return success(makePullRequest(22));
    });
    const reader = createPrContextReader({ github });
    const result = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [22],
        context: makeContext(),
      }),
    );

    expect(
      calls
        .map((call) => call.query?.page)
        .filter((page) => page !== undefined),
    ).toEqual([1, 2]);
    expect(result.items[0]?.changedPaths).toHaveLength(5);
    expect(result.partial).toBe(true);
    expect(result.limitations).toContain("changed-path-page-incomplete");
  });

  it("rejects unsafe changed paths and never follows upstream URLs", async () => {
    const { github, calls } = makeGithub(async ({ path }) =>
      path.endsWith("/files")
        ? success([
            makeChangedFile({ filename: "../outside.ts" }),
            makeChangedFile({ filename: "%2e%2e/secret.txt" }),
            makeChangedFile({ filename: "src/safe.ts" }),
          ])
        : success(
            makePullRequest(31, {
              html_url: "https://attacker.invalid/pull/31",
              diff_url: "https://attacker.invalid/diff/31",
              patch_url: "https://attacker.invalid/patch/31",
            }),
          ),
    );
    const reader = createPrContextReader({ github });
    const result = unwrap(
      await reader.readSelected({
        scope: makeScope(),
        selectedNumbers: [31],
        context: makeContext(),
      }),
    );

    expect(calls).toHaveLength(2);
    expect(
      calls.every((call) =>
        call.path.startsWith("/repos/acme/resume-changer/pulls/"),
      ),
    ).toBe(true);
    expect(result.items[0]?.changedPaths.map((file) => file.filename)).toEqual([
      "src/safe.ts",
    ]);
    expect(result.partial).toBe(true);
    expect(JSON.stringify(result)).not.toContain("attacker.invalid");
  });
});
