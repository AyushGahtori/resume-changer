import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExecutionContext,
  RepositoryScope,
} from "../../../../src/lib/github/contracts";

const doubles = vi.hoisted(() => ({ services: vi.fn() }));
vi.mock("@/lib/github/server/composition", () => ({
  getGithubServices: doubles.services,
}));
vi.mock("@/lib/cloud/protect-route", () => ({
  protectAccountRoute: (handler: unknown) => handler,
}));
vi.mock("@/lib/cloud/security", () => ({
  getAppMode: () => "local",
  assertSameOrigin: vi.fn(),
}));
import { GET } from "../../../../src/app/api/github/repositories/[repositoryId]/pull-requests/handler";

const scope: RepositoryScope = {
  repositoryId: "42",
  owner: "example",
  name: "publishing",
  canonicalUrl: "https://github.com/example/publishing",
  visibility: "private",
  ref: "main",
  commitSha: "a".repeat(40),
  selectedPaths: [],
  selectedPullRequestNumbers: [],
  contributionStatement: "I implemented validation.",
  identitySource: "user-provided",
};
const context = {
  access: {
    sessionId: "session-one",
    authorizationNamespace: "owner-one",
    grantedRepositoryIds: [],
  },
  signal: new AbortController().signal,
} as unknown as ExecutionContext;
const authorize = vi.fn(),
  list = vi.fn(),
  identity = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue({ ok: true, value: { scope } });
  list.mockResolvedValue({
    ok: true,
    value: { candidates: [], completeness: "complete", limitations: [] },
  });
  identity.mockResolvedValue({ ok: true, value: context });
  doubles.services.mockResolvedValue({
    createContext: identity,
    access: { authorizeRepository: authorize },
    pullRequests: { listCandidates: list },
  });
});
const read = (id = "42", query = "") =>
  GET(
    new Request(
      "http://localhost/api/github/repositories/" +
        id +
        "/pull-requests" +
        query,
    ),
    { params: Promise.resolve({ repositoryId: id }) },
  );

describe("authorized PR candidate endpoint", () => {
  it("re-authorizes the repository and uses only the pinned server scope", async () => {
    const response = await read();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain(
      "private, no-store",
    );
    expect(authorize).toHaveBeenCalledWith({ repositoryId: "42" }, context);
    expect(list).toHaveBeenCalledWith({
      scope,
      context: expect.objectContaining({
        access: expect.objectContaining({ grantedRepositoryIds: ["42"] }),
      }),
    });
    expect(context.access.grantedRepositoryIds).toEqual([]);
  });
  it("stops at a revoked account or repository grant", async () => {
    identity.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "forbidden",
        message: "Another account owns this session.",
        retryable: false,
      },
    });
    expect((await read()).status).toBe(403);
    expect(authorize).not.toHaveBeenCalled();
    authorize.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "forbidden",
        message: "Repository access was revoked.",
        retryable: false,
      },
    });
    expect((await read()).status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });
  it.each([
    ["not-a-repository", ""],
    ["42", "?url=https://attacker.example"],
    ["42", "?owner=other"],
  ])("rejects forged scope %s%s before GitHub calls", async (id, query) => {
    expect((await read(id, query)).status).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
