import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  auth: {
    authStateReady: vi.fn(),
    currentUser: null as null | {
      uid: string;
      getIdToken: ReturnType<typeof vi.fn>;
    },
  },
}));
vi.mock("../../../src/lib/cloud/browser-auth", () => ({
  getBrowserAuth: () => state.auth,
}));
import {
  apiFetch,
  setActiveAccountUid,
} from "../../../src/lib/cloud/api-fetch";
import { assertAccountBinding } from "../../../src/lib/cloud/security";

beforeEach(() => {
  vi.stubGlobal("window", {
    location: {
      href: "https://resume.example/generate",
      origin: "https://resume.example",
    },
  });
  state.auth.authStateReady.mockResolvedValue(undefined);
  state.auth.currentUser = {
    uid: "alice",
    getIdToken: vi.fn().mockResolvedValue("fictional-token"),
  };
  setActiveAccountUid("alice");
});
afterEach(() => {
  setActiveAccountUid(null);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const expired = () => Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
describe("account-bound browser requests", () => {
  it("cancels an in-flight cookie renewal when signing out", async () => {
    let renewed!: () => void;
    const started = new Promise<void>((resolve) => {
      renewed = resolve;
    });
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn().mockImplementation(async (input, options) => {
      if (input !== "/api/auth/session") return expired();
      signal = options.signal;
      renewed();
      return new Promise((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(new Error("Cancelled"))),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = apiFetch("/api/library/points", {
      method: "POST",
      body: "{}",
    });
    await started;
    setActiveAccountUid(null);
    expect(signal?.aborted).toBe(true);
    expect((await pending).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("renews an expired session once and preserves the intended account on replay", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(expired())
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ saved: true }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await apiFetch("/api/library/points", { method: "POST", body: "{}" }))
        .status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const index of [0, 2])
      expect(
        new Headers(fetcher.mock.calls[index][1].headers).get(
          "x-workspace-account",
        ),
      ).toBe("alice");
  });
  it("does not retry quota, provider or other authentication failures", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const [status, code] of [
      [429, "RATE_LIMITED"],
      [503, "PROVIDER_UNAVAILABLE"],
      [401, "INVALID_PROVIDER_KEY"],
    ] as const) {
      fetcher.mockResolvedValueOnce(Response.json({ code }, { status }));
      expect((await apiFetch("/api/ai/auto-tailor")).status).toBe(status);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(state.auth.currentUser!.getIdToken).not.toHaveBeenCalled();
  });
  it("never replays Alice's mutation under Bob's session after an account switch", async () => {
    const fetcher = vi.fn().mockImplementationOnce(async () => {
      setActiveAccountUid("bob");
      return expired();
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await apiFetch("/api/library/points", {
          method: "POST",
          body: "Alice private text",
        })
      ).status,
    ).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rechecks identity after token renewal and before setting a new cookie", async () => {
    state.auth.currentUser!.getIdToken.mockImplementation(async () => {
      setActiveAccountUid("bob");
      return "alice-token";
    });
    const fetcher = vi.fn().mockResolvedValue(expired());
    vi.stubGlobal("fetch", fetcher);
    await apiFetch("/api/library/points", { method: "POST", body: "{}" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("deduplicates simultaneous session renewals for the same account", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async (input) =>
        input === "/api/auth/session" ? Response.json({ ok: true }) : expired(),
      );
    vi.stubGlobal("fetch", fetcher);
    await Promise.all([apiFetch("/api/history"), apiFetch("/api/history")]);
    expect(
      fetcher.mock.calls.filter(([input]) => input === "/api/auth/session"),
    ).toHaveLength(1);
  });
  it("requires account intent on writes and rejects mismatched read headers", () => {
    const request = (method: string, uid?: string) =>
      new Request("https://resume.example/api/history", {
        method,
        headers: uid ? { "x-workspace-account": uid } : {},
      });
    expect(() => assertAccountBinding(request("POST"), "alice")).toThrow();
    expect(() =>
      assertAccountBinding(request("POST", "bob"), "alice"),
    ).toThrow();
    expect(() =>
      assertAccountBinding(request("GET", "bob"), "alice"),
    ).toThrow();
    expect(() => assertAccountBinding(request("GET"), "alice")).not.toThrow();
    expect(() =>
      assertAccountBinding(request("POST", "alice"), "alice"),
    ).not.toThrow();
  });
});
