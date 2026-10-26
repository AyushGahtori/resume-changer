import { describe, expect, it, vi } from "vitest";
import {
  createGithubClient,
  type GithubBudgetLedger,
  type GithubClientDependencies,
  type GithubFetch,
  type GithubResolvedDestination,
  type GithubRequestContext,
} from "../../../../src/lib/github/server/client";

function createLedger(attemptLimit = 32, byteLimit = 12 * 1024 * 1024) {
  const used = new Map<string, number>();
  let nextId = 0;
  const ledger: GithubBudgetLedger = {
    reserve: vi.fn(async (input) => {
      const key = `${input.runId}:${input.resource}`;
      const maximum = Math.min(
        input.maximum,
        input.resource === "github-http-attempts" ? attemptLimit : byteLimit,
      );
      const next = (used.get(key) ?? 0) + input.amount;
      if (next > maximum) return null;
      used.set(key, next);
      return `reservation-${++nextId}`;
    }),
    commitUsage: vi.fn(async () => undefined),
  };
  return { ledger, used };
}

function createHarness(
  options: {
    fetch?: GithubFetch;
    resolveAddresses?: GithubClientDependencies["resolveAddresses"];
    accessToken?: string | null;
    ledger?: GithubBudgetLedger;
    now?: () => number;
    sleep?: GithubClientDependencies["sleep"];
    requestTimeoutMs?: number;
    maxResponseBytes?: number;
  } = {},
) {
  const fetcher = options.fetch ?? vi.fn<GithubFetch>();
  const resolver =
    options.resolveAddresses ?? vi.fn(async () => ["140.82.112.6"] as const);
  const credentials = {
    getAccessToken: vi.fn(async () =>
      options.accessToken === undefined
        ? "ghp_test-secret"
        : options.accessToken,
    ),
  };
  const fakeLedger = options.ledger ?? createLedger().ledger;
  const client = createGithubClient({
    fetch: fetcher,
    resolveAddresses: resolver,
    credentials,
    ledger: fakeLedger,
    now: options.now,
    sleep: options.sleep,
    requestTimeoutMs: options.requestTimeoutMs,
    maxResponseBytes: options.maxResponseBytes,
  });
  return { client, fetcher, resolver, credentials, ledger: fakeLedger };
}

function context(
  runId = "test-run",
  options: { deadline?: number; signal?: AbortSignal } = {},
): GithubRequestContext {
  return {
    runId,
    deadline: options.deadline ?? Date.now() + 30_000,
    signal: options.signal ?? new AbortController().signal,
  };
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(headers)),
    },
  });
}

function input(path = "/repos/acme/project", ctx = context()) {
  return { path, context: ctx };
}

describe("fixed-origin GitHub transport", () => {
  it("accepts a slash ref only in the commit-ref parameter and rejects encoded path escapes", async () => {
    const { client, fetcher } = createHarness();
    vi.mocked(fetcher).mockResolvedValue(jsonResponse({ sha: "a".repeat(40) }));
    expect(
      (
        await client.getJson(
          input("/repos/acme/project/commits/feature%2Fcache"),
        )
      ).ok,
    ).toBe(true);
    expect(
      (await client.getJson(input("/repos/acme/project/contents/a%2Fb"))).ok,
    ).toBe(false);
    expect(
      (
        await client.getJson(
          input("/repos/acme/project/commits/feature%2F..%2Fsecret"),
        )
      ).ok,
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("pins the GitHub API headers and returns only safe metadata", async () => {
    const { client, fetcher, ledger } = createHarness();
    vi.mocked(fetcher).mockResolvedValueOnce(
      jsonResponse({ id: 42 }, 200, {
        etag: '"abc123"',
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4999",
        "x-ratelimit-reset": "1790000000",
      }),
    );

    const result = await client.getJson<{ id: number }>(input());

    expect(result).toMatchObject({
      ok: true,
      value: {
        data: { id: 42 },
        status: 200,
        etag: '"abc123"',
        rateLimit: { limit: 5000, remaining: 4999, resetAt: 1790000000 },
      },
    });
    const [destination, init] = vi.mocked(fetcher).mock.calls[0];
    expect(String(destination)).toBe(
      "https://api.github.com/repos/acme/project",
    );
    expect(vi.mocked(fetcher).mock.calls[0][2]).toEqual({
      hostname: "api.github.com",
      addresses: ["140.82.112.6"],
    });
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    const headers = new Headers(init?.headers);
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(headers.get("x-github-api-version")).toBe("2026-03-10");
    expect(headers.get("accept-encoding")).toBe("identity");
    expect(headers.get("authorization")).toBe("Bearer ghp_test-secret");
    expect(vi.mocked(ledger.reserve)).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "test-run",
        resource: "github-http-attempts",
        amount: 1,
        maximum: 32,
      }),
    );
  });

  it("rejects unsafe paths, invalid queries, and exhausted ledgers before fetch", async () => {
    const ledger = createLedger(0).ledger;
    const { client, fetcher, resolver } = createHarness({ ledger });

    const invalidPath = await client.getJson(
      input("https://evil.example/private"),
    );
    const invalidTraversal = await client.getJson(
      input("/repos/acme/%2e%2e/secrets"),
    );
    const invalidQuery = await client.getJson({
      ...input(),
      query: { page: { nested: "not allowed" } as unknown as string },
    });
    const exhausted = await client.getJson(input());

    expect(invalidPath).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(invalidTraversal).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(invalidQuery).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(exhausted).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects private and IPv4-mapped private resolutions without network access", async () => {
    const resolver = vi.fn(async () => ["::ffff:127.0.0.1"] as const);
    const { client, fetcher } = createHarness({ resolveAddresses: resolver });

    const result = await client.getJson(input());

    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(resolver).toHaveBeenCalledWith(
      "api.github.com",
      expect.any(AbortSignal),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("follows a trusted redirect serially and refuses hostile redirect targets", async () => {
    const { client, fetcher } = createHarness();
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/repos/acme/project/metadata" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ name: "project" }));

    const success = await client.getJson(input());
    expect(success).toMatchObject({
      ok: true,
      value: { data: { name: "project" } },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetcher).mock.calls[0][0])).toBe(
      "https://api.github.com/repos/acme/project",
    );
    expect(String(vi.mocked(fetcher).mock.calls[1][0])).toBe(
      "https://api.github.com/repos/acme/project/metadata",
    );
    expect(
      vi.mocked(fetcher).mock.calls.map(([, init]) => init?.method),
    ).toEqual(["GET", "GET"]);

    const hostile = createHarness();
    vi.mocked(hostile.fetcher).mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/private" },
      }),
    );
    const rejected = await hostile.client.getJson(input());
    expect(rejected).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(hostile.fetcher).toHaveBeenCalledTimes(1);
    expect(hostile.resolver).toHaveBeenCalledTimes(1);
  });

  it("validates and returns pagination as a trusted path and typed query", async () => {
    const { client, fetcher, ledger } = createHarness();
    vi.mocked(fetcher)
      .mockResolvedValueOnce(
        jsonResponse([{ number: 1 }], 200, {
          link: '<https://api.github.com/repos/acme/project/pulls?per_page=100&page=2>; rel="next", <https://api.github.com/repos/acme/project/pulls?per_page=100&page=3>; rel="last"',
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ number: 2 }]));

    const first = await client.getJson<{ number: number }[]>(
      input("/repos/acme/project/pulls"),
    );
    expect(first).toMatchObject({
      ok: true,
      value: {
        data: [{ number: 1 }],
        nextPage: {
          path: "/repos/acme/project/pulls",
          query: { per_page: "100", page: "2" },
        },
      },
    });
    if (!first.ok || !first.value.nextPage)
      throw new Error("Missing safe next page");
    const second = await client.getJson({
      path: first.value.nextPage.path,
      query: first.value.nextPage.query,
      context: context(),
    });
    expect(second).toMatchObject({
      ok: true,
      value: { data: [{ number: 2 }] },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetcher).mock.calls[1][0])).toBe(
      "https://api.github.com/repos/acme/project/pulls?per_page=100&page=2",
    );
    expect(
      vi
        .mocked(ledger.reserve)
        .mock.calls.filter(
          ([item]) => item.resource === "github-http-attempts",
        ),
    ).toHaveLength(2);

    const hostile = createHarness();
    vi.mocked(hostile.fetcher).mockResolvedValueOnce(
      jsonResponse([], 200, {
        link: '<https://attacker.example/p?secret=1>; rel="next"',
      }),
    );
    const unsafe = await hostile.client.getJson(
      input("/repos/acme/project/pulls"),
    );
    expect(unsafe).toMatchObject({
      ok: false,
      error: { code: "upstream-error" },
    });
    expect(hostile.fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns safe errors for malformed JSON and inaccessible private resources", async () => {
    const malformed = createHarness();
    vi.mocked(malformed.fetcher).mockResolvedValueOnce(
      new Response("{broken", { status: 200 }),
    );
    expect(await malformed.client.getJson(input())).toMatchObject({
      ok: false,
      error: {
        code: "upstream-error",
        message: "GitHub returned an invalid response.",
      },
    });

    const missing = createHarness();
    vi.mocked(missing.fetcher).mockResolvedValueOnce(
      new Response("private repo exists", { status: 404 }),
    );
    const notFound = await missing.client.getJson(input());
    expect(notFound).toMatchObject({
      ok: false,
      error: {
        code: "not-found",
        message: "The GitHub resource was not found or is not accessible.",
      },
    });
    expect(JSON.stringify(notFound)).not.toContain("private repo exists");
  });

  it("streams and aborts an oversized response without buffering the rest", async () => {
    const cancelled = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(
            new TextEncoder().encode(pulls === 1 ? "12345" : "rest"),
          );
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    );
    const { client, fetcher } = createHarness({ maxResponseBytes: 4 });
    vi.mocked(fetcher).mockResolvedValueOnce(
      new Response(body, { status: 200 }),
    );

    const result = await client.getText(input());

    expect(result).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(pulls).toBe(1);
  });

  it("rejects compressed responses and malformed lengths before reading them", async () => {
    const compressed = createHarness();
    vi.mocked(compressed.fetcher).mockResolvedValueOnce(
      new Response("compressed", {
        status: 200,
        headers: { "content-encoding": "gzip" },
      }),
    );
    expect(await compressed.client.getText(input())).toMatchObject({
      ok: false,
      error: { code: "upstream-error" },
    });

    const oversized = createHarness({ maxResponseBytes: 4 });
    vi.mocked(oversized.fetcher).mockResolvedValueOnce(
      new Response("12345", {
        status: 200,
        headers: { "content-length": "5" },
      }),
    );
    expect(await oversized.client.getText(input())).toMatchObject({
      ok: false,
      error: { code: "limit-exceeded" },
    });
  });

  it("charges each permitted rate-limit retry and stops when the deadline cannot fit", async () => {
    const now = () => 1_000_000;
    const ledger = createLedger();
    const sleep = vi.fn(async () => undefined);
    const retry = createHarness({ ledger: ledger.ledger, now, sleep });
    vi.mocked(retry.fetcher)
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: { "retry-after": "2", "x-ratelimit-remaining": "0" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const retried = await retry.client.getJson(
      input(
        "/repos/acme/project",
        context("retry-run", { deadline: now() + 60_000 }),
      ),
    );
    expect(retried).toMatchObject({ ok: true, value: { data: { ok: true } } });
    expect(retry.fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000, expect.any(AbortSignal));
    expect(ledger.used.get("retry-run:github-http-attempts")).toBe(2);

    const noTime = createHarness({ now });
    vi.mocked(noTime.fetcher).mockResolvedValueOnce(
      new Response("", {
        status: 403,
        headers: { "retry-after": "40" },
      }),
    );
    const limited = await noTime.client.getJson(
      input(
        "/repos/acme/project",
        context("short-run", { deadline: now() + 20_000 }),
      ),
    );
    expect(limited).toMatchObject({
      ok: false,
      error: { code: "rate-limited", retryable: true, retryAfterSeconds: 40 },
    });
    expect(noTime.fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not disclose the credential when fetch fails", async () => {
    const secret = "ghp_super-secret-token";
    const harness = createHarness({
      accessToken: secret,
      fetch: vi.fn(async () => {
        throw new Error(`failed for Bearer ${secret}`);
      }),
    });

    const result = await harness.client.getJson(input());

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "unavailable",
        message: "GitHub could not complete the request.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("times out active requests and cancels queued requests promptly", async () => {
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const timed = createHarness({
      requestTimeoutMs: 10,
      fetch: vi.fn((_url, init) => {
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    });
    const timedResult = await timed.client.getJson(input());
    await didStart;
    expect(timedResult).toMatchObject({
      ok: false,
      error: {
        code: "upstream-error",
        message: "The GitHub request timed out.",
      },
    });
    expect(timed.fetcher).toHaveBeenCalledTimes(1);
    expect(
      vi
        .mocked(timed.ledger.reserve)
        .mock.calls.filter(
          ([reservation]) => reservation.resource === "github-http-attempts",
        ),
    ).toHaveLength(1);

    let finishFirst!: () => void;
    let startFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      startFirst = resolve;
    });
    const firstResponse = new Promise<Response>((resolve) => {
      finishFirst = () => resolve(jsonResponse({ first: true }));
    });
    const fetcher = vi.fn(async () => {
      startFirst();
      return firstResponse;
    });
    const queued = createHarness({ fetch: fetcher });
    const first = queued.client.getJson(
      input("/repos/acme/project", context("serial-run")),
    );
    await firstStarted;
    const queuedAbort = new AbortController();
    const second = queued.client.getJson(
      input(
        "/repos/acme/project/contents/readme",
        context("serial-run", { signal: queuedAbort.signal }),
      ),
    );
    queuedAbort.abort();
    expect(await second).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    finishFirst();
    expect(await first).toMatchObject({
      ok: true,
      value: { data: { first: true } },
    });
  });

  it("aborts an active request when its analysis is cancelled", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const harness = createHarness({
      fetch: vi.fn((_url, init) => {
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }),
    });
    const pending = harness.client.getJson(
      input(
        "/repos/acme/project",
        context("abort-run", { signal: controller.signal }),
      ),
    );
    await didStart;
    controller.abort();

    expect(await pending).toMatchObject({
      ok: false,
      error: {
        code: "cancelled",
        message: "The GitHub request was cancelled.",
      },
    });
    expect(harness.fetcher).toHaveBeenCalledTimes(1);
  });

  it("serializes simultaneous requests for the same analysis", async () => {
    let finishFirst!: () => void;
    let announceFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      announceFirst = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    let callCount = 0;
    let active = 0;
    let maximumActive = 0;
    const fetcher = vi.fn(
      async (
        _url: URL,
        _init: RequestInit,
        _destination: GithubResolvedDestination,
      ) => {
        callCount += 1;
        const currentCall = callCount;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (currentCall === 1) {
          announceFirst();
          await firstGate;
        }
        active -= 1;
        return jsonResponse({ call: currentCall });
      },
    );
    const harness = createHarness({ fetch: fetcher });
    const first = harness.client.getJson(
      input("/repos/acme/project/first", context("serial-analysis")),
    );
    await firstStarted;
    const second = harness.client.getJson(
      input("/repos/acme/project/second", context("serial-analysis")),
    );
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);
    finishFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({
      ok: true,
      value: { data: { call: 1 } },
    });
    expect(secondResult).toMatchObject({
      ok: true,
      value: { data: { call: 2 } },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
    expect(String(vi.mocked(fetcher).mock.calls[0][0])).toContain("/first");
    expect(String(vi.mocked(fetcher).mock.calls[1][0])).toContain("/second");
  });

  it("returns raw text through the read-only API", async () => {
    const harness = createHarness({ accessToken: null });
    vi.mocked(harness.fetcher).mockResolvedValueOnce(
      new Response("export const answer = 42;", { status: 200 }),
    );

    const result = await harness.client.getText(
      input("/repos/acme/project/contents/src/index.ts"),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { data: "export const answer = 42;", status: 200 },
    });
    expect(
      new Headers(vi.mocked(harness.fetcher).mock.calls[0][1]?.headers).get(
        "accept",
      ),
    ).toBe("application/vnd.github.raw+json");
    expect(
      new Headers(vi.mocked(harness.fetcher).mock.calls[0][1]?.headers).has(
        "authorization",
      ),
    ).toBe(false);
    expect(vi.mocked(harness.fetcher).mock.calls[0][1]?.method).toBe("GET");
  });
});
