import { describe, expect, it } from "vitest";
import {
  githubInstallationUrl,
  safeGithubInstallationUrl,
} from "../../../src/lib/github/installation-url";
describe("repository installation selection", () => {
  it("links only to GitHub's selected-repository installation screen", () => {
    expect(githubInstallationUrl("resume-changer-preview")).toBe(
      "https://github.com/apps/resume-changer-preview/installations/new",
    );
    expect(githubInstallationUrl(undefined)).toBeUndefined();
  });
  it("rejects external, credential-bearing and malformed installation links", () => {
    for (const url of [
      "https://evil.example/apps/resume-changer/installations/new",
      "https://user@github.com/apps/resume-changer/installations/new",
      "https://github.com/apps/resume-changer/installations/new?redirect=evil",
      "javascript:alert(1)",
      "https://github.com/apps/../settings/installations/new",
    ])
      expect(safeGithubInstallationUrl(url)).toBeUndefined();
    expect(githubInstallationUrl("bad/app")).toBeUndefined();
  });
});
