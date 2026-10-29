import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { createGithubAuthorizationExchange } from "../../../src/lib/github/server/hosted/github-exchange";
import { GithubAuthorizationError } from "../../../src/lib/github/server/access-core";
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const config = {
  appId: "123",
  clientId: "fictional-client",
  clientSecret: "fictional-client-secret",
  privateKey,
};
describe("live GitHub App exchange", () => {
  it("keeps client credentials and PKCE verifier in the HTTPS request body and translates expirations", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        access_token: "fictional-user-token",
        expires_in: 3600,
        refresh_token: "fictional-refresh",
        refresh_token_expires_in: 7200,
      }),
    );
    const exchange = createGithubAuthorizationExchange(config, fetcher, () =>
      Date.parse("2026-10-28T00:00:00Z"),
    );
    const result = await exchange.exchangeAuthorizationCode({
      code: "temporary-code",
      redirectUri: "https://preview.example.test/callback",
      codeVerifier: "private-verifier",
    });
    expect(result.accessExpiresAt).toBe("2026-10-28T01:00:00.000Z");
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(request.redirect).toBe("error");
    expect(request.headers.Accept).toBe("application/json");
    expect(JSON.parse(request.body)).toMatchObject({
      client_secret: config.clientSecret,
      code_verifier: "private-verifier",
    });
    expect(url).not.toContain(config.clientSecret);
  });
  it("mints an App JWT and requests one repository with read permissions only", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        token: "fictional-installation-token",
        expires_at: "2026-10-28T01:00:00Z",
        permissions: {
          contents: "read",
          metadata: "read",
          pull_requests: "read",
        },
        repositories: [
          {
            id: 42,
            name: "example",
            private: true,
            owner: { login: "owner" },
          },
        ],
      }),
    );
    const exchange = createGithubAuthorizationExchange(config, fetcher, () =>
      Date.parse("2026-10-28T00:00:00Z"),
    );
    const result = await exchange.createInstallationToken({
      installationId: 5,
      repositoryIds: ["42"],
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "read",
      },
    });
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/app/installations/5/access_tokens",
    );
    expect(JSON.parse(request.body)).toEqual({
      repository_ids: [42],
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "read",
      },
    });
    const jwt = request.headers.Authorization.slice("Bearer ".length);
    expect(decodeProtectedHeader(jwt).alg).toBe("RS256");
    expect(decodeJwt(jwt).iss).toBe("123");
    expect(
      Number(decodeJwt(jwt).exp) - Number(decodeJwt(jwt).iat),
    ).toBeLessThanOrEqual(600);
    expect(result.repositoryIds).toEqual(["42"]);
  });
  it("does not expose upstream response bodies on rejected authorization", async () => {
    const exchange = createGithubAuthorizationExchange(
      config,
      vi
        .fn()
        .mockResolvedValue(
          new Response("private upstream details", { status: 401 }),
        ),
    );
    await expect(
      exchange.getAuthenticatedUser({ accessToken: "fictional-user-token" }),
    ).rejects.toEqual(new GithubAuthorizationError(401));
  });
  it("bounds repository listing and rejects malformed installation IDs before networking", async () => {
    const fetcher = vi
        .fn()
        .mockResolvedValue(Response.json({ repositories: [] })),
      exchange = createGithubAuthorizationExchange(config, fetcher);
    await expect(
      exchange.listInstallationRepositories({
        accessToken: "fictional-user-token",
        installationId: -1,
      }),
    ).rejects.toBeInstanceOf(GithubAuthorizationError);
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await exchange.listInstallationRepositories({
        accessToken: "fictional-user-token",
        installationId: 5,
      }),
    ).toEqual([]);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.github.com/user/installations/5/repositories?per_page=100&page=1",
    );
  });
});
