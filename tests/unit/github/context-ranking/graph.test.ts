import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  relatedImplementationTargets,
} from "@/lib/github/context-ranking";
import {
  DEMO_REPOSITORY,
  projectMap,
  section,
  substantialSource,
} from "../../../fixtures/github/context-ranking";

describe("context dependency graph", () => {
  it("resolves only configured aliases, relative imports, index files, and declared workspace packages", () => {
    const paths = [
      "src/page.tsx",
      "src/lib/flow.ts",
      "src/widgets/index.ts",
      "packages/api/src/handler.ts",
      "packages/api/src/client.ts",
      "packages/api/src/router.ts",
      "packages/shared/src/index.ts",
    ];
    const map = projectMap(paths, {
      aliases: [
        {
          pattern: "@/*",
          targetPattern: "src/*",
          basePath: "",
          packageRoot: "",
          configPath: "tsconfig.json",
        },
        {
          pattern: "~/*",
          targetPattern: "src/*",
          basePath: "packages/api",
          packageRoot: "packages/api",
          configPath: "packages/api/tsconfig.json",
        },
      ],
      packageBoundaries: [
        { root: "", entrypoints: ["src/page.tsx"] },
        {
          root: "packages/api",
          name: "@demo/api",
          entrypoints: ["packages/api/src/client.ts"],
        },
        {
          root: "packages/shared",
          name: "@demo/shared",
          entrypoints: ["packages/shared/src/index.ts"],
        },
      ],
    });
    const sections = [
      section(
        "page",
        "src/page.tsx",
        [
          'import { run } from "@/lib/flow";',
          'import { Widget } from "./widgets";',
          'import { createClient } from "@demo/api";',
          'import { unsafe } from "@/../../outside";',
          "export function Page() { return run(Widget, createClient); }",
        ].join("\n"),
      ),
      section("flow", "src/lib/flow.ts", substantialSource("flow")),
      section(
        "widgets",
        "src/widgets/index.ts",
        'export { Widget } from "./widget";',
      ),
      section(
        "api-client",
        "packages/api/src/client.ts",
        'export { handler } from "~/handler";',
      ),
      section(
        "api-handler",
        "packages/api/src/handler.ts",
        substantialSource("handle"),
      ),
      section(
        "api-router",
        "packages/api/src/router.ts",
        'import { handler } from "../../../packages/api/src/handler";',
      ),
      section(
        "shared-index",
        "packages/shared/src/index.ts",
        "export const shared = true;",
      ),
    ];

    const graph = buildDependencyGraph(map, sections);
    const resolved = graph.edges.filter((edge) => edge.status === "resolved");

    expect(resolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromPath: "src/page.tsx",
          toPath: "src/lib/flow.ts",
          viaAlias: "@/*",
        }),
        expect.objectContaining({
          fromPath: "src/page.tsx",
          toPath: "src/widgets/index.ts",
        }),
        expect.objectContaining({
          fromPath: "src/page.tsx",
          toPath: "packages/api/src/client.ts",
        }),
        expect.objectContaining({
          fromPath: "packages/api/src/client.ts",
          toPath: "packages/api/src/handler.ts",
          viaAlias: "~/*",
        }),
      ]),
    );
    expect(
      graph.edges.find((edge) => edge.specifier === "@demo/api")?.toPath,
    ).toBe("packages/api/src/client.ts");
    expect(
      graph.edges.find((edge) => edge.specifier === "@/../../outside"),
    ).toMatchObject({ status: "unresolved", reason: "unsafe-path" });
    expect(
      graph.edges.find(
        (edge) => edge.fromPath === "packages/api/src/router.ts",
      ),
    ).toMatchObject({ status: "unresolved", reason: "unsafe-path" });
  });

  it("does not guess @/ or ~/ aliases and reports missing candidate sections", () => {
    const map = projectMap([
      "src/app.ts",
      "src/lib/engine.ts",
      "src/secret.ts",
    ]);
    const graph = buildDependencyGraph(map, [
      section(
        "app",
        "src/app.ts",
        [
          'import { engine } from "@/lib/engine";',
          'import { missing } from "~/secret";',
          'import { notLoaded } from "./not-loaded";',
        ].join("\n"),
      ),
      section("engine", "src/lib/engine.ts", substantialSource("engine")),
    ]);

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: "@/lib/engine",
          status: "unresolved",
          reason: "unconfigured-alias",
        }),
        expect.objectContaining({
          specifier: "~/secret",
          status: "unresolved",
          reason: "unconfigured-alias",
        }),
        expect.objectContaining({
          specifier: "./not-loaded",
          status: "unresolved",
          reason: "target-not-in-inventory",
        }),
      ]),
    );
    expect(graph.edges.some((edge) => edge.toPath === "src/secret.ts")).toBe(
      false,
    );
  });

  it("fails closed on conflicting mappings for the same alias pattern", () => {
    const paths = ["src/app.ts", "src/core.ts", "app/core.ts"];
    const aliases = [
      {
        pattern: "@/*",
        targetPattern: "src/*",
        basePath: "",
        packageRoot: "",
        configPath: "tsconfig.json",
      },
      {
        pattern: "@/*",
        targetPattern: "app/*",
        basePath: "",
        packageRoot: "",
        configPath: "packages/app/tsconfig.json",
      },
    ];
    const map = projectMap(paths, { aliases });
    const source = section("app", "src/app.ts", 'import "@/core";');
    const first = buildDependencyGraph(map, [source]);
    const second = buildDependencyGraph(
      { ...map, aliases: [...aliases].reverse() },
      [source],
    );

    expect(first.diagnostics).toContain("ambiguous-alias-config");
    expect(first.edges[0]).toMatchObject({
      status: "unresolved",
      reason: "unconfigured-alias",
    });
    expect(first.edges).toEqual(second.edges);
  });

  it("scans imports, re-exports, static dynamic imports, and require while ignoring comments and strings", () => {
    const map = projectMap(["src/index.ts", "src/core.ts", "src/other.ts"]);
    const graph = buildDependencyGraph(map, [
      section(
        "index",
        "src/index.ts",
        [
          '// import "./ghost";',
          'const note = "require(\\\"./ghost-too\\\")";',
          'import "./core";',
          'export { run } from "./core";',
          'const deferred = import("./other");',
          'const loaded = require("./core");',
          'const template = `import("./not-an-edge")`;',
        ].join("\n"),
      ),
      section("core", "src/core.ts", substantialSource("core")),
      section("other", "src/other.ts", substantialSource("other")),
    ]);

    expect(
      graph.edges.map(({ specifier, kind }) => `${kind}:${specifier}`),
    ).toEqual([
      "import:./core",
      "re-export:./core",
      "dynamic-import:./other",
      "require:./core",
    ]);
    expect(graph.edges.every((edge) => edge.status === "resolved")).toBe(true);
  });

  it("follows a bounded wrapper chain through a cycle to the implementation", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/engine.ts"];
    const graph = buildDependencyGraph(projectMap(paths), [
      section("a", "src/a.ts", 'export { run } from "./b";'),
      section(
        "b",
        "src/b.ts",
        [
          'export { run } from "./a";',
          'export { engine } from "./engine";',
        ].join("\n"),
      ),
      section("engine", "src/engine.ts", substantialSource("engine")),
    ]);

    expect(
      graph.nodes.find((node) => node.path === "src/a.ts")?.isThinWrapper,
    ).toBe(true);
    expect(
      graph.nodes.find((node) => node.path === "src/b.ts")?.isThinWrapper,
    ).toBe(true);
    expect(relatedImplementationTargets(graph, "src/a.ts")).toEqual([
      "src/engine.ts",
    ]);
    expect(relatedImplementationTargets(graph, "src/a.ts", 1)).toEqual([]);
  });

  it("keeps foreign, unsafe, and unreviewed source out of the graph", () => {
    const map = projectMap(["src/safe.ts", "src/unsafe.ts", "src/foreign.ts"]);
    const graph = buildDependencyGraph(map, [
      section("safe", "src/safe.ts", 'import "./unsafe";'),
      section("unsafe", "src/unsafe.ts", substantialSource("unsafe"), {
        safety: {
          eligible: false,
          screening: "unsafe",
          reason: "secret-like content",
        },
      }),
      section("foreign", "src/foreign.ts", substantialSource("foreign"), {
        provenance: {
          ...DEMO_REPOSITORY,
          commitSha: "b".repeat(40),
          status: "observed",
        },
      }),
      section("traversal", "src/../escape.ts", substantialSource("escape")),
      section("unknown", "src/unreviewed.ts", "export const x = 1;", {
        safety: { eligible: true, screening: "unreviewed" },
      }),
    ]);

    expect(graph.nodes.map((node) => node.path)).toEqual(["src/safe.ts"]);
    expect(graph.edges[0]).toMatchObject({
      status: "unresolved",
      reason: "target-not-screened",
    });
    expect(graph.diagnostics).toEqual(
      expect.arrayContaining([
        "foreign-revision-section-excluded",
        "invalid-section-path-excluded",
        "unreviewed-section-excluded",
        "unsafe-section-excluded",
      ]),
    );
  });

  it("uses supplied static references for other languages and reports unsupported static parsing", () => {
    const map = projectMap(
      ["ml/pipeline.py", "ml/features.py", "ml/unknown.xyz"],
      {
        languageByPath: { "ml/unknown.xyz": "unknown" },
      },
    );
    const graph = buildDependencyGraph(map, [
      section("pipeline", "ml/pipeline.py", "def train(data): return data", {
        staticImports: [
          {
            specifier: "./features",
            kind: "import",
            resolvedPath: "ml/features.py",
          },
        ],
      }),
      section("features", "ml/features.py", "def transform(data): return data"),
      section("unknown", "ml/unknown.xyz", 'use("./not-real")'),
    ]);

    expect(graph.edges).toEqual([
      expect.objectContaining({
        fromPath: "ml/pipeline.py",
        toPath: "ml/features.py",
        status: "resolved",
      }),
    ]);
    expect(graph.diagnostics).toContain("unsupported-language-static-parse");
  });

  it("bounds graph limits and rejects unsafe configured aliases", () => {
    const map = projectMap(["src/a.ts", "src/b.ts"], {
      aliases: [
        {
          pattern: "@/*",
          targetPattern: "../../outside/*",
          basePath: "src",
          packageRoot: "",
          configPath: "tsconfig.json",
        },
      ],
    });
    const graph = buildDependencyGraph(
      map,
      [
        section("a", "src/a.ts", 'import "@/b";'),
        section("b", "src/b.ts", substantialSource("b")),
      ],
      { limits: { maxSections: 1 } },
    );

    expect(graph.diagnostics).toContain("section-limit-reached");
    expect(graph.diagnostics).toContain("invalid-alias-config-excluded");
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(() =>
      buildDependencyGraph(map, [], { limits: { maxEdges: 25_000 } }),
    ).toThrow(/Graph limit maxEdges/);
  });
});
