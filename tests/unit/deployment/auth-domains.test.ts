import { describe, expect, it, vi } from "vitest";
import { syncAuthDomains } from "../../../scripts/lib/auth-domains.mjs";
const config = {
  project: "demo-resume",
  configuredProject: "demo-resume",
  domains: ["resume.example.test"],
};
describe("Firebase authorized-domain release verification", () => {
  it("catches provider setup that left the website domain unapplied", async () => {
    const api = {
      getAuthDomains: vi
        .fn()
        .mockResolvedValue(["demo-resume.firebaseapp.com"]),
      updateAuthDomains: vi.fn(),
    };
    await expect(syncAuthDomains(config, api)).rejects.toThrow(/differ/);
    expect(api.updateAuthDomains).not.toHaveBeenCalled();
  });
  it("applies only the reviewed project/list and verifies the backend read-back", async () => {
    const api = {
      getAuthDomains: vi
        .fn()
        .mockResolvedValueOnce(["old.example.test"])
        .mockResolvedValueOnce(config.domains),
      updateAuthDomains: vi.fn(),
    };
    await expect(
      syncAuthDomains({ ...config, apply: true }, api),
    ).resolves.toMatchObject({ verified: true, changed: true });
    expect(api.updateAuthDomains).toHaveBeenCalledWith(
      "demo-resume",
      config.domains,
    );
    api.getAuthDomains.mockResolvedValue(["wrong.example.test"]);
    await expect(
      syncAuthDomains({ ...config, apply: true }, api),
    ).rejects.toThrow(/read-back/);
  });
  it("rejects accidental project changes and broad or malformed domains before any access", async () => {
    const api = { getAuthDomains: vi.fn(), updateAuthDomains: vi.fn() };
    for (const input of [
      { ...config, project: "another-project" },
      ...[
        "*.example.test",
        "https://resume.example.test",
        "resume.example.test:443",
        "bad..example.test",
      ].map((domain) => ({ ...config, domains: [domain] })),
    ])
      await expect(syncAuthDomains(input, api)).rejects.toThrow();
    expect(api.getAuthDomains).not.toHaveBeenCalled();
  });
});
