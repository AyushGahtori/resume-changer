import { parseJsonc } from "./jsonc";
import {
  isGeneratedOrVendored,
  isSafeConfigKey,
  normalizeInventoryPath,
  resolveConfigTarget,
  resolveLocalExtends,
} from "./path-safety";
import type {
  AliasMapping,
  BoundedReadFailure,
  BoundedReadResult,
  CapabilitySuggestion,
  ConfigurationCandidate,
  DiscoveryExclusion,
  DiscoveryFile,
  EntrypointCandidate,
  FrameworkSuggestion,
  OverviewCandidate,
  PackageMapEntry,
  ProjectDiscoveryInput,
  ProjectMap,
  ProjectMapIssue,
  ProjectMapResult,
} from "./contracts";

const MAX_INVENTORY_FILES = 10_000;
const MAX_READ_BYTES_PER_FILE = 64 * 1024;
const MAX_READ_ATTEMPTS = 96;
const README_READ_RESERVE = 10;
const MAX_PACKAGES = 500;
const MAX_OVERVIEW_CANDIDATES = 16;
const MAX_ENTRYPOINTS = 128;
const MAX_EXCLUSIONS = 512;
const SHA_PATTERN = /^[a-f0-9]{40}$/iu;
const README_EXTENSIONS = new Set(["", ".md", ".mdx", ".rst", ".txt"]);
const OVERVIEW_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt"]);
const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scala",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);
const CONFIG_KINDS: Readonly<Record<string, ConfigurationCandidate["kind"]>> = {
  "tsconfig.json": "typescript",
  "jsconfig.json": "javascript",
  "pyproject.toml": "python",
  "requirements.txt": "python",
  "setup.cfg": "python",
  "setup.py": "python",
  "go.mod": "go",
  "go.work": "workspace",
  "cargo.toml": "rust",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "java",
  "pnpm-workspace.yaml": "workspace",
  "lerna.json": "workspace",
  "settings.gradle": "workspace",
  "settings.gradle.kts": "workspace",
};
const MANIFEST_NAMES = new Set([
  "package.json",
  "pyproject.toml",
  "setup.cfg",
  "setup.py",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "androidmanifest.xml",
  "pnpm-workspace.yaml",
  "lerna.json",
  "go.work",
  "settings.gradle",
  "settings.gradle.kts",
]);

interface IndexedFile extends DiscoveryFile {
  safePath: string;
}

interface ReadText {
  text: string;
  bytesRead: number;
  blobSha: string;
  truncated: boolean;
}

interface PackageMetadata {
  path: string;
  manifestPaths: string[];
  kind: PackageMapEntry["kind"];
  packageName: string | null;
  description: string | null;
  projectTypes: string[];
  entrypointPaths: string[];
  dependencies: Set<string>;
  workspacePatterns: string[];
}

interface WorkspaceDeclaration {
  path: string;
  patterns: string[];
}

interface AliasParseState {
  aliases: Map<string, AliasMapping[]>;
  failed: boolean;
}

const EMPTY_FILE: Omit<IndexedFile, "path" | "safePath"> = {
  blobSha: null,
  mode: "",
  sizeBytes: null,
  eligibility: "excluded",
  safetyFlags: [],
};

export async function discoverProjectMap(
  input: ProjectDiscoveryInput,
): Promise<ProjectMapResult> {
  const inputError = validateInput(input);
  if (inputError) return inputError;

  const { repository, inventory, reader } = input;
  const issues: ProjectMapIssue[] = [];
  const exclusions: DiscoveryExclusion[] = [];
  const fileIndex = indexInventoryFiles(inventory.files, exclusions);
  const sortedFiles = [...fileIndex.values()].sort((a, b) =>
    compare(a.path, b.path),
  );
  const readCache = new Map<string, BoundedReadResult>();
  let readAttempts = 0;

  const recordIssue = (
    code: ProjectMapIssue["code"],
    path: string | null,
    message: string,
  ): void => {
    if (
      issues.some(
        (issue) =>
          issue.code === code &&
          issue.path === path &&
          issue.message === message,
      )
    ) {
      return;
    }
    issues.push({ code, path, message });
  };

  const safeRead = async (path: string): Promise<BoundedReadResult> => {
    const cached = readCache.get(path);
    if (cached) return cached;
    const file = fileIndex.get(path);
    if (!file || !isEligibleInventoryFile(file)) {
      const result: BoundedReadResult = { ok: false, reason: "unsafe" };
      readCache.set(path, result);
      return result;
    }
    if (file.sizeBytes !== null && file.sizeBytes > MAX_READ_BYTES_PER_FILE) {
      const result: BoundedReadResult = { ok: false, reason: "over-budget" };
      readCache.set(path, result);
      recordIssue(
        "read-failed",
        path,
        "The candidate exceeds the per-file discovery byte limit.",
      );
      return result;
    }
    if (!file.blobSha || !SHA_PATTERN.test(file.blobSha)) {
      const result: BoundedReadResult = {
        ok: false,
        reason: "revision-mismatch",
      };
      readCache.set(path, result);
      recordIssue(
        "read-failed",
        path,
        "The pinned file identity is unavailable.",
      );
      return result;
    }
    if (
      readAttempts >= MAX_READ_ATTEMPTS ||
      (!isReadme(file) &&
        readAttempts >= MAX_READ_ATTEMPTS - README_READ_RESERVE)
    ) {
      const result: BoundedReadResult = { ok: false, reason: "over-budget" };
      readCache.set(path, result);
      recordIssue("read-limit", path, "The discovery read limit was reached.");
      return result;
    }

    readAttempts += 1;
    let result: BoundedReadResult;
    try {
      result = await reader.read({
        repository,
        path,
        blobSha: file.blobSha.toLowerCase(),
        maxBytes: MAX_READ_BYTES_PER_FILE,
      });
    } catch {
      result = { ok: false, reason: "unreadable" };
    }
    if (result.ok) {
      const actualBytes = new TextEncoder().encode(result.text).byteLength;
      if (
        typeof result.blobSha !== "string" ||
        result.blobSha.toLowerCase() !== file.blobSha.toLowerCase() ||
        result.bytesRead < 0 ||
        !Number.isSafeInteger(result.bytesRead) ||
        result.bytesRead > MAX_READ_BYTES_PER_FILE ||
        actualBytes > MAX_READ_BYTES_PER_FILE ||
        actualBytes > result.bytesRead
      ) {
        result = { ok: false, reason: "revision-mismatch" };
      }
    }
    readCache.set(path, result);
    if (!result.ok) recordReadFailure(path, result.reason, recordIssue);
    return result;
  };

  const manifestFiles = sortedFiles.filter(
    (file) =>
      isEligibleInventoryFile(file) &&
      isManifestName(file.path) &&
      !isDynamicConfig(basename(file.path)),
  );
  const configurationFiles = sortedFiles.filter(
    (file) =>
      configurationKind(file.path) !== null &&
      !isGeneratedOrVendored(file.path),
  );
  const packageMetadata = new Map<string, PackageMetadata>();
  const manifestText = new Map<string, ReadText>();

  for (const file of manifestFiles.slice(0, MAX_READ_ATTEMPTS)) {
    const read = await safeRead(file.path);
    if (!read.ok || read.truncated) {
      if (read.ok && read.truncated) {
        recordIssue(
          "config-truncated",
          file.path,
          "The bounded manifest read was truncated.",
        );
      }
      continue;
    }
    manifestText.set(file.path, toReadText(read));
    const metadata = parseManifest(file.path, read.text);
    if (metadata) mergePackageMetadata(packageMetadata, metadata);
    else if (basename(file.path) === "package.json") {
      const parsed = parseJsonc(read.text);
      recordIssue(
        !parsed.ok && parsed.reason === "unsafe-key"
          ? "unsafe-config"
          : "unsupported-config",
        file.path,
        !parsed.ok && parsed.reason === "unsafe-key"
          ? "Prototype-polluting package manifest keys were rejected."
          : "The package manifest is not supported static JSONC.",
      );
    }
  }
  if (manifestFiles.length > MAX_READ_ATTEMPTS) {
    recordIssue(
      "read-limit",
      null,
      "Some manifest candidates were outside the bounded read limit.",
    );
  }

  addInventoryPackages(packageMetadata, inventory.packages, fileIndex);
  if (inventory.packagePath) {
    const selectedPath = normalizeInventoryPath(inventory.packagePath);
    if (selectedPath && !packageMetadata.has(selectedPath)) {
      packageMetadata.set(selectedPath, {
        path: selectedPath,
        manifestPaths: [],
        kind: "selected-scope",
        packageName: null,
        description: null,
        projectTypes: inferProjectTypes(
          selectedPath,
          sortedFiles,
          inventory.projectTypes,
        ),
        entrypointPaths: [],
        dependencies: new Set(),
        workspacePatterns: [],
      });
    }
  }

  const workspaceDeclarations = collectWorkspaceDeclarations(
    manifestText,
    recordIssue,
  );
  const declaredPatterns = uniqueSorted(
    workspaceDeclarations.flatMap((declaration) => declaration.patterns),
  );
  const manifestDirectories = [...packageMetadata.keys()].sort(compare);
  const workspaceMembers = new Set<string>();
  for (const pattern of declaredPatterns) {
    if (pattern.startsWith("!")) continue;
    const matched = manifestDirectories.filter((path) =>
      pathMatchesWorkspacePattern(path, pattern),
    );
    if (matched.length === 0) {
      recordIssue(
        "workspace-pattern-unresolved",
        null,
        `A workspace pattern did not match an inventoried package: ${pattern}`,
      );
    }
    for (const path of matched) workspaceMembers.add(path);
  }
  for (const pattern of declaredPatterns.filter((item) =>
    item.startsWith("!"),
  )) {
    for (const member of [...workspaceMembers]) {
      if (pathMatchesWorkspacePattern(member, pattern.slice(1)))
        workspaceMembers.delete(member);
    }
  }

  for (const path of workspaceMembers) {
    const current = packageMetadata.get(path);
    if (current) current.kind = "declared";
    else {
      packageMetadata.set(path, {
        path,
        manifestPaths: [],
        kind: "declared",
        packageName: null,
        description: null,
        projectTypes: inferProjectTypes(
          path,
          sortedFiles,
          inventory.projectTypes,
        ),
        entrypointPaths: [],
        dependencies: new Set(),
        workspacePatterns: declaredPatterns.filter((pattern) =>
          pathMatchesWorkspacePattern(path, pattern),
        ),
      });
    }
  }
  if (!packageMetadata.has("")) {
    packageMetadata.set("", {
      path: "",
      manifestPaths: [],
      kind: "manifest-inferred",
      packageName: null,
      description: null,
      projectTypes: uniqueSorted(inventory.projectTypes),
      entrypointPaths: [],
      dependencies: new Set(),
      workspacePatterns: [],
    });
  }
  if (packageMetadata.size > MAX_PACKAGES) {
    recordIssue(
      "package-limit",
      null,
      "Only the first bounded package set is included.",
    );
  }
  const packages = [...packageMetadata.values()]
    .sort((a, b) => compare(a.path, b.path))
    .slice(0, MAX_PACKAGES);

  const configurationCandidates: ConfigurationCandidate[] = [];
  const aliases = await discoverAliases({
    files: configurationFiles,
    fileIndex,
    safeRead,
    recordIssue,
  });
  for (const file of configurationFiles) {
    const kind = configurationKind(file.path);
    if (!kind) continue;
    const base = basename(file.path);
    if (isDynamicConfig(base)) {
      configurationCandidates.push({
        path: file.path,
        kind,
        status: "static-only",
      });
      recordIssue(
        "unsupported-config",
        file.path,
        "Executable configuration is listed but never evaluated.",
      );
    } else if (file.eligibility !== "automatic") {
      configurationCandidates.push({
        path: file.path,
        kind,
        status: "unreadable",
      });
    } else {
      const read = readCache.get(file.path);
      const status =
        !read || !read.ok
          ? "unreadable"
          : read.truncated || !isStructuredConfig(file.path, read.text)
            ? "unsupported"
            : "parsed";
      configurationCandidates.push({ path: file.path, kind, status });
    }
  }

  const overviewCandidates = await discoverOverviewCandidates({
    inventory,
    files: sortedFiles,
    packages,
    safeRead,
    recordIssue,
    exclusions,
  });
  const entrypoints = discoverEntrypoints(
    packages,
    sortedFiles,
    fileIndex,
    inventory.packages,
  );
  for (const entrypoint of entrypoints) {
    const packageInfo = packages.find(
      (item) => item.path === entrypoint.packagePath,
    );
    if (packageInfo)
      packageInfo.entrypointPaths = uniqueSorted([
        ...packageInfo.entrypointPaths,
        entrypoint.path,
      ]);
  }
  const frameworks = inferFrameworks(packages);
  const capabilities = inferCapabilities(
    packages,
    frameworks,
    sortedFiles,
    entrypoints,
  );
  if (inventory.partial) {
    recordIssue(
      "inventory-partial",
      null,
      "The repository inventory is partial; package and capability suggestions may be incomplete.",
    );
  }

  const eligibleFiles = sortedFiles.filter((file) =>
    isEligibleInventoryFile(file),
  ).length;
  const selectedEvidenceFiles = inventory.files.filter(
    (file) => file.selected === true,
  ).length;
  const projectTypes = uniqueSorted([
    ...inventory.projectTypes,
    ...packages.flatMap((entry) => entry.projectTypes),
  ]);

  return {
    ok: true,
    value: {
      version: "project-map-v1",
      repository: {
        repositoryId: repository.repositoryId,
        owner: repository.owner,
        name: repository.name,
        commitSha: repository.commitSha.toLowerCase(),
      },
      counts: {
        totalInventoryFiles: inventory.files.length,
        eligibleFiles,
        selectedEvidenceFiles,
        overviewCandidates: overviewCandidates.filter(
          (candidate) => candidate.status === "candidate",
        ).length,
        configurations: configurationCandidates.length,
      },
      usage: {
        readAttempts,
        readBytes: [...readCache.values()].reduce(
          (total, result) => total + (result.ok ? result.bytesRead : 0),
          0,
        ),
      },
      inventory: {
        partial: Boolean(inventory.partial),
        unvisitedScope: [...(inventory.unvisitedScope ?? [])].slice(0, 128),
        projectTypes,
        fallbackMode:
          projectTypes.length === 0 ||
          projectTypes.every((type) => type === "unknown")
            ? "language-agnostic"
            : "classified",
      },
      packages: packages.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
        manifestPaths: uniqueSorted(entry.manifestPaths),
        packageName: entry.packageName,
        description: entry.description,
        projectTypes: uniqueSorted(entry.projectTypes),
        entrypointPaths: uniqueSorted(entry.entrypointPaths),
        workspacePatterns: uniqueSorted(entry.workspacePatterns),
        features: uniqueSorted(
          capabilities
            .filter((capability) =>
              capability.evidence.some(
                (evidence) =>
                  packageForPath(packages, evidence.path) === entry.path,
              ),
            )
            .map((capability) => capability.capability),
        ) as CapabilitySuggestion["capability"][],
      })),
      workspace: {
        declarationPaths: uniqueSorted(
          workspaceDeclarations.map((declaration) => declaration.path),
        ),
        patterns: declaredPatterns,
        members: [...workspaceMembers].sort(compare).slice(0, MAX_PACKAGES),
      },
      overviewCandidates,
      configurations: configurationCandidates.sort((a, b) =>
        compare(a.path, b.path),
      ),
      aliases: [...aliases.values()].sort(
        (a, b) =>
          compare(a.pattern, b.pattern) ||
          compare(a.configPath, b.configPath) ||
          a.targetIndex - b.targetIndex,
      ),
      entrypoints,
      frameworks,
      capabilities,
      exclusions: capExclusions(exclusions),
      issues,
      limits: {
        maxInventoryFiles: MAX_INVENTORY_FILES,
        maxReadBytesPerFile: MAX_READ_BYTES_PER_FILE,
        maxReadAttempts: MAX_READ_ATTEMPTS,
      },
    },
  };
}

function validateInput(input: ProjectDiscoveryInput): ProjectMapResult | null {
  if (
    !input ||
    typeof input !== "object" ||
    !input.repository ||
    !input.inventory ||
    !input.reader
  ) {
    return {
      ok: false,
      error: "invalid-input",
      message: "Project discovery input is invalid.",
    };
  }
  const repository = input.repository;
  if (
    !Number.isSafeInteger(repository.repositoryId) ||
    repository.repositoryId <= 0 ||
    typeof repository.owner !== "string" ||
    !repository.owner.trim() ||
    repository.owner.length > 100 ||
    typeof repository.name !== "string" ||
    !repository.name.trim() ||
    repository.name.length > 100 ||
    !SHA_PATTERN.test(repository.commitSha)
  ) {
    return {
      ok: false,
      error: "invalid-input",
      message: "Repository identity is invalid.",
    };
  }
  const inventory = input.inventory;
  if (
    !Number.isSafeInteger(inventory.repositoryId) ||
    typeof inventory.commitSha !== "string" ||
    !SHA_PATTERN.test(inventory.commitSha) ||
    !Array.isArray(inventory.files) ||
    !Array.isArray(inventory.packages) ||
    !Array.isArray(inventory.projectTypes) ||
    typeof inventory.snapshotId !== "string" ||
    !inventory.snapshotId.trim() ||
    (inventory.packagePath !== undefined &&
      (typeof inventory.packagePath !== "string" ||
        (inventory.packagePath !== "" &&
          !normalizeInventoryPath(inventory.packagePath)))) ||
    (inventory.unvisitedScope !== undefined &&
      (!Array.isArray(inventory.unvisitedScope) ||
        inventory.unvisitedScope.some((scope) => typeof scope !== "string")))
  ) {
    return {
      ok: false,
      error: "invalid-input",
      message: "Repository inventory is invalid.",
    };
  }
  if (
    inventory.files.some(
      (file) =>
        !file ||
        typeof file.path !== "string" ||
        typeof file.mode !== "string" ||
        !["automatic", "manual-only", "excluded"].includes(file.eligibility) ||
        !Array.isArray(file.safetyFlags) ||
        (file.blobSha !== null && typeof file.blobSha !== "string") ||
        (file.sizeBytes !== null &&
          (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0)),
    ) ||
    inventory.packages.some(
      (item) =>
        !item ||
        typeof item.path !== "string" ||
        !Array.isArray(item.manifestPaths) ||
        !Array.isArray(item.projectTypes) ||
        !Array.isArray(item.entrypointPaths),
    )
  ) {
    return {
      ok: false,
      error: "invalid-input",
      message: "Repository inventory entries are invalid.",
    };
  }
  if (
    inventory.repositoryId !== repository.repositoryId ||
    inventory.commitSha.toLowerCase() !== repository.commitSha.toLowerCase()
  ) {
    return {
      ok: false,
      error: "inventory-mismatch",
      message: "Inventory does not match the pinned repository revision.",
    };
  }
  if (inventory.files.length > MAX_INVENTORY_FILES) {
    return {
      ok: false,
      error: "inventory-over-limit",
      message: "Repository inventory exceeds the discovery limit.",
    };
  }
  if (typeof input.reader.read !== "function") {
    return {
      ok: false,
      error: "invalid-input",
      message: "A bounded reader is required.",
    };
  }
  return null;
}

function indexInventoryFiles(
  files: readonly DiscoveryFile[],
  exclusions: DiscoveryExclusion[],
): Map<string, IndexedFile> {
  const index = new Map<string, IndexedFile>();
  for (const raw of files) {
    if (!raw || typeof raw.path !== "string") continue;
    const safePath = normalizeInventoryPath(raw.path);
    if (!safePath) {
      addExclusion(exclusions, {
        path: raw.path.slice(0, 1_024),
        reason: "unsafe-path",
      });
      continue;
    }
    if (index.has(safePath)) {
      addExclusion(exclusions, { path: safePath, reason: "unsafe-path" });
      continue;
    }
    const file: IndexedFile = {
      ...EMPTY_FILE,
      ...raw,
      path: safePath,
      safePath,
    };
    const mode = file.mode.toLowerCase();
    if (mode === "120000") {
      addExclusion(exclusions, { path: safePath, reason: "symlink" });
    } else if (mode === "160000") {
      addExclusion(exclusions, { path: safePath, reason: "submodule" });
    } else if (file.eligibility === "excluded") {
      addExclusion(exclusions, {
        path: safePath,
        reason: "inventory-excluded",
      });
    } else if (file.eligibility === "manual-only") {
      addExclusion(exclusions, { path: safePath, reason: "manual-only" });
    } else if (file.safetyFlags.length > 0) {
      addExclusion(exclusions, { path: safePath, reason: "unsafe-flag" });
    } else if (isGeneratedOrVendored(safePath)) {
      addExclusion(exclusions, {
        path: safePath,
        reason: "generated-or-vendored",
      });
    } else if (isDocumentationImage(safePath)) {
      addExclusion(exclusions, { path: safePath, reason: "non-text-overview" });
    } else if (
      /^readme(?:\.[a-z0-9_-]+)*$/iu.test(basename(safePath)) &&
      !README_EXTENSIONS.has(extension(safePath))
    ) {
      addExclusion(exclusions, { path: safePath, reason: "non-text-overview" });
    } else if (!["100644", "100755"].includes(file.mode.toLowerCase())) {
      addExclusion(exclusions, {
        path: safePath,
        reason: "unsupported-file-mode",
      });
    }
    index.set(safePath, file);
  }
  return index;
}

function isEligibleInventoryFile(file: IndexedFile): boolean {
  return (
    file.eligibility === "automatic" &&
    file.safetyFlags.length === 0 &&
    file.mode.toLowerCase() !== "120000" &&
    file.mode.toLowerCase() !== "160000" &&
    ["100644", "100755"].includes(file.mode.toLowerCase()) &&
    !isGeneratedOrVendored(file.path) &&
    !isDocumentationImage(file.path)
  );
}

function recordReadFailure(
  path: string,
  reason: BoundedReadFailure,
  recordIssue: (
    code: ProjectMapIssue["code"],
    path: string | null,
    message: string,
  ) => void,
): void {
  recordIssue(
    reason === "over-budget" ? "read-limit" : "read-failed",
    path,
    `The bounded read was unavailable (${reason}).`,
  );
}

function toReadText(
  result: Extract<BoundedReadResult, { ok: true }>,
): ReadText {
  return {
    text: result.text,
    bytesRead: result.bytesRead,
    blobSha: result.blobSha.toLowerCase(),
    truncated: result.truncated,
  };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [
    ...new Set(
      values.filter((value) => typeof value === "string" && value.length > 0),
    ),
  ].sort(compare);
}

function basename(path: string): string {
  return path.toLowerCase().split("/").at(-1) ?? path.toLowerCase();
}

function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function extension(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot);
}

function isManifestName(path: string): boolean {
  return MANIFEST_NAMES.has(basename(path));
}

function configurationKind(
  path: string,
): ConfigurationCandidate["kind"] | null {
  const base = basename(path);
  if (CONFIG_KINDS[base]) return CONFIG_KINDS[base] ?? null;
  if (/^(?:tsconfig|jsconfig)(?:\.[a-z0-9_-]+)?\.jsonc?$/u.test(base)) {
    return base.startsWith("tsconfig") ? "typescript" : "javascript";
  }
  if (
    /^(?:next|vite|webpack|rollup|jest|vitest|playwright)\.config\.(?:[cm]?[jt]s|json)$/u.test(
      base,
    )
  ) {
    return "other";
  }
  return null;
}

function isDynamicConfig(base: string): boolean {
  return (
    /\.(?:[cm]?[jt]s|py)$/u.test(base) &&
    !/^(?:tsconfig|jsconfig).*\.jsonc?$/u.test(base)
  );
}

function isStructuredConfig(path: string, text: string): boolean {
  const base = basename(path);
  if (
    /^(?:tsconfig|jsconfig).*\.jsonc?$/u.test(base) ||
    base === "lerna.json"
  ) {
    return parseJsonc(text).ok;
  }
  if (base === "pnpm-workspace.yaml") {
    return /^\s*packages\s*:/mu.test(text);
  }
  if (base === "go.work") return /^\s*go\s+\d+/mu.test(text);
  if (base === "go.mod") return /^\s*module\s+[^\s]+/mu.test(text);
  if (base === "cargo.toml") {
    return Boolean(
      tomlScalar(text, "package", "name") ||
      tomlArray(text, "workspace", "members").length,
    );
  }
  if (base === "pyproject.toml") {
    return Boolean(
      tomlScalar(text, "project", "name") ||
      tomlScalar(text, "tool.poetry", "name"),
    );
  }
  if (base === "settings.gradle" || base === "settings.gradle.kts") {
    return parseGradleSettings(text).length > 0;
  }
  if (base === "requirements.txt") {
    return text
      .split(/\r?\n/u)
      .some((line) => line.trim() && !line.trim().startsWith("#"));
  }
  return false;
}

function isDocumentationImage(path: string): boolean {
  return (
    path.toLowerCase().startsWith("docs/") &&
    new Set([
      ".avif",
      ".bmp",
      ".gif",
      ".jpeg",
      ".jpg",
      ".png",
      ".svg",
      ".webp",
    ]).has(extension(path))
  );
}

function addExclusion(
  exclusions: DiscoveryExclusion[],
  exclusion: DiscoveryExclusion,
): void {
  if (
    exclusions.some(
      (entry) =>
        entry.path === exclusion.path && entry.reason === exclusion.reason,
    )
  )
    return;
  if (exclusions.length < MAX_EXCLUSIONS) exclusions.push(exclusion);
}

function capExclusions(exclusions: DiscoveryExclusion[]): DiscoveryExclusion[] {
  return [...exclusions]
    .sort((a, b) => compare(a.path, b.path) || compare(a.reason, b.reason))
    .slice(0, MAX_EXCLUSIONS);
}

function parseManifest(path: string, text: string): PackageMetadata | null {
  const name = basename(path);
  const directory = dirname(path);
  if (name === "package.json") {
    const parsed = parseJsonc(text);
    if (!parsed.ok || !isRecord(parsed.value)) return null;
    const root = parsed.value;
    const dependencies = new Set<string>();
    for (const key of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const values = root[key];
      if (!isRecord(values)) continue;
      for (const dependencyName of Object.keys(values)) {
        if (dependencyName.length <= 200)
          dependencies.add(dependencyName.toLowerCase());
      }
    }
    const entrypointPaths = [root.main, root.module]
      .filter((value): value is string => typeof value === "string")
      .map((value) => resolveManifestPath(directory, value))
      .filter((value): value is string => value !== null);
    if (isRecord(root.bin)) {
      for (const value of Object.values(root.bin)) {
        if (typeof value !== "string") continue;
        const resolved = resolveManifestPath(directory, value);
        if (resolved) entrypointPaths.push(resolved);
      }
    } else if (typeof root.bin === "string") {
      const resolved = resolveManifestPath(directory, root.bin);
      if (resolved) entrypointPaths.push(resolved);
    }
    return {
      path: directory,
      manifestPaths: [path],
      kind: "manifest-inferred",
      packageName: readBoundedString(root.name),
      description: readBoundedString(root.description),
      projectTypes: inferLanguageFromManifest(name),
      entrypointPaths: uniqueSorted(entrypointPaths),
      dependencies,
      workspacePatterns: readWorkspacePatterns(root.workspaces),
    };
  }

  const dependencies = collectDependencyNames(text);
  let packageName: string | null = null;
  if (name === "pyproject.toml") {
    packageName =
      tomlScalar(text, "project", "name") ??
      tomlScalar(text, "tool.poetry", "name");
  } else if (name === "cargo.toml") {
    packageName = tomlScalar(text, "package", "name");
  } else if (name === "go.mod") {
    packageName = text.match(/^\s*module\s+([^\s]+)\s*$/mu)?.[1] ?? null;
  }
  if (
    !MANIFEST_NAMES.has(name) ||
    [
      "pnpm-workspace.yaml",
      "lerna.json",
      "go.work",
      "settings.gradle",
      "settings.gradle.kts",
    ].includes(name)
  ) {
    return null;
  }
  return {
    path: directory,
    manifestPaths: [path],
    kind: "manifest-inferred",
    packageName: packageName && packageName.length <= 200 ? packageName : null,
    description: null,
    projectTypes: inferLanguageFromManifest(name),
    entrypointPaths: [],
    dependencies,
    workspacePatterns: [],
  };
}

function mergePackageMetadata(
  target: Map<string, PackageMetadata>,
  incoming: PackageMetadata,
): void {
  const current = target.get(incoming.path);
  if (!current) {
    target.set(incoming.path, incoming);
    return;
  }
  current.manifestPaths = uniqueSorted([
    ...current.manifestPaths,
    ...incoming.manifestPaths,
  ]);
  current.packageName ??= incoming.packageName;
  current.description ??= incoming.description;
  current.projectTypes = uniqueSorted([
    ...current.projectTypes,
    ...incoming.projectTypes,
  ]);
  current.entrypointPaths = uniqueSorted([
    ...current.entrypointPaths,
    ...incoming.entrypointPaths,
  ]);
  current.workspacePatterns = uniqueSorted([
    ...current.workspacePatterns,
    ...incoming.workspacePatterns,
  ]);
  for (const dependency of incoming.dependencies)
    current.dependencies.add(dependency);
  if (
    current.kind === "manifest-inferred" &&
    incoming.kind !== "manifest-inferred"
  )
    current.kind = incoming.kind;
}

function addInventoryPackages(
  target: Map<string, PackageMetadata>,
  boundaries: readonly {
    path: string;
    kind: "declared" | "conventional" | "selected-scope";
    manifestPaths: readonly string[];
    projectTypes: readonly string[];
    entrypointPaths: readonly string[];
  }[],
  files: Map<string, IndexedFile>,
): void {
  for (const boundary of boundaries) {
    const path = boundary.path ? normalizeInventoryPath(boundary.path) : "";
    if (path === null) continue;
    const manifestPaths = boundary.manifestPaths.filter((item) => {
      const normalized = normalizeInventoryPath(item);
      return Boolean(normalized && files.has(normalized));
    });
    mergePackageMetadata(target, {
      path,
      manifestPaths,
      kind: boundary.kind,
      packageName: null,
      description: null,
      projectTypes: uniqueSorted(boundary.projectTypes),
      entrypointPaths: boundary.entrypointPaths.filter((item) => {
        const normalized = normalizeInventoryPath(item);
        return Boolean(normalized && files.has(normalized));
      }),
      dependencies: new Set(),
      workspacePatterns: [],
    });
  }
}

function collectWorkspaceDeclarations(
  manifestText: Map<string, ReadText>,
  recordIssue: (
    code: ProjectMapIssue["code"],
    path: string | null,
    message: string,
  ) => void,
): WorkspaceDeclaration[] {
  const declarations: WorkspaceDeclaration[] = [];
  for (const [path, read] of [...manifestText].sort(([a], [b]) =>
    compare(a, b),
  )) {
    const name = basename(path);
    let patterns: string[] = [];
    if (name === "package.json") {
      const parsed = parseJsonc(read.text);
      if (parsed.ok && isRecord(parsed.value))
        patterns = readWorkspacePatterns(parsed.value.workspaces);
    } else if (name === "lerna.json") {
      const parsed = parseJsonc(read.text);
      if (parsed.ok && isRecord(parsed.value))
        patterns = readWorkspacePatterns(parsed.value.packages);
    } else if (name === "pnpm-workspace.yaml") {
      patterns = parsePnpmWorkspace(read.text);
    } else if (name === "cargo.toml") {
      patterns = tomlArray(read.text, "workspace", "members");
    } else if (name === "go.work") {
      patterns = parseGoWork(read.text);
    } else if (name === "settings.gradle" || name === "settings.gradle.kts") {
      patterns = parseGradleSettings(read.text);
    }
    const valid = patterns.filter(isSafeWorkspacePattern);
    if (patterns.length !== valid.length) {
      recordIssue(
        "unsafe-config",
        path,
        "Unsafe workspace paths were ignored.",
      );
    }
    if (valid.length)
      declarations.push({ path, patterns: uniqueSorted(valid) });
  }

  return declarations;
}

function readWorkspacePatterns(value: unknown): string[] {
  const source = isRecord(value) ? value.packages : value;
  if (!Array.isArray(source)) return [];
  return source
    .filter((pattern): pattern is string => typeof pattern === "string")
    .slice(0, 200);
}

function parsePnpmWorkspace(text: string): string[] {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) =>
    /^\s*packages\s*:\s*(?:#.*)?$/u.test(line),
  );
  if (start < 0) return [];
  const patterns: string[] = [];
  for (const line of lines.slice(start + 1, start + 202)) {
    if (!/^\s*[-]/u.test(line)) {
      if (line.trim() && !/^\s*#/u.test(line)) break;
      continue;
    }
    const value = line
      .replace(/^\s*-\s*/u, "")
      .replace(/\s+#.*$/u, "")
      .trim();
    const unquoted = value.replace(/^(['"])(.*)\1$/u, "$2");
    if (unquoted) patterns.push(unquoted);
  }
  return patterns;
}

function parseGoWork(text: string): string[] {
  const patterns: string[] = [];
  let inUseBlock = false;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\/\/.*$/u, "").trim();
    if (/^use\s*\($/u.test(line)) {
      inUseBlock = true;
      continue;
    }
    if (inUseBlock && line === ")") {
      inUseBlock = false;
      continue;
    }
    const match = inUseBlock
      ? line.match(/^\.\/([^\s]+)$/u)
      : line.match(/^use\s+\.\/([^\s]+)$/u);
    if (match?.[1]) patterns.push(match[1]);
  }
  return patterns;
}

function parseGradleSettings(text: string): string[] {
  const patterns: string[] = [];
  for (const match of text.matchAll(
    /\binclude\s*(?:\(([^)]{1,2000})\)|([^\n;]{1,2000}))/gu,
  )) {
    const literalList = match[1] ?? match[2] ?? "";
    const values = [
      ...literalList.matchAll(/["'](:[a-zA-Z0-9_.:-]{1,200})["']/gu),
    ];
    if (values.length === 0) continue;
    for (const value of values) {
      const modulePath = value[1]?.replace(/^:/u, "").replace(/:/gu, "/");
      if (modulePath) patterns.push(modulePath);
    }
  }
  return patterns;
}

function tomlArray(text: string, section: string, key: string): string[] {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionMatch = new RegExp(
    `(?:^|\\n)\\s*\\[${escaped}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\[|$)`,
    "u",
  ).exec(text);
  const valueMatch = sectionMatch?.[1]?.match(
    new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "mu"),
  );
  if (!valueMatch?.[1]) return [];
  return [...valueMatch[1].matchAll(/["']([^"']+)["']/gu)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}

function tomlScalar(text: string, section: string, key: string): string | null {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sectionMatch = new RegExp(
    `(?:^|\\n)\\s*\\[${escaped}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\[|$)`,
    "u",
  ).exec(text);
  const valueMatch = sectionMatch?.[1]?.match(
    new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']{1,200})["']`, "mu"),
  );
  return valueMatch?.[1] ?? null;
}

function collectDependencyNames(text: string): Set<string> {
  const dependencies = new Set<string>();
  const knownNames = [
    "torch",
    "pytorch",
    "tensorflow",
    "scikit-learn",
    "sklearn",
    "transformers",
    "numpy",
    "pandas",
    "fastapi",
    "flask",
    "django",
  ];
  let inDependencyArray = false;
  let inDependencyTable = false;
  const candidateLines: string[] = [];

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    if (line.startsWith("[")) {
      inDependencyTable =
        /(?:^|\.)(?:dependencies|dev-dependencies|optional-dependencies)\]$/iu.test(
          line,
        );
      inDependencyArray = false;
    }
    if (/^(?:dependencies|install_requires|requires)\s*=\s*\[/iu.test(line)) {
      inDependencyArray = !line.includes("]");
      candidateLines.push(line);
      continue;
    }
    if (inDependencyArray) {
      candidateLines.push(line);
      if (line.includes("]")) inDependencyArray = false;
      continue;
    }
    if (
      inDependencyTable ||
      knownNames.some((name) =>
        new RegExp(`^${escapeRegExp(name)}\\s*(?:[<=>~!;]|$)`, "iu").test(line),
      )
    ) {
      candidateLines.push(line);
    }
  }

  const dependencyText = candidateLines.join("\n");
  for (const name of knownNames) {
    if (
      new RegExp(
        `(?:^|[^a-z0-9_-])${escapeRegExp(name)}(?:[<=>~!;\\s"',]|$)`,
        "imu",
      ).test(dependencyText)
    ) {
      dependencies.add(name);
    }
  }
  return dependencies;
}

function resolveManifestPath(
  packagePath: string,
  value: string,
): string | null {
  const normalizedValue = value.replace(/^\.\//u, "");
  if (
    !normalizedValue ||
    normalizedValue.startsWith("/") ||
    normalizedValue.includes("\\") ||
    normalizedValue
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalizeInventoryPath(
    packagePath ? `${packagePath}/${normalizedValue}` : normalizedValue,
  );
}

function readBoundedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= 500
    ? value.trim()
    : null;
}

function inferLanguageFromManifest(name: string): string[] {
  if (name === "package.json") return ["javascript-typescript"];
  if (
    name === "pyproject.toml" ||
    name === "setup.cfg" ||
    name === "setup.py" ||
    name === "requirements.txt"
  )
    return ["python"];
  if (name === "cargo.toml") return ["rust"];
  if (name === "go.mod") return ["go"];
  if (name === "pom.xml" || name.startsWith("build.gradle")) return ["java"];
  if (name === "androidmanifest.xml") return ["java-mobile"];
  return [];
}

function inferProjectTypes(
  packagePath: string,
  files: IndexedFile[],
  fallback: readonly string[],
): string[] {
  const typeByExtension: Record<string, string> = {
    ".go": "go",
    ".java": "java",
    ".js": "javascript-typescript",
    ".jsx": "javascript-typescript",
    ".kt": "java-mobile",
    ".py": "python",
    ".rs": "rust",
    ".swift": "java-mobile",
    ".ts": "javascript-typescript",
    ".tsx": "javascript-typescript",
  };
  const known = new Set<string>();
  for (const file of files) {
    if (
      packagePath &&
      file.path !== packagePath &&
      !file.path.startsWith(`${packagePath}/`)
    )
      continue;
    const language = typeByExtension[extension(file.path)];
    if (language) known.add(language);
  }
  return known.size ? [...known].sort(compare) : uniqueSorted(fallback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function discoverAliases(args: {
  files: IndexedFile[];
  fileIndex: Map<string, IndexedFile>;
  safeRead: (path: string) => Promise<BoundedReadResult>;
  recordIssue: (
    code: ProjectMapIssue["code"],
    path: string | null,
    message: string,
  ) => void;
}): Promise<Map<string, AliasMapping>> {
  const result = new Map<string, AliasMapping>();
  const configPaths = args.files
    .filter((file) => isEligibleInventoryFile(file))
    .map((file) => file.path)
    .filter((path) =>
      /^(?:tsconfig|jsconfig)(?:\.[a-z0-9_-]+)?\.jsonc?$/u.test(basename(path)),
    )
    .sort(compare);
  for (const configPath of configPaths) {
    const state = await aliasesForConfig(configPath, new Set(), 0, args);
    for (const mappings of state.aliases.values()) {
      for (const mapping of mappings) {
        const key = `${mapping.configPath}\u0000${mapping.pattern}\u0000${mapping.targetPattern}`;
        result.set(key, mapping);
      }
    }
  }
  return result;
}

async function aliasesForConfig(
  configPath: string,
  visited: Set<string>,
  depth: number,
  args: {
    fileIndex: Map<string, IndexedFile>;
    safeRead: (path: string) => Promise<BoundedReadResult>;
    recordIssue: (
      code: ProjectMapIssue["code"],
      path: string | null,
      message: string,
    ) => void;
  },
): Promise<AliasParseState> {
  const empty: AliasParseState = { aliases: new Map(), failed: false };
  if (depth > 5 || visited.has(configPath)) {
    args.recordIssue(
      "unresolved-extends",
      configPath,
      "Configuration inheritance is cyclic or exceeds the supported depth.",
    );
    return { ...empty, failed: true };
  }
  visited.add(configPath);
  const file = args.fileIndex.get(configPath);
  if (!file || file.eligibility !== "automatic") {
    args.recordIssue(
      "unresolved-extends",
      configPath,
      "A local configuration extension is not an eligible inventoried file.",
    );
    return { ...empty, failed: true };
  }
  const read = await args.safeRead(configPath);
  if (!read.ok || read.truncated) {
    if (read.ok && read.truncated)
      args.recordIssue(
        "config-truncated",
        configPath,
        "The bounded configuration read was truncated.",
      );
    return { ...empty, failed: true };
  }
  const parsed = parseJsonc(read.text);
  if (!parsed.ok) {
    args.recordIssue(
      parsed.reason === "unsafe-key" ? "unsafe-config" : "unsupported-config",
      configPath,
      parsed.reason === "unsafe-key"
        ? "Prototype-polluting configuration keys were rejected."
        : "Configuration is not supported JSONC.",
    );
    return { ...empty, failed: true };
  }
  if (!isRecord(parsed.value)) {
    args.recordIssue(
      "unsupported-config",
      configPath,
      "Configuration root must be a JSONC object.",
    );
    return { ...empty, failed: true };
  }

  const config = parsed.value;
  let aliases = new Map<string, AliasMapping[]>();
  const extendsValue = config.extends;
  if (extendsValue !== undefined) {
    const parentPath = resolveLocalExtends(configPath, extendsValue);
    if (!parentPath) {
      args.recordIssue(
        "unresolved-extends",
        configPath,
        "External, traversing, or dynamic config inheritance is ignored.",
      );
      empty.failed = true;
    } else if (!args.fileIndex.has(parentPath)) {
      args.recordIssue(
        "unresolved-extends",
        configPath,
        "The local extended config is absent from the pinned inventory.",
      );
      empty.failed = true;
    } else {
      const parent = await aliasesForConfig(
        parentPath,
        new Set(visited),
        depth + 1,
        args,
      );
      aliases = new Map(
        [...parent.aliases].map(([pattern, mappings]) => [
          pattern,
          [...mappings],
        ]),
      );
      empty.failed ||= parent.failed;
    }
  }

  const compilerOptions = config.compilerOptions;
  if (compilerOptions === undefined) return { aliases, failed: empty.failed };
  if (!isRecord(compilerOptions)) {
    args.recordIssue(
      "unsupported-config",
      configPath,
      "compilerOptions must be a static JSONC object.",
    );
    return { aliases, failed: true };
  }
  const baseUrl = compilerOptions.baseUrl;
  if (baseUrl !== undefined && typeof baseUrl !== "string") {
    args.recordIssue(
      "unsupported-config",
      configPath,
      "Non-string baseUrl values prevent alias validation.",
    );
    return { aliases, failed: true };
  }
  const paths = compilerOptions.paths;
  if (paths === undefined) return { aliases, failed: empty.failed };
  if (!isRecord(paths)) {
    args.recordIssue(
      "unsupported-config",
      configPath,
      "paths must be a static object.",
    );
    return { aliases, failed: true };
  }

  for (const [pattern, targets] of Object.entries(paths)) {
    if (!isSafeAliasPattern(pattern)) {
      args.recordIssue(
        "unsafe-config",
        configPath,
        "An unsafe or unsupported path alias was ignored.",
      );
      empty.failed = true;
      continue;
    }
    if (!Array.isArray(targets) || targets.length === 0 || targets.length > 8) {
      args.recordIssue(
        "unsupported-config",
        configPath,
        "An alias must have a bounded list of static string targets.",
      );
      empty.failed = true;
      continue;
    }
    const mappings: AliasMapping[] = [];
    let allTargetsValid = true;
    for (const [targetIndex, target] of targets.entries()) {
      if (
        typeof target !== "string" ||
        countCharacter(target, "*") !== countCharacter(pattern, "*")
      ) {
        args.recordIssue(
          "unsafe-config",
          configPath,
          "An alias target with traversal or unsupported wildcard syntax was ignored.",
        );
        empty.failed = true;
        allTargetsValid = false;
        continue;
      }
      const normalizedTarget = resolveConfigTarget(configPath, baseUrl, target);
      if (!normalizedTarget) {
        args.recordIssue(
          "unsafe-config",
          configPath,
          "An alias target outside the repository was ignored.",
        );
        empty.failed = true;
        allTargetsValid = false;
        continue;
      }
      mappings.push({
        pattern,
        targetPattern: normalizedTarget,
        targetIndex,
        configPath,
        provenance: basename(configPath).startsWith("jsconfig")
          ? "jsconfig-jsonc"
          : "tsconfig-jsonc",
      });
    }
    if (allTargetsValid && mappings.length === targets.length) {
      aliases.set(pattern, mappings);
    } else {
      aliases.delete(pattern);
    }
  }
  return { aliases, failed: empty.failed };
}

function isSafeAliasPattern(pattern: string): boolean {
  return (
    Boolean(pattern) &&
    pattern.length <= 200 &&
    !pattern.startsWith("/") &&
    !pattern.includes("\\") &&
    !pattern.split("/").includes("..") &&
    !/[?\[\]{}:]/u.test(pattern) &&
    countCharacter(pattern, "*") <= 1 &&
    (!pattern.includes("*") || pattern.endsWith("*")) &&
    isSafeConfigKey(pattern)
  );
}

function countCharacter(value: string, character: string): number {
  return [...value].filter((item) => item === character).length;
}

function isSafeWorkspacePattern(pattern: string): boolean {
  const value = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  if (
    !value ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes(":") ||
    /%(?:2e|2f|5c)/iu.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value
      .split("/")
      .some((segment) => segment === ".." || segment === "." || !segment)
  ) {
    return false;
  }
  return !/[?\[\]{}]/u.test(value);
}

function pathMatchesWorkspacePattern(path: string, pattern: string): boolean {
  const normalized = pattern.replace(/^\.\//u, "");
  const pathParts = path ? path.split("/") : [];
  const patternParts = normalized.split("/");
  const matches = (pathIndex: number, patternIndex: number): boolean => {
    if (patternIndex >= patternParts.length)
      return pathIndex >= pathParts.length;
    const segment = patternParts[patternIndex] ?? "";
    if (segment === "**") {
      return (
        matches(pathIndex, patternIndex + 1) ||
        (pathIndex < pathParts.length && matches(pathIndex + 1, patternIndex))
      );
    }
    if (pathIndex >= pathParts.length) return false;
    const expression = new RegExp(
      `^${segment.split("*").map(escapeRegExp).join("[^/]*")}$`,
      "u",
    );
    return (
      expression.test(pathParts[pathIndex] ?? "") &&
      matches(pathIndex + 1, patternIndex + 1)
    );
  };
  return matches(0, 0);
}

async function discoverOverviewCandidates(args: {
  inventory: ProjectDiscoveryInput["inventory"];
  files: IndexedFile[];
  packages: PackageMetadata[];
  safeRead: (path: string) => Promise<BoundedReadResult>;
  recordIssue: (
    code: ProjectMapIssue["code"],
    path: string | null,
    message: string,
  ) => void;
  exclusions: DiscoveryExclusion[];
}): Promise<OverviewCandidate[]> {
  const results: OverviewCandidate[] = [];
  const seenContents = new Map<string, string>();
  const eligibleDocs = args.files.filter(
    (file) => isEligibleInventoryFile(file) && isOverviewText(file.path),
  );
  const sortedReadmes = eligibleDocs.filter(isReadme).sort(readmeCompare);

  const includeReadme = async (
    directory: string,
    role: OverviewCandidate["role"],
    required: boolean,
  ): Promise<boolean> => {
    const candidates = sortedReadmes
      .filter((file) => dirname(file.path) === directory)
      .slice(0, 5);
    if (candidates.length === 0) {
      if (required) {
        args.recordIssue(
          role === "root-readme"
            ? "missing-root-readme"
            : "missing-package-readme",
          directory || null,
          directory
            ? "No eligible README was present for the selected package."
            : "No eligible root README was present in the pinned inventory.",
        );
      }
      return false;
    }

    let readSucceeded = false;
    for (const file of candidates) {
      if (results.length >= MAX_OVERVIEW_CANDIDATES) {
        args.recordIssue(
          "read-limit",
          file.path,
          "The overview candidate limit was reached.",
        );
        break;
      }
      const read = await args.safeRead(file.path);
      if (!read.ok) {
        results.push(unavailableOverview(file, role, directory));
        continue;
      }
      if (read.truncated) {
        args.recordIssue(
          "overview-truncated",
          file.path,
          "Only a bounded partial overview was available for section hints.",
        );
      }
      readSucceeded = true;
      const fingerprint = overviewFingerprint(
        read.text,
        packageNameForPath(args.packages, directory),
      );
      const duplicateOf = seenContents.get(fingerprint);
      if (!duplicateOf) seenContents.set(fingerprint, file.path);
      else
        args.recordIssue(
          "duplicate-overview",
          file.path,
          "A repeated overview document was omitted.",
        );
      results.push({
        path: file.path,
        role,
        packagePath: directory,
        status: duplicateOf ? "duplicate" : "candidate",
        ...(duplicateOf ? { duplicateOf } : {}),
        contentStatus: documentContentStatus(file.path, read.text),
        truncated: read.truncated,
        sectionHints: sectionHints(
          read.text,
          packageNameForPath(args.packages, directory),
        ),
        blobSha: file.blobSha ?? "",
      });
      // One representative README per package is enough; variants are alternatives.
      break;
    }
    if (!readSucceeded && required) {
      args.recordIssue(
        role === "root-readme"
          ? "missing-root-readme"
          : "missing-package-readme",
        directory || null,
        directory
          ? "The package README was unavailable through the bounded reader."
          : "The root README was unavailable through the bounded reader.",
      );
    }
    return readSucceeded;
  };

  await includeReadme("", "root-readme", true);

  const selectedPackagePath = args.inventory.packagePath
    ? normalizeInventoryPath(args.inventory.packagePath)
    : null;
  const relevantPackagePaths = selectedPackagePath ? [selectedPackagePath] : [];
  for (const packagePath of uniqueSorted(relevantPackagePaths)) {
    const packageDirectoryExists = args.packages.some(
      (item) => item.path === packagePath,
    );
    if (!packageDirectoryExists) {
      args.recordIssue(
        "missing-package-readme",
        packagePath,
        "The selected package boundary is not present in the package map.",
      );
      continue;
    }
    await includeReadme(packagePath, "package-readme", true);
  }

  const allArchitectureFiles = eligibleDocs
    .filter(isArchitectureDocument)
    .sort(
      (a, b) =>
        architectureScore(a.path) - architectureScore(b.path) ||
        compare(a.path, b.path),
    );
  const architectureFiles = allArchitectureFiles.slice(0, 4);
  for (const omitted of allArchitectureFiles.slice(4)) {
    addExclusion(args.exclusions, {
      path: omitted.path,
      reason: "not-selected-overview",
    });
  }
  for (const file of architectureFiles) {
    if (results.length >= MAX_OVERVIEW_CANDIDATES) {
      args.recordIssue(
        "read-limit",
        file.path,
        "The overview candidate limit was reached.",
      );
      break;
    }
    const read = await args.safeRead(file.path);
    if (!read.ok) {
      results.push(
        unavailableOverview(file, "architecture", dirname(file.path)),
      );
      continue;
    }
    if (read.truncated) {
      args.recordIssue(
        "overview-truncated",
        file.path,
        "Only a bounded partial overview was available for section hints.",
      );
    }
    const packagePath = packageForPath(args.packages, file.path);
    const fingerprint = overviewFingerprint(
      read.text,
      packageNameForPath(args.packages, packagePath),
    );
    const duplicateOf = seenContents.get(fingerprint);
    if (!duplicateOf) seenContents.set(fingerprint, file.path);
    else
      args.recordIssue(
        "duplicate-overview",
        file.path,
        "A repeated overview document was omitted.",
      );
    results.push({
      path: file.path,
      role: "architecture",
      packagePath,
      status: duplicateOf ? "duplicate" : "candidate",
      ...(duplicateOf ? { duplicateOf } : {}),
      contentStatus: documentContentStatus(file.path, read.text),
      truncated: read.truncated,
      sectionHints: sectionHints(
        read.text,
        packageNameForPath(args.packages, packagePath),
      ),
      blobSha: file.blobSha ?? "",
    });
  }

  const relevantDirectories = new Set(["", ...relevantPackagePaths]);
  const includedOverviewPaths = new Set(
    results.map((candidate) => candidate.path),
  );
  for (const readme of sortedReadmes) {
    if (includedOverviewPaths.has(readme.path)) continue;
    const packagePath = dirname(readme.path);
    addExclusion(args.exclusions, {
      path: readme.path,
      reason: relevantDirectories.has(packagePath)
        ? "not-selected-overview"
        : "outside-selected-package",
    });
  }

  return results.sort(
    (a, b) => roleOrder(a.role) - roleOrder(b.role) || compare(a.path, b.path),
  );
}

function unavailableOverview(
  file: IndexedFile,
  role: OverviewCandidate["role"],
  packagePath: string,
): OverviewCandidate {
  return {
    path: file.path,
    role,
    packagePath,
    status: "unavailable",
    contentStatus: "unknown",
    truncated: false,
    sectionHints: [],
    blobSha: file.blobSha ?? "",
  };
}

function isOverviewText(path: string): boolean {
  return OVERVIEW_EXTENSIONS.has(extension(path)) || extension(path) === "";
}

function isReadme(file: IndexedFile): boolean {
  const base = basename(file.path);
  return (
    /^readme(?:\.[a-z0-9_-]+)*$/iu.test(base) &&
    README_EXTENSIONS.has(extension(file.path))
  );
}

function readmeCompare(left: IndexedFile, right: IndexedFile): number {
  const score = (path: string): number => {
    const base = basename(path);
    if (base === "readme.md") return 0;
    if (base === "readme.mdx") return 1;
    if (base === "readme.rst") return 2;
    if (base === "readme.txt") return 3;
    if (base === "readme") return 4;
    return 5;
  };
  return score(left.path) - score(right.path) || compare(left.path, right.path);
}

function isArchitectureDocument(file: IndexedFile): boolean {
  if (!OVERVIEW_EXTENSIONS.has(extension(file.path))) return false;
  const base = basename(file.path).replace(/\.[^.]+$/u, "");
  const directory = dirname(file.path).toLowerCase();
  return (
    [
      "architecture",
      "design",
      "overview",
      "system-design",
      "structure",
    ].includes(base) &&
    (directory === "" || directory === "docs" || directory.startsWith("docs/"))
  );
}

function architectureScore(path: string): number {
  const base = basename(path);
  if (base.startsWith("architecture")) return path.startsWith("docs/") ? 0 : 1;
  if (base.startsWith("design")) return path.startsWith("docs/") ? 2 : 3;
  return 4;
}

function documentContentStatus(
  path: string,
  text: string,
): OverviewCandidate["contentStatus"] {
  const opening = text.split(/\r?\n/u).slice(0, 60).join("\n").toLowerCase();
  const name = basename(path);
  if (
    /\b(?:status\s*[:：]\s*planning|planning only|proposal|future work|roadmap|planned implementation)\b/u.test(
      opening,
    ) ||
    /(?:^|[.-])(?:plan|proposal|roadmap)(?:[.-]|$)/u.test(name)
  ) {
    return "planning";
  }
  return /\b(?:overview|architecture|what it does|features)\b/u.test(opening)
    ? "descriptive"
    : "unknown";
}

function sectionHints(
  text: string,
  packageName: string | null,
): Array<{ heading: string; line: number }> {
  const hints: Array<{ heading: string; line: number }> = [];
  const relevance = [
    "overview",
    "about",
    "project",
    "purpose",
    "architecture",
    "design",
    "features",
    "structure",
  ];
  const packageTerms = (packageName ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((term) => term.length > 2);
  const lines = text.split(/\r?\n/u);
  for (
    let index = 0;
    index < Math.min(lines.length, 2_000) && hints.length < 12;
    index += 1
  ) {
    const headingMatch = /^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/u.exec(
      lines[index] ?? "",
    );
    const heading = headingMatch?.[1]?.trim();
    if (!heading) continue;
    const lower = heading.toLowerCase();
    if (
      relevance.some((word) => lower.includes(word)) ||
      packageTerms.some((word) => lower.includes(word))
    ) {
      hints.push({ heading: heading.slice(0, 120), line: index + 1 });
    }
  }
  return hints;
}

function overviewFingerprint(text: string, packageName: string | null): string {
  let normalized = text.normalize("NFKC");
  if (packageName) {
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    normalized = normalized.replace(
      new RegExp(escapedName, "giu"),
      "<package>",
    );
  }
  normalized = normalized.replace(/^(\s{0,3}#{1,2})\s+.+$/mu, "$1 <title>");
  return normalized
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/\s+/gu, " ").toLowerCase())
    .filter(Boolean)
    .join("\n");
}

function packageNameForPath(
  packages: PackageMetadata[],
  packagePath: string,
): string | null {
  return (
    packages.find((item) => item.path === packagePath)?.packageName ?? null
  );
}

function packageForPath(packages: PackageMetadata[], filePath: string): string {
  return (
    [...packages]
      .filter(
        (item) =>
          item.path &&
          (filePath === item.path || filePath.startsWith(`${item.path}/`)),
      )
      .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? ""
  );
}

function roleOrder(role: OverviewCandidate["role"]): number {
  if (role === "root-readme") return 0;
  if (role === "package-readme") return 1;
  return 2;
}

function discoverEntrypoints(
  packages: PackageMetadata[],
  files: IndexedFile[],
  fileIndex: Map<string, IndexedFile>,
  inventoryPackages: ProjectDiscoveryInput["inventory"]["packages"],
): EntrypointCandidate[] {
  const candidates = new Map<string, EntrypointCandidate>();
  const add = (
    path: string,
    reason: EntrypointCandidate["reason"],
    confidence: EntrypointCandidate["confidence"],
    packagePath?: string,
  ): void => {
    const normalized = normalizeInventoryPath(path);
    const file = normalized ? fileIndex.get(normalized) : undefined;
    if (
      !normalized ||
      !file ||
      !isEligibleInventoryFile(file) ||
      !SOURCE_EXTENSIONS.has(extension(normalized))
    )
      return;
    const owningPackage = packagePath ?? packageForPath(packages, normalized);
    const key = `${normalized}\u0000${owningPackage}`;
    const existing = candidates.get(key);
    if (!existing || confidence === "medium") {
      candidates.set(key, {
        path: normalized,
        packagePath: owningPackage,
        confidence,
        reason,
      });
    }
  };

  for (const packageInfo of packages) {
    for (const path of packageInfo.entrypointPaths)
      add(path, "manifest-entry", "medium", packageInfo.path);
  }
  for (const boundary of inventoryPackages) {
    const packagePath = boundary.path
      ? normalizeInventoryPath(boundary.path)
      : "";
    if (packagePath === null) continue;
    for (const path of boundary.entrypointPaths)
      add(path, "inventory-entry", "medium", packagePath);
  }

  const conventionalNames = new Set([
    "__main__.py",
    "app.py",
    "application.java",
    "index.js",
    "index.jsx",
    "index.ts",
    "index.tsx",
    "main.go",
    "main.java",
    "main.js",
    "main.py",
    "main.rs",
    "manage.py",
  ]);
  for (const file of files) {
    if (
      !isEligibleInventoryFile(file) ||
      !SOURCE_EXTENSIONS.has(extension(file.path))
    )
      continue;
    const relative = relativePackagePath(
      file.path,
      packageForPath(packages, file.path),
    );
    const base = basename(file.path);
    if (
      conventionalNames.has(base) ||
      /^(?:src|app|pages)\/(?:index|main)\.[a-z0-9]+$/u.test(relative) ||
      /^app\/page\.[a-z0-9]+$/u.test(relative) ||
      /^src\/app\/page\.[a-z0-9]+$/u.test(relative) ||
      /^src\/main\.[a-z0-9]+$/u.test(relative)
    ) {
      add(file.path, "conventional-entry", "low");
    }
  }
  return [...candidates.values()]
    .sort(
      (a, b) =>
        compare(a.packagePath, b.packagePath) || compare(a.path, b.path),
    )
    .slice(0, MAX_ENTRYPOINTS);
}

function relativePackagePath(path: string, packagePath: string): string {
  return packagePath && path.startsWith(`${packagePath}/`)
    ? path.slice(packagePath.length + 1)
    : path;
}

function inferFrameworks(packages: PackageMetadata[]): FrameworkSuggestion[] {
  const frameworkSignals: Readonly<Record<string, string>> = {
    next: "Next.js",
    react: "React",
    vue: "Vue",
    svelte: "Svelte",
    vite: "Vite",
    angular: "Angular",
    "@angular/core": "Angular",
    express: "Express",
    fastify: "Fastify",
    "@nestjs/core": "NestJS",
    fastapi: "FastAPI",
    flask: "Flask",
    django: "Django",
    "spring-boot": "Spring Boot",
  };
  const suggestions = new Map<string, FrameworkSuggestion>();
  for (const packageInfo of packages) {
    for (const dependency of packageInfo.dependencies) {
      const name = frameworkSignals[dependency];
      if (!name) continue;
      const sourcePath = packageInfo.manifestPaths[0];
      if (!sourcePath) continue;
      const key = `${name}\u0000${sourcePath}`;
      suggestions.set(key, {
        name,
        sourcePath,
        confidence: "medium",
        evidenceStatus: "suggested",
      });
    }
  }
  return [...suggestions.values()]
    .sort(
      (a, b) => compare(a.name, b.name) || compare(a.sourcePath, b.sourcePath),
    )
    .slice(0, 64);
}

function inferCapabilities(
  packages: PackageMetadata[],
  frameworks: FrameworkSuggestion[],
  files: IndexedFile[],
  entrypoints: EntrypointCandidate[],
): CapabilitySuggestion[] {
  const signals = new Map<
    CapabilitySuggestion["capability"],
    CapabilitySuggestion["evidence"]
  >();
  const add = (
    capability: CapabilitySuggestion["capability"],
    path: string,
    signal: string,
    source: CapabilitySuggestion["evidence"][number]["source"],
    confidence: CapabilitySuggestion["confidence"],
  ): void => {
    const evidence = signals.get(capability) ?? [];
    if (
      !evidence.some(
        (item) =>
          item.path === path &&
          item.signal === signal &&
          item.source === source,
      )
    ) {
      evidence.push({ path, signal, source });
      signals.set(capability, evidence);
    }
    const key = `${capability}\u0000${path}\u0000${signal}\u0000${source}`;
    confidences.set(key, confidence);
  };
  const confidences = new Map<string, CapabilitySuggestion["confidence"]>();

  for (const framework of frameworks) {
    if (
      ["Next.js", "React", "Vue", "Svelte", "Vite", "Angular"].includes(
        framework.name,
      )
    ) {
      add(
        "web-application",
        framework.sourcePath,
        `${framework.name} dependency`,
        "manifest",
        "medium",
      );
    }
    if (
      [
        "Express",
        "Fastify",
        "NestJS",
        "FastAPI",
        "Flask",
        "Django",
        "Spring Boot",
      ].includes(framework.name)
    ) {
      add(
        "api-service",
        framework.sourcePath,
        `${framework.name} dependency`,
        "manifest",
        "medium",
      );
    }
  }

  const mlDependencies = new Set([
    "torch",
    "pytorch",
    "tensorflow",
    "scikit-learn",
    "sklearn",
    "transformers",
  ]);
  for (const packageInfo of packages) {
    const sourcePath = packageInfo.manifestPaths[0];
    if (!sourcePath) continue;
    for (const dependency of packageInfo.dependencies) {
      if (mlDependencies.has(dependency))
        add(
          "machine-learning",
          sourcePath,
          `${dependency} dependency`,
          "manifest",
          "medium",
        );
    }
    if (
      packageInfo.entrypointPaths.length > 0 &&
      packageInfo.manifestPaths.some(
        (path) => basename(path) === "package.json",
      )
    ) {
      const packageJsonBin = packageInfo.entrypointPaths.some((path) =>
        /(?:^|\/)(?:bin|cli|command)(?:\/|\.|$)/iu.test(path),
      );
      if (packageJsonBin)
        add(
          "cli-tool",
          sourcePath,
          "declared CLI entrypoint",
          "manifest",
          "medium",
        );
    }
    if (
      packageInfo.projectTypes.includes("java-mobile") ||
      packageInfo.manifestPaths.some(
        (path) => basename(path) === "androidmanifest.xml",
      )
    ) {
      add(
        "mobile-application",
        sourcePath,
        "mobile package/configuration marker",
        "manifest",
        "medium",
      );
    }
  }

  for (const file of files) {
    if (!isEligibleInventoryFile(file)) continue;
    const path = file.path.toLowerCase();
    const packagePath = packageForPath(packages, file.path);
    const source = "implementation-path" as const;
    if (
      /^(?:app|pages)\/.*\.(?:jsx?|tsx?)$/u.test(
        relativePackagePath(path, packagePath),
      ) ||
      /\/app\/page\.(?:jsx?|tsx?)$/u.test(path)
    ) {
      add(
        "web-application",
        file.path,
        "application route path",
        source,
        "low",
      );
    }
    if (
      /(?:^|\/)(?:api|routes|controllers)\/[^/]+\.(?:[cm]?[jt]s|py|go|java)$/u.test(
        path,
      )
    ) {
      add("api-service", file.path, "API route/controller path", source, "low");
    }
    if (
      /(?:^|\/)(?:train|training|model|models|notebooks?)\.[^/]+$/u.test(
        path,
      ) ||
      /(?:^|\/)notebooks?\//u.test(path)
    ) {
      add(
        "machine-learning",
        file.path,
        "model or training source path",
        source,
        "low",
      );
    }
    if (
      path.endsWith("/androidmanifest.xml") ||
      path === "androidmanifest.xml" ||
      /(?:^|\/)(?:android|ios)\//u.test(path)
    ) {
      add(
        "mobile-application",
        file.path,
        "mobile source/configuration path",
        source,
        "low",
      );
    }
  }
  if (
    entrypoints.some((entrypoint) =>
      ["__main__.py", "main.go", "main.rs", "main.py"].includes(
        basename(entrypoint.path),
      ),
    )
  ) {
    const entry = entrypoints.find((candidate) =>
      ["__main__.py", "main.go", "main.rs", "main.py"].includes(
        basename(candidate.path),
      ),
    );
    if (entry)
      add(
        "cli-tool",
        entry.path,
        "conventional command entrypoint",
        "implementation-path",
        "low",
      );
  }

  return [...signals.entries()]
    .map<CapabilitySuggestion>(([capability, evidence]) => {
      const normalizedEvidence = evidence.sort(
        (a, b) => compare(a.path, b.path) || compare(a.signal, b.signal),
      );
      const hasMedium = normalizedEvidence.some(
        (item) =>
          confidences.get(
            `${capability}\u0000${item.path}\u0000${item.signal}\u0000${item.source}`,
          ) === "medium",
      );
      return {
        capability,
        confidence: hasMedium ? "medium" : "low",
        evidence: normalizedEvidence.slice(0, 24),
        evidenceStatus: "suggested",
      };
    })
    .sort((a, b) => compare(a.capability, b.capability));
}
