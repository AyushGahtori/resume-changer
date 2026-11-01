import { describe, expect, it } from "vitest";
import { createBaselineSelectorAdapter } from "./baseline-adapter";
import { AdapterConformanceError, runQualityAdapter } from "./harness";
import { createReferenceAdapter } from "./reference-adapters";
import {
  QUALITY_FIXTURES,
  repositoryInput,
} from "../fixtures/github/context-quality/scenarios";
import type { QualityAdapter } from "./contracts";

const adapters = [
  createBaselineSelectorAdapter(),
  createReferenceAdapter("static-top-n"),
  createReferenceAdapter("role-balanced"),
  createReferenceAdapter("marginal-coverage"),
];

describe("GitHub context port conformance", () => {
  it("keeps interview transcripts and optional screenshot metadata distinct from repository files", () => {
    for (const fixture of QUALITY_FIXTURES) {
      expect(fixture.interviewTranscript).toHaveLength(5);
      expect(
        fixture.interviewTranscript.every(
          ({ provenance, catalogVersion }) =>
            provenance === "user-reported" &&
            catalogVersion === "project-context-v1",
        ),
      ).toBe(true);
    }
    const monorepo = repositoryInput(
      QUALITY_FIXTURES.find(({ id }) => id === "multi-package-monorepo")!,
    );
    expect(monorepo.visualInputs).toHaveLength(1);
    expect(monorepo.visualInputs[0]).toMatchObject({
      mimeType: "image/png",
      source: "user-uploaded",
      scope: "visual-only",
    });
    expect(
      monorepo.inventory.some(({ id }) => id === monorepo.visualInputs[0].id),
    ).toBe(false);
    expect(monorepo.visualInputs[0]).not.toHaveProperty("bytes");
  });

  for (const adapter of adapters) {
    for (const fixture of QUALITY_FIXTURES) {
      it(adapter.id + " preserves frozen ports for " + fixture.id, async () => {
        const result = await runQualityAdapter(adapter, fixture);
        expect(result.conformanceErrors).toEqual([]);
        expect(result.selectedFiles).toBeGreaterThan(0);
        expect(result.provenance.total).toBe(fixture.expected.evidence.length);
      });
    }
  }

  it("rejects an empty no-op adapter instead of reporting fixture success", async () => {
    const noOp: QualityAdapter = {
      id: "deliberate-no-op",
      version: "0.0.0",
      kind: "candidate",
      discover: (input) => ({
        repositoryId: input.identity.repositoryId,
        commitSha: input.identity.commitSha,
        packages: [],
        capabilitySuggestions: [],
        overviewCandidateIds: [],
        entrypointCandidateIds: [],
        fileRoles: {},
        excludedFileIds: [],
      }),
      readSections: () => [],
      buildGraph: (input) => ({
        repositoryId: input.repository.identity.repositoryId,
        commitSha: input.repository.identity.commitSha,
        nodes: [],
        edges: [],
        unresolved: [],
      }),
      rank: () => [],
      select: (input) => ({
        repositoryId: input.repository.identity.repositoryId,
        commitSha: input.repository.identity.commitSha,
        selectionId: "",
        sections: [],
        selectedFileIds: [],
        coveredFeatureHints: [],
        limitations: [],
        budget: {
          selectedTokens: 0,
          selectedBytes: 0,
          selectedLines: 0,
          simulatedRequests: 0,
        },
      }),
    };

    await expect(
      runQualityAdapter(noOp, QUALITY_FIXTURES[0]),
    ).rejects.toMatchObject({
      name: "AdapterConformanceError",
      errors: expect.arrayContaining([
        "discover returned no package/root boundary",
        "readSections returned no screened sections",
        "rank returned no candidates",
        "select returned an empty bundle for a non-empty fixture",
      ]),
    } satisfies Partial<AdapterConformanceError>);
  });
});
