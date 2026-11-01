import { performance } from "node:perf_hooks";
import {
  QUALITY_CONTRACT_VERSION,
  estimatedTokens,
  sha256,
  type EvaluatedFixture,
  type ExpectedEvidence,
  type QualityAdapter,
  type QualityFixture,
  type QualityReport,
  type ScreenedSection,
  type StrategyReport,
} from "./contracts";
import { inspectConformance, type PipelineOutput } from "./conformance";
import { repositoryInput } from "../fixtures/github/context-quality/scenarios";
import publicManifest from "../fixtures/github/context-quality/public-reproduction-manifest.json";

export class AdapterConformanceError extends Error {
  constructor(
    adapterId: string,
    fixtureId: string,
    readonly errors: string[],
  ) {
    super(
      "Adapter " +
        adapterId +
        " failed " +
        fixtureId +
        ": " +
        errors.join("; "),
    );
    this.name = "AdapterConformanceError";
  }
}

export async function runQualityAdapter(
  adapter: QualityAdapter,
  fixture: QualityFixture,
): Promise<EvaluatedFixture> {
  const repository = repositoryInput(fixture);
  const started = performance.now();
  const beforeHeap = process.memoryUsage().heapUsed;
  const projectMap = await adapter.discover(repository);
  const sections = await adapter.readSections({ repository, projectMap });
  const graph = await adapter.buildGraph({ repository, projectMap, sections });
  const rankedCandidates = await adapter.rank({
    repository,
    projectMap,
    sections,
    graph,
  });
  const bundle = await adapter.select({
    repository,
    projectMap,
    sections,
    graph,
    rankedCandidates,
  });
  const elapsedMs = Math.round((performance.now() - started) * 1_000) / 1_000;
  const afterHeap = process.memoryUsage().heapUsed;
  const output = { projectMap, sections, graph, rankedCandidates, bundle };
  const errors = inspectConformance(repository, output);
  if (errors.length > 0)
    throw new AdapterConformanceError(adapter.id, fixture.id, errors);

  return evaluateFixture({
    fixture,
    output,
    elapsedMs,
    observedHeapDeltaBytes: afterHeap - beforeHeap,
    conformanceErrors: errors,
  });
}

export async function runQualityBenchmark(input: {
  adapters: readonly QualityAdapter[];
  fixtures: readonly QualityFixture[];
}): Promise<QualityReport> {
  validateAdapters(input.adapters);
  if (input.fixtures.length === 0)
    throw new Error("At least one synthetic repository fixture is required.");
  const strategies: StrategyReport[] = [];

  for (const adapter of input.adapters) {
    const results: EvaluatedFixture[] = [];
    for (const fixture of input.fixtures)
      results.push(await runQualityAdapter(adapter, fixture));
    strategies.push(makeStrategyReport(adapter, results));
  }

  const fileLines = publicManifest.selectedPaths.reduce(
    (sum, file) => sum + file.selectedLines,
    0,
  );
  const testFiles = publicManifest.selectedPaths.filter(
    ({ role }) => role === "test",
  );
  const testLines = testFiles.reduce(
    (sum, file) => sum + file.selectedLines,
    0,
  );
  if (
    publicManifest.sourceIncluded !== false ||
    publicManifest.selectedPaths.length !== 12 ||
    fileLines !== 651 ||
    publicManifest.afterRepair.selectedBytes !== 22_536 ||
    testFiles.length !== 3 ||
    testLines !== 434
  ) {
    throw new Error(
      "The source-free public regression manifest is inconsistent.",
    );
  }

  const body = {
    contractVersion: QUALITY_CONTRACT_VERSION,
    benchmarkVersion: "1.0.0" as const,
    fixtureIds: input.fixtures.map(({ id }) => id),
    budget: input.fixtures[0].limits,
    regressionManifest: {
      revision: publicManifest.revision,
      selectedFiles: publicManifest.afterRepair.selectedFiles,
      selectedLines: publicManifest.afterRepair.selectedLines,
      selectedBytes: publicManifest.afterRepair.selectedBytes,
      testFiles: publicManifest.afterRepair.testFiles,
      testLines: publicManifest.afterRepair.testLines,
    },
    strategies,
  };
  return {
    ...body,
    deterministicHash: sha256(stableJson(stableProjection(body))),
  };
}

export function evaluateFixture(input: {
  fixture: QualityFixture;
  output: PipelineOutput;
  elapsedMs: number;
  observedHeapDeltaBytes: number | null;
  conformanceErrors: string[];
}): EvaluatedFixture {
  const { fixture, output } = input;
  const repository = repositoryInput(fixture);
  const files = new Map(repository.inventory.map((file) => [file.id, file]));
  const resolvedEvidence = new Set<string>();
  const provenanceErrors: string[] = [];

  for (const expected of fixture.expected.evidence) {
    const section = output.bundle.sections.find(
      (candidate) =>
        candidate.fileId === expected.fileId &&
        candidate.excerpt.includes(expected.exactSnippet),
    );
    if (
      section &&
      evidenceProvenanceMatches(
        expected,
        section,
        files.get(expected.fileId),
        repository.identity.repositoryId,
      )
    ) {
      resolvedEvidence.add(expected.id);
    } else if (section) {
      provenanceErrors.push(
        "evidence:" + expected.id + ":source-or-range-mismatch",
      );
    }
  }

  const covered = fixture.expected.features.filter((feature) =>
    feature.evidenceIds.every((id) => resolvedEvidence.has(id)),
  );
  const critical = fixture.expected.features.filter(({ critical }) => critical);
  const criticalCovered = critical.filter((feature) =>
    feature.evidenceIds.every((id) => resolvedEvidence.has(id)),
  );
  const unsafeIds = new Set(
    repository.inventory.filter((file) => !file.safe).map(({ id }) => id),
  );
  const safeExclusionLeaks = output.bundle.sections
    .filter(({ fileId }) => unsafeIds.has(fileId))
    .map(({ fileId }) => fileId)
    .sort();
  const selectedIds = new Set(output.bundle.selectedFileIds);
  const selectedSections = output.bundle.sections;
  const selectedTokens = selectedSections.reduce(
    (sum, section) => sum + estimatedTokens(section.excerpt),
    0,
  );
  const selectedBytes = selectedSections.reduce(
    (sum, section) => sum + Buffer.byteLength(section.excerpt, "utf8"),
    0,
  );
  const selectedLines = selectedSections.reduce(
    (sum, section) => sum + section.lineEnd - section.lineStart + 1,
    0,
  );
  const selectedFiles = [...selectedIds]
    .map((id) => files.get(id))
    .filter((file): file is NonNullable<typeof file> => Boolean(file));
  const tokensByFile = new Map<string, number>();
  for (const section of selectedSections) {
    tokensByFile.set(
      section.fileId,
      (tokensByFile.get(section.fileId) ?? 0) +
        estimatedTokens(section.excerpt),
    );
  }
  const wrapperTokens = selectedSections
    .filter(({ role }) => role === "wrapper")
    .reduce((sum, section) => sum + estimatedTokens(section.excerpt), 0);
  const testTokens = selectedSections
    .filter(({ role, path }) => role === "verification" || isTestPath(path))
    .reduce((sum, section) => sum + estimatedTokens(section.excerpt), 0);
  const duplicateTokens = countDuplicateTokens(
    selectedSections,
    selectedFiles,
    tokensByFile,
  );
  const downloadedBytes = selectedFiles.reduce(
    (sum, file) => sum + file.byteSize,
    0,
  );
  const omittedSelectedDependencies = output.graph.edges.filter(
    ({ fromFileId, toFileId }) =>
      selectedIds.has(fromFileId) && !selectedIds.has(toFileId),
  ).length;
  const maxRetainedTextBytes =
    output.sections.reduce(
      (sum, section) => sum + Buffer.byteLength(section.excerpt, "utf8"),
      0,
    ) + selectedBytes;

  return {
    fixtureId: fixture.id,
    scenario: fixture.scenario,
    selectedFiles: selectedIds.size,
    selectedLines,
    selectedBytes,
    selectedTokenEstimate: selectedTokens,
    featureCoverage: {
      covered: covered.length,
      total: fixture.expected.features.length,
      criticalCovered: criticalCovered.length,
      criticalTotal: critical.length,
    },
    coveredFeatureIds: covered.map(({ id }) => id).sort(),
    missingCriticalFeatureIds: critical
      .filter((feature) => !criticalCovered.includes(feature))
      .map(({ id }) => id)
      .sort(),
    overviewPresent: selectedSections.some(({ role }) => role === "overview"),
    unresolvedDependencies:
      output.graph.unresolved.length + omittedSelectedDependencies,
    wrapperTokens,
    testTokens,
    duplicateTokens,
    provenance: {
      correct: resolvedEvidence.size,
      total: fixture.expected.evidence.length,
      errors: provenanceErrors,
    },
    safeExclusionLeaks,
    downloadedBytes,
    simulatedRequests: output.bundle.budget.simulatedRequests,
    maxRetainedTextBytes,
    withinTextMemoryCap:
      maxRetainedTextBytes <= repository.limits.maxAggregateReadBytes,
    elapsedMs: input.elapsedMs,
    observedHeapDeltaBytes: input.observedHeapDeltaBytes,
    conformanceErrors: input.conformanceErrors,
  };
}

export function makeStrategyReport(
  adapter: QualityAdapter,
  fixtures: EvaluatedFixture[],
): StrategyReport {
  const sum = (pick: (fixture: EvaluatedFixture) => number) =>
    fixtures.reduce((total, fixture) => total + pick(fixture), 0);
  const featureCovered = sum(({ featureCoverage }) => featureCoverage.covered);
  const featureTotal = sum(({ featureCoverage }) => featureCoverage.total);
  const criticalCovered = sum(
    ({ featureCoverage }) => featureCoverage.criticalCovered,
  );
  const criticalTotal = sum(
    ({ featureCoverage }) => featureCoverage.criticalTotal,
  );
  const selectedTokens = sum(
    ({ selectedTokenEstimate }) => selectedTokenEstimate,
  );
  const wrapperTokens = sum(({ wrapperTokens }) => wrapperTokens);
  const testTokens = sum(({ testTokens }) => testTokens);
  const duplicateTokens = sum(({ duplicateTokens }) => duplicateTokens);
  const provenanceCorrect = sum(({ provenance }) => provenance.correct);
  const provenanceTotal = sum(({ provenance }) => provenance.total);
  const heapDeltas = fixtures
    .map(({ observedHeapDeltaBytes }) => observedHeapDeltaBytes)
    .filter((value): value is number => value !== null);

  return {
    adapterId: adapter.id,
    adapterVersion: adapter.version,
    adapterKind: adapter.kind,
    fixtures,
    totals: {
      fixtureCount: fixtures.length,
      featureCoverage: {
        covered: featureCovered,
        total: featureTotal,
        ratio: ratio(featureCovered, featureTotal),
      },
      criticalFeatureCoverage: {
        covered: criticalCovered,
        total: criticalTotal,
        ratio: ratio(criticalCovered, criticalTotal),
      },
      overviewFixtures: {
        present: fixtures.filter(({ overviewPresent }) => overviewPresent)
          .length,
        total: fixtures.length,
      },
      unresolvedDependencies: sum(
        ({ unresolvedDependencies }) => unresolvedDependencies,
      ),
      wrapperTokens,
      testTokens,
      selectedTokens,
      wrapperTokenShare: ratio(wrapperTokens, selectedTokens),
      testTokenShare: ratio(testTokens, selectedTokens),
      duplicateTokens,
      duplicateTokenShare: ratio(duplicateTokens, selectedTokens),
      provenance: {
        correct: provenanceCorrect,
        total: provenanceTotal,
        ratio: ratio(provenanceCorrect, provenanceTotal),
      },
      safeExclusionLeaks: sum(
        ({ safeExclusionLeaks }) => safeExclusionLeaks.length,
      ),
      downloadedBytes: sum(({ downloadedBytes }) => downloadedBytes),
      simulatedRequests: sum(({ simulatedRequests }) => simulatedRequests),
      maxRetainedTextBytes: Math.max(
        0,
        ...fixtures.map(({ maxRetainedTextBytes }) => maxRetainedTextBytes),
      ),
      fixturesWithinTextMemoryCap: fixtures.filter(
        ({ withinTextMemoryCap }) => withinTextMemoryCap,
      ).length,
      totalElapsedMs: sum(
        ({ elapsedMs }) => Math.round(elapsedMs * 1_000) / 1_000,
      ),
      observedHeapDeltaBytes: heapDeltas.length
        ? heapDeltas.reduce((total, value) => total + value, 0)
        : null,
    },
    integrationStatus: "adapter-contract-tested; production-wiring-not-proven",
  };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stableJson(record[key]));
    return "{" + fields.join(",") + "}";
  }
  return JSON.stringify(value) ?? "null";
}

export function formatMarkdownReport(report: QualityReport): string {
  const lines = [
    "# GitHub context quality benchmark",
    "",
    "Contract: " +
      report.contractVersion +
      " · Stable report hash: " +
      report.deterministicHash,
    "",
    "The fixture suite is synthetic and offline. Token counts are a character-based estimate; requests are simulated source reads. Timing and heap deltas are observed per run and excluded from the deterministic hash.",
    "",
    "## Aggregate results",
    "",
    "| Adapter | Feature coverage | Critical coverage | Overview | Wrapper token share | Test token share | Provenance | Unsafe leaks | Bytes | Reads | Max retained text | Elapsed ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const strategy of report.strategies) {
    const total = strategy.totals;
    lines.push(
      "| " +
        strategy.adapterId +
        " | " +
        total.featureCoverage.covered +
        "/" +
        total.featureCoverage.total +
        " | " +
        total.criticalFeatureCoverage.covered +
        "/" +
        total.criticalFeatureCoverage.total +
        " | " +
        total.overviewFixtures.present +
        "/" +
        total.overviewFixtures.total +
        " | " +
        formatRatio(total.wrapperTokenShare) +
        " | " +
        formatRatio(total.testTokenShare) +
        " | " +
        total.provenance.correct +
        "/" +
        total.provenance.total +
        " | " +
        total.safeExclusionLeaks +
        " | " +
        total.downloadedBytes +
        " | " +
        total.simulatedRequests +
        " | " +
        total.maxRetainedTextBytes +
        " | " +
        total.totalElapsedMs.toFixed(3) +
        " |",
    );
  }
  lines.push(
    "",
    "## Per-fixture coverage",
    "",
    "| Adapter | Fixture | Coverage | Critical gaps | Selected files | Tokens | Missing critical features |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
  );
  for (const strategy of report.strategies) {
    for (const fixture of strategy.fixtures) {
      lines.push(
        "| " +
          strategy.adapterId +
          " | " +
          fixture.fixtureId +
          " | " +
          fixture.featureCoverage.covered +
          "/" +
          fixture.featureCoverage.total +
          " | " +
          (fixture.featureCoverage.criticalTotal -
            fixture.featureCoverage.criticalCovered) +
          " | " +
          fixture.selectedFiles +
          " | " +
          fixture.selectedTokenEstimate +
          " | " +
          (fixture.missingCriticalFeatureIds.join(", ") || "none") +
          " |",
      );
    }
  }
  lines.push(
    "",
    "## Source-free public regression manifest",
    "",
    "Revision " +
      report.regressionManifest.revision +
      ": " +
      report.regressionManifest.selectedFiles +
      " files, " +
      report.regressionManifest.selectedLines +
      " selected lines, " +
      report.regressionManifest.selectedBytes +
      " bytes. Tests account for " +
      report.regressionManifest.testFiles +
      " files and " +
      report.regressionManifest.testLines +
      " lines. No source text is stored in the manifest.",
    "",
    "Every strategy is marked adapter-contract-tested; production-wiring-not-proven. Passing synthetic fixtures does not prove production wiring.",
    "",
  );
  return lines.join("\n");
}

function evidenceProvenanceMatches(
  expected: ExpectedEvidence,
  section: ScreenedSection,
  file: ReturnType<typeof repositoryInput>["inventory"][number] | undefined,
  repositoryId: string,
): boolean {
  if (!file || !file.safe || section.repositoryId !== repositoryId)
    return false;
  if (
    section.path !== file.path ||
    section.blobSha !== file.blobSha ||
    section.contentHash !== sha256(section.excerpt)
  )
    return false;
  const offset = file.content.indexOf(expected.exactSnippet);
  if (offset < 0) return false;
  const line = file.content.slice(0, offset).split("\n").length;
  return (
    line >= section.lineStart &&
    line <= section.lineEnd &&
    section.excerpt.includes(expected.exactSnippet)
  );
}

function countDuplicateTokens(
  sections: ScreenedSection[],
  files: Array<ReturnType<typeof repositoryInput>["inventory"][number]>,
  tokensByFile: Map<string, number>,
): number {
  const byId = new Map(files.map((file) => [file.id, file]));
  const seen = new Set<string>();
  const seenFiles = new Set<string>();
  let duplicates = 0;
  for (const section of sections) {
    const file = byId.get(section.fileId);
    if (!file || seenFiles.has(file.id)) continue;
    seenFiles.add(file.id);
    const identity = file.duplicateGroup
      ? "group:" + file.duplicateGroup
      : "blob:" + file.blobSha;
    if (seen.has(identity))
      duplicates +=
        tokensByFile.get(file.id) ?? estimatedTokens(section.excerpt);
    else seen.add(identity);
  }
  return duplicates;
}

function stableProjection(report: Omit<QualityReport, "deterministicHash">) {
  return {
    contractVersion: report.contractVersion,
    benchmarkVersion: report.benchmarkVersion,
    fixtureIds: report.fixtureIds,
    budget: report.budget,
    regressionManifest: report.regressionManifest,
    strategies: report.strategies.map((strategy) => ({
      adapterId: strategy.adapterId,
      adapterVersion: strategy.adapterVersion,
      adapterKind: strategy.adapterKind,
      integrationStatus: strategy.integrationStatus,
      fixtures: strategy.fixtures.map(
        ({ elapsedMs: _elapsed, observedHeapDeltaBytes: _heap, ...stable }) =>
          stable,
      ),
      totals: {
        ...strategy.totals,
        totalElapsedMs: 0,
        observedHeapDeltaBytes: null,
      },
    })),
  };
}

function validateAdapters(adapters: readonly QualityAdapter[]): void {
  const ids = adapters.map(({ id }) => id);
  if (ids.length === 0 || ids.some((id) => !id.trim()))
    throw new Error("Adapters must have stable, non-empty IDs.");
  if (new Set(ids).size !== ids.length)
    throw new Error("Adapter IDs must be unique.");
  for (const adapter of adapters) {
    if (!adapter.version.trim())
      throw new Error("Adapter " + adapter.id + " has no version.");
    if (
      !adapter.discover ||
      !adapter.readSections ||
      !adapter.buildGraph ||
      !adapter.rank ||
      !adapter.select
    )
      throw new Error("Adapter " + adapter.id + " is missing a frozen port.");
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 1_000_000) / 1_000_000;
}

function formatRatio(value: number | null): string {
  return value === null ? "none" : (value * 100).toFixed(1) + "%";
}

function isTestPath(path: string): boolean {
  return /(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|\.(?:test|spec)\.[^.]+$/iu.test(
    path,
  );
}
