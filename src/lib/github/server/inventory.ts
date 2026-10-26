import { createHash } from "node:crypto";
import type {
  GithubDomainError,
  GithubErrorCode,
  GithubJsonClient,
  RepositorySnapshot,
  Result,
} from "./repository";

const MIB = 1024 * 1024;
const SHA_PATTERN = /^[a-fA-F0-9]{40}$/;
const MAX_REPORTED_UNVISITED_SCOPES = 128;

export interface RepositoryInventoryLimits {
  maxEntries: number;
  maxDepth: number;
  maxTreeRequests: number;
  maxTreeWireBytes: number;
}

export const DEFAULT_REPOSITORY_INVENTORY_LIMITS: Readonly<RepositoryInventoryLimits> =
  {
    maxEntries: 10_000,
    maxDepth: 8,
    maxTreeRequests: 32,
    maxTreeWireBytes: 8 * MIB,
  };

export type RepositoryProjectType =
  | "javascript-typescript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "java-mobile"
  | "notebook"
  | "unknown";

export type RepositoryEvidenceRole =
  | "purpose"
  | "stack-build"
  | "product-surface"
  | "core-method"
  | "corroboration"
  | "measurement"
  | "contribution"
  | "unknown";

export type RepositoryPackageRole =
  | "root-context"
  | "manifest"
  | "entrypoint"
  | "test"
  | "measurement"
  | "documentation"
  | "configuration"
  | "implementation"
  | "unknown";

export type CandidateEligibility = "automatic" | "manual-only" | "excluded";

export interface RepositoryFileCandidate {
  id: string;
  snapshotId: string;
  repositoryId: number;
  commitSha: string;
  path: string;
  blobSha: string | null;
  mode: string;
  sizeBytes: number | null;
  packagePath: string | null;
  packageRole: RepositoryPackageRole;
  evidenceRole: RepositoryEvidenceRole;
  reasonCodes: string[];
  safetyFlags: string[];
  eligibility: CandidateEligibility;
  selected: false;
}

export interface RepositoryPackageBoundary {
  path: string;
  kind: "declared" | "conventional" | "selected-scope";
  manifestPaths: string[];
  projectTypes: RepositoryProjectType[];
  entrypointPaths: string[];
}

export type RepositoryInventoryLimitReason =
  | "depth-limit"
  | "entry-limit"
  | "request-limit"
  | "rate-limit"
  | "shared-budget"
  | "wire-limit"
  | "tree-truncated"
  | "unsafe-path";

export interface RepositoryInventory {
  snapshotId: string;
  repositoryId: number;
  commitSha: string;
  treeSha: string;
  packagePath?: string;
  files: RepositoryFileCandidate[];
  packages: RepositoryPackageBoundary[];
  projectTypes: RepositoryProjectType[];
  partial: boolean;
  complete: boolean;
  empty: boolean;
  manualScopeAvailable: true;
  unvisitedScope: string[];
  limitReasons: RepositoryInventoryLimitReason[];
  recursiveTruncationRecovered: boolean;
  usage: {
    entriesRetained: number;
    treeRequests: number;
    treeWireBytes: number;
  };
  limits: RepositoryInventoryLimits;
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  sizeBytes: number | null;
}

interface GitTreePage {
  sha: string;
  tree: GitTreeEntry[];
  truncated: boolean;
}

interface RawInventoryEntry extends GitTreeEntry {
  fullPath: string;
}

interface InventoryState {
  limits: RepositoryInventoryLimits;
  entries: Map<string, RawInventoryEntry>;
  unvisited: Set<string>;
  reasons: Set<RepositoryInventoryLimitReason>;
  treeRequests: number;
  treeWireBytes: number;
  partial: boolean;
  recursiveTruncationRecovered: boolean;
}

type TreeRequestOutcome<Context> =
  | { kind: "page"; page: GitTreePage }
  | { kind: "limit" }
  | { kind: "error"; error: GithubDomainError };

interface BuildInventoryArguments<Context> {
  snapshot: RepositorySnapshot;
  context: Context;
  client: GithubJsonClient<Context>;
  limits?: Partial<RepositoryInventoryLimits>;
}

const PROJECT_TYPE_ORDER: readonly RepositoryProjectType[] = [
  "javascript-typescript",
  "python",
  "go",
  "rust",
  "java",
  "java-mobile",
  "notebook",
  "unknown",
];

const SOURCE_EXTENSIONS: Readonly<Record<string, RepositoryProjectType>> = {
  ".c": "unknown",
  ".cc": "unknown",
  ".cpp": "unknown",
  ".cs": "unknown",
  ".go": "go",
  ".java": "java",
  ".js": "javascript-typescript",
  ".jsx": "javascript-typescript",
  ".kt": "java-mobile",
  ".kts": "java-mobile",
  ".m": "unknown",
  ".mm": "unknown",
  ".php": "unknown",
  ".py": "python",
  ".rb": "unknown",
  ".rs": "rust",
  ".scala": "java",
  ".swift": "java-mobile",
  ".ts": "javascript-typescript",
  ".tsx": "javascript-typescript",
  ".vue": "javascript-typescript",
};

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cfg",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".go",
  ".gradle",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".py",
  ".rb",
  ".rs",
  ".rst",
  ".scala",
  ".sh",
  ".sql",
  ".svg",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".ipynb",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".apk",
  ".bin",
  ".class",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".onnx",
  ".pdf",
  ".png",
  ".pt",
  ".pth",
  ".safetensors",
  ".so",
  ".woff",
  ".woff2",
  ".zip",
]);

const GENERATED_DIRECTORY_NAMES = new Set([
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "__pycache__",
  ".venv",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const WORKSPACE_MANIFESTS = new Set([
  "lerna.json",
  "pnpm-workspace.yaml",
  "settings.gradle",
  "settings.gradle.kts",
  "go.work",
]);

function fail<T>(error: GithubDomainError): Result<T> {
  return { ok: false, error };
}

function makeError(
  code: GithubErrorCode,
  message: string,
  retryable = false,
): GithubDomainError {
  return { code, message, retryable };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFullSha(value: unknown): value is string {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isSafeTreePath(path: string): boolean {
  if (
    !path ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    /%(?:2e|2f|5c)/i.test(path)
  ) {
    return false;
  }
  return path
    .split("/")
    .every((component) => component && component !== "." && component !== "..");
}

function validateLimits(
  requested: Partial<RepositoryInventoryLimits> | undefined,
): Result<RepositoryInventoryLimits> {
  const limits: RepositoryInventoryLimits = {
    maxEntries: Math.min(
      requested?.maxEntries ?? DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxEntries,
      DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxEntries,
    ),
    maxDepth: Math.min(
      requested?.maxDepth ?? DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxDepth,
      DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxDepth,
    ),
    maxTreeRequests: Math.min(
      requested?.maxTreeRequests ??
        DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxTreeRequests,
      DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxTreeRequests,
    ),
    maxTreeWireBytes: Math.min(
      requested?.maxTreeWireBytes ??
        DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxTreeWireBytes,
      DEFAULT_REPOSITORY_INVENTORY_LIMITS.maxTreeWireBytes,
    ),
  };

  if (
    !Number.isSafeInteger(limits.maxEntries) ||
    limits.maxEntries < 1 ||
    !Number.isSafeInteger(limits.maxDepth) ||
    limits.maxDepth < 0 ||
    !Number.isSafeInteger(limits.maxTreeRequests) ||
    limits.maxTreeRequests < 1 ||
    !Number.isSafeInteger(limits.maxTreeWireBytes) ||
    limits.maxTreeWireBytes < 1
  ) {
    return fail(
      makeError("invalid-input", "Repository inventory limits are invalid."),
    );
  }

  return { ok: true, value: limits };
}

function createState(limits: RepositoryInventoryLimits): InventoryState {
  return {
    limits,
    entries: new Map(),
    unvisited: new Set(),
    reasons: new Set(),
    treeRequests: 0,
    treeWireBytes: 0,
    partial: false,
    recursiveTruncationRecovered: false,
  };
}

function addUnvisited(state: InventoryState, path: string): void {
  if (!path) path = ".";
  if (state.unvisited.size < MAX_REPORTED_UNVISITED_SCOPES) {
    state.unvisited.add(path);
  } else {
    state.unvisited.add("additional scope omitted");
  }
  state.partial = true;
}

function markPartial(
  state: InventoryState,
  reason: RepositoryInventoryLimitReason,
  path: string,
): void {
  state.reasons.add(reason);
  addUnvisited(state, path);
}

function parseTreePage(
  value: unknown,
  expectedSha: string,
): Result<GitTreePage> {
  if (
    !isRecord(value) ||
    !isFullSha(value.sha) ||
    value.sha.toLowerCase() !== expectedSha.toLowerCase()
  ) {
    return fail(
      makeError(
        "upstream-error",
        "GitHub returned a tree for a different repository revision.",
      ),
    );
  }
  if (!Array.isArray(value.tree) || typeof value.truncated !== "boolean") {
    return fail(
      makeError(
        "upstream-error",
        "GitHub returned an invalid repository tree.",
      ),
    );
  }

  const tree: GitTreeEntry[] = [];
  for (const rawEntry of value.tree) {
    if (!isRecord(rawEntry)) {
      return fail(
        makeError(
          "upstream-error",
          "GitHub returned an invalid repository tree entry.",
        ),
      );
    }
    const validModeForType =
      (rawEntry.type === "tree" && rawEntry.mode === "040000") ||
      (rawEntry.type === "commit" && rawEntry.mode === "160000") ||
      (rawEntry.type === "blob" &&
        typeof rawEntry.mode === "string" &&
        ["100644", "100755", "120000"].includes(rawEntry.mode));
    if (
      typeof rawEntry.path !== "string" ||
      typeof rawEntry.mode !== "string" ||
      !validModeForType ||
      !isFullSha(rawEntry.sha)
    ) {
      return fail(
        makeError(
          "upstream-error",
          "GitHub returned an invalid repository tree entry.",
        ),
      );
    }

    const sizeBytes =
      typeof rawEntry.size === "number" &&
      Number.isSafeInteger(rawEntry.size) &&
      rawEntry.size >= 0
        ? rawEntry.size
        : null;
    tree.push({
      path: rawEntry.path,
      mode: rawEntry.mode,
      type: rawEntry.type as GitTreeEntry["type"],
      sha: rawEntry.sha.toLowerCase(),
      sizeBytes,
    });
  }

  return {
    ok: true,
    value: { sha: value.sha.toLowerCase(), tree, truncated: value.truncated },
  };
}

function safeTreeError(error: GithubDomainError): GithubDomainError {
  if (error.code === "not-found") {
    return makeError("not-found", "The pinned repository tree is unavailable.");
  }
  return error;
}

async function requestTree<Context>(args: {
  state: InventoryState;
  client: GithubJsonClient<Context>;
  context: Context;
  snapshot: RepositorySnapshot;
  treeSha: string;
  path: string;
  recursive: boolean;
}): Promise<TreeRequestOutcome<Context>> {
  const { state, client, context, snapshot, treeSha, path, recursive } = args;
  if (state.treeRequests >= state.limits.maxTreeRequests) {
    markPartial(state, "request-limit", path);
    return { kind: "limit" };
  }
  if (state.treeWireBytes >= state.limits.maxTreeWireBytes) {
    markPartial(state, "wire-limit", path);
    return { kind: "limit" };
  }

  state.treeRequests += 1;
  const requestPath = `/repos/${encodeURIComponent(snapshot.owner)}/${encodeURIComponent(snapshot.name)}/git/trees/${encodeURIComponent(treeSha)}`;
  let response;
  try {
    response = await client.getJson<unknown>({
      path: requestPath,
      ...(recursive ? { query: { recursive: 1 } } : {}),
      context,
    });
  } catch {
    return {
      kind: "error",
      error: makeError(
        "io-error",
        "The pinned repository tree could not be read.",
        true,
      ),
    };
  }

  if (!response.ok) {
    if (
      response.error.code === "limit-exceeded" ||
      response.error.code === "rate-limited"
    ) {
      markPartial(
        state,
        response.error.code === "rate-limited" ? "rate-limit" : "shared-budget",
        path,
      );
      return { kind: "limit" };
    }
    return { kind: "error", error: safeTreeError(response.error) };
  }

  if (response.value.status === 404) {
    return {
      kind: "error",
      error: makeError(
        "not-found",
        "The pinned repository tree is unavailable.",
      ),
    };
  }
  if (
    !Number.isInteger(response.value.status) ||
    response.value.status < 200 ||
    response.value.status >= 300
  ) {
    return {
      kind: "error",
      error: makeError(
        "upstream-error",
        "GitHub returned an invalid repository tree response.",
        true,
      ),
    };
  }
  if (
    !Number.isSafeInteger(response.value.wireBytes) ||
    response.value.wireBytes < 0
  ) {
    return {
      kind: "error",
      error: makeError(
        "upstream-error",
        "GitHub did not report valid repository tree byte usage.",
      ),
    };
  }

  state.treeWireBytes += response.value.wireBytes;
  if (state.treeWireBytes > state.limits.maxTreeWireBytes) {
    markPartial(state, "wire-limit", path);
    return { kind: "limit" };
  }

  const page = parseTreePage(response.value.data, treeSha);
  if (!page.ok) return { kind: "error", error: page.error };
  return { kind: "page", page: page.value };
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function joinPath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function treeDepth(path: string): number {
  return path.split("/").length;
}

function recordEntry(
  state: InventoryState,
  entry: GitTreeEntry,
  basePath: string,
): boolean {
  const fullPath = joinPath(basePath, entry.path);
  if (!isSafeTreePath(fullPath)) {
    markPartial(state, "unsafe-path", "unsafe path omitted");
    return true;
  }
  if (state.entries.has(fullPath)) return true;
  if (state.entries.size >= state.limits.maxEntries) {
    markPartial(state, "entry-limit", fullPath);
    return false;
  }
  state.entries.set(fullPath, { ...entry, fullPath });
  return true;
}

function markRemainingEntries(
  state: InventoryState,
  entries: GitTreeEntry[],
  start: number,
  basePath: string,
): void {
  for (let index = start; index < entries.length; index += 1) {
    const path = joinPath(basePath, entries[index].path);
    if (isSafeTreePath(path)) addUnvisited(state, path);
  }
}

function processRecursivePage(
  state: InventoryState,
  page: GitTreePage,
  basePath: string,
  baseDepth: number,
): void {
  const entries = [...page.tree].sort((left, right) =>
    comparePath(left.path, right.path),
  );
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const fullPath = joinPath(basePath, entry.path);
    const depth = baseDepth + treeDepth(entry.path);
    if (!isSafeTreePath(fullPath)) {
      markPartial(state, "unsafe-path", "unsafe path omitted");
      continue;
    }
    if (depth > state.limits.maxDepth) {
      markPartial(state, "depth-limit", fullPath);
      continue;
    }
    if (!recordEntry(state, entry, basePath)) {
      markRemainingEntries(state, entries, index, basePath);
      break;
    }
  }
}

async function walkBoundedSubtrees<Context>(args: {
  state: InventoryState;
  client: GithubJsonClient<Context>;
  context: Context;
  snapshot: RepositorySnapshot;
  rootTreeSha: string;
  basePath: string;
  baseDepth: number;
}): Promise<Result<void>> {
  const { state, client, context, snapshot, rootTreeSha, basePath, baseDepth } =
    args;
  const pending: Array<{ sha: string; path: string; depth: number }> = [
    { sha: rootTreeSha, path: basePath, depth: baseDepth },
  ];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;
    const outcome = await requestTree({
      state,
      client,
      context,
      snapshot,
      treeSha: current.sha,
      path: current.path,
      recursive: false,
    });
    if (outcome.kind === "error") return fail(outcome.error);
    if (outcome.kind === "limit") {
      for (const item of pending) addUnvisited(state, item.path);
      break;
    }

    if (outcome.page.truncated) {
      markPartial(state, "tree-truncated", current.path);
    }
    const entries = [...outcome.page.tree].sort((left, right) =>
      comparePath(left.path, right.path),
    );
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const fullPath = joinPath(current.path, entry.path);
      const depth = current.depth + treeDepth(entry.path);
      if (!isSafeTreePath(fullPath)) {
        markPartial(state, "unsafe-path", "unsafe path omitted");
        continue;
      }
      if (depth > state.limits.maxDepth) {
        markPartial(state, "depth-limit", fullPath);
        continue;
      }
      if (!recordEntry(state, entry, current.path)) {
        markRemainingEntries(state, entries, index, current.path);
        for (const item of pending) addUnvisited(state, item.path);
        pending.length = 0;
        break;
      }
      if (entry.type === "tree") {
        if (depth >= state.limits.maxDepth) {
          markPartial(state, "depth-limit", fullPath);
        } else {
          pending.push({ sha: entry.sha, path: fullPath, depth });
        }
      }
    }
  }

  return { ok: true, value: undefined };
}

function rootContextPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (path.includes("/")) {
    return (
      lower === "docs/index.md" ||
      lower === "docs/index.mdx" ||
      lower === "docs/architecture.md" ||
      lower === "docs/architecture.mdx"
    );
  }
  const base = lower.split("/").pop() ?? lower;
  return (
    /^readme(?:\.[a-z0-9]+)?$/i.test(base) ||
    /^license(?:\.[a-z0-9]+)?$/i.test(base) ||
    /^copying(?:\.[a-z0-9]+)?$/i.test(base) ||
    /^contributing(?:\.[a-z0-9]+)?$/i.test(base) ||
    isManifestName(base) ||
    WORKSPACE_MANIFESTS.has(base)
  );
}

function withinPackage(path: string, packagePath: string): boolean {
  return path.startsWith(`${packagePath}/`);
}

function visibleInScope(
  path: string,
  packagePath: string | undefined,
): boolean {
  if (!packagePath) return true;
  return withinPackage(path, packagePath) || rootContextPath(path);
}

function extension(path: string): string {
  const base = path.toLowerCase().split("/").pop() ?? path.toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

function basename(path: string): string {
  return path.toLowerCase().split("/").pop() ?? path.toLowerCase();
}

function isManifestName(base: string): boolean {
  return new Set([
    "androidmanifest.xml",
    "build.gradle",
    "build.gradle.kts",
    "cargo.toml",
    "go.mod",
    "package.json",
    "pipfile",
    "pom.xml",
    "pyproject.toml",
    "requirements.txt",
    "setup.cfg",
    "setup.py",
  ]).has(base);
}

function isWorkspaceOrBuildConfig(path: string): boolean {
  const base = basename(path);
  return (
    WORKSPACE_MANIFESTS.has(base) ||
    [
      "dockerfile",
      "makefile",
      "package-lock.json",
      "pnpm-lock.yaml",
      "poetry.lock",
      "tsconfig.json",
      "yarn.lock",
    ].includes(base) ||
    /^(?:next|vite|webpack|jest|vitest|playwright)\.config\.[a-z0-9.]+$/.test(
      base,
    )
  );
}

function isTestPath(path: string): boolean {
  const lower = path.toLowerCase();
  const parts = lower.split("/");
  const base = parts.at(-1) ?? lower;
  return (
    parts.some((part) =>
      ["__tests__", "test", "tests", "spec", "specs"].includes(part),
    ) ||
    /\.(?:test|spec)\.[a-z0-9]+$/.test(base) ||
    /_test\.go$/.test(base) ||
    /test\.java$/.test(base)
  );
}

function isEntrypoint(path: string): boolean {
  const lower = path.toLowerCase();
  const base = basename(path);
  return (
    [
      "__main__.py",
      "application.java",
      "cli.py",
      "index.js",
      "index.ts",
      "main.go",
      "main.java",
      "main.py",
      "main.rs",
      "server.js",
      "server.ts",
    ].includes(base) ||
    /^(?:main|index|app|server|cli)\.(?:cjs|js|jsx|mjs|mts|py|ts|tsx)$/.test(
      base,
    ) ||
    /^(?:src\/)?(?:app|pages)\/(?:.*\/)?(?:page|route)\.(?:js|jsx|ts|tsx)$/.test(
      lower,
    )
  );
}

function isProductSurface(path: string): boolean {
  return /(?:^|\/)(?:app|pages|routes|api)\//i.test(path);
}

function isMeasurementReport(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /(?:^|\/)(?:benchmarks?|coverage|evaluation|metrics?|reports?)\//.test(
      lower,
    ) && [".csv", ".json", ".md", ".txt"].includes(extension(path))
  );
}

function isDocumentation(path: string): boolean {
  return (
    /(?:^|\/)(?:docs?|documentation)\//i.test(path) ||
    [".adoc", ".md", ".mdx", ".rst"].includes(extension(path))
  );
}

function isPurposeDocument(path: string): boolean {
  return /^(?:readme|contributing|architecture|design)(?:\.[^/]*)?$/i.test(
    basename(path),
  );
}

function isGeneratedCandidate(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  const base = basename(path);
  return (
    parts.some((part) => GENERATED_DIRECTORY_NAMES.has(part)) ||
    /\.(?:min\.(?:js|css)|map)$/.test(base) ||
    ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(base)
  );
}

function isVendoredCandidate(path: string): boolean {
  return path
    .toLowerCase()
    .split("/")
    .some((part) =>
      ["third_party", "third-party", "vendor", "vendored"].includes(part),
    );
}

function isSecretCandidate(path: string): boolean {
  const lower = path.toLowerCase();
  const base = basename(path);
  return (
    base === ".env" ||
    base.startsWith(".env.") ||
    [
      "id_rsa",
      "id_ed25519",
      "credentials.json",
      "secrets.json",
      ".npmrc",
      ".pypirc",
    ].includes(base) ||
    [".key", ".pem", ".p12", ".pfx", ".tfstate"].some((suffix) =>
      lower.endsWith(suffix),
    )
  );
}

function isNotebook(path: string): boolean {
  return extension(path) === ".ipynb";
}

function categoryFor(path: string): RepositoryEvidenceRole {
  const base = basename(path);
  if (isTestPath(path)) return "corroboration";
  if (isManifestName(base) || isWorkspaceOrBuildConfig(path))
    return "stack-build";
  if (isPurposeDocument(path)) return "purpose";
  if (isMeasurementReport(path)) return "measurement";
  if (isProductSurface(path)) return "product-surface";
  if (isEntrypoint(path)) return "product-surface";
  if (isDocumentation(path)) return "purpose";
  if (SOURCE_EXTENSIONS[extension(path)]) return "core-method";
  return "unknown";
}

function packageRoleFor(
  path: string,
  evidenceRole: RepositoryEvidenceRole,
  selectedPackagePath: string | undefined,
): RepositoryPackageRole {
  if (selectedPackagePath && !withinPackage(path, selectedPackagePath)) {
    return "root-context";
  }
  if (evidenceRole === "stack-build") return "manifest";
  if (evidenceRole === "corroboration") return "test";
  if (evidenceRole === "measurement") return "measurement";
  if (evidenceRole === "purpose") return "documentation";
  if (isEntrypoint(path) || evidenceRole === "product-surface")
    return "entrypoint";
  if (evidenceRole === "core-method") return "implementation";
  if (isWorkspaceOrBuildConfig(path)) return "configuration";
  return "unknown";
}

function packageRoot(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function manifestPackagePath(path: string): string | null {
  const base = basename(path);
  if (
    [
      "package.json",
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "pipfile",
      "go.mod",
      "cargo.toml",
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
    ].includes(base)
  ) {
    return packageRoot(path);
  }
  return null;
}

function stableFileId(
  snapshotId: string,
  path: string,
  sha: string,
  mode: string,
): string {
  const digest = createHash("sha256")
    .update(`${snapshotId}\n${path}\n${sha}\n${mode}`)
    .digest("hex");
  return `github-file-${digest}`;
}

function longestPackageRoot(path: string, roots: string[]): string | null {
  const matches = roots.filter((root) =>
    root === ""
      ? !path.startsWith("../")
      : path === root || withinPackage(path, root),
  );
  matches.sort(
    (left, right) => right.length - left.length || comparePath(left, right),
  );
  return matches[0] ?? null;
}

function hasExtension(path: string): boolean {
  const base = basename(path);
  return (
    TEXT_EXTENSIONS.has(extension(path)) ||
    [
      "dockerfile",
      "license",
      "makefile",
      "readme",
      ".gitattributes",
      ".gitignore",
    ].includes(base)
  );
}

function candidateFor(
  entry: RawInventoryEntry,
  snapshot: RepositorySnapshot,
  selectedPackagePath: string | undefined,
  packageRoots: string[],
): RepositoryFileCandidate {
  const evidenceRole = categoryFor(entry.fullPath);
  const packageRole = packageRoleFor(
    entry.fullPath,
    evidenceRole,
    selectedPackagePath,
  );
  const flags: string[] = [];
  const isSymlink = entry.mode === "120000";
  const isSubmodule = entry.type === "commit" || entry.mode === "160000";
  const binaryCandidate = BINARY_EXTENSIONS.has(extension(entry.fullPath));
  const generatedCandidate = isGeneratedCandidate(entry.fullPath);
  const vendoredCandidate = isVendoredCandidate(entry.fullPath);
  const secretCandidate = isSecretCandidate(entry.fullPath);
  const notebook = isNotebook(entry.fullPath);
  const oversized = entry.sizeBytes !== null && entry.sizeBytes > 64 * 1024;
  const lfsCandidate =
    oversized ||
    (binaryCandidate &&
      [".bin", ".mp4", ".onnx", ".pt", ".pth", ".safetensors", ".zip"].includes(
        extension(entry.fullPath),
      ));

  if (isSymlink) flags.push("symlink");
  if (isSubmodule) flags.push("submodule");
  if (binaryCandidate) flags.push("binary-candidate");
  if (generatedCandidate) flags.push("generated-candidate");
  if (vendoredCandidate) flags.push("vendored-candidate");
  if (lfsCandidate) flags.push("lfs-candidate");
  if (oversized) flags.push("oversized");
  if (entry.sizeBytes === null) flags.push("size-unknown");
  if (secretCandidate) flags.push("secret-candidate");
  if (notebook) flags.push("notebook-unparsed");
  if (evidenceRole === "unknown") flags.push("unknown-format");

  let eligibility: CandidateEligibility = "automatic";
  if (
    isSymlink ||
    isSubmodule ||
    binaryCandidate ||
    oversized ||
    secretCandidate
  ) {
    eligibility = "excluded";
  } else if (
    generatedCandidate ||
    vendoredCandidate ||
    lfsCandidate ||
    notebook ||
    entry.sizeBytes === null ||
    !hasExtension(entry.fullPath)
  ) {
    eligibility = "manual-only";
  }

  const reasonCodes: string[] = [evidenceRole];
  if (
    selectedPackagePath &&
    withinPackage(entry.fullPath, selectedPackagePath)
  ) {
    reasonCodes.push("selected-package-scope");
  }
  if (selectedPackagePath && rootContextPath(entry.fullPath)) {
    reasonCodes.push("root-context");
  }
  if (isEntrypoint(entry.fullPath)) reasonCodes.push("entrypoint-candidate");
  if (isManifestName(basename(entry.fullPath)))
    reasonCodes.push("manifest-candidate");

  return {
    id: stableFileId(
      snapshot.snapshotId,
      entry.fullPath,
      entry.sha,
      entry.mode,
    ),
    snapshotId: snapshot.snapshotId,
    repositoryId: snapshot.repositoryId,
    commitSha: snapshot.commitSha,
    path: entry.fullPath,
    blobSha: isSubmodule ? null : entry.sha,
    mode: entry.mode,
    sizeBytes: entry.sizeBytes,
    packagePath: longestPackageRoot(entry.fullPath, packageRoots),
    packageRole,
    evidenceRole,
    reasonCodes: [...new Set(reasonCodes)],
    safetyFlags: flags,
    eligibility,
    selected: false,
  };
}

function projectTypeForManifest(path: string): RepositoryProjectType[] {
  const base = basename(path);
  if (base === "package.json" || base === "pnpm-workspace.yaml") {
    return ["javascript-typescript"];
  }
  if (
    [
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "pipfile",
    ].includes(base)
  ) {
    return ["python"];
  }
  if (["go.mod", "go.work"].includes(base)) return ["go"];
  if (base === "cargo.toml") return ["rust"];
  if (base === "androidmanifest.xml") return ["java-mobile"];
  if (base === "build.gradle" || base === "build.gradle.kts") {
    return /(?:^|\/)app\//i.test(path) || /android/i.test(path)
      ? ["java-mobile"]
      : ["java"];
  }
  if (base === "pom.xml") return ["java"];
  return [];
}

function inferProjectTypes(
  files: RepositoryFileCandidate[],
): RepositoryProjectType[] {
  const found = new Set<RepositoryProjectType>();
  for (const file of files) {
    for (const type of projectTypeForManifest(file.path)) found.add(type);
    const sourceType = SOURCE_EXTENSIONS[extension(file.path)];
    if (sourceType && sourceType !== "unknown") found.add(sourceType);
    if (isNotebook(file.path)) found.add("notebook");
  }
  if (!found.size) return ["unknown"];
  return PROJECT_TYPE_ORDER.filter((type) => found.has(type));
}

function packageBoundaries(
  files: RepositoryFileCandidate[],
  selectedPackagePath: string | undefined,
): RepositoryPackageBoundary[] {
  const grouped = new Map<
    string,
    { manifests: Set<string>; types: Set<RepositoryProjectType> }
  >();
  for (const file of files) {
    const path = manifestPackagePath(file.path);
    if (path === null) continue;
    const group = grouped.get(path) ?? {
      manifests: new Set(),
      types: new Set(),
    };
    group.manifests.add(file.path);
    for (const type of projectTypeForManifest(file.path)) group.types.add(type);
    grouped.set(path, group);
  }

  if (selectedPackagePath) {
    const group = grouped.get(selectedPackagePath) ?? {
      manifests: new Set<string>(),
      types: new Set<RepositoryProjectType>(),
    };
    grouped.set(selectedPackagePath, group);
  }

  for (const file of files) {
    if (/^src\/[^/]+\/__init__\.py$/i.test(file.path)) {
      const path = packageRoot(file.path);
      const group = grouped.get(path) ?? {
        manifests: new Set<string>(),
        types: new Set<RepositoryProjectType>(),
      };
      group.types.add("python");
      grouped.set(path, group);
    }
    if (/^cmd\/[^/]+\/main\.go$/i.test(file.path)) {
      const path = packageRoot(file.path);
      const group = grouped.get(path) ?? {
        manifests: new Set<string>(),
        types: new Set<RepositoryProjectType>(),
      };
      group.types.add("go");
      grouped.set(path, group);
    }
  }

  const entrypoints = files.filter((file) => isEntrypoint(file.path));
  return [...grouped.entries()]
    .sort(([left], [right]) => comparePath(left, right))
    .map(([path, group]) => {
      const relevantEntrypoints = entrypoints
        .filter((file) => (file.packagePath ?? "") === path)
        .map((file) => file.path)
        .sort(comparePath);
      const types = PROJECT_TYPE_ORDER.filter((type) => group.types.has(type));
      return {
        path,
        kind:
          path === selectedPackagePath
            ? "selected-scope"
            : path
              ? "declared"
              : "declared",
        manifestPaths: [...group.manifests].sort(comparePath),
        projectTypes: types.length ? types : ["unknown"],
        entrypointPaths: relevantEntrypoints,
      };
    });
}

function finalInventory(
  snapshot: RepositorySnapshot,
  state: InventoryState,
): RepositoryInventory {
  const selectedPackagePath = snapshot.packagePath;
  const visibleEntries = [...state.entries.values()]
    .filter((entry) => entry.type !== "tree")
    .filter((entry) => visibleInScope(entry.fullPath, selectedPackagePath))
    .sort((left, right) => comparePath(left.fullPath, right.fullPath));

  const manifestRoots = visibleEntries
    .map((entry) => manifestPackagePath(entry.fullPath))
    .filter((path): path is string => path !== null);
  if (selectedPackagePath) manifestRoots.push(selectedPackagePath);
  const packageRoots = [...new Set(manifestRoots)].sort(comparePath);
  const files = visibleEntries.map((entry) =>
    candidateFor(entry, snapshot, selectedPackagePath, packageRoots),
  );
  const packages = packageBoundaries(files, selectedPackagePath);
  const projectTypes = inferProjectTypes(files);

  return {
    snapshotId: snapshot.snapshotId,
    repositoryId: snapshot.repositoryId,
    commitSha: snapshot.commitSha,
    treeSha: snapshot.treeSha,
    ...(selectedPackagePath ? { packagePath: selectedPackagePath } : {}),
    files,
    packages,
    projectTypes,
    partial: state.partial,
    complete: !state.partial,
    empty: files.length === 0 && !state.partial,
    manualScopeAvailable: true,
    unvisitedScope: [...state.unvisited].sort(comparePath),
    limitReasons: [...state.reasons].sort(comparePath),
    recursiveTruncationRecovered: state.recursiveTruncationRecovered,
    usage: {
      entriesRetained: state.entries.size,
      treeRequests: state.treeRequests,
      treeWireBytes: state.treeWireBytes,
    },
    limits: state.limits,
  };
}

function validateSnapshot(snapshot: RepositorySnapshot): Result<void> {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.repositoryId) ||
    snapshot.repositoryId <= 0 ||
    !snapshot.snapshotId ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(snapshot.owner) ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(snapshot.name) ||
    snapshot.name.includes("..") ||
    typeof snapshot.ref !== "string" ||
    !snapshot.ref ||
    !isFullSha(snapshot.commitSha) ||
    !isFullSha(snapshot.treeSha) ||
    (snapshot.packagePath !== undefined &&
      !isSafeTreePath(snapshot.packagePath))
  ) {
    return fail(
      makeError("invalid-input", "The repository snapshot is invalid."),
    );
  }
  return { ok: true, value: undefined };
}

function notFoundPackage(packagePath: string): GithubDomainError {
  return {
    code: "not-found",
    message:
      "The selected package path is not present in the pinned repository snapshot.",
    retryable: false,
    fieldErrors: { packagePath },
  };
}

function addPageEntries(
  state: InventoryState,
  page: GitTreePage,
  basePath: string,
  baseDepth: number,
): void {
  const entries = [...page.tree].sort((left, right) =>
    comparePath(left.path, right.path),
  );
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const fullPath = joinPath(basePath, entry.path);
    if (!isSafeTreePath(fullPath)) {
      markPartial(state, "unsafe-path", "unsafe path omitted");
      continue;
    }
    const depth = baseDepth + treeDepth(entry.path);
    if (depth > state.limits.maxDepth) {
      markPartial(state, "depth-limit", fullPath);
      continue;
    }
    if (!recordEntry(state, entry, basePath)) {
      markRemainingEntries(state, entries, index, basePath);
      break;
    }
  }
}

function immediateEntry(
  page: GitTreePage,
  component: string,
): GitTreeEntry | undefined {
  return page.tree.find((entry) => entry.path === component);
}

async function inspectSelectedPackage<Context>(args: {
  snapshot: RepositorySnapshot;
  state: InventoryState;
  client: GithubJsonClient<Context>;
  context: Context;
}): Promise<Result<void>> {
  const { snapshot, state, client, context } = args;
  const packagePath = snapshot.packagePath;
  if (!packagePath) return { ok: true, value: undefined };

  const rootOutcome = await requestTree({
    state,
    client,
    context,
    snapshot,
    treeSha: snapshot.treeSha,
    path: ".",
    recursive: false,
  });
  if (rootOutcome.kind === "error") return fail(rootOutcome.error);
  if (rootOutcome.kind === "limit") {
    addUnvisited(state, packagePath);
    return { ok: true, value: undefined };
  }
  if (rootOutcome.page.truncated) markPartial(state, "tree-truncated", ".");

  let activePage = rootOutcome.page;
  let activeTreeSha = snapshot.treeSha;
  let activePath = "";
  const components = packagePath.split("/");
  if (components.length > state.limits.maxDepth) {
    markPartial(state, "depth-limit", packagePath);
    return { ok: true, value: undefined };
  }

  addPageEntries(state, activePage, activePath, 0);

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const entry = immediateEntry(activePage, component);
    if (!entry || entry.type !== "tree") {
      if (activePage.truncated) {
        markPartial(state, "tree-truncated", packagePath);
        return { ok: true, value: undefined };
      }
      return fail(notFoundPackage(packagePath));
    }

    activeTreeSha = entry.sha;
    activePath = joinPath(activePath, component);
    if (index < components.length - 1) {
      const nextOutcome = await requestTree({
        state,
        client,
        context,
        snapshot,
        treeSha: activeTreeSha,
        path: activePath,
        recursive: false,
      });
      if (nextOutcome.kind === "error") return fail(nextOutcome.error);
      if (nextOutcome.kind === "limit") {
        addUnvisited(state, packagePath);
        return { ok: true, value: undefined };
      }
      activePage = nextOutcome.page;
      addPageEntries(state, activePage, activePath, index + 1);
    }
  }

  const packageOutcome = await requestTree({
    state,
    client,
    context,
    snapshot,
    treeSha: activeTreeSha,
    path: packagePath,
    recursive: true,
  });
  if (packageOutcome.kind === "error") return fail(packageOutcome.error);
  if (packageOutcome.kind === "limit") {
    addUnvisited(state, packagePath);
    return { ok: true, value: undefined };
  }

  if (packageOutcome.page.truncated) {
    state.recursiveTruncationRecovered = true;
    const fallback = await walkBoundedSubtrees({
      state,
      client,
      context,
      snapshot,
      rootTreeSha: activeTreeSha,
      basePath: packagePath,
      baseDepth: components.length,
    });
    if (!fallback.ok) return fallback;
  } else {
    processRecursivePage(
      state,
      packageOutcome.page,
      packagePath,
      components.length,
    );
  }

  return { ok: true, value: undefined };
}

export async function buildRepositoryInventory<Context>(
  args: BuildInventoryArguments<Context>,
): Promise<Result<RepositoryInventory>> {
  const snapshotResult = validateSnapshot(args.snapshot);
  if (!snapshotResult.ok) return snapshotResult;
  const limitsResult = validateLimits(args.limits);
  if (!limitsResult.ok) return limitsResult;
  const state = createState(limitsResult.value);
  const selectedPackagePath = args.snapshot.packagePath;

  if (selectedPackagePath) {
    const selected = await inspectSelectedPackage({
      snapshot: args.snapshot,
      state,
      client: args.client,
      context: args.context,
    });
    if (!selected.ok) return selected;
  } else {
    const recursive = await requestTree({
      state,
      client: args.client,
      context: args.context,
      snapshot: args.snapshot,
      treeSha: args.snapshot.treeSha,
      path: ".",
      recursive: true,
    });
    if (recursive.kind === "error") return fail(recursive.error);
    if (recursive.kind === "limit") {
      addUnvisited(state, ".");
    } else if (recursive.page.truncated) {
      state.recursiveTruncationRecovered = true;
      const fallback = await walkBoundedSubtrees({
        state,
        client: args.client,
        context: args.context,
        snapshot: args.snapshot,
        rootTreeSha: args.snapshot.treeSha,
        basePath: "",
        baseDepth: 0,
      });
      if (!fallback.ok) return fallback;
    } else {
      processRecursivePage(state, recursive.page, "", 0);
    }
  }

  return { ok: true, value: finalInventory(args.snapshot, state) };
}
