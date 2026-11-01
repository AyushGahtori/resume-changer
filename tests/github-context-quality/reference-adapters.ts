import {
  estimatedTokens,
  lineCount,
  sha256,
  type DependencyGraph,
  type EvidenceBundle,
  type EvidenceRole,
  type ProjectMap,
  type QualityAdapter,
  type RankedCandidate,
  type RepositoryInput,
  type ScreenedSection,
} from "./contracts";

export type ReferenceStrategy =
  "static-top-n" | "role-balanced" | "marginal-coverage";

export function discoverReferenceProject(input: RepositoryInput): ProjectMap {
  const visible = input.inventory.filter((file) => file.safe);
  const packages = new Map<string, string[]>();
  for (const file of visible) {
    const packageRoot = packageRootFor(file.path);
    const members = packages.get(packageRoot) ?? [];
    members.push(file.id);
    packages.set(packageRoot, members);
  }

  const capabilitySources = new Map<string, string[]>();
  for (const file of visible) {
    for (const hint of file.topicHints) {
      const sources = capabilitySources.get(hint) ?? [];
      sources.push(file.id);
      capabilitySources.set(hint, sources);
    }
  }

  return {
    repositoryId: input.identity.repositoryId,
    commitSha: input.identity.commitSha,
    packages: [...packages]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([rootPath, fileIds]) => ({
        id: `package:${rootPath || "root"}`,
        rootPath,
        fileIds: [...fileIds].sort(),
      })),
    capabilitySuggestions: [...capabilitySources]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, sourceFileIds]) => ({
        id,
        sourceFileIds: [...sourceFileIds].sort(),
        confidence: sourceFileIds.length > 1 ? "high" : "medium",
      })),
    overviewCandidateIds: visible
      .filter((file) => file.role === "overview")
      .map(({ id }) => id)
      .sort(),
    entrypointCandidateIds: visible
      .filter((file) => file.role === "wrapper")
      .map(({ id }) => id)
      .sort(),
    fileRoles: Object.fromEntries(visible.map(({ id, role }) => [id, role])),
    excludedFileIds: input.inventory
      .filter((file) => !file.safe)
      .map(({ id }) => id)
      .sort(),
  };
}

export function readReferenceSections(input: {
  repository: RepositoryInput;
  projectMap: ProjectMap;
}): ScreenedSection[] {
  const excluded = new Set(input.projectMap.excludedFileIds);
  let aggregateBytes = 0;
  const output: ScreenedSection[] = [];

  for (const file of input.repository.inventory) {
    if (excluded.has(file.id)) continue;
    if (
      Buffer.byteLength(file.content, "utf8") >
      input.repository.limits.maxReadBytesPerFile
    )
      continue;
    const sourceLines = file.content.split("\n");
    const hints = file.sectionHints.length
      ? file.sectionHints
      : [
          {
            id: `${file.id}-whole`,
            lineStart: 1,
            lineEnd: sourceLines.length,
            role: file.role,
          },
        ];

    for (const hint of hints) {
      const first = Math.max(1, Math.floor(hint.lineStart));
      const last = Math.min(sourceLines.length, Math.floor(hint.lineEnd));
      if (last < first) continue;

      for (let start = first; start <= last; start += 200) {
        const end = Math.min(last, start + 199);
        const excerpt = sourceLines.slice(start - 1, end).join("\n");
        const bytes = Buffer.byteLength(excerpt, "utf8");
        if (
          bytes > 48 * 1024 ||
          aggregateBytes + bytes > input.repository.limits.maxAggregateReadBytes
        )
          continue;
        aggregateBytes += bytes;
        output.push({
          id: `${hint.id}:${start}-${end}`,
          repositoryId: input.repository.identity.repositoryId,
          commitSha: input.repository.identity.commitSha,
          fileId: file.id,
          path: file.path,
          blobSha: file.blobSha,
          lineStart: start,
          lineEnd: end,
          contentHash: sha256(excerpt),
          excerpt,
          role: hint.role,
          topicHints: [...file.topicHints],
          safety: "safe",
          warnings: [],
          estimatedTokens: estimatedTokens(excerpt),
          sourceBytes: file.byteSize,
        });
      }
    }
  }

  return output.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.lineStart - right.lineStart ||
      left.id.localeCompare(right.id),
  );
}

export function buildReferenceGraph(input: {
  repository: RepositoryInput;
  projectMap: ProjectMap;
  sections: readonly ScreenedSection[];
}): DependencyGraph {
  const eligibleIds = new Set(
    input.projectMap.fileRoles ? Object.keys(input.projectMap.fileRoles) : [],
  );
  const nodes = input.repository.inventory
    .filter((file) => eligibleIds.has(file.id))
    .map((file) => ({
      id: file.id,
      fileId: file.id,
      path: file.path,
      role: file.role,
    }))
    .sort((left, right) => left.fileId.localeCompare(right.fileId));
  const edges: DependencyGraph["edges"] = [];
  const unresolved: DependencyGraph["unresolved"] = [];
  const known = new Set(nodes.map(({ fileId }) => fileId));

  for (const file of input.repository.inventory) {
    if (!known.has(file.id)) continue;
    for (const targetId of file.dependencyIds) {
      if (known.has(targetId))
        edges.push({
          fromFileId: file.id,
          toFileId: targetId,
          kind: "imports",
        });
      else unresolved.push({ fromFileId: file.id, targetId });
    }
  }

  return {
    repositoryId: input.repository.identity.repositoryId,
    commitSha: input.repository.identity.commitSha,
    nodes,
    edges: edges.sort(
      (left, right) =>
        left.fromFileId.localeCompare(right.fromFileId) ||
        left.toFileId.localeCompare(right.toFileId),
    ),
    unresolved: unresolved.sort(
      (left, right) =>
        left.fromFileId.localeCompare(right.fromFileId) ||
        left.targetId.localeCompare(right.targetId),
    ),
  };
}

export function createReferenceAdapter(
  strategy: ReferenceStrategy,
): QualityAdapter {
  return {
    id: strategy,
    version: "1.0.0",
    kind: "reference",
    discover: discoverReferenceProject,
    readSections: readReferenceSections,
    buildGraph: buildReferenceGraph,
    rank({ repository, projectMap, sections, graph }) {
      const byId = new Map(repository.inventory.map((file) => [file.id, file]));
      const scored = sections.map((section) => {
        const file = byId.get(section.fileId);
        const role = section.role;
        const graphLinks = graph.edges.filter(
          (edge) =>
            edge.fromFileId === section.fileId ||
            edge.toFileId === section.fileId,
        ).length;
        const topicSignals = section.topicHints.length;
        let score = 0;
        const components: Record<string, number> = {};

        if (strategy === "static-top-n") {
          score = staticPathScore(section.path);
          components.pathAndCategory = score;
        } else if (strategy === "role-balanced") {
          score = roleWeight(role) + topicSignals * 3 + Math.min(graphLinks, 3);
          components.role = roleWeight(role);
          components.topicSignals = topicSignals * 3;
          components.dependencyLinks = Math.min(graphLinks, 3);
        } else {
          score =
            topicSignals * 20 +
            Math.min(graphLinks, 4) * 2 +
            roleWeight(role) / 10;
          components.capabilitySignals = topicSignals * 20;
          components.dependencyLinks = Math.min(graphLinks, 4) * 2;
          components.evidenceRole = roleWeight(role) / 10;
        }

        return {
          sectionId: section.id,
          fileId: section.fileId,
          score,
          components,
          featureTargets: [...section.topicHints],
          expectedIncrementalCoverage: [...section.topicHints],
          estimatedTokenCost: section.estimatedTokens,
          uncertaintyFlags: file ? [] : ["inventory-file-unavailable"],
          reason: reasonFor(strategy, role, topicSignals, graphLinks),
        } satisfies RankedCandidate;
      });

      return scored.sort(
        (left, right) =>
          right.score - left.score ||
          left.fileId.localeCompare(right.fileId) ||
          left.sectionId.localeCompare(right.sectionId),
      );
    },
    select({ repository, projectMap, sections, rankedCandidates }) {
      const byId = new Map(sections.map((section) => [section.id, section]));
      const chosen: ScreenedSection[] = [];
      const chosenFiles = new Set<string>();
      const chosenTopics = new Set<string>();
      let tokens = 0;
      let bytes = 0;
      let lines = 0;

      const fits = (section: ScreenedSection) => {
        if (chosenFiles.has(section.fileId)) return false;
        const sectionBytes = Buffer.byteLength(section.excerpt, "utf8");
        const sectionLines = lineCount(section.excerpt);
        return (
          chosen.length < repository.limits.maxFiles &&
          tokens + section.estimatedTokens <= repository.limits.maxTokens &&
          bytes + sectionBytes <= repository.limits.maxSelectedBytes &&
          lines + sectionLines <= repository.limits.maxLines &&
          chosen.length < repository.limits.maxRequests
        );
      };
      const add = (entry: RankedCandidate | undefined) => {
        if (!entry) return;
        const section = byId.get(entry.sectionId);
        if (!section || section.safety !== "safe" || !fits(section)) return;
        chosen.push(section);
        chosenFiles.add(section.fileId);
        for (const topic of section.topicHints) chosenTopics.add(topic);
        tokens += section.estimatedTokens;
        bytes += Buffer.byteLength(section.excerpt, "utf8");
        lines += lineCount(section.excerpt);
      };

      if (strategy === "role-balanced") {
        const roleTargets: Array<[EvidenceRole, number]> = [
          ["overview", 0.15],
          ["implementation", 0.7],
          ["verification", 0.15],
        ];
        for (const [role, share] of roleTargets) {
          const target = Math.max(
            1,
            Math.floor(repository.limits.maxTokens * share),
          );
          const startTokens = tokens;
          for (const entry of rankedCandidates.filter(
            (candidate) => byId.get(candidate.sectionId)?.role === role,
          )) {
            if (tokens - startTokens >= target) break;
            add(entry);
          }
        }
        for (const entry of rankedCandidates) add(entry);
      } else if (strategy === "marginal-coverage") {
        const remaining = [...rankedCandidates];
        while (remaining.length > 0) {
          let bestIndex = -1;
          let bestValue = Number.NEGATIVE_INFINITY;
          for (let index = 0; index < remaining.length; index += 1) {
            const entry = remaining[index];
            const section = byId.get(entry.sectionId);
            if (!section || !fits(section)) continue;
            const newTopics = section.topicHints.filter(
              (topic) => !chosenTopics.has(topic),
            ).length;
            const roleBonus = chosen.some(({ role }) => role === section.role)
              ? 0
              : 0.2;
            const overviewBonus =
              section.role === "overview" &&
              !chosen.some(({ role }) => role === "overview")
                ? 0.5
                : 0;
            const verificationBonus =
              section.role === "verification" ? 0.15 : 0;
            const tokenCost = Math.max(1, section.estimatedTokens);
            const value =
              (newTopics + roleBonus + overviewBonus + verificationBonus) /
              tokenCost;
            if (
              value > bestValue ||
              (value === bestValue &&
                entry.sectionId.localeCompare(
                  remaining[bestIndex]?.sectionId ?? "",
                ) < 0)
            ) {
              bestIndex = index;
              bestValue = value;
            }
          }
          if (bestIndex < 0 || bestValue <= 0) break;
          add(remaining[bestIndex]);
          remaining.splice(bestIndex, 1);
        }
      } else {
        for (const entry of rankedCandidates) add(entry);
      }

      const ordered = [...chosen].sort(
        (left, right) =>
          left.path.localeCompare(right.path) ||
          left.lineStart - right.lineStart,
      );
      const payload = ordered
        .map(({ id, contentHash }) => `${id}:${contentHash}`)
        .join("|");
      return {
        repositoryId: repository.identity.repositoryId,
        commitSha: repository.identity.commitSha,
        selectionId: `selection-${sha256(payload).slice(0, 20)}`,
        sections: ordered,
        selectedFileIds: [
          ...new Set(ordered.map(({ fileId }) => fileId)),
        ].sort(),
        coveredFeatureHints: [
          ...new Set(ordered.flatMap(({ topicHints }) => topicHints)),
        ].sort(),
        limitations: projectMap.capabilitySuggestions.length
          ? []
          : ["No capability hints were discovered."],
        budget: {
          selectedTokens: tokens,
          selectedBytes: bytes,
          selectedLines: lines,
          simulatedRequests: chosenFiles.size,
        },
      };
    },
  };
}

export function sectionRoleFromPath(path: string): EvidenceRole {
  if (/^(?:README|ARCHITECTURE|CONTRIBUTING)(?:\.|$)/iu.test(path))
    return "overview";
  if (
    /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|\.)|\.(?:test|spec)\.[^.]+$/iu.test(
      path,
    )
  )
    return "verification";
  if (
    /(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|tsconfig[^/]*|vite\.config\.[^/]+)$/iu.test(
      path,
    )
  )
    return "configuration";
  if (
    /(?:^|\/)(?:app|pages|routes?)(?:\/|$)|(?:^|\/)(?:page|route)\.[^.]+$/iu.test(
      path,
    )
  )
    return "wrapper";
  if (/^docs\//iu.test(path)) return "documentation";
  return "implementation";
}

function packageRootFor(path: string): string {
  const segments = path.split("/");
  return (segments[0] === "apps" || segments[0] === "packages") &&
    segments.length > 1
    ? segments.slice(0, 2).join("/")
    : "";
}

function staticPathScore(path: string): number {
  let score = 0;
  if (/(?:^|\/)(?:app|pages|routes?)(?:\/|$)/iu.test(path)) score += 30;
  if (
    /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|\.)|\.(?:test|spec)\.[^.]+$/iu.test(
      path,
    )
  )
    score += 25;
  if (/(?:page|route|index)\.[^.]+$/iu.test(path)) score += 18;
  if (/^docs\//iu.test(path)) score += 8;
  if (/^(?:README|package\.json)/iu.test(path)) score += 12;
  if (/^src\//iu.test(path)) score += 5;
  return score;
}

function roleWeight(role: EvidenceRole): number {
  switch (role) {
    case "implementation":
      return 30;
    case "overview":
      return 18;
    case "verification":
      return 15;
    case "configuration":
      return 12;
    case "supporting":
      return 8;
    case "documentation":
      return 6;
    case "wrapper":
      return 4;
  }
}

function reasonFor(
  strategy: ReferenceStrategy,
  role: EvidenceRole,
  topics: number,
  links: number,
): string {
  if (strategy === "static-top-n")
    return "Fixed path/category score with stable lexical tie-break.";
  if (strategy === "role-balanced")
    return `Role ${role}; ${topics} topic signal(s); ${links} dependency link(s).`;
  return `Marginal topic coverage and dependency signal for role ${role}.`;
}
