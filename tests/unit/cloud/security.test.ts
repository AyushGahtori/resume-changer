import { afterEach, describe, expect, it, vi } from "vitest";
import { accountStorage } from "../../../src/lib/cloud/account-storage";
import {
  assertSafeEmulator,
  assertSameOrigin,
  getAppMode,
  privatePdfPath,
  readBoundedBody,
} from "../../../src/lib/cloud/security";

afterEach(() => vi.unstubAllEnvs());

describe("hosted account security boundaries", () => {
  it("never falls back to shared local storage on Vercel", () => {
    expect(getAppMode({ VERCEL: "1" })).toBe("firebase");
    expect(() => getAppMode({ VERCEL: "1", RESUME_APP_MODE: "local" })).toThrow(
      /Hosted/,
    );
    expect(() => getAppMode({ RESUME_APP_MODE: "typo" })).toThrow(/Unknown/);
    expect(getAppMode({ RESUME_APP_MODE: "local" })).toBe("local");
  });

  it("rejects cross-site writes, opaque origins and forged fetch-site headers", () => {
    const request = (origin?: string, site?: string) =>
      new Request("https://resume.example/api/library", {
        headers: {
          ...(origin ? { origin } : {}),
          ...(site ? { "sec-fetch-site": site } : {}),
        },
      });
    expect(() =>
      assertSameOrigin(request("https://resume.example", "same-origin")),
    ).not.toThrow();
    for (const value of [
      request(),
      request("null"),
      request("https://attacker.example"),
      request("https://resume.example", "cross-site"),
    ])
      expect(() => assertSameOrigin(value)).toThrow();
  });

  it("bounds streamed bodies even when content length is omitted or forged", async () => {
    await expect(
      readBoundedBody(
        new Request("https://resume.example", {
          method: "POST",
          body: "12345",
        }),
        4,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readBoundedBody(
        new Request("https://resume.example", {
          method: "POST",
          body: "12345",
          headers: { "content-length": "1" },
        }),
        4,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readBoundedBody(
        new Request("https://resume.example", { method: "POST", body: "1234" }),
        4,
      ),
    ).resolves.toEqual(new TextEncoder().encode("1234"));
  });

  it("derives private file paths from a validated account and content hash", () => {
    const hash = "a".repeat(64);
    expect(privatePdfPath("alice", "generation-1", hash)).toBe(
      `accounts/alice/generations/generation-1/${hash}.pdf`,
    );
    for (const args of [
      ["../bob", "generation-1", hash],
      ["alice", "../bob", hash],
      ["alice", "generation-1", "https://attacker.example/pdf"],
    ])
      expect(() =>
        privatePdfPath(...(args as [string, string, string])),
      ).toThrow();
  });

  it("cannot enable unsigned emulator tokens in production or a real Firebase project", () => {
    expect(() =>
      assertSafeEmulator({
        VERCEL: "1",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-resume",
      }),
    ).toThrow();
    expect(() =>
      assertSafeEmulator({
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "production-project",
      }),
    ).toThrow();
    expect(() =>
      assertSafeEmulator({
        FIRESTORE_EMULATOR_HOST: "attacker.example:8080",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-resume",
      }),
    ).toThrow();
    expect(
      assertSafeEmulator({
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-resume",
      }),
    ).toBe(true);
  });

  it("prevents one account from reading or clearing another account's browser drafts", () => {
    const data = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return data.size;
      },
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
      clear: () => data.clear(),
    };
    const alice = accountStorage(storage, "alice");
    const bob = accountStorage(storage, "bob");
    alice.setItem("draft", "Alice private JD");
    bob.setItem("draft", "Bob private JD");
    expect(alice.getItem("draft")).toBe("Alice private JD");
    expect(bob.getItem("draft")).toBe("Bob private JD");
    alice.clear();
    expect(alice.length).toBe(0);
    expect(bob.getItem("draft")).toBe("Bob private JD");
  });
});
