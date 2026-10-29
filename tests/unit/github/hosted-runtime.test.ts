import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/github/server/hosted/admin", () => ({
  hostedAdmin: () => ({ db: {}, auth: {}, namespace: "phase-one" }),
}));
vi.mock("workflow/api", () => ({ start: vi.fn() }));
vi.mock("../../../src/workflows/github-import", () => ({
  githubImportWorkflow: vi.fn(),
}));

import { getHostedGithubRuntime } from "../../../src/lib/github/server/hosted/runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("assembles hosted services before contacting external APIs", async () => {
  const origin = "https://preview.example.com";
  for (const [key, value] of Object.entries({
    VERCEL: "1",
    GITHUB_RUNTIME_ENABLED: "1",
    GITHUB_APP_ID: "12345",
    GITHUB_APP_CLIENT_ID: "synthetic-client",
    GITHUB_APP_CLIENT_SECRET: "synthetic-secret",
    GITHUB_APP_PRIVATE_KEY: "synthetic-key",
    GITHUB_APP_CALLBACK_URL: `${origin}/api/github/connection/callback`,
    GITHUB_FIREBASE_SERVICE_ACCOUNT: "synthetic-account",
    GITHUB_VAULT_KEY: Buffer.alloc(32, 1).toString("base64"),
    GITHUB_HOSTED_NAMESPACE: "phase-one",
    RESUME_APP_ORIGIN: origin,
    GEMINI_API_KEY: "synthetic-api-key",
    AI_PROVIDER: "gemini",
  }))
    vi.stubEnv(key, value);
  const fetcher = vi.fn(() => {
    throw new Error("Unexpected external request");
  });
  vi.stubGlobal("fetch", fetcher);
  const runtime = await getHostedGithubRuntime();
  expect(runtime.services.createContext).toBeTypeOf("function");
  expect(fetcher).not.toHaveBeenCalled();
});
