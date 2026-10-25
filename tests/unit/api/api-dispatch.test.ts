import { describe, expect, it } from "vitest";
import {
  dispatchApiRequest,
  optionsForApiRequest,
  resolveApiRequest,
} from "@/lib/api/dispatch";

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
  ["/api/library/points", ["POST"]],
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
});
