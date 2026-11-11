import { afterEach, describe, expect, it, vi } from "vitest";
import { protectAccountRoute } from "../../../src/lib/cloud/protect-route";

afterEach(() => vi.unstubAllEnvs());

const route = protectAccountRoute(async () => Response.json({ ok: true }));

function write(url: string, headers: Record<string, string>, body = "{}") {
  return route(
    new Request(url, {
      method: "POST",
      headers,
      body,
    }),
  );
}

describe("local account route guards", () => {
  it("keeps same-origin and JSON checks on local mutations without blocking GET", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("RESUME_APP_MODE", "local");

    expect(
      (
        await write("http://127.0.0.1:3000/api/library/skills", {
          origin: "https://evil.example",
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await write("http://127.0.0.1:3000/api/library/skills", {
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
          "content-type": "text/plain",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("http://localhost:3000/api/library/skills", {
          origin: "http://127.0.0.1:3000",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await write("http://localhost:3000/api/library/skills", {
          "content-type": "application/json",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await write("http://192.168.1.20:3000/api/library/skills", {
          "content-type": "application/json",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await route(
          new Request("http://127.0.0.1:3000/api/history/example", {
            method: "DELETE",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await route(
          new Request("http://127.0.0.1:3000/api/resume/skills", {
            headers: { origin: "https://evil.example" },
          }),
        )
      ).status,
    ).toBe(200);
  });
});
