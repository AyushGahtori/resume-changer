import { describe, expect, it } from "vitest";
import { githubAppRegistration } from "../../../../scripts/prepare-github-app.mjs";

describe("new GitHub App setup", () => {
  it("prepares a read-only Preview App with the exact callback and no unsolicited OAuth callback", () => {
    const registration = githubAppRegistration("https://preview.example.com");
    const url = new URL(registration.registrationUrl);
    expect(url.origin + url.pathname).toBe(
      "https://github.com/settings/apps/new",
    );
    expect(url.searchParams.get("callback_urls[]")).toBe(
      "https://preview.example.com/api/github/connection/callback",
    );
    expect(url.searchParams.get("contents")).toBe("read");
    expect(url.searchParams.get("pull_requests")).toBe("read");
    expect(url.searchParams.get("webhook_active")).toBe("false");
    expect(url.searchParams.get("request_oauth_on_install")).toBe("false");
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(url.searchParams.get("public")).toBe("false");
  });
  it.each([
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com?x=1",
    "https://example.com#x",
  ])("rejects unsafe origin %s", (origin) =>
    expect(() => githubAppRegistration(origin)).toThrow(),
  );
  it("permits isolated localhost setup", () =>
    expect(githubAppRegistration("http://127.0.0.1:3010").callbackUrl).toBe(
      "http://127.0.0.1:3010/api/github/connection/callback",
    ));
});
