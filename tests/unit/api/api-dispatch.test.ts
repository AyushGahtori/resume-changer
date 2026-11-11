import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchApiRequest,
  optionsForApiRequest,
  resolveApiRequest,
} from "@/lib/api/dispatch";
import { createAiProvider } from "@/lib/ai/provider-factory-core";

afterEach(() => vi.unstubAllEnvs());

const routes: Array<[string, string[]]> = [
  ["/api/account/import/history", ["POST"]],
  ["/api/account/library", ["GET", "PUT"]],
  ["/api/ai/achievement", ["POST"]],
  ["/api/ai/analyze-job-description", ["POST"]],
  ["/api/ai/auto-tailor", ["POST"]],
  ["/api/ai/select-achievements", ["POST"]],
  ["/api/ai/tailor-achievements", ["POST"]],
  ["/api/auth/session", ["DELETE", "GET", "POST"]],
  ["/api/compile", ["POST"]],
  ["/api/generate", ["POST"]],
  ["/api/history", ["GET", "POST"]],
  ["/api/history/generation-example", ["DELETE", "GET"]],
  ["/api/history/generation-example/pdf", ["GET"]],
  ["/api/library/parents", ["POST"]],
  ["/api/library/points", ["POST"]],
  ["/api/library/profile", ["PATCH"]],
  ["/api/library/jobs/job-example", ["PUT"]],
  ["/api/library/projects/project-example", ["PUT"]],
  ["/api/library/skills", ["POST", "PUT"]],
  ["/api/load-test/safety", ["GET"]],
  ["/api/library/points/achievement-example", ["PATCH"]],
  ["/api/resume/edit", ["POST"]],
  ["/api/resume/skills", ["GET"]],
];

describe("shared API route dispatcher", () => {
  it.each(routes)("routes %s to its original handlers", (path, methods) => {
    const match = resolveApiRequest(path);
    expect(match).not.toBeNull();
    expect(Object.keys(match!.methods).sort()).toEqual(methods.sort());
  });

  it("passes decoded dynamic IDs as route context", async () => {
    const history = resolveApiRequest("/api/history/generation%20example");
    const point = resolveApiRequest(
      "/api/library/points/achievement%20example",
    );

    expect(await history?.context.params).toEqual({ id: "generation example" });
    expect(await point?.context.params).toEqual({ id: "achievement example" });
    const job = resolveApiRequest("/api/library/jobs/job%2Dexample");
    expect(await job?.context.params).toEqual({ id: "job-example" });
  });

  it("rejects malformed and unknown paths", () => {
    expect(resolveApiRequest("/api/history/%2Fpdf")).toBeNull();
    expect(resolveApiRequest("/api/unknown/action")).toBeNull();
    expect(resolveApiRequest("/api/toString")).toBeNull();
    expect(resolveApiRequest("/api/__proto__")).toBeNull();
    expect(resolveApiRequest("/other/api/history")).toBeNull();
  });

  it("returns a bounded 404 or 405 for unsupported requests", async () => {
    const missing = await dispatchApiRequest(
      new Request("https://resume.example/api/unknown"),
    );
    const wrongMethod = await dispatchApiRequest(
      new Request("https://resume.example/api/compile", { method: "GET" }),
    );

    expect(missing.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST, OPTIONS");
    expect(wrongMethod.headers.get("cache-control")).toBe("no-store");
  });

  it("answers preflight with only the route's supported methods", () => {
    const response = optionsForApiRequest(
      new Request("https://resume.example/api/history/example-id", {
        method: "OPTIONS",
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("allow")).toBe("DELETE, GET, HEAD, OPTIONS");
  });

  it("hides the load-test safety response and keeps AI available outside the local runtime", async () => {
    vi.stubEnv("RESUME_LOAD_TEST", "");
    const safety = await dispatchApiRequest(
      new Request("http://127.0.0.1:3020/api/load-test/safety"),
    );
    expect(safety.status).toBe(404);
  });

  it("refuses AI and other expensive routes in the local load-test runtime", async () => {
    vi.stubEnv("RESUME_LOAD_TEST", "1");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("RESUME_APP_MODE", "firebase");
    vi.stubEnv(
      "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
      "demo-resume-changer-loadtest",
    );
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_DATABASE_ID", "(default)");
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9098");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9098");
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8088");
    const denied = await dispatchApiRequest(
      new Request("http://127.0.0.1:3020/api/ai/analyze-job-description", {
        method: "POST",
      }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "load-test-forbidden" });
    const allowed = resolveApiRequest("/api/library/points");
    expect(allowed?.methods.POST).toBeTypeOf("function");
    expect(() => createAiProvider({ AI_PROVIDER: "mock" })).toThrow(
      /disabled for the local load test/,
    );
  });
});
