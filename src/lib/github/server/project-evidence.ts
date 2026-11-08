import { createHash } from "node:crypto";
import { discoverProjectMap } from "../context-discovery";
import {
  createContextSectionReader,
  type ContextSection,
} from "../context-sections";
import {
  buildDependencyGraph,
  rankCandidates,
  type ProjectMap,
  type ScreenedSection,
  type RankingContext,
} from "../context-ranking";
import { allocateEvidenceBundle, type EvidenceBundle } from "../context-bundle";
import {
  classifyPath,
  EVIDENCE_LIMITS,
  getPathExclusionReason,
  sha256,
  type FileCandidate,
  type Result,
} from "./file-policy-core";
import type {
  EvidenceDimension,
  EvidenceExecutionContext,
  PreparedEvidence,
  RepositoryScope,
  SelectionPlan,
} from "./selector-core";
import { evidenceReadiness } from "./evidence-readiness";

export const PROJECT_EVIDENCE_VERSION = "project-evidence-v1";

export interface ProjectEvidenceInput {
  plan: SelectionPlan;
  inventory: readonly FileCandidate[];
  context: EvidenceExecutionContext;
  authorize(): Promise<boolean>;
  readFile(
    candidate: FileCandidate,
  ): Promise<Result<{ text: string; blobSha: string; byteSize: number }>>;
}

function intent(path: string): ContextSection["role"] {
  const category = classifyPath(path);
  return category === "purpose"
    ? "overview"
    : category === "stack"
      ? "configuration"
      : category === "corroboration"
        ? "verification"
        : "implementation";
}

const MANIFEST_BASENAMES = new Set([
  "androidmanifest.xml",
  "build.gradle",
  "build.gradle.kts",
  "cargo.toml",
  "go.mod",
  "go.work",
  "lerna.json",
  "package.json",
  "pnpm-workspace.yaml",
  "pom.xml",
  "pyproject.toml",
  "requirements.txt",
  "settings.gradle",
  "settings.gradle.kts",
  "setup.cfg",
  "setup.py",
]);
const IMPLEMENTATION_READ_RESERVE = 2;

function basename(path: string): string {
  return path.split("/").at(-1)?.toLowerCase() ?? "";
}

function isManifestPath(path: string): boolean {
  return MANIFEST_BASENAMES.has(basename(path));
}

function isOverviewPath(path: string): boolean {
  return /^readme(?:\.[a-z0-9_-]+)*$/iu.test(basename(path));
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/** Keep overview, implementation, and pinned files from losing the shared read budget to manifests. */
function planSharedReads(input: {
  files: readonly FileCandidate[];
  pinnedPaths: readonly string[];
  hintPaths: readonly string[];
  repositoryName: string;
  preferredPaths: readonly string[];
}): { reserved: Set<string>; allowedManifests: Set<string> } {
  const paths = input.files.map((file) => file.path);
  const pathSet = new Set(paths);
  const pinned = input.pinnedPaths.filter((path) => pathSet.has(path));
  const nameTerms = input.repositoryName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((term) => term.replace(/(?:ing|ed|s)$/u, ""))
    .filter((term) => term.length >= 5);
  const nameMatches = (path: string) =>
    nameTerms.some((term) => basename(path).includes(term));
  const preferredRank = new Map(
    input.preferredPaths.map((path, index) => [path, index]),
  );
  const overview = paths
    .filter(isOverviewPath)
    .sort(
      (left, right) =>
        left.split("/").length - right.split("/").length ||
        left.localeCompare(right),
    )[0];
  const implementations = paths
    .filter(
      (path) => intent(path) === "implementation" && !isManifestPath(path),
    )
    .sort((left, right) => {
      const pinnedRank =
        Number(pinned.includes(right)) - Number(pinned.includes(left));
      return (
        pinnedRank ||
        Number(nameMatches(right)) - Number(nameMatches(left)) ||
        (preferredRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (preferredRank.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.split("/").length - right.split("/").length ||
        left.localeCompare(right)
      );
    })
    .slice(0, IMPLEMENTATION_READ_RESERVE);
  const reserved = new Set(
    [...pinned, ...(overview ? [overview] : []), ...implementations].filter(
      (path) => pathSet.has(path),
    ),
  );
  const rank = (path: string) => {
    if (reserved.has(path)) return 0;
    if (directoryOf(path) === "") return 1;
    if (
      input.hintPaths.some((hint) => {
        const directory = directoryOf(path);
        return hint === directory || hint.startsWith(`${directory}/`);
      })
    )
      return 2;
    return 3;
  };
  const manifests = paths
    .filter(isManifestPath)
    .sort(
      (left, right) => rank(left) - rank(right) || left.localeCompare(right),
    );
  const extraSlots = Math.max(
    0,
    EVIDENCE_LIMITS.maxFetchedFiles - reserved.size,
  );
  const allowedManifests = new Set(
    manifests
      .filter((path) => reserved.has(path))
      .concat(
        manifests.filter((path) => !reserved.has(path)).slice(0, extraSlots),
      ),
  );
  return { reserved, allowedManifests };
}

/** Inventory groups are retrieval hints, never product facts or ownership proof. */
function area(path: string): string {
  const clean = path.replace(/^(?:tests?\/)(?:unit\/|e2e\/)?/, "src/");
  const match = clean.match(/^(.*?\/(?:lib|services|features|modules)\/[^/]+)/);
  return (
    match?.[1] ?? (clean.split("/").slice(0, -1).join("/") || "implementation")
  );
}

export function rankProjectSections(input: {
  scope: RepositoryScope;
  inventory: readonly FileCandidate[];
  sections: readonly ContextSection[];
  map: Pick<ProjectMap, "aliases" | "packageBoundaries">;
  pinnedFileIds?: readonly string[];
}) {
  const groups = [
    ...new Set(
      input.inventory
        .filter((f) => intent(f.path) === "implementation")
        .map((f) => area(f.path)),
    ),
  ];
  const features = groups.slice(0, 100).map((path, i) => ({
    id: `area-${i}`,
    status: "suggested" as const,
    sourcePaths: input.inventory
      .filter((f) => area(f.path) === path)
      .map((f) => f.path),
  }));
  const featureForPath = (path: string) =>
    features.filter((f) => f.sourcePaths.includes(path)).map((f) => f.id);
  const pinnedPaths = new Set(
    input.inventory
      .filter((f) => input.pinnedFileIds?.includes(f.id))
      .map((f) => f.path),
  );
  const sections: ScreenedSection[] = input.sections.map((s) => ({
    id: s.id,
    path: s.path,
    lineStart: s.lineStart,
    lineEnd: s.lineEnd,
    excerpt: s.excerpt,
    estimatedTokens: Math.ceil(s.excerpt.length / 2),
    role: s.role,
    featureTargets: featureForPath(s.path),
    provenance: {
      repositoryId: s.repositoryId,
      commitSha: s.commitSha,
      blobSha: s.blobSha,
      status:
        s.evidenceStatus === "documented" || s.evidenceStatus === "planned"
          ? "documented"
          : "observed",
    },
    safety: { eligible: true, screening: "safe" },
    userPinned: pinnedPaths.has(s.path),
  }));
  const projectMap: ProjectMap = {
    repository: {
      repositoryId: input.scope.repositoryId,
      commitSha: input.scope.fullSha,
    },
    featureAreas: features,
    knownPaths: input.inventory.map((f) => f.path),
    ...input.map,
  };
  const graph = buildDependencyGraph(projectMap, sections);
  const mode = input.scope.projectContext?.ownership?.value;
  const context: RankingContext = {
    scope: {
      mode:
        mode === "selected-areas" || mode === "shared" || mode === "unsure"
          ? mode
          : "whole-project",
      paths: input.scope.selectedPaths ?? [],
      source: "user-reported",
    },
  };
  const ranked = rankCandidates({ projectMap, sections, graph, context });
  return { graph, ranked, features, sections };
}

/** Production assembly: all discovery and dependency reads share the existing transport ledger. */
export async function prepareProjectEvidence(
  input: ProjectEvidenceInput,
): Promise<Result<{ prepared: PreparedEvidence; bundle: EvidenceBundle }>> {
  const { plan, context } = input;
  const scope = plan.scope;
  const safe = input.inventory.filter(
    (f) =>
      !plan.removedFileIds.includes(f.id) &&
      !getPathExclusionReason(f) &&
      f.byteSize <= EVIDENCE_LIMITS.maxFileBytes,
  );
  const byPath = new Map(safe.map((f) => [f.path, f]));
  const pinnedPaths = plan.rankedCandidates
    .filter((item) => item.pinned)
    .map((item) => item.candidate.path);
  const { reserved, allowedManifests } = planSharedReads({
    files: safe,
    pinnedPaths,
    repositoryName: scope.name,
    preferredPaths: plan.rankedCandidates.map((item) => item.candidate.path),
    hintPaths: [
      ...pinnedPaths,
      ...(scope.selectedPaths ?? []),
      ...safe
        .filter((file) => intent(file.path) === "implementation")
        .map((file) => file.path),
    ],
  });
  const loaded = new Map<
    string,
    { text: string; blobSha: string; byteSize: number }
  >();
  const failed = new Set<string>();
  let fetchedBytes = 0;
  let readFailure: Result<never> | undefined;
  async function read(path: string) {
    if (
      context.signal?.aborted ||
      (context.deadlineAt &&
        context.clock().getTime() >= Date.parse(context.deadlineAt))
    )
      return undefined;
    if (!(await input.authorize())) return undefined;
    if (loaded.has(path)) return loaded.get(path);
    const file = byPath.get(path);
    const used = loaded.size + failed.size;
    const unreadReserved = [...reserved].filter(
      (item) => item !== path && !loaded.has(item) && !failed.has(item),
    ).length;
    const reserveIsFull =
      !reserved.has(path) &&
      used + unreadReserved >= EVIDENCE_LIMITS.maxFetchedFiles;
    if (
      !file ||
      failed.has(path) ||
      used >= EVIDENCE_LIMITS.maxFetchedFiles ||
      reserveIsFull ||
      (isManifestPath(path) && !allowedManifests.has(path)) ||
      fetchedBytes + file.byteSize > EVIDENCE_LIMITS.maxFetchedBytes
    )
      return undefined;
    const result = await input.readFile(file);
    if (!result.ok) {
      failed.add(path);
      if (
        result.error.retryable ||
        result.error.code === "forbidden" ||
        result.error.code === "cancelled"
      )
        readFailure = result;
      return undefined;
    }
    const bytes = Buffer.from(result.value.text);
    const hash = createHash(file.blobSha.length === 64 ? "sha256" : "sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (
      hash !== file.blobSha ||
      bytes.length > EVIDENCE_LIMITS.maxFileBytes ||
      (file.byteSize > 0 && bytes.length !== file.byteSize)
    ) {
      failed.add(path);
      return undefined;
    }
    fetchedBytes += bytes.length;
    loaded.set(path, result.value);
    return result.value;
  }
  const repository = {
    repositoryId: scope.repositoryId,
    owner: scope.owner,
    name: scope.name,
    commitSha: scope.fullSha,
  };
  const discovery = await discoverProjectMap({
    repository: { ...repository, repositoryId: Number(scope.repositoryId) },
    inventory: {
      snapshotId: plan.snapshotId,
      repositoryId: Number(scope.repositoryId),
      commitSha: scope.fullSha,
      packagePath: scope.packagePath,
      packages: [],
      projectTypes: [],
      files: safe.map((f) => ({
        path: f.path,
        blobSha: f.blobSha,
        mode: f.mode,
        sizeBytes: f.byteSize,
        eligibility: "automatic",
        safetyFlags: [],
      })),
    },
    reader: {
      async read(request) {
        const file = await read(request.path);
        return file
          ? {
              ok: true,
              text: file.text,
              blobSha: file.blobSha,
              bytesRead: file.byteSize,
              truncated: false,
            }
          : { ok: false, reason: "over-budget" };
      },
    },
  });
  if (!discovery.ok)
    return {
      ok: false,
      error: {
        code: "invalid-evidence",
        message: "Project discovery failed for this pinned inventory.",
        retryable: false,
      },
    };
  if (readFailure) return readFailure;
  const map: Pick<ProjectMap, "aliases" | "packageBoundaries"> = {
    aliases: discovery.value.aliases.map((a) => ({
      ...a,
      basePath: a.configPath.split("/").slice(0, -1).join("/"),
      packageRoot: "",
    })),
    packageBoundaries: discovery.value.packages.length
      ? discovery.value.packages.map((p) => ({
          root: p.path,
          name: p.packageName ?? undefined,
          entrypoints: p.entrypointPaths,
        }))
      : [{ root: "" }],
  };
  const reader = createContextSectionReader(
    {
      isAuthorized: () => input.authorize(),
      async openPinnedBlob(request) {
        const file = await read(request.file.path);
        if (!file || file.byteSize > request.maxBytes)
          throw new Error("Source unavailable within the shared read budget.");
        return {
          repositoryId: scope.repositoryId,
          commitSha: scope.fullSha,
          path: request.file.path,
          blobSha: file.blobSha,
          body: (async function* () {
            yield Buffer.from(file.text);
          })(),
        };
      },
    },
    { now: () => context.clock().getTime() },
  );
  const sections: ContextSection[] = [];
  const visited = new Set<string>();
  const limitations: string[] = [];
  const seedPaths = [
    ...reserved,
    ...pinnedPaths,
    ...discovery.value.overviewCandidates
      .filter((c) => c.status === "candidate")
      .slice(0, 2)
      .map((c) => c.path),
    ...loaded.keys(),
    ...plan.selectedFiles.map((f) => f.candidate.path),
  ];
  const queue = [...new Set(seedPaths)];
  while (queue.length && visited.size < EVIDENCE_LIMITS.maxFetchedFiles) {
    const path = queue.shift()!;
    const file = byPath.get(path);
    if (!file || visited.has(path)) continue;
    visited.add(path);
    const result = await reader.readSections({
      repository,
      file: {
        fileId: file.id,
        path: file.path,
        blobSha: file.blobSha,
        mode: file.mode,
        ...(file.byteSize > 0 ? { byteSize: file.byteSize } : {}),
      },
      context: {
        authorizationNamespace: context.runId,
        signal: context.signal ?? new AbortController().signal,
        deadlineEpochMs: context.deadlineAt
          ? Date.parse(context.deadlineAt)
          : context.clock().getTime() + 60_000,
      },
      intent: intent(path),
      relevanceTerms: scope.contributionStatement
        ?.split(/\W+/)
        .filter((t) => t.length > 3),
      budget: { maxFileBytes: EVIDENCE_LIMITS.maxFileBytes },
    });
    if (!result.ok) {
      limitations.push(
        `Source sections unavailable: ${path} (${result.error.code}).`,
      );
      continue;
    }
    sections.push(...result.sections);
    // Static imports are parsed from a bounded source view, even when the selected
    // declaration doesn't contain its file's imports. This view is never transmitted.
    const ranked = rankProjectSections({
      scope,
      inventory: safe,
      sections: [
        ...sections,
        ...[...loaded].map(([p, f]) => ({
          id: `graph-${sha256(p).slice(0, 24)}`,
          repositoryId: scope.repositoryId,
          commitSha: scope.fullSha,
          path: p,
          blobSha: f.blobSha,
          contentHash: sha256(f.text),
          lineStart: 1,
          lineEnd: f.text.split("\n").length,
          excerpt: f.text,
          role: intent(p),
          kind: "file" as const,
          evidenceStatus: "source" as const,
          completeness: "complete" as const,
          warnings: [],
          dependencyHints: [],
          byteSize: f.byteSize,
          estimatedTokens: Math.ceil(f.text.length / 2),
          score: 0,
        })),
      ],
      map,
    });
    const targets = ranked.graph.edges
      .filter((e) => e.fromPath === path && e.toPath && !visited.has(e.toPath))
      .map((e) => e.toPath!);
    // Follow a wrapper's implementation before paying for another route wrapper.
    queue.unshift(
      ...targets.filter((p) => byPath.has(p) && intent(p) === "implementation"),
    );
  }
  if (readFailure) return readFailure;
  if (context.signal?.aborted || !(await input.authorize()))
    return {
      ok: false,
      error: {
        code: context.signal?.aborted ? "cancelled" : "forbidden",
        message: "Project preparation was cancelled or access was revoked.",
        retryable: false,
      },
    };
  const ranking = rankProjectSections({
    scope,
    inventory: safe,
    sections,
    map,
  });
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const pinnedIds = new Set(
    plan.rankedCandidates.filter((c) => c.pinned).map((c) => c.candidate.id),
  );
  const pinnedSections = new Set<string>();
  for (const id of pinnedIds) {
    const path = safe.find((f) => f.id === id)?.path;
    const section = ranking.ranked.rankedCandidates.find(
      (c) => c.path === path,
    );
    if (section) pinnedSections.add(section.sectionId);
  }
  for (const path of reserved) {
    const section = ranking.ranked.rankedCandidates.find(
      (candidate) => candidate.path === path,
    );
    if (section) pinnedSections.add(section.sectionId);
  }
  const bundle = allocateEvidenceBundle({
    repositoryId: scope.repositoryId,
    commitSha: scope.fullSha,
    candidates: ranking.ranked.rankedCandidates.map((c) => {
      const s = sectionById.get(c.sectionId)!;
      return {
        id: c.sectionId,
        section: {
          id: s.id,
          source: {
            repositoryId: s.repositoryId,
            commitSha: s.commitSha,
            path: s.path,
            blobSha: s.blobSha,
            startLine: s.lineStart,
            endLine: s.lineEnd,
            excerptSha256: sha256(s.excerpt),
          },
          excerpt: s.excerpt,
          screeningResult: "passed" as const,
          warnings: [...s.warnings],
        },
        role:
          c.role === "verification"
            ? ("verification" as const)
            : c.role === "implementation"
              ? ("implementation" as const)
              : ("overview" as const),
        featureIds: [...c.coveredFeatureIds],
        rankScore: Math.max(0, Math.min(100, c.totalScore)),
        expectedIncrementalCoverage: Math.min(1, c.expectedIncrementalCoverage),
        tokenCost: Math.max(1, c.estimatedTokenCost),
        eligible: true,
        safety: "safe" as const,
        pinned: pinnedSections.has(s.id),
        isTestEvidence: c.role === "verification",
        isWrapper:
          ranking.graph.nodes.find((n) => n.path === s.path)?.isThinWrapper ??
          false,
        duplicateGroupIds: [],
        uncertaintyFlags:
          s.evidenceStatus === "planned" ? ["planning-document"] : [],
      };
    }),
    features: ranking.features.map((f) => ({
      id: f.id,
      label: f.sourcePaths[0] ? area(f.sourcePaths[0]) : f.id,
      critical: false,
      weight: 1,
    })),
    context: {
      mode: "whole-project",
      confirmedContributionFeatureIds: [],
      testingContributionConfirmed: /test|qa|quality/i.test(scope.role ?? ""),
    },
    budget: {
      maxTokens: 12_000,
      maxFiles: EVIDENCE_LIMITS.maxFilesPerRequest,
      maxSections: 300,
      maxLinesPerFile: EVIDENCE_LIMITS.maxLinesPerFile,
      maxTotalLines: EVIDENCE_LIMITS.maxLinesPerRequest,
      maxCharsPerFile: EVIDENCE_LIMITS.maxCharsPerFile,
      maxTotalChars: 24_000,
    },
  });
  const evidence = bundle.selectedSections.map((s) => ({
    id: `evidence-${sha256(s.candidateId).slice(0, 24)}`,
    snapshotId: plan.snapshotId,
    repositoryId: scope.repositoryId,
    fullSha: scope.fullSha,
    path: s.section.source.path,
    blobSha: s.section.source.blobSha,
    lineStart: s.section.source.startLine,
    lineEnd: s.section.source.endLine,
    excerpt: s.section.excerpt,
    excerptHash: s.section.source.excerptSha256,
    category: classifyPath(s.section.source.path),
    reasonCodes: [PROJECT_EVIDENCE_VERSION, s.role],
    sourceClassification: (s.role === "overview"
      ? "documented"
      : "observed") as "documented" | "observed",
    untrustedSource: true,
    alternateOrigins: [],
  }));
  const selectedFileIds = [
    ...new Set(evidence.map((e) => byPath.get(e.path)!.id)),
  ];
  const missingDimensions: EvidenceDimension[] = [
    ...plan.missingDimensions.filter((d) => d === "attribution"),
  ];
  if (!evidence.some((e) => e.reasonCodes.includes("implementation")))
    missingDimensions.push("method");
  if (!evidence.some((e) => e.reasonCodes.includes("overview")))
    missingDimensions.push("purpose");
  const pinConflicts = [
    ...plan.pinConflicts,
    ...[...pinnedIds]
      .filter((id) => !selectedFileIds.includes(id))
      .map((fileId) => ({ fileId, reasonCode: "pinned-file-not-included" })),
  ];
  const allLimitations = [
    ...new Set([...plan.limitations, ...limitations, ...bundle.limitations]),
  ];
  const prepared: PreparedEvidence = {
    runId: plan.runId,
    snapshotId: plan.snapshotId,
    scope,
    selectedPrContext: plan.selectedPrContext,
    repositoryId: scope.repositoryId,
    fullSha: scope.fullSha,
    selectedFileIds,
    duplicateFileAliases: [],
    evidence,
    excludedFiles: plan.excludedFiles,
    pinConflicts,
    replacementRecommendations: [],
    limitations: allLimitations,
    missingDimensions,
    completeness: evidenceReadiness({
      missingDimensions,
      selectedCount: evidence.length,
      pinConflicts: pinConflicts.length,
      partial: allLimitations.length > 0,
    }),
    fetchedFileCount: loaded.size,
    fetchedBytes,
    uniqueLineCount: evidence.reduce(
      (sum, e) => sum + e.lineEnd - e.lineStart + 1,
      0,
    ),
    transmittedLineCount: 0,
    totalCharacters: evidence.reduce((sum, e) => sum + e.excerpt.length, 0),
    selectionHash: sha256(
      JSON.stringify({
        version: PROJECT_EVIDENCE_VERSION,
        scope,
        bundle: bundle.selectionIdentity,
      }),
    ),
    requiresConsent: true,
  };
  const admission = await context.budgetLedger.checkSelection({
    runId: context.runId,
    requestKind: "initial",
    files: selectedFileIds.map((fileId) => {
      const file = safe.find((f) => f.id === fileId)!;
      const items = evidence.filter((e) => e.path === file.path);
      return {
        fileId,
        path: file.path,
        blobSha: file.blobSha,
        ranges: items.map((e) => ({
          lineStart: e.lineStart,
          lineEnd: e.lineEnd,
        })),
        bytes: items.reduce((n, e) => n + Buffer.byteLength(e.excerpt), 0),
        characters: items.reduce((n, e) => n + e.excerpt.length, 0),
        transmitted: false,
      };
    }),
    uniqueLineCount: prepared.uniqueLineCount,
    transmittedLineCount: 0,
    totalCharacters: prepared.totalCharacters,
    prContextCharacters: 0,
    contextCharacters: JSON.stringify(scope).length,
    estimatedSourceTokens: Math.ceil(prepared.totalCharacters / 2),
    estimatedPrContextTokens: 0,
    estimatedInputTokens: Math.ceil(prepared.totalCharacters / 2),
    totalFetchedBytes: fetchedBytes,
  });
  if (!admission.ok) return admission;
  if (!admission.value.allowed)
    return {
      ok: false,
      error: {
        code: "limit-exceeded",
        message: "The project evidence exceeds the shared preparation budget.",
        retryable: false,
      },
    };
  return { ok: true, value: { prepared, bundle } };
}
