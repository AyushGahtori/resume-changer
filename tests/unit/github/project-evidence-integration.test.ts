import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EVIDENCE_LIMITS } from "@/lib/github/server/file-policy-core";
import { createEvidenceSelector } from "@/lib/github/server/selector-core";
import { prepareProjectEvidence } from "@/lib/github/server/project-evidence";
import { makeContext, makeScope } from "./task-06/fixtures";

function gitBlobSha(text: string) {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
}

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

  it("keeps overview and implementation reads when manifests exceed the file budget", async () => {
    const bodies = new Map<string, string>([
      ["README.md", "# Product\nShips the resume workflow for applicants."],
      [
        "packages/zzz/src/index.ts",
        "export function start(job: string) { return job.trim(); }",
      ],
      [
        "notes/pinned.ts",
        "export function pinnedNote(job: string) { return job.length; }",
      ],
    ]);
    for (let index = 1; index <= 21; index += 1) {
      bodies.set(
        `packages/aaa${String(index).padStart(2, "0")}/package.json`,
        JSON.stringify({ name: `aaa${index}`, private: true }),
      );
    }
    bodies.set(
      "packages/zzz/package.json",
      JSON.stringify({ name: "zzz", private: true }),
    );
    const inventory = [...bodies].map(([path, text], index) => ({
      id: `file-${index}`,
      path,
      mode: "100644",
      byteSize: Buffer.byteLength(text),
      blobSha: gitBlobSha(text),
    }));
    const pinned = inventory.find((file) => file.path === "notes/pinned.ts")!;
    const scope = makeScope({
      repositoryId: "42",
      contributionStatement: "Built the product workflow.",
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
      pinnedFileIds: [pinned.id],
      context,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const reads: string[] = [];
    const result = await prepareProjectEvidence({
      plan: plan.value,
      inventory,
      context,
      authorize: async () => true,
      readFile: async (file) => {
        reads.push(file.path);
        return {
          ok: true,
          value: {
            text: bodies.get(file.path)!,
            blobSha: file.blobSha,
            byteSize: file.byteSize,
          },
        };
      },
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(reads.length).toBeLessThanOrEqual(EVIDENCE_LIMITS.maxFetchedFiles);
    expect(reads).toContain("README.md");
    expect(reads).toContain("packages/zzz/src/index.ts");
    expect(reads).toContain("notes/pinned.ts");
    expect(reads).toContain("packages/zzz/package.json");
    expect(
      reads.filter((path) => path.endsWith("/package.json")).length,
    ).toBeLessThan(22);
    const evidencePaths = result.value.prepared.evidence.map(
      (item) => item.path,
    );
    expect(evidencePaths).toContain("README.md");
    expect(evidencePaths).toContain("packages/zzz/src/index.ts");
    expect(result.value.prepared.missingDimensions).not.toContain("purpose");
    expect(result.value.prepared.missingDimensions).not.toContain("method");
  });

  it("reserves the repository implementation ahead of generic feature files", async () => {
    const steps = Array.from(
      { length: 55 },
      (_, index) =>
        `  const step${index} = input.trim() + "${"publishing detail ".repeat(8)}";`,
    ).join("\n");
    const bodies = new Map<string, string>([
      ["README.md", "# Publishing API\nValidates publishing requests."],
      ["package.json", JSON.stringify({ name: "publishing-large-input" })],
      [
        "src/publish.ts",
        `export function validatePublish(input: string) {\n${steps}\n return input.trim();\n}`,
      ],
    ]);
    for (let index = 0; index < 4; index++)
      bodies.set(
        `src/feature-${index}.ts`,
        `export function feature${index}(input: string) {\n${steps}\n return input.trim();\n}`,
      );
    const inventory = [...bodies].map(([path, text], index) => ({
      id: `file-${index}`,
      path,
      mode: "100644",
      byteSize: Buffer.byteLength(text),
      blobSha: gitBlobSha(text),
    }));
    const scope = makeScope({
      repositoryId: "48",
      name: "publishing-large-input",
      contributionStatement: "Built the entire project.",
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
    expect(result.value.prepared.evidence.map((item) => item.path)).toContain(
      "src/publish.ts",
    );
  });
});
