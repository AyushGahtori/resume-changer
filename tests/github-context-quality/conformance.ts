import {
  estimatedTokens,
  lineCount,
  sha256,
  type DependencyGraph,
  type EvidenceBundle,
  type ProjectMap,
  type RankedCandidate,
  type RepositoryInput,
  type ScreenedSection,
} from "./contracts";

export interface PipelineOutput {
  projectMap: ProjectMap;
  sections: ScreenedSection[];
  graph: DependencyGraph;
  rankedCandidates: RankedCandidate[];
  bundle: EvidenceBundle;
}

export function inspectConformance(
  repository: RepositoryInput,
  output: PipelineOutput,
): string[] {
  const errors: string[] = [];
  const inventoryById = new Map(
    repository.inventory.map((file) => [file.id, file]),
  );
  const sectionById = new Map(
    output.sections.map((section) => [section.id, section]),
  );
  const map = output.projectMap;

  if (
    map.repositoryId !== repository.identity.repositoryId ||
    map.commitSha !== repository.identity.commitSha
  )
    errors.push("discover returned the wrong repository revision");
  if (map.packages.length === 0)
    errors.push("discover returned no package/root boundary");
  if (Object.keys(map.fileRoles).length === 0)
    errors.push("discover returned no file roles");
  if (
    Object.keys(map.fileRoles).some(
      (id) => !inventoryById.has(id) || !inventoryById.get(id)?.safe,
    )
  )
    errors.push("discover assigned a role to an unknown or unsafe file");
  if (map.overviewCandidateIds.some((id) => !inventoryById.has(id)))
    errors.push("discover referenced an unknown overview file");
  if (map.entrypointCandidateIds.some((id) => !inventoryById.has(id)))
    errors.push("discover referenced an unknown entrypoint");
  if (map.excludedFileIds.some((id) => !inventoryById.has(id)))
    errors.push("discover referenced an unknown excluded file");
  if (
    repository.inventory.some(
      (file) => !file.safe && !map.excludedFileIds.includes(file.id),
    )
  )
    errors.push("discover failed to exclude an unsafe file");
  if (map.excludedFileIds.some((id) => inventoryById.get(id)?.safe))
    errors.push("discover excluded a safe file");
  if (
    map.packages.some(
      (pkg) =>
        pkg.fileIds.length === 0 ||
        pkg.fileIds.some(
          (id) => !inventoryById.has(id) || map.excludedFileIds.includes(id),
        ),
    )
  )
    errors.push(
      "discover returned an empty package or an invalid package member",
    );
  if (
    map.capabilitySuggestions.some(
      (suggestion) =>
        suggestion.sourceFileIds.length === 0 ||
        suggestion.sourceFileIds.some(
          (id) => !inventoryById.has(id) || map.excludedFileIds.includes(id),
        ),
    )
  )
    errors.push(
      "discover returned a capability suggestion with an invalid source",
    );

  if (output.sections.length === 0)
    errors.push("readSections returned no screened sections");
  if (
    new Set(output.sections.map(({ id }) => id)).size !== output.sections.length
  )
    errors.push("readSections returned duplicate section IDs");
  let sectionBytes = 0;
  for (const section of output.sections) {
    const file = inventoryById.get(section.fileId);
    if (!file) {
      errors.push("readSections referenced a file outside the inventory");
      continue;
    }
    if (!file.safe || section.safety !== "safe")
      errors.push("readSections exposed an excluded or unsafe file");
    if (
      section.repositoryId !== repository.identity.repositoryId ||
      section.commitSha !== repository.identity.commitSha
    )
      errors.push("readSections lost repository/revision provenance");
    if (section.path !== file.path || section.blobSha !== file.blobSha)
      errors.push("readSections changed source path or blob identity");
    if (
      section.lineStart < 1 ||
      section.lineEnd < section.lineStart ||
      section.lineEnd > lineCount(file.content)
    )
      errors.push("readSections returned an invalid source range");
    else if (!matchesSourceRange(file.content, section))
      errors.push(
        "readSections excerpt does not match its declared source range",
      );
    if (section.contentHash !== sha256(section.excerpt))
      errors.push("readSections returned a mismatched excerpt hash");
    if (section.estimatedTokens !== estimatedTokens(section.excerpt))
      errors.push("readSections token estimate is inconsistent");
    sectionBytes += Buffer.byteLength(section.excerpt, "utf8");
  }
  if (sectionBytes > repository.limits.maxAggregateReadBytes)
    errors.push("readSections exceeded the aggregate retained-text cap");

  if (
    output.graph.repositoryId !== repository.identity.repositoryId ||
    output.graph.commitSha !== repository.identity.commitSha
  )
    errors.push("buildGraph returned the wrong repository revision");
  const nodeIds = output.graph.nodes.map(({ fileId }) => fileId);
  if (new Set(nodeIds).size !== nodeIds.length)
    errors.push("buildGraph returned duplicate nodes");
  if (
    nodeIds.some(
      (id) => !inventoryById.has(id) || map.excludedFileIds.includes(id),
    )
  )
    errors.push("buildGraph included an unknown or excluded file");
  if (nodeIds.some((id) => !inventoryById.get(id)?.safe))
    errors.push("buildGraph included an unsafe file");
  const knownNodes = new Set(nodeIds);
  if (
    output.graph.edges.some(
      (edge) =>
        !knownNodes.has(edge.fromFileId) || !knownNodes.has(edge.toFileId),
    )
  )
    errors.push("buildGraph returned an edge without two known endpoints");
  if (output.graph.unresolved.some((edge) => !knownNodes.has(edge.fromFileId)))
    errors.push(
      "buildGraph returned an unresolved edge with an unknown source",
    );

  if (output.rankedCandidates.length === 0)
    errors.push("rank returned no candidates");
  const rankedIds = output.rankedCandidates.map(({ sectionId }) => sectionId);
  if (new Set(rankedIds).size !== rankedIds.length)
    errors.push("rank returned duplicate candidate IDs");
  for (const candidate of output.rankedCandidates) {
    if (!sectionById.has(candidate.sectionId))
      errors.push("rank referenced a section outside reader output");
    if (!Number.isFinite(candidate.score))
      errors.push("rank returned a non-finite score");
    if (
      !candidate.reason.trim() ||
      Object.keys(candidate.components).length === 0
    )
      errors.push("rank omitted an explanation or named score components");
    if (
      Object.values(candidate.components).some(
        (value) => !Number.isFinite(value),
      ) ||
      candidate.estimatedTokenCost < 0
    )
      errors.push("rank returned an invalid score component or token cost");
    if (
      candidate.expectedIncrementalCoverage.some(
        (id) => !candidate.featureTargets.includes(id),
      )
    )
      errors.push(
        "rank reported incremental coverage outside its feature targets",
      );
  }

  const bundle = output.bundle;
  if (
    bundle.repositoryId !== repository.identity.repositoryId ||
    bundle.commitSha !== repository.identity.commitSha
  )
    errors.push("select returned the wrong repository revision");
  if (!bundle.selectionId.trim())
    errors.push("select returned no deterministic selection identity");
  if (bundle.sections.length === 0)
    errors.push("select returned an empty bundle for a non-empty fixture");
  if (
    new Set(bundle.sections.map(({ id }) => id)).size !== bundle.sections.length
  )
    errors.push("select returned duplicate section IDs");
  const selectedIds = [
    ...new Set(bundle.sections.map(({ fileId }) => fileId)),
  ].sort();
  if (
    JSON.stringify(selectedIds) !==
    JSON.stringify([...bundle.selectedFileIds].sort())
  )
    errors.push("select file IDs do not match its selected sections");
  const rankedSet = new Set(rankedIds);
  for (const section of bundle.sections) {
    const file = inventoryById.get(section.fileId);
    if (!file || !file.safe)
      errors.push("select exposed an unknown or unsafe source");
    if (section.safety !== "safe")
      errors.push("select exposed a section that was not screened safe");
    if (
      section.repositoryId !== repository.identity.repositoryId ||
      section.commitSha !== repository.identity.commitSha
    )
      errors.push("select lost source repository/revision provenance");
    if (
      file &&
      (section.path !== file.path || section.blobSha !== file.blobSha)
    )
      errors.push("select changed source path or blob identity");
    if (section.contentHash !== sha256(section.excerpt))
      errors.push("select returned a mismatched excerpt hash");
    if (
      section.lineStart < 1 ||
      section.lineEnd < section.lineStart ||
      (file && section.lineEnd > lineCount(file.content))
    )
      errors.push("select returned an invalid source range");
    else if (file && !matchesSourceRange(file.content, section))
      errors.push("select excerpt does not match its declared source range");
    if (!rankedSet.has(section.id) && !section.id.startsWith("baseline:"))
      errors.push("select returned a section with no ranked/reader identity");
  }

  const selectedLines = bundle.sections.reduce(
    (sum, section) => sum + section.lineEnd - section.lineStart + 1,
    0,
  );
  const selectedBytes = bundle.sections.reduce(
    (sum, section) => sum + Buffer.byteLength(section.excerpt, "utf8"),
    0,
  );
  const selectedTokens = bundle.sections.reduce(
    (sum, section) => sum + estimatedTokens(section.excerpt),
    0,
  );
  if (bundle.selectedFileIds.length > repository.limits.maxFiles)
    errors.push("select exceeded the selected file cap");
  if (
    selectedLines > repository.limits.maxLines ||
    bundle.budget.selectedLines > repository.limits.maxLines
  )
    errors.push("select exceeded the selected line cap");
  if (
    selectedBytes > repository.limits.maxSelectedBytes ||
    bundle.budget.selectedBytes > repository.limits.maxSelectedBytes
  )
    errors.push("select exceeded the selected byte cap");
  if (
    selectedTokens > repository.limits.maxTokens ||
    bundle.budget.selectedTokens > repository.limits.maxTokens
  )
    errors.push("select exceeded the selected token cap");
  if (bundle.budget.simulatedRequests > repository.limits.maxRequests)
    errors.push("select exceeded the simulated request cap");
  if (
    bundle.budget.selectedTokens !== selectedTokens ||
    bundle.budget.selectedBytes !== selectedBytes ||
    bundle.budget.selectedLines !== selectedLines
  )
    errors.push("select budget summary does not match its bundle");

  return [...new Set(errors)];
}

function matchesSourceRange(source: string, section: ScreenedSection): boolean {
  return (
    source
      .split("\n")
      .slice(section.lineStart - 1, section.lineEnd)
      .join("\n") === section.excerpt
  );
}
