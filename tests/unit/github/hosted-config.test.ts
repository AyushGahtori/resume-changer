import { describe, expect, it } from "vitest";
import { hostedGithubConfigured } from "../../../src/lib/github/server/hosted/config";
describe("hosted GitHub enablement", () => {
  it("keeps incomplete deployments unavailable even when explicitly enabled", () => {
    expect(
      hostedGithubConfigured({ VERCEL: "1", GITHUB_RUNTIME_ENABLED: "1" }),
    ).toBe(false);
  });
  it("requires every live capability and never enables the hosted runtime locally", () => {
    const configured = {
      VERCEL: "1",
      GITHUB_RUNTIME_ENABLED: "1",
      GITHUB_APP_ID: "configured",
      GITHUB_APP_CLIENT_ID: "configured",
      GITHUB_APP_CLIENT_SECRET: "configured",
      GITHUB_APP_PRIVATE_KEY: "configured",
      GITHUB_APP_CALLBACK_URL: "configured",
      GITHUB_FIREBASE_SERVICE_ACCOUNT: "configured",
      GITHUB_VAULT_KEY: "configured",
      GITHUB_HOSTED_NAMESPACE: "configured",
      GEMINI_API_KEY: "configured",
    };
    expect(hostedGithubConfigured(configured)).toBe(true);
    for (const key of Object.keys(configured))
      expect(hostedGithubConfigured({ ...configured, [key]: "" })).toBe(false);
  });
});
