import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  rankCandidates,
  selectEvidenceCandidates,
  type RankingContext,
} from "@/lib/github/context-ranking";
import {
  projectMap,
  section,
  substantialSource,
} from "../../../fixtures/github/context-ranking";

const wholeProject: RankingContext = {
  scope: { mode: "whole-project", source: "user-confirmed" },
};

describe("explainable local candidate ranking", () => {
  it("ranks implementation targets above thin route wrappers and explains the dependency", () => {
    const paths = ["src/app/page.tsx", "src/app/project-panel.tsx"];
    const map = projectMap(paths, {
      featureAreas: [{ id: "resume-generation", status: "confirmed" }],
    });
    const sections = [
      section(
        "page-wrapper",
        "src/app/page.tsx",
        [
          'import { ProjectPanel } from "./project-panel";',
          "export default function Page() { return <ProjectPanel />; }",
        ].join("\n"),
        { featureTargets: ["resume-generation"] },
      ),
      section(
        "project-panel",
        "src/app/project-panel.tsx",
        substantialSource("project"),
        {
          featureTargets: ["resume-generation"],
        },
      ),
    ];
    const result = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
    });

    expect(
      result.graph.nodes.find((node) => node.path === "src/app/page.tsx")
        ?.isThinWrapper,
    ).toBe(true);
    expect(result.rankedCandidates[0]?.sectionId).toBe("project-panel");
    expect(result.rankedCandidates[0]?.reasonCodes).toContain(
      "resolves-wrapper-to-implementation",
    );
    expect(
      result.rankedCandidates.find(
        (candidate) => candidate.sectionId === "page-wrapper",
      )?.reason,
    ).toContain("thin wrapper");
  });

  it("caps fan-in value so a trivial shared helper does not outrank a feature implementation", () => {
    const sourcePaths = Array.from(
      { length: 8 },
      (_, index) => `src/routes/route-${index}.ts`,
    );
    const paths = [
      ...sourcePaths,
      "src/shared/identity.ts",
      "src/features/pipeline.ts",
    ];
    const map = projectMap(paths, {
      featureAreas: [{ id: "resume-generation", status: "confirmed" }],
    });
    const sections = [
      ...sourcePaths.map((path, index) =>
        section(
          `route-${index}`,
          path,
          `import { identity } from "../shared/identity";\nexport const route${index} = identity;`,
          {
            role: "implementation",
          },
        ),
      ),
      section(
        "identity",
        "src/shared/identity.ts",
        "export const identity = (value: unknown) => value;",
      ),
      section(
        "pipeline",
        "src/features/pipeline.ts",
        substantialSource("resume"),
        {
          featureTargets: ["resume-generation"],
        },
      ),
    ];
    const result = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
    });

    expect(
      result.graph.edges.filter(
        (edge) => edge.toPath === "src/shared/identity.ts",
      ),
    ).toHaveLength(8);
    expect(result.rankedCandidates[0]?.sectionId).toBe("pipeline");
    expect(
      result.rankedCandidates.find(
        (candidate) => candidate.sectionId === "identity",
      )?.components.dependencyRelevance,
    ).toBeLessThanOrEqual(0.2);
  });

  it("recomputes marginal feature gain against selected candidates within the same evidence role", () => {
    const paths = [
      "src/ui.ts",
      "src/ui-copy.ts",
      "src/pdf.ts",
      "tests/ui.test.ts",
    ];
    const map = projectMap(paths, {
      featureAreas: [
        { id: "web-interface", status: "confirmed" },
        { id: "pdf-export", status: "confirmed" },
      ],
    });
    const sections = [
      section("ui", "src/ui.ts", substantialSource("ui"), {
        featureTargets: ["web-interface"],
      }),
      section("ui-copy", "src/ui-copy.ts", substantialSource("uiCopy"), {
        featureTargets: ["web-interface"],
      }),
      section("pdf", "src/pdf.ts", substantialSource("pdf"), {
        featureTargets: ["pdf-export"],
      }),
      section(
        "ui-test",
        "tests/ui.test.ts",
        "describe('UI', () => { it('renders', () => expect(true).toBe(true)); });",
        {
          role: "verification",
          featureTargets: ["web-interface"],
        },
      ),
    ];
    const result = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
      selectedSectionIds: ["ui"],
    });

    expect(
      result.rankedCandidates.find(
        (candidate) => candidate.sectionId === "ui-copy",
      )?.expectedIncrementalCoverage,
    ).toBe(0);
    expect(
      result.rankedCandidates.find((candidate) => candidate.sectionId === "pdf")
        ?.expectedIncrementalCoverage,
    ).toBe(0.5);
    expect(
      result.rankedCandidates.find(
        (candidate) => candidate.sectionId === "ui-test",
      )?.expectedIncrementalCoverage,
    ).toBe(0.5);
    expect(result.coverage.byRole.implementation).toEqual(["web-interface"]);
    expect(result.coverage.byRole.verification).toEqual([]);
  });

  it("keeps overview, implementation, and verification roles separately ranked", () => {
    const paths = ["README.md", "src/engine.ts", "tests/engine.test.ts"];
    const map = projectMap(paths, {
      featureAreas: [{ id: "resume-generation", status: "confirmed" }],
    });
    const sections = [
      section(
        "readme",
        "README.md",
        "A synthetic resume tool overview for contributors.",
        { role: "overview" },
      ),
      section("engine", "src/engine.ts", substantialSource("engine"), {
        featureTargets: ["resume-generation"],
      }),
      section(
        "engine-test",
        "tests/engine.test.ts",
        "it('generates resumes', () => expect(true).toBe(true));",
        {
          role: "verification",
          featureTargets: ["resume-generation"],
        },
      ),
      section(
        "misclassified-test",
        "src/__tests__/provider.spec.ts",
        "it('mocks provider output', () => expect(true).toBe(true));",
        {
          role: "implementation",
          featureTargets: ["resume-generation"],
        },
      ),
    ];
    const result = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
    });
    const testOnlySelection = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
      selectedSectionIds: ["misclassified-test"],
    });

    expect(
      result.byRole.overview.map((candidate) => candidate.sectionId),
    ).toEqual(["readme"]);
    expect(
      result.byRole.implementation.map((candidate) => candidate.sectionId),
    ).toEqual(["engine"]);
    expect(
      result.byRole.verification.map((candidate) => candidate.sectionId),
    ).toEqual(["engine-test", "misclassified-test"].sort());
    expect(result.coverage.missingImplementationFeatures).toEqual([
      "resume-generation",
    ]);
    expect(result.byRole.verification[0]?.reasonCodes).toContain(
      "verification-evidence-only",
    );
    expect(testOnlySelection.coverage.byRole.verification).toEqual([
      "resume-generation",
    ]);
    expect(testOnlySelection.coverage.byRole.implementation).toEqual([]);
  });

  it("exposes duplicate relationships and penalizes a duplicate after the first copy is selected", () => {
    const duplicateExcerpt = substantialSource("duplicate");
    const sections = [
      section("one", "src/one.ts", duplicateExcerpt),
      section("two", "src/two.ts", duplicateExcerpt),
    ];
    const map = projectMap(sections.map((item) => item.path));
    const initial = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
    });
    const afterFirst = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
      selectedSectionIds: [initial.rankedCandidates[0]!.sectionId],
    });

    expect(
      initial.rankedCandidates.every(
        (candidate) => candidate.duplicateSectionIds.length === 1,
      ),
    ).toBe(true);
    expect(
      afterFirst.rankedCandidates.find(
        (candidate) =>
          candidate.sectionId !== initial.rankedCandidates[0]!.sectionId,
      )?.components.redundancy,
    ).toBe(1);
  });

  it("changes ranking with contribution scope and enforces explicit selected areas when requested", () => {
    const paths = ["src/frontend/view.ts", "src/ml/trainer.py"];
    const map = projectMap(paths, {
      featureAreas: [
        { id: "web-interface", status: "confirmed" },
        { id: "model-training", status: "suggested" },
      ],
    });
    const sections = [
      section("view", paths[0]!, substantialSource("view"), {
        featureTargets: ["web-interface"],
      }),
      section("trainer", paths[1]!, "def train(data):\n    return fit(data)", {
        featureTargets: ["model-training"],
        staticImports: [],
      }),
    ];
    const viewScope = rankCandidates({
      projectMap: map,
      sections,
      context: {
        scope: {
          mode: "selected-areas",
          paths: ["src/frontend"],
          featureIds: ["web-interface"],
          source: "user-confirmed",
          enforceExplicitScope: true,
        },
      },
    });
    const mlScope = rankCandidates({
      projectMap: map,
      sections,
      context: {
        scope: {
          mode: "selected-areas",
          paths: ["src/ml"],
          featureIds: ["model-training"],
          source: "user-confirmed",
          enforceExplicitScope: true,
        },
      },
    });

    expect(
      viewScope.rankedCandidates.map((candidate) => candidate.sectionId),
    ).toEqual(["view"]);
    expect(viewScope.excludedCandidates).toContainEqual(
      expect.objectContaining({
        sectionId: "trainer",
        reason: "outside-explicit-scope",
      }),
    );
    expect(
      mlScope.rankedCandidates.map((candidate) => candidate.sectionId),
    ).toEqual(["trainer"]);
  });

  it("keeps pins inside safety, explicit scope, and hard token/file budgets", () => {
    const paths = [
      "src/core.ts",
      "src/other.ts",
      "src/unsafe.ts",
      "src/outside.ts",
    ];
    const map = projectMap(paths, {
      featureAreas: [{ id: "resume-generation", status: "confirmed" }],
    });
    const sections = [
      section("core", "src/core.ts", substantialSource("core"), {
        featureTargets: ["resume-generation"],
        estimatedTokens: 90,
      }),
      section(
        "core-extra",
        "src/core.ts",
        "A second reviewed excerpt from the same contribution area.",
        { estimatedTokens: 20 },
      ),
      section("other", "src/other.ts", substantialSource("other"), {
        estimatedTokens: 90,
      }),
      section("unsafe", "src/unsafe.ts", substantialSource("unsafe"), {
        estimatedTokens: 1,
        safety: { eligible: false, screening: "unsafe", reason: "fixture" },
      }),
      section("outside", "src/outside.ts", substantialSource("outside"), {
        estimatedTokens: 1,
      }),
    ];
    const result = selectEvidenceCandidates({
      projectMap: map,
      sections,
      context: {
        scope: {
          mode: "selected-areas",
          paths: ["src/core.ts"],
          source: "user-confirmed",
          enforceExplicitScope: true,
        },
      },
      pinnedSectionIds: ["core", "core-extra", "unsafe", "outside", "missing"],
      budget: { maxTokens: 100, maxFiles: 1 },
    });

    expect(result.selected.map((candidate) => candidate.sectionId)).toEqual([
      "core",
    ]);
    expect(result.pinConflicts).toEqual(
      expect.arrayContaining([
        { sectionId: "unsafe", reason: "unsafe" },
        { sectionId: "core-extra", reason: "over-budget" },
        { sectionId: "outside", reason: "outside-explicit-scope" },
        { sectionId: "missing", reason: "not-found" },
      ]),
    );
    expect(result.selectedTokenEstimate).toBe(90);
    expect(result.selectedFileCount).toBe(1);
  });

  it("returns stable results when candidate inventory order changes", () => {
    const sections = [
      section("b", "src/b.ts", substantialSource("b"), {
        featureTargets: ["model-training"],
      }),
      section("a", "src/a.ts", substantialSource("a"), {
        featureTargets: ["web-interface"],
      }),
      section("c", "src/c.ts", 'export { run } from "./a";', {
        featureTargets: ["web-interface"],
      }),
    ];
    const map = projectMap(sections.map((item) => item.path));
    const first = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
    });
    const shuffled = rankCandidates({
      projectMap: map,
      sections: [...sections].reverse(),
      context: wholeProject,
    });

    expect(
      first.rankedCandidates.map((item) => [item.sectionId, item.totalScore]),
    ).toEqual(
      shuffled.rankedCandidates.map((item) => [
        item.sectionId,
        item.totalScore,
      ]),
    );
    expect(first.graph.edges).toEqual(shuffled.graph.edges);
  });

  it("uses conservative fallbacks for unknown repositories and unsupported languages", () => {
    const paths = ["src/feature.xyz", "README.md"];
    const map = projectMap(paths, { featureAreas: [] });
    const sections = [
      section("unknown-code", "src/feature.xyz", 'import "./other";'),
      section("readme", "README.md", "A small overview.", { role: "overview" }),
    ];
    const result = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
    });

    expect(result.graph.edges).toEqual([]);
    expect(result.diagnostics).toContain("unsupported-language-static-parse");
    expect(
      result.rankedCandidates.every(
        (candidate) => candidate.components.featureGain === 0,
      ),
    ).toBe(true);
  });

  it("reports graph-bound omissions and does not let a pin bypass the analysis bound", () => {
    const sections = [
      section("kept", "src/kept.ts", substantialSource("kept")),
      section("omitted", "src/omitted.ts", "export const value = 1;"),
    ];
    const map = projectMap(sections.map((item) => item.path));
    const graph = buildDependencyGraph(map, sections, {
      limits: { maxSections: 1 },
    });
    const ranked = rankCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
      graph,
    });
    const selected = selectEvidenceCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
      graph,
      pinnedSectionIds: ["omitted"],
      budget: { maxTokens: 100, maxFiles: 3 },
    });
    const pinAwareGraph = buildDependencyGraph(map, sections, {
      limits: { maxSections: 1 },
      pinnedSectionIds: ["omitted"],
    });
    const pinAwareSelection = selectEvidenceCandidates({
      projectMap: map,
      sections,
      context: wholeProject,
      graph: pinAwareGraph,
      pinnedSectionIds: ["omitted"],
      budget: { maxTokens: 100, maxFiles: 3 },
    });

    expect(
      ranked.rankedCandidates.map((candidate) => candidate.sectionId),
    ).toEqual(["kept"]);
    expect(ranked.excludedCandidates).toContainEqual(
      expect.objectContaining({
        sectionId: "omitted",
        reason: "not-a-candidate",
      }),
    );
    expect(selected.pinConflicts).toContainEqual({
      sectionId: "omitted",
      reason: "analysis-limit",
    });
    expect(
      pinAwareSelection.selected.map((candidate) => candidate.sectionId),
    ).toContain("omitted");
    expect(
      pinAwareSelection.selected.find(
        (candidate) => candidate.sectionId === "omitted",
      )?.pinned,
    ).toBe(true);
  });

  it("reports that a smaller section costs less without treating token estimates as measurements", () => {
    const sections = [
      section("small", "src/small.ts", "export const answer = 42;"),
      section("large", "src/large.ts", substantialSource("large")),
    ];
    const result = rankCandidates({
      projectMap: projectMap(sections.map((item) => item.path)),
      sections,
      context: wholeProject,
    });
    const small = result.rankedCandidates.find(
      (candidate) => candidate.sectionId === "small",
    )!;
    const large = result.rankedCandidates.find(
      (candidate) => candidate.sectionId === "large",
    )!;

    expect(small.components.estimatedTokenCost).toBeLessThan(
      large.components.estimatedTokenCost,
    );
    expect(small.estimatedTokenCost).toBe(
      Math.ceil(sections[0]!.excerpt.length / 4),
    );
  });
});
