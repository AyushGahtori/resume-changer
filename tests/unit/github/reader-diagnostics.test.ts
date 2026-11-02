import { expect, it, vi } from "vitest";
import { createGithubClient } from "../../../src/lib/github/server/client-core";

it("identifies timeout during body budget accounting without exposing source or credentials", async () => {
  vi.useFakeTimers();
  vi.stubEnv("VERCEL", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const client = createGithubClient({
      requestTimeoutMs: 100,
      resolveAddresses: async () => ["140.82.112.6"],
      credentials: { getAccessToken: async () => "credential-value" },
      fetch: async () => Response.json({ source: "private-source-content" }),
      ledger: {
        async reserve(input) {
          if (input.resource === "github-wire-bytes")
            await new Promise((done) => setTimeout(done, 200));
          return input.reservationKey;
        },
        commitUsage: async () => {},
      },
    });
    const pending = client.getJson({
      path: "/repos/private-owner/private-repository/commits/private-ref",
      context: {
        runId: "diagnostic-run",
        signal: new AbortController().signal,
        deadline: Date.now() + 10_000,
      },
    });
    await vi.advanceTimersByTimeAsync(210);
    expect((await pending).ok).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "GitHub reader failure.",
      expect.objectContaining({
        runId: "diagnostic-run",
        operation: "commit-metadata",
        stage: "response-body",
        timedOut: true,
        upstreamStatus: 200,
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|credential/);
  } finally {
    warn.mockRestore();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  }
});

it("does not log thrown provider exception text", async () => {
  vi.stubEnv("VERCEL", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const client = createGithubClient({
      resolveAddresses: async () => ["140.82.112.6"],
      credentials: { getAccessToken: async () => "credential-value" },
      fetch: async () => {
        throw new Error("private-upstream-details");
      },
      ledger: {
        reserve: async (input) => input.reservationKey,
        commitUsage: async () => {},
      },
    });
    const result = await client.getJson({
      path: "/repos/private-owner/private-repository",
      context: {
        runId: "diagnostic-run",
        signal: new AbortController().signal,
        deadline: Date.now() + 10_000,
      },
    });
    expect(result.ok).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "GitHub reader failure.",
      expect.objectContaining({ stage: "fetch", timedOut: false }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|credential/);
  } finally {
    warn.mockRestore();
    vi.unstubAllEnvs();
  }
});
