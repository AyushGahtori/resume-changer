import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHostedAccountConfig } from "../../../scripts/check-hosted-account-config.mjs";
import { signInErrorMessage } from "../../../src/lib/cloud/sign-in-error";
import { getFirebaseClientConfig } from "../../../src/lib/cloud/config";

afterEach(() => vi.unstubAllEnvs());

const configured = {
  VERCEL: "1",
  RESUME_APP_MODE: "firebase",
  NEXT_PUBLIC_FIREBASE_API_KEY: "fictional-public-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "example.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "example",
  NEXT_PUBLIC_FIREBASE_APP_ID: "fictional-app",
  NEXT_PUBLIC_FIREBASE_DATABASE_ID: "resume-changer",
};
describe("hosted sign-in configuration", () => {
  it("tags incomplete browser config so sign-in can explain the real failure", () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "");
    try {
      getFirebaseClientConfig();
      expect.fail("Missing configuration must fail before Google sign-in.");
    } catch (error) {
      expect(error).toMatchObject({ code: "app/account-config-incomplete" });
      expect(signInErrorMessage(error)).toContain(
        "not configured for this deployment",
      );
    }
  });
  it("rejects the empty Preview configuration that previously produced a broken sign-in page", () => {
    expect(() =>
      checkHostedAccountConfig({ VERCEL: "1", VERCEL_ENV: "preview" }),
    ).toThrow(/NEXT_PUBLIC_FIREBASE_API_KEY/);
    for (const key of Object.keys(configured).filter((key) =>
      key.startsWith("NEXT_PUBLIC_"),
    )) {
      expect(() =>
        checkHostedAccountConfig({ ...configured, [key]: "" }),
      ).toThrow(key);
    }
  });
  it("accepts complete hosted configuration and keeps local builds independent", () => {
    expect(() => checkHostedAccountConfig(configured)).not.toThrow();
    expect(() => checkHostedAccountConfig({})).not.toThrow();
  });
  it("rejects local auth mode and emulator access in hosted builds", () => {
    expect(() =>
      checkHostedAccountConfig({ ...configured, RESUME_APP_MODE: "local" }),
    ).toThrow(/mode/);
    expect(() =>
      checkHostedAccountConfig({
        ...configured,
        NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      }),
    ).toThrow(/emulators/);
  });
  it("explains missing deployment configuration without revealing its values", () => {
    expect(
      signInErrorMessage({
        code: "app/account-config-incomplete",
        message: "secret",
      }),
    ).toBe(
      "Sign-in is not configured for this deployment. Please contact the app owner.",
    );
  });
});

describe("hosted GitHub module loader compatibility", () => {
  const github = { ...configured, GITHUB_RUNTIME_ENABLED: "1" };
  it("rejects the Vercel default that cannot load firebase-admin/auth", () => {
    for (const NODE_OPTIONS of [
      undefined,
      "",
      "--max-old-space-size=2048",
      "--no-experimental-require-module",
      "--experimental-require-module --no-experimental-require-module",
    ])
      expect(() =>
        checkHostedAccountConfig({ ...github, NODE_OPTIONS }),
      ).toThrow(/NODE_OPTIONS=--experimental-require-module/);
  });
  it("accepts an explicit loader opt-in only when hosted GitHub is enabled", () => {
    expect(() =>
      checkHostedAccountConfig({
        ...github,
        NODE_OPTIONS: "--max-old-space-size=2048 --experimental-require-module",
      }),
    ).not.toThrow();
    expect(() => checkHostedAccountConfig(configured)).not.toThrow();
    expect(() =>
      checkHostedAccountConfig({ GITHUB_RUNTIME_ENABLED: "1" }),
    ).not.toThrow();
  });
  it("loads the actual Firebase Admin dependency chain with the deployed Node option", () => {
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "require('firebase-admin/auth'); require('firebase-admin/firestore'); process.stdout.write('loaded')",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_OPTIONS: "--experimental-require-module" },
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("loaded");
  }, 25000);
});
