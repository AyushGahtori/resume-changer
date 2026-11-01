import { describe, expect, it } from "vitest";
import { discoverProjectMap } from "@/lib/github/context-discovery/discovery";
import {
  FIXTURE_COMMIT,
  makeDiscoveryInput,
} from "../../../fixtures/github/context-discovery/repositories";

describe("discoverProjectMap", () => {
  it("maps a small TypeScript app and validates JSONC aliases without following README links", async () => {
    const fixture = makeDiscoveryInput(
      [
        "README.md",
        "package.json",
        "tsconfig.json",
        "src/main.ts",
        "src/app/page.tsx",
      ],
      {
        "README.md":
          "# Project overview\nA small app.\n\n## Features\n- Local workflow\n\n[Remote](https://example.invalid/docs)\n![diagram](https://example.invalid/image.png)",
        "package.json":
          '{"name":"sample-app","description":"A sample app","dependencies":{"next":"15","react":"19"}}',
        "tsconfig.json": `{
          // Local import alias
          "compilerOptions": {
            "baseUrl": ".",
            "paths": { "@/*": ["./src/*", "./generated/*"], },
          },
        }`,
        "src/main.ts": "export const start = () => undefined;",
        "src/app/page.tsx": "export default function Page() { return null; }",
      },
      { projectTypes: ["javascript-typescript"] },
    );

    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.aliases).toEqual([
      {
        pattern: "@/*",
        targetPattern: "src/*",
        targetIndex: 0,
        configPath: "tsconfig.json",
        provenance: "tsconfig-jsonc",
      },
      {
        pattern: "@/*",
        targetPattern: "generated/*",
        targetIndex: 1,
        configPath: "tsconfig.json",
        provenance: "tsconfig-jsonc",
      },
    ]);
    expect(
      result.value.overviewCandidates.map((candidate) => candidate.path),
    ).toContain("README.md");
    expect(result.value.overviewCandidates[0]?.sectionHints).toContainEqual({
      heading: "Project overview",
      line: 1,
    });
    expect(result.value.frameworks.map((framework) => framework.name)).toEqual([
      "Next.js",
      "React",
    ]);
    expect(result.value.capabilities).toContainEqual(
      expect.objectContaining({
        capability: "web-application",
        evidenceStatus: "suggested",
      }),
    );
    expect(
      result.value.entrypoints.map((entrypoint) => entrypoint.path),
    ).toContain("src/main.ts");
    expect(fixture.calls).not.toContain("https://example.invalid/docs");
    expect(fixture.calls).not.toContain("https://example.invalid/image.png");
    expect(JSON.stringify(result.value)).not.toContain("A small app.");
    expect(JSON.stringify(result.value)).not.toContain("example.invalid");
    expect(result.value.counts.selectedEvidenceFiles).toBe(0);
  });

  it("respects a selected monorepo package and does not read every package README", async () => {
    const fixture = makeDiscoveryInput(
      [
        "README.md",
        "package.json",
        "packages/web/package.json",
        "packages/web/README.md",
        "packages/web/src/index.ts",
        "packages/api/package.json",
        "packages/api/README.md",
        "packages/api/src/index.ts",
      ],
      {
        "README.md": "# Workspace\nShared overview.",
        "package.json": '{"name":"workspace","workspaces":["packages/*"]}',
        "packages/web/package.json":
          '{"name":"@sample/web","dependencies":{"react":"19"}}',
        "packages/web/README.md": "# Workspace\nShared overview.",
        "packages/web/src/index.ts": "export const web = true;",
        "packages/api/package.json":
          '{"name":"@sample/api","dependencies":{"fastify":"5"}}',
        "packages/api/README.md": "# API\nPrivate package overview.",
        "packages/api/src/index.ts": "export const api = true;",
      },
      { packagePath: "packages/web", projectTypes: ["javascript-typescript"] },
    );

    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.workspace.patterns).toEqual(["packages/*"]);
    expect(result.value.workspace.members).toEqual([
      "packages/api",
      "packages/web",
    ]);
    expect(result.value.packages.map((item) => item.path)).toContain(
      "packages/api",
    );
    expect(
      result.value.packages.find((item) => item.path === "packages/web")
        ?.features,
    ).toContain("web-application");
    expect(
      result.value.packages.find((item) => item.path === "packages/api")
        ?.features,
    ).toContain("api-service");
    expect(fixture.calls).toContain("packages/web/README.md");
    expect(fixture.calls).not.toContain("packages/api/README.md");
    expect(result.value.exclusions).toContainEqual({
      path: "packages/api/README.md",
      reason: "outside-selected-package",
    });
    expect(result.value.overviewCandidates).toContainEqual(
      expect.objectContaining({
        path: "packages/web/README.md",
        status: "duplicate",
        duplicateOf: "README.md",
      }),
    );
    expect(result.value.counts.overviewCandidates).toBe(1);
  });

  it("infers Python and ML from bounded manifest evidence when inventory types are missing", async () => {
    const fixture = makeDiscoveryInput(
      ["pyproject.toml", "src/train.py", "src/model.py"],
      {
        "pyproject.toml": `[project]\nname = "model-lab"\ndependencies = ["torch>=2", "numpy>=1"]\n`,
        "src/train.py": "def train(): pass",
        "src/model.py": "class Model: pass",
      },
    );
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.inventory.fallbackMode).toBe("classified");
    expect(result.value.inventory.projectTypes).toContain("python");
    expect(result.value.packages[0]?.packageName).toBe("model-lab");
    expect(result.value.capabilities).toContainEqual(
      expect.objectContaining({
        capability: "machine-learning",
        confidence: "medium",
        evidenceStatus: "suggested",
      }),
    );
    expect(result.value.issues).toContainEqual(
      expect.objectContaining({ code: "missing-root-readme" }),
    );
  });

  it("maps a backend CLI and lists executable tool config without evaluating it", async () => {
    const fixture = makeDiscoveryInput(
      [
        "README.md",
        "go.mod",
        "cmd/tool/main.go",
        "api/routes.ts",
        "vite.config.ts",
      ],
      {
        "README.md": "# Command service",
        "go.mod": "module example.invalid/command-service\n\ngo 1.22\n",
        "cmd/tool/main.go": "package main\nfunc main() {}",
        "api/routes.ts": "export const routes = [];",
        "vite.config.ts":
          "export default defineConfig(() => ({ root: process.cwd() }));",
      },
      { projectTypes: ["go", "javascript-typescript"] },
    );
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.packages[0]?.packageName).toBe(
      "example.invalid/command-service",
    );
    expect(result.value.entrypoints).toContainEqual(
      expect.objectContaining({ path: "cmd/tool/main.go", confidence: "low" }),
    );
    expect(result.value.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: "api-service" }),
        expect.objectContaining({ capability: "cli-tool" }),
      ]),
    );
    expect(result.value.configurations).toContainEqual({
      path: "vite.config.ts",
      kind: "other",
      status: "static-only",
    });
    expect(fixture.calls).not.toContain("vite.config.ts");
  });

  it("reports missing README on an empty repository without calling the reader", async () => {
    const fixture = makeDiscoveryInput([], {});
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.packages).toEqual([
      expect.objectContaining({ path: "", kind: "manifest-inferred" }),
    ]);
    expect(result.value.inventory.fallbackMode).toBe("language-agnostic");
    expect(result.value.issues).toContainEqual(
      expect.objectContaining({ code: "missing-root-readme" }),
    );
    expect(fixture.calls).toEqual([]);
  });

  it("ignores generated docs, vendored READMEs and images under docs with explicit reasons", async () => {
    const fixture = makeDiscoveryInput(
      [
        "docs/architecture.md",
        "docs/generated/README.md",
        "docs/ui/map.png",
        "node_modules/lib/README.md",
      ],
      {
        "docs/architecture.md": "# Architecture\nCurrent module layout.",
        "docs/generated/README.md": "generated documentation",
        "node_modules/lib/README.md": "vendor documentation",
      },
    );
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fixture.calls).toEqual(["docs/architecture.md"]);
    expect(result.value.overviewCandidates).toContainEqual(
      expect.objectContaining({
        path: "docs/architecture.md",
        contentStatus: "descriptive",
      }),
    );
    expect(result.value.exclusions).toEqual(
      expect.arrayContaining([
        { path: "docs/generated/README.md", reason: "generated-or-vendored" },
        { path: "docs/ui/map.png", reason: "non-text-overview" },
        { path: "node_modules/lib/README.md", reason: "generated-or-vendored" },
      ]),
    );
    expect(result.value.issues).toContainEqual(
      expect.objectContaining({ code: "missing-root-readme" }),
    );
  });

  it("inherits only safe local JSONC aliases and preserves the config that declared them", async () => {
    const fixture = makeDiscoveryInput(
      [
        "README.en.md",
        "tsconfig.json",
        "configs/tsconfig.base.json",
        "src/index.ts",
      ],
      {
        "README.en.md": "# Overview\nLocalized README variant.",
        "tsconfig.json":
          '{"extends":"./configs/tsconfig.base.json","compilerOptions":{"paths":{"@app/*":["./src/*"]}}}',
        "configs/tsconfig.base.json":
          '{"compilerOptions":{"baseUrl":".","paths":{"@shared/*":["./shared/*"]}}}',
        "src/index.ts": "export {};",
      },
    );
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      result.value.overviewCandidates.map((candidate) => candidate.path),
    ).toContain("README.en.md");
    expect(result.value.aliases).toEqual([
      expect.objectContaining({
        pattern: "@app/*",
        targetPattern: "src/*",
        configPath: "tsconfig.json",
      }),
      expect.objectContaining({
        pattern: "@shared/*",
        targetPattern: "configs/shared/*",
        configPath: "configs/tsconfig.base.json",
      }),
    ]);
  });

  it("rejects unsafe aliases, prototype keys and external config inheritance", async () => {
    const fixture = makeDiscoveryInput(
      [
        "tsconfig.json",
        "jsconfig.json",
        "tsconfig.security.json",
        "tsconfig.broken.json",
      ],
      {
        "tsconfig.json":
          '{"compilerOptions":{"paths":{"@/*":["../../outside/*"]}}}',
        "jsconfig.json": '{"extends":"https://example.invalid/base.json"}',
        "tsconfig.security.json":
          '{"compilerOptions":{"paths":{"__proto__":["src/*"]}}}',
        "tsconfig.broken.json":
          '{"compilerOptions":{"paths":{}} /* unterminated',
      },
    );
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.aliases).toEqual([]);
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsafe-config",
          path: "tsconfig.json",
        }),
        expect.objectContaining({
          code: "unsafe-config",
          path: "tsconfig.security.json",
        }),
        expect.objectContaining({
          code: "unresolved-extends",
          path: "jsconfig.json",
        }),
        expect.objectContaining({
          code: "unsupported-config",
          path: "tsconfig.broken.json",
        }),
      ]),
    );
  });

  it("records an unreadable README candidate instead of silently dropping it", async () => {
    const fixture = makeDiscoveryInput(["README.md"], {
      "README.md": "# Project",
    });
    fixture.failures.set("README.md", { ok: false, reason: "unreadable" });
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.overviewCandidates).toContainEqual(
      expect.objectContaining({
        path: "README.md",
        status: "unavailable",
        contentStatus: "unknown",
      }),
    );
    expect(result.value.issues).toContainEqual(
      expect.objectContaining({ code: "read-failed", path: "README.md" }),
    );
    expect(result.value.issues).toContainEqual(
      expect.objectContaining({ code: "missing-root-readme" }),
    );
  });

  it("does not request a text file that inventory metadata already places over the byte limit", async () => {
    const fixture = makeDiscoveryInput(["README.md"], {
      "README.md": "# Large README",
    });
    fixture.input.inventory = {
      ...fixture.input.inventory,
      files: fixture.input.inventory.files.map((file) => ({
        ...file,
        sizeBytes: 70 * 1024,
      })),
    };
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fixture.calls).toEqual([]);
    expect(result.value.usage.readAttempts).toBe(0);
    expect(result.value.issues).toContainEqual(
      expect.objectContaining({ code: "read-failed", path: "README.md" }),
    );
  });

  it("reserves bounded reads so whole-project discovery still attempts the root README in a config-heavy repository", async () => {
    const configPaths = Array.from(
      { length: 100 },
      (_, index) => `tsconfig.${index}.json`,
    );
    const routePaths = Array.from(
      { length: 500 },
      (_, index) => `src/routes/route-${index}/page.tsx`,
    );
    const contents = Object.fromEntries([
      ["README.md", "# Project overview"],
      ...configPaths.map((path) => [path, "{}"]),
    ]);
    const fixture = makeDiscoveryInput(
      ["README.md", ...configPaths, ...routePaths],
      contents,
      { projectTypes: ["javascript-typescript"] },
    );

    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(fixture.calls).toContain("README.md");
    expect(result.value.overviewCandidates).toContainEqual(
      expect.objectContaining({ path: "README.md", status: "candidate" }),
    );
    expect(result.value.usage.readAttempts).toBeLessThanOrEqual(96);
    expect(result.value.issues).toContainEqual(
      expect.objectContaining({ code: "read-limit" }),
    );
  });

  it("rejects stale inventories, path escapes, symlinks and unsafe alias config without reading them", async () => {
    const fixture = makeDiscoveryInput(
      ["README.md", "safe.ts", "links/readme.md", "tsconfig.json"],
      {
        "README.md": "# Local project",
        "safe.ts": "export {};",
        "links/readme.md": "Never read this symlink.",
        "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}',
      },
    );
    const unsafeInventory = fixture.input.inventory;
    fixture.input.inventory = {
      ...unsafeInventory,
      files: unsafeInventory.files.map((file, index) => {
        if (index === 0) return { ...file, path: "../../outside/README.md" };
        if (index === 2) return { ...file, mode: "120000" };
        if (index === 3) return { ...file, safetyFlags: ["screening-failed"] };
        return file;
      }),
    };

    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fixture.calls).toEqual([]);
    expect(result.value.exclusions).toEqual(
      expect.arrayContaining([
        { path: "../../outside/README.md", reason: "unsafe-path" },
        { path: "links/readme.md", reason: "symlink" },
        { path: "tsconfig.json", reason: "unsafe-flag" },
      ]),
    );

    const stale = await discoverProjectMap({
      ...fixture.input,
      inventory: { ...fixture.input.inventory, commitSha: "c".repeat(40) },
    });
    expect(stale).toEqual({
      ok: false,
      error: "inventory-mismatch",
      message: "Inventory does not match the pinned repository revision.",
    });
  });

  it("keeps plan documents labeled as planning and leaves document-only claims out of capabilities", async () => {
    const fixture = makeDiscoveryInput(["README.md", "docs/architecture.md"], {
      "README.md": "# Product overview\nA small tool.",
      "docs/architecture.md":
        "# Web application\nStatus: planning only. A mobile API is planned for future work.",
    });
    const result = await discoverProjectMap(fixture.input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.overviewCandidates).toContainEqual(
      expect.objectContaining({
        path: "docs/architecture.md",
        contentStatus: "planning",
      }),
    );
    expect(result.value.capabilities).toEqual([]);
  });

  it("uses deterministic ordering and keeps inventory limits visible", async () => {
    const paths = ["src/z.ts", "src/a.ts", "README.md", "src/main.ts"];
    const contents = { "README.md": "# Overview" };
    const first = makeDiscoveryInput(paths, contents, {
      partial: true,
      unvisitedScope: ["vendor", "docs"],
    });
    const second = makeDiscoveryInput([...paths].reverse(), contents, {
      partial: true,
      unvisitedScope: ["docs", "vendor"],
    });
    const [left, right] = await Promise.all([
      discoverProjectMap(first.input),
      discoverProjectMap(second.input),
    ]);
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;

    expect(left.value.entrypoints).toEqual(right.value.entrypoints);
    expect(left.value.packages).toEqual(right.value.packages);
    expect(left.value.inventory.unvisitedScope).toEqual(["vendor", "docs"]);
    expect(left.value.issues).toContainEqual(
      expect.objectContaining({ code: "inventory-partial" }),
    );
    expect(left.value.limits.maxReadBytesPerFile).toBe(64 * 1024);
  });

  it("rejects a malformed inventory and leaves the input unmodified", async () => {
    const fixture = makeDiscoveryInput(["README.md"], {
      "README.md": "# Project",
    });
    const before = structuredClone(fixture.input.inventory);
    const invalid = await discoverProjectMap({
      ...fixture.input,
      repository: { ...fixture.input.repository, commitSha: "short" },
    });
    expect(invalid).toMatchObject({ ok: false, error: "invalid-input" });
    expect(fixture.input.inventory).toEqual(before);
  });

  it("uses the pinned identity passed to the bounded reader", async () => {
    const fixture = makeDiscoveryInput(["README.md"], {
      "README.md": "# Project",
    });
    const identities: Array<{
      path: string;
      commitSha: string;
      repositoryId: number;
    }> = [];
    const originalRead = fixture.input.reader.read;
    fixture.input.reader.read = async (request) => {
      identities.push({
        path: request.path,
        commitSha: request.repository.commitSha,
        repositoryId: request.repository.repositoryId,
      });
      return originalRead(request);
    };
    await discoverProjectMap(fixture.input);
    expect(identities).toEqual([
      { path: "README.md", commitSha: FIXTURE_COMMIT, repositoryId: 42 },
    ]);
  });
});
