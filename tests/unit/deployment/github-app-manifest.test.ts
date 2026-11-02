import { describe, expect, it } from "vitest";
import {
  githubAppManifest,
  consumeManifestCallback,
  previewOrigin,
} from "../../../scripts/lib/github-app-manifest.mjs";

describe("owner-managed GitHub App setup", () => {
  it("requests read-only access and keeps the OAuth callback on the approved Preview", () => {
    const manifest = githubAppManifest("http://127.0.0.1:43927/callback");
    expect(manifest.public).toBe(false);
    expect(manifest.default_permissions).toEqual({
      contents: "read",
      pull_requests: "read",
      metadata: "read",
    });
    expect(manifest.callback_urls).toEqual([
      `${previewOrigin}/api/github/connection/callback`,
    ]);
    expect(manifest.hook_attributes.active).toBe(false);
  });
  it("rejects off-device or malformed registration callbacks", () => {
    for (const url of [
      "https://example.test/callback",
      "http://localhost:43927/callback",
      "http://127.0.0.1:43927/wrong",
      "http://127.0.0.1:43927/callback?secret=x",
    ])
      expect(() => githubAppManifest(url)).toThrow();
  });
  it("requires the exact setup state and a single bounded authorization code", () => {
    const code = "a".repeat(40),
      state = "b".repeat(43);
    expect(
      consumeManifestCallback(`/callback?code=${code}&state=${state}`, state),
    ).toBe(code);
    for (const query of [
      `code=${code}&state=wrong`,
      `code=${code}&code=duplicate&state=${state}`,
      `code=short&state=${state}`,
      `code=${code}&state=${state}&state=${state}`,
    ])
      expect(() =>
        consumeManifestCallback(`/callback?${query}`, state),
      ).toThrow();
    expect(() =>
      consumeManifestCallback(`/wrong?code=${code}&state=${state}`, state),
    ).toThrow();
  });
});
