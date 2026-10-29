import { createPrivateKey } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { z } from "zod";
import {
  GithubAuthorizationError,
  type GithubAuthorizationExchange,
  type GithubUserTokenSet,
} from "../access-core";

type Config = {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
};
const User = z.object({
  id: z.number().int().positive().safe(),
  login: z.string().min(1).max(100),
});
const Repository = z.object({
  id: z.number().int().positive().safe(),
  name: z.string().min(1).max(100),
  private: z.boolean(),
  owner: z.object({ login: z.string().min(1).max(100) }),
});
const Installation = z.object({
  id: z.number().int().positive().safe(),
  account: User.extend({ type: z.enum(["User", "Organization"]) }),
  suspended_at: z.string().nullable().optional(),
});
const Token = z.object({
  access_token: z.string().min(1).max(16000),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).max(16000).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
});

export function createGithubAuthorizationExchange(
  config: Config,
  fetcher: typeof fetch = fetch,
  now = () => Date.now(),
): GithubAuthorizationExchange {
  if (
    !/^\d+$/.test(config.appId) ||
    !config.clientId ||
    !config.clientSecret ||
    !config.privateKey
  )
    throw new Error("GitHub App credentials are incomplete.");
  async function request(url: string, init: RequestInit = {}) {
    const response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "resume-changer",
        "X-GitHub-Api-Version": "2026-03-10",
        ...init.headers,
      },
    });
    if (!response.ok) throw new GithubAuthorizationError(response.status);
    const reader = response.body?.getReader();
    if (!reader) throw new GithubAuthorizationError(502);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new GithubAuthorizationError(502);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function oauth(
    fields: Record<string, string>,
  ): Promise<GithubUserTokenSet> {
    const result = Token.parse(
      await request("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          ...fields,
        }),
      }),
    );
    return {
      accessToken: result.access_token,
      ...(result.expires_in
        ? {
            accessExpiresAt: new Date(
              now() + result.expires_in * 1000,
            ).toISOString(),
          }
        : {}),
      ...(result.refresh_token ? { refreshToken: result.refresh_token } : {}),
      ...(result.refresh_token_expires_in
        ? {
            refreshExpiresAt: new Date(
              now() + result.refresh_token_expires_in * 1000,
            ).toISOString(),
          }
        : {}),
    };
  }
  async function pages<T>(
    path: string,
    token: string,
    field: string,
    schema: z.ZodType<T>,
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= 5; page++) {
      const result = await request(
        `https://api.github.com${path}?per_page=100&page=${page}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const items = z.array(schema).max(100).parse(result[field]);
      all.push(...items);
      if (items.length < 100) return all;
      if (page === 5) throw new GithubAuthorizationError(413);
    }
    return all;
  }
  return {
    exchangeAuthorizationCode: (input) =>
      oauth({
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    refreshUserToken: (input) =>
      oauth({ grant_type: "refresh_token", refresh_token: input.refreshToken }),
    async getAuthenticatedUser({ accessToken }) {
      return User.parse(
        await request("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      );
    },
    async listAccessibleInstallations({ accessToken }) {
      return (
        await pages(
          "/user/installations",
          accessToken,
          "installations",
          Installation,
        )
      ).map((i) => ({
        id: i.id,
        account: i.account,
        suspendedAt: i.suspended_at,
      }));
    },
    async listInstallationRepositories({ accessToken, installationId }) {
      if (!Number.isSafeInteger(installationId) || installationId <= 0)
        throw new GithubAuthorizationError(400);
      return pages(
        `/user/installations/${installationId}/repositories`,
        accessToken,
        "repositories",
        Repository,
      );
    },
    async createInstallationToken({
      installationId,
      repositoryIds,
      permissions,
    }) {
      if (
        !Number.isSafeInteger(installationId) ||
        installationId <= 0 ||
        repositoryIds.length !== 1 ||
        !/^\d+$/.test(repositoryIds[0]) ||
        !Number.isSafeInteger(Number(repositoryIds[0]))
      )
        throw new GithubAuthorizationError(400);
      const pem = createPrivateKey(config.privateKey)
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      const jwt = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer(config.appId)
        .setIssuedAt(Math.floor(now() / 1000) - 30)
        .setExpirationTime(Math.floor(now() / 1000) + 540)
        .sign(await importPKCS8(pem, "RS256"));
      const data = await request(
        `https://api.github.com/app/installations/${installationId}/access_tokens`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwt}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repository_ids: repositoryIds.map(Number),
            permissions,
          }),
        },
      );
      const value = z
        .object({
          token: z.string().min(1),
          expires_at: z.iso.datetime(),
          permissions: z.record(z.string(), z.string()),
          repositories: z.array(Repository).max(1),
        })
        .parse(data);
      return {
        accessToken: value.token,
        expiresAt: value.expires_at,
        permissions: value.permissions,
        repositoryIds: value.repositories.map((r) => String(r.id)),
      };
    },
  };
}
