import { describe, expect, it, vi } from "vitest";
import type { spawnSync } from "node:child_process";
import { publishGithubPreviewSecrets } from "../../../scripts/lib/github-preview-secrets.mjs";
import { githubRuntimeIamBindings } from "../../../scripts/lib/github-hosted-iam.mjs";

describe("hosted GitHub least-privilege provisioning", () => {
  it("grants database access only on the selected database and account lookup without user mutation", () => {
    const bindings = githubRuntimeIamBindings(
      "resume-example",
      "resume-changer",
      "github-phase-one@resume-example.iam.gserviceaccount.com",
    );
    expect(bindings[0].role).toBe("roles/datastore.user");
    expect(bindings[0].condition?.expression).toBe(
      'resource.name == "projects/resume-example/databases/resume-changer"',
    );
    expect(bindings[1].role).toBe(
      "projects/resume-example/roles/githubPreviewAuthRead",
    );
    expect(() =>
      githubRuntimeIamBindings(
        "resume-example",
        "resume-changer",
        "owner@example.test",
      ),
    ).toThrow();
  });
  it("sends credentials over stdin and scopes all entries to phase-one Preview", () => {
    const runMock = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: "{}" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          envs: [
            {
              key: "GITHUB_VAULT_KEY",
              target: ["preview"],
              gitBranch: "phase-one",
              type: "sensitive",
            },
          ],
        }),
      });
    publishGithubPreviewSecrets(
      { GITHUB_VAULT_KEY: "fictional-secret" },
      "installed-vercel-cli",
      runMock as unknown as typeof spawnSync,
    );
    const [executable, args, options] = runMock.mock.calls[0];
    expect(executable).toBe(process.execPath);
    expect(args.join(" ")).not.toContain("fictional-secret");
    expect(JSON.parse(options.input)).toEqual(
      expect.objectContaining({
        key: "GITHUB_VAULT_KEY",
        value: "fictional-secret",
        type: "sensitive",
        target: ["preview"],
        gitBranch: "phase-one",
      }),
    );
  });
  it("rejects failed publication or missing branch-scoped read-back", () => {
    expect(() =>
      publishGithubPreviewSecrets(
        { GITHUB_VAULT_KEY: "test" },
        "cli",
        vi.fn(() => ({
          status: 1,
        })) as unknown as typeof spawnSync,
      ),
    ).toThrow(/publication/);
    expect(() =>
      publishGithubPreviewSecrets(
        { GITHUB_VAULT_KEY: "test" },
        "cli",
        vi.fn(() => ({
          status: 0,
          stdout: '{"envs":[]}',
        })) as unknown as typeof spawnSync,
      ),
    ).toThrow(/read-back/);
  });
});
