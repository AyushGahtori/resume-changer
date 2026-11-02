import {
  createEvidenceSelector,
  type EvidenceExecutionContext,
  type SelectionPlan,
} from "@/lib/github/server/selector-core";
import type { FileCandidate } from "@/lib/github/server/file-policy-core";
import {
  estimatedTokens,
  sha256,
  type EvidenceBundle,
  type QualityAdapter,
  type RankedCandidate,
  type RepositoryInput,
  type ScreenedSection,
} from "./contracts";
import {
  buildReferenceGraph,
  discoverReferenceProject,
  readReferenceSections,
} from "./reference-adapters";

/**
 * The adapter calls the committed baseline selector directly. The surrounding
 * discovery/reader ports are fixture-only shims so the benchmark stays offline.
 */
export function createBaselineSelectorAdapter(): QualityAdapter {
  let lastPlan: SelectionPlan | null = null;
  let lastInput: RepositoryInput | null = null;

  const adapter: QualityAdapter = {
    id: "existing-selector-baseline",
    version: "phase-one-selector-core-v1",
    kind: "reference",
    discover: discoverReferenceProject,
    readSections: readReferenceSections,
    buildGraph: buildReferenceGraph,
    rank({ repository, projectMap }) {
      const bodies = new Map(
        repository.inventory.map((file) => [file.id, file]),
      );
      const inventory: FileCandidate[] = repository.inventory
        .filter((file) => !projectMap.excludedFileIds.includes(file.id))
        .map((file) => ({
          id: file.id,
          path: file.path,
          blobSha: file.blobSha,
          mode: file.mode,
          byteSize: file.byteSize,
          selected: repository.context.selectedPaths.includes(file.path),
        }));
      const selector = createEvidenceSelector({
        async fetchFile({ candidate }) {
          const file = bodies.get(candidate.id);
          if (!file || !file.safe || file.byteSize > 64 * 1024) {
            return {
              ok: false,
              error: {
                code: "unavailable",
                message:
                  "Synthetic source is unavailable to the baseline selector.",
                retryable: false,
              },
            };
          }
          return {
            ok: true,
            value: {
              text: file.content,
              blobSha: file.blobSha,
              byteSize: file.byteSize,
            },
          };
        },
      });
      const scope = {
        repositoryId: repository.identity.repositoryId,
        owner: repository.identity.owner,
        name: repository.identity.name,
        fullSha: repository.identity.commitSha,
        canonicalUrl: `https://github.com/${repository.identity.owner}/${repository.identity.name}`,
        visibility: "public" as const,
        role: repository.context.role,
        contributionStatement: repository.context.contribution,
        identitySource: "self-declared" as const,
        selectedPaths: repository.context.selectedPaths,
        selectedPrNumbers: [],
      };
      const context: EvidenceExecutionContext = {
        runId: `quality-${repository.fixtureId}`,
        snapshotId: repository.identity.commitSha,
        clock: () => new Date("2026-10-31T00:00:00.000Z"),
        budgetLedger: {
          async checkSelection(request) {
            const allowed =
              request.files.length <= repository.limits.maxFiles &&
              request.uniqueLineCount <= repository.limits.maxLines &&
              request.estimatedInputTokens <= repository.limits.maxTokens &&
              request.totalFetchedBytes <= repository.limits.maxSelectedBytes;
            return { ok: true, value: { allowed } };
          },
        },
      };
      const result = selector.select({
        inventory,
        scope,
        prContext: { selectedPullRequests: [] },
        pinnedFileIds: [],
        context,
      });
      if (!result.ok)
        throw new Error(
          `Baseline selector rejected ${repository.fixtureId}: ${result.error.code}`,
        );
      lastPlan = result.value;
      lastInput = repository;

      const sectionByFile = new Map<string, ScreenedSection>();
      for (const section of readReferenceSections({
        repository,
        projectMap,
      })) {
        if (!sectionByFile.has(section.fileId))
          sectionByFile.set(section.fileId, section);
      }
      return result.value.rankedCandidates.flatMap((ranked) => {
        const section = sectionByFile.get(ranked.candidate.id);
        if (!section) return [];
        const featureTargets =
          repository.inventory.find(({ id }) => id === ranked.candidate.id)
            ?.topicHints ?? [];
        return [
          {
            sectionId: section.id,
            fileId: ranked.candidate.id,
            score: ranked.score,
            components: { existingSelectorScore: ranked.score },
            featureTargets: [...featureTargets],
            expectedIncrementalCoverage: [...featureTargets],
            estimatedTokenCost: section.estimatedTokens,
            uncertaintyFlags: [],
            reason: ranked.reasonCodes.join(", "),
          } satisfies RankedCandidate,
        ];
      });
    },
    async select({ repository, projectMap, sections, graph }) {
      if (
        !lastPlan ||
        lastInput?.identity.commitSha !== repository.identity.commitSha
      ) {
        throw new Error(
          "Baseline selector plan is missing or belongs to another revision.",
        );
      }
      const candidatesById = new Map(
        repository.inventory.map((file) => [file.id, file]),
      );
      const selector = createEvidenceSelector({
        async fetchFile({ candidate }) {
          const file = candidatesById.get(candidate.id);
          if (!file || !file.safe || file.byteSize > 64 * 1024) {
            return {
              ok: false,
              error: {
                code: "unavailable",
                message:
                  "Synthetic source is unavailable to the baseline selector.",
                retryable: false,
              },
            };
          }
          return {
            ok: true,
            value: {
              text: file.content,
              blobSha: file.blobSha,
              byteSize: file.byteSize,
            },
          };
        },
      });
      const context = makePackingContext(repository);
      const packed = await selector.pack({ selected: lastPlan, context });
      if (!packed.ok)
        throw new Error(`Baseline pack failed: ${packed.error.code}`);

      const fileById = new Map(
        repository.inventory.map((file) => [file.id, file]),
      );
      const evidenceSections: ScreenedSection[] = packed.value.evidence.map(
        (evidence) => {
          const file = fileById.get(
            repository.inventory.find(({ path }) => path === evidence.path)
              ?.id ?? "",
          );
          const excerpt = evidence.excerpt;
          const start = evidence.lineStart;
          const end = evidence.lineEnd;
          const available = sections.find(
            (section) =>
              section.fileId === file?.id &&
              section.lineStart <= start &&
              section.lineEnd >= end,
          );
          return {
            id: `baseline:${evidence.id}`,
            repositoryId: evidence.repositoryId,
            commitSha: evidence.fullSha,
            fileId: file?.id ?? evidence.path,
            path: evidence.path,
            blobSha: evidence.blobSha,
            lineStart: start,
            lineEnd: end,
            contentHash: evidence.excerptHash,
            excerpt,
            role: available?.role ?? file?.role ?? "supporting",
            topicHints: file?.topicHints ?? [],
            safety: "safe",
            warnings: evidence.untrustedSource ? ["untrusted-source"] : [],
            estimatedTokens: estimatedTokens(excerpt),
            sourceBytes: file?.byteSize ?? Buffer.byteLength(excerpt, "utf8"),
          };
        },
      );
      const selectedTokens = evidenceSections.reduce(
        (sum, section) => sum + section.estimatedTokens,
        0,
      );
      const selectedBytes = evidenceSections.reduce(
        (sum, section) => sum + Buffer.byteLength(section.excerpt, "utf8"),
        0,
      );
      const selectedLines = evidenceSections.reduce(
        (sum, section) => sum + section.lineEnd - section.lineStart + 1,
        0,
      );
      const selectedFileIds = [
        ...new Set(evidenceSections.map(({ fileId }) => fileId)),
      ].sort();
      const contentIdentity = evidenceSections
        .map(({ id, contentHash }) => `${id}:${contentHash}`)
        .sort()
        .join("|");
      return {
        repositoryId: repository.identity.repositoryId,
        commitSha: repository.identity.commitSha,
        selectionId: `selection-${sha256(contentIdentity).slice(0, 20)}`,
        sections: evidenceSections,
        selectedFileIds,
        coveredFeatureHints: [
          ...new Set(evidenceSections.flatMap(({ topicHints }) => topicHints)),
        ].sort(),
        limitations: [...packed.value.limitations],
        budget: {
          selectedTokens,
          selectedBytes,
          selectedLines,
          simulatedRequests: packed.value.fetchedFileCount,
        },
      };
    },
  };

  return adapter;
}

function makePackingContext(
  repository: RepositoryInput,
): EvidenceExecutionContext {
  return {
    runId: `quality-${repository.fixtureId}`,
    snapshotId: repository.identity.commitSha,
    clock: () => new Date("2026-10-31T00:00:00.000Z"),
    budgetLedger: {
      async checkSelection(request) {
        const allowed =
          request.files.length <= repository.limits.maxFiles &&
          request.uniqueLineCount <= repository.limits.maxLines &&
          request.estimatedInputTokens <= repository.limits.maxTokens &&
          request.totalFetchedBytes <= repository.limits.maxSelectedBytes;
        return { ok: true, value: { allowed } };
      },
    },
  };
}
