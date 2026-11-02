import { describe, it, expect, vi } from "vitest";
import { createGithubAccess } from "../../../src/lib/github/server/access-core";
import { createGithubAccessPort } from "../../../src/lib/github/server/access-port";
import { createUnavailableBudgetLedger } from "../../../src/lib/github/server/unavailable";
import {
  ok,
  type ExecutionContext,
  type RepositoryScope,
} from "../../../src/lib/github/contracts";

const scope: RepositoryScope = {
  repositoryId: "42",
  owner: "example",
  name: "publishing",
  canonicalUrl: "https://github.com/example/publishing",
  visibility: "public",
  ref: "main",
  commitSha: "a".repeat(40),
  selectedPaths: [],
  selectedPullRequestNumbers: [],
  contributionStatement: "I wrote the validation.",
  identitySource: "user-provided",
};
const context: ExecutionContext = {
  personalRoot: process.cwd(),
  access: {
    sessionId: "trusted-session",
    authorizationNamespace: "trusted-session",
    accountId: null,
    grantedRepositoryIds: ["42"],
  },
  signal: new AbortController().signal,
  now: () => new Date("2026-10-27T12:00:00Z"),
  deadline: "2026-10-27T12:02:00Z",
  runId: "test-run",
  budget: createUnavailableBudgetLedger(),
};

describe("GitHub access DTO adapter", () => {
  it("preserves the real unconfigured service's unavailable response", async () => {
    const access = createGithubAccess({ clock: { now: context.now } });
    const port = createGithubAccessPort({
      access,
      callbackOrigin: "http://localhost:3000",
      resolveScope: async () => ok(scope),
    });
    expect(
      await port.beginConnection({ returnTo: "/library" }, context),
    ).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
  it("binds grants to the trusted session and never exposes credential handles", async () => {
    const access = createGithubAccess({ clock: { now: context.now } });
    vi.spyOn(access, "authorizeRepository").mockResolvedValue({
      ok: true,
      value: {
        account: { id: 1, login: "example" },
        repository: {
          id: "42",
          owner: "example",
          name: "publishing",
          fullName: "example/publishing",
          visibility: "public",
          url: scope.canonicalUrl,
        },
        credentialHandle: "opaque-secret" as never,
        expiresAt: "2026-10-27T13:00:00Z",
      },
    });
    let resolved = scope;
    const port = createGithubAccessPort({
      access,
      callbackOrigin: "http://localhost:3000",
      resolveScope: async () => ok(resolved),
    });
    const result = await port.authorizeRepository(
      { repositoryId: "42" },
      context,
    );
    expect(result).toEqual(ok({ scope }));
    expect(JSON.stringify(result)).not.toContain("opaque-secret");
    expect(access.authorizeRepository).toHaveBeenCalledWith({
      repositoryId: "42",
      sessionId: "trusted-session",
    });
    resolved = { ...scope, repositoryId: "99" };
    expect(
      await port.authorizeRepository({ repositoryId: "42" }, context),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});
