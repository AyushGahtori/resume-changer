import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createEvidenceSelector } from "@/lib/github/server/selector-core";
import { prepareProjectEvidence } from "@/lib/github/server/project-evidence";
import { makeContext, makeScope } from "./task-06/fixtures";

describe("project evidence assembly", () => {
  it("follows a route to implementation and keeps selected evidence inside the pinned inventory", async () => {
    const bodies = new Map([
      [
        "README.md",
        "# Resume Studio\nHelps applicants tailor a resume to a job description.",
      ],
      [
        "src/app/page.ts",
        'import { buildResume } from "../lib/resume";\nexport const page = buildResume;',
      ],
      [
        "src/lib/resume.ts",
        "export function buildResume(job, achievements) { return achievements.filter(a => job.includes(a.skill)); }",
      ],
      [
        "tests/resume.test.ts",
        "test('resume', () => expect(true).toBe(true));",
      ],
    ]);
    const inventory = [...bodies].map(([path, text], i) => ({
      id: `file-${i}`,
      path,
      mode: "100644",
      byteSize: Buffer.byteLength(text),
      blobSha: createHash("sha1")
        .update(`blob ${Buffer.byteLength(text)}\0`)
        .update(text)
        .digest("hex"),
    }));
    const scope = makeScope({
      repositoryId: "42",
      contributionStatement: "Built the resume workflow.",
    });
    const context = makeContext();
    const selector = createEvidenceSelector({
      fetchFile: async () => ({
        ok: false,
        error: { code: "unavailable", message: "unused", retryable: false },
      }),
    });
    const plan = selector.select({
      inventory,
      scope,
      prContext: { selectedPullRequests: [] },
      pinnedFileIds: [],
      context,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const result = await prepareProjectEvidence({
      plan: plan.value,
      inventory,
      context,
      authorize: async () => true,
      readFile: async (file) => ({
        ok: true,
        value: {
          text: bodies.get(file.path)!,
          blobSha: file.blobSha,
          byteSize: file.byteSize,
        },
      }),
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.prepared.evidence.some((e) => e.path === "README.md"),
    ).toBe(true);
    expect(
      result.value.prepared.evidence.some(
        (e) => e.path === "src/lib/resume.ts",
      ),
    ).toBe(true);
    expect(
      result.value.prepared.evidence.every((e) =>
        inventory.some((f) => f.path === e.path && f.blobSha === e.blobSha),
      ),
    ).toBe(true);
  });
});
