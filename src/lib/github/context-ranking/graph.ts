import {
  DEPENDENCY_GRAPH_VERSION,
  type ConfiguredAlias,
  type DependencyEdge,
  type DependencyGraph,
  type DependencyNode,
  type GraphLimits,
  type ImportKind,
  type PackageBoundary,
  type ProjectMap,
  type ScreenedSection,
  type StaticImportReference,
} from "./types";

export const DEFAULT_GRAPH_LIMITS: Readonly<GraphLimits> = {
  maxSections: 1_500,
  maxSourceCharactersPerSection: 24_000,
  maxReferencesPerSection: 200,
  maxEdges: 12_000,
  maxTraversalDepth: 8,
};

const MAX_HARD_LIMITS: GraphLimits = {
  maxSections: 4_000,
  maxSourceCharactersPerSection: 64_000,
  maxReferencesPerSection: 500,
  maxEdges: 24_000,
  maxTraversalDepth: 16,
};

const CODE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
] as const;

const LOGIC_SIGNALS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "try",
  "catch",
  "throw",
  "await",
  "return",
  "reduce",
  "filter",
  "sort",
  "parse",
  "validate",
  "compile",
  "generate",
  "analyze",
  "transform",
  "process",
  "save",
  "query",
  "write",
  "read",
  "handle",
]);

interface Token {
  kind: "identifier" | "string" | "punctuation";
  value: string;
  line: number;
}

interface ResolvedReference {
  status: "resolved" | "external" | "unresolved";
  toPath?: string;
  reason?: DependencyEdge["reason"];
  viaAlias?: string;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Test/spec sources remain verification evidence even if upstream metadata mislabels them. */
export function effectiveEvidenceRole(
  section: Pick<ScreenedSection, "path" | "role">,
): ScreenedSection["role"] {
  const path = section.path.toLowerCase();
  const parts = path.split("/");
  const isTestPath =
    parts.some((part) =>
      ["test", "tests", "__tests__", "spec", "specs"].includes(part),
    ) ||
    /\.(?:test|spec)\.[^.]+$/.test(path) ||
    /(?:^|\/)test_[^/]+\.py$/.test(path) ||
    /_test\.go$/.test(path) ||
    /test\.java$/.test(path);
  return isTestPath ? "verification" : section.role;
}

export function normalizeRepositoryPath(
  value: string,
  allowRoot = false,
): string | null {
  if (value === "") return allowRoot ? "" : null;
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value)
  ) {
    return null;
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return null;
  }
  return segments.join("/");
}

function isWithinRoot(path: string, root: string): boolean {
  return root === "" || path === root || path.startsWith(`${root}/`);
}

function joinRepositoryPath(
  base: string,
  relative: string,
  minimumRoot = "",
): string | null {
  if (!relative || relative.includes("\\") || relative.includes("\0"))
    return null;
  if (relative.startsWith("/") || /^[a-zA-Z]:/.test(relative)) return null;
  const segments = base === "" ? [] : base.split("/");
  const rootSegments = minimumRoot === "" ? [] : minimumRoot.split("/");
  if (!isWithinRoot(base, minimumRoot)) return null;
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length <= rootSegments.length) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function parentDirectory(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function isJavaScriptLike(path: string, language: string): boolean {
  const normalizedLanguage = language.toLowerCase();
  return (
    [
      "javascript",
      "typescript",
      "javascript-typescript",
      "jsx",
      "tsx",
    ].includes(normalizedLanguage) || /\.(?:[cm]?[jt]sx?)$/i.test(path)
  );
}

function tokenize(source: string, maxTokens: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let line = 1;

  while (index < source.length && tokens.length < maxTokens) {
    const character = source[index];
    const next = source[index + 1];

    if (/\s/.test(character)) {
      if (character === "\n") line += 1;
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (character === "/" && next === "*") {
      index += 2;
      while (index < source.length) {
        if (source[index] === "\n") line += 1;
        if (source[index] === "*" && source[index + 1] === "/") {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (character === "`" || character === "'" || character === '"') {
      const quote = character;
      const tokenLine = line;
      index += 1;
      let value = "";
      let escaped = false;
      while (index < source.length) {
        const current = source[index];
        if (current === "\n") line += 1;
        if (!escaped && current === quote) {
          index += 1;
          break;
        }
        if (!escaped && current === "\\") {
          escaped = true;
          index += 1;
          continue;
        }
        if (escaped) {
          value += current === "n" ? "\n" : current === "r" ? "\r" : current;
          escaped = false;
        } else {
          value += current;
        }
        index += 1;
      }
      // Template strings can contain expressions; do not interpret their contents as imports.
      if (quote !== "`")
        tokens.push({ kind: "string", value, line: tokenLine });
      continue;
    }

    if (/[A-Za-z_$]/.test(character)) {
      const tokenLine = line;
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index]))
        index += 1;
      tokens.push({
        kind: "identifier",
        value: source.slice(start, index),
        line: tokenLine,
      });
      continue;
    }

    tokens.push({ kind: "punctuation", value: character, line });
    index += 1;
  }

  return tokens;
}

function scanModuleReferences(
  source: string,
  maxTokens: number,
  maxReferences: number,
): StaticImportReference[] {
  const tokens = tokenize(source, maxTokens);
  const references: StaticImportReference[] = [];
  const seen = new Set<string>();
  const add = (specifier: string, kind: ImportKind, line: number) => {
    const key = `${kind}\0${specifier}\0${line}`;
    if (!specifier || seen.has(key) || references.length >= maxReferences)
      return;
    seen.add(key);
    references.push({ specifier, kind, line });
  };

  for (
    let index = 0;
    index < tokens.length && references.length < maxReferences;
    index += 1
  ) {
    const token = tokens[index];
    if (token.kind !== "identifier") continue;
    const previous = tokens[index - 1];
    if (previous?.value === ".") continue;

    if (token.value === "import") {
      const next = tokens[index + 1];
      if (next?.value === "(" && tokens[index + 2]?.kind === "string") {
        const close = tokens[index + 3];
        if (!close || close.value === ")") {
          add(tokens[index + 2].value, "dynamic-import", token.line);
          continue;
        }
      }
      if (next?.kind === "string") {
        add(next.value, "import", token.line);
        continue;
      }
      for (
        let cursor = index + 1;
        cursor < tokens.length && cursor <= index + 100;
        cursor += 1
      ) {
        if (tokens[cursor].value === ";") break;
        if (
          tokens[cursor].kind === "identifier" &&
          tokens[cursor].value === "from" &&
          tokens[cursor + 1]?.kind === "string"
        ) {
          add(tokens[cursor + 1].value, "import", token.line);
          break;
        }
      }
      continue;
    }

    if (token.value === "export") {
      for (
        let cursor = index + 1;
        cursor < tokens.length && cursor <= index + 100;
        cursor += 1
      ) {
        if (tokens[cursor].value === ";") break;
        if (
          tokens[cursor].kind === "identifier" &&
          tokens[cursor].value === "from" &&
          tokens[cursor + 1]?.kind === "string"
        ) {
          add(tokens[cursor + 1].value, "re-export", token.line);
          break;
        }
      }
      continue;
    }

    if (
      token.value === "require" &&
      tokens[index + 1]?.value === "(" &&
      tokens[index + 2]?.kind === "string"
    ) {
      add(tokens[index + 2].value, "require", token.line);
    }
  }

  return references;
}

function validAlias(alias: ConfiguredAlias): boolean {
  const wildcardCount = (value: string) =>
    [...value].filter((character) => character === "*").length;
  return (
    alias.pattern.length > 0 &&
    wildcardCount(alias.pattern) <= 1 &&
    alias.targetPattern.length > 0 &&
    wildcardCount(alias.targetPattern) <= 1 &&
    normalizeRepositoryPath(alias.basePath, true) !== null &&
    normalizeRepositoryPath(alias.packageRoot, true) !== null &&
    isWithinRoot(alias.basePath, alias.packageRoot) &&
    normalizeRepositoryPath(alias.configPath) !== null &&
    !alias.pattern.includes("\\") &&
    !alias.pattern.includes("\0") &&
    !alias.pattern.startsWith("/") &&
    !alias.pattern.split("/").includes("..") &&
    !alias.targetPattern.includes("\\") &&
    !alias.targetPattern.startsWith("/") &&
    !/^[a-zA-Z]:/.test(alias.targetPattern) &&
    !alias.targetPattern.split("/").includes("..")
  );
}

function aliasMatch(pattern: string, specifier: string): string | null {
  const wildcardIndex = pattern.indexOf("*");
  if (wildcardIndex === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  return specifier.slice(
    prefix.length,
    specifier.length - suffix.length || undefined,
  );
}

function packageForPath(
  path: string,
  packages: readonly PackageBoundary[],
): PackageBoundary {
  return (
    [...packages]
      .filter((item) => {
        const root = normalizeRepositoryPath(item.root, true);
        return root !== null && isWithinRoot(path, root);
      })
      .sort(
        (left, right) =>
          right.root.length - left.root.length ||
          compareText(left.root, right.root),
      )[0] ?? {
      root: "",
    }
  );
}

function variantsForBase(basePath: string): string[] {
  const hasExtension = CODE_EXTENSIONS.some((extension) =>
    basePath.toLowerCase().endsWith(extension),
  );
  if (hasExtension) return [basePath];
  return [
    basePath,
    ...CODE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...CODE_EXTENSIONS.map((extension) => `${basePath}/index${extension}`),
  ];
}

function resolveKnownPath(
  basePath: string,
  knownPaths: ReadonlySet<string>,
): string | undefined {
  return variantsForBase(basePath).find((candidate) =>
    knownPaths.has(candidate),
  );
}

function resolveCandidatePath(
  basePath: string,
  knownPaths: ReadonlySet<string>,
  candidatePaths: ReadonlySet<string>,
): ResolvedReference {
  const known = resolveKnownPath(basePath, knownPaths);
  if (!known) {
    return { status: "unresolved", reason: "target-not-in-inventory" };
  }
  if (candidatePaths.has(known)) return { status: "resolved", toPath: known };
  return { status: "unresolved", toPath: known, reason: "target-not-screened" };
}

function resolveSuppliedTargetPath(
  importerPath: string,
  reference: StaticImportReference,
  projectMap: ProjectMap,
  knownPaths: ReadonlySet<string>,
  candidatePaths: ReadonlySet<string>,
): ResolvedReference {
  const suppliedPath = normalizeRepositoryPath(reference.resolvedPath ?? "");
  if (!suppliedPath) return { status: "unresolved", reason: "unsafe-path" };
  const importerPackage = packageForPath(
    importerPath,
    projectMap.packageBoundaries,
  );
  const targetPackage = packageForPath(
    suppliedPath,
    projectMap.packageBoundaries,
  );

  if (importerPackage.root === targetPackage.root) {
    return resolveCandidatePath(suppliedPath, knownPaths, candidatePaths);
  }

  const workspacePackage = matchWorkspacePackage(
    reference.specifier,
    projectMap.packageBoundaries,
  );
  if (
    workspacePackage &&
    isWithinRoot(suppliedPath, workspacePackage.item.root)
  ) {
    return resolveCandidatePath(suppliedPath, knownPaths, candidatePaths);
  }

  const configuredAlias = matchConfiguredAlias(
    reference.specifier,
    importerPackage.root,
    projectMap.aliases,
  );
  if (configuredAlias) {
    const expected = resolveReference(
      importerPath,
      { ...reference, resolvedPath: undefined },
      projectMap,
      knownPaths,
      candidatePaths,
    );
    if (
      (expected.status === "resolved" ||
        expected.reason === "target-not-screened") &&
      expected.toPath === suppliedPath
    ) {
      return expected;
    }
  }

  return { status: "unresolved", reason: "outside-package" };
}

function matchConfiguredAlias(
  specifier: string,
  importerPackageRoot: string,
  aliases: readonly ConfiguredAlias[],
): { alias: ConfiguredAlias; capture: string } | null {
  const matches = aliases
    .filter(
      (alias) =>
        (alias.packageRoot === importerPackageRoot ||
          alias.packageRoot === "") &&
        validAlias(alias),
    )
    .map((alias) => ({ alias, capture: aliasMatch(alias.pattern, specifier) }))
    .filter(
      (item): item is { alias: ConfiguredAlias; capture: string } =>
        item.capture !== null,
    )
    .sort((left, right) => {
      const leftSpecific =
        left.alias.packageRoot === importerPackageRoot ? 1 : 0;
      const rightSpecific =
        right.alias.packageRoot === importerPackageRoot ? 1 : 0;
      return (
        rightSpecific - leftSpecific ||
        right.alias.pattern.length - left.alias.pattern.length ||
        compareText(left.alias.pattern, right.alias.pattern) ||
        compareText(left.alias.targetPattern, right.alias.targetPattern) ||
        compareText(left.alias.basePath, right.alias.basePath) ||
        compareText(left.alias.configPath, right.alias.configPath)
      );
    });
  if (matches.length < 2) return matches[0] ?? null;
  const top = matches[0];
  if (!top) return null;
  const topIsPackageSpecific = top.alias.packageRoot === importerPackageRoot;
  const topMappings = matches.filter(
    (item) =>
      (item.alias.packageRoot === importerPackageRoot) ===
        topIsPackageSpecific &&
      item.alias.pattern.length === top.alias.pattern.length,
  );
  const mappingKeys = new Set(
    topMappings.map(
      ({ alias }) =>
        `${alias.targetPattern}\0${alias.basePath}\0${alias.packageRoot}`,
    ),
  );
  return mappingKeys.size === 1 ? (topMappings[0] ?? null) : null;
}

function matchWorkspacePackage(
  specifier: string,
  packages: readonly PackageBoundary[],
): { item: PackageBoundary; subpath: string } | null {
  const matches = packages
    .filter(
      (item) =>
        item.name &&
        (specifier === item.name || specifier.startsWith(`${item.name}/`)),
    )
    .sort(
      (left, right) =>
        (right.name?.length ?? 0) - (left.name?.length ?? 0) ||
        compareText(left.name ?? "", right.name ?? "") ||
        compareText(left.root, right.root),
    );
  const item = matches[0];
  if (!item?.name) return null;
  return {
    item,
    subpath:
      specifier === item.name ? "" : specifier.slice(item.name.length + 1),
  };
}

function resolveReference(
  importerPath: string,
  reference: StaticImportReference,
  projectMap: ProjectMap,
  knownPaths: ReadonlySet<string>,
  candidatePaths: ReadonlySet<string>,
): ResolvedReference {
  const specifier = reference.specifier;
  if (
    !specifier ||
    specifier.includes("\\") ||
    specifier.includes("\0") ||
    specifier.includes("?") ||
    specifier.includes("#")
  ) {
    return { status: "unresolved", reason: "unsafe-path" };
  }

  if (/^(?:node:|https?:|data:|file:)/i.test(specifier))
    return { status: "external" };

  const importerPackage = packageForPath(
    importerPath,
    projectMap.packageBoundaries,
  );
  const configuredAlias = matchConfiguredAlias(
    specifier,
    importerPackage.root,
    projectMap.aliases,
  );

  if (configuredAlias) {
    const { alias, capture } = configuredAlias;
    if (
      alias.pattern.includes("*") &&
      capture
        .split("/")
        .some(
          (segment) => segment === "" || segment === "." || segment === "..",
        )
    ) {
      return {
        status: "unresolved",
        reason: "unsafe-path",
        viaAlias: alias.pattern,
      };
    }
    const substituted = alias.targetPattern.replace("*", capture);
    const targetBase = joinRepositoryPath(
      alias.basePath,
      substituted,
      alias.packageRoot,
    );
    if (targetBase === null || !isWithinRoot(targetBase, alias.packageRoot)) {
      return {
        status: "unresolved",
        reason: "outside-package",
        viaAlias: alias.pattern,
      };
    }
    const resolved = resolveCandidatePath(
      targetBase,
      knownPaths,
      candidatePaths,
    );
    return { ...resolved, viaAlias: alias.pattern };
  }

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const targetBase = joinRepositoryPath(
      parentDirectory(importerPath),
      specifier,
      importerPackage.root,
    );
    if (targetBase === null)
      return { status: "unresolved", reason: "unsafe-path" };
    if (!isWithinRoot(targetBase, importerPackage.root)) {
      return { status: "unresolved", reason: "outside-package" };
    }
    return resolveCandidatePath(targetBase, knownPaths, candidatePaths);
  }

  if (specifier.startsWith("/")) {
    return { status: "unresolved", reason: "unsupported-root-import" };
  }

  const workspacePackage = matchWorkspacePackage(
    specifier,
    projectMap.packageBoundaries,
  );
  if (workspacePackage) {
    const { item, subpath } = workspacePackage;
    const packageRoot = normalizeRepositoryPath(item.root, true);
    if (packageRoot === null)
      return { status: "unresolved", reason: "unsafe-path" };
    const targetBases = subpath
      ? [joinRepositoryPath(packageRoot, subpath, packageRoot)]
      : (item.entrypoints ?? [])
          .map((entrypoint) => normalizeRepositoryPath(entrypoint))
          .filter((entrypoint): entrypoint is string => entrypoint !== null);
    for (const targetBase of targetBases) {
      if (targetBase === null || !isWithinRoot(targetBase, packageRoot))
        continue;
      const resolved = resolveCandidatePath(
        targetBase,
        knownPaths,
        candidatePaths,
      );
      if (
        resolved.status === "resolved" ||
        resolved.reason === "target-not-screened"
      )
        return resolved;
    }
    return { status: "unresolved", reason: "target-not-in-inventory" };
  }

  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return { status: "unresolved", reason: "unconfigured-alias" };
  }

  if (specifier.startsWith("@") && !specifier.includes("/")) {
    return { status: "unresolved", reason: "unsupported-alias-pattern" };
  }

  // Bare imports are external packages unless the project map declares a workspace package.
  return { status: "external" };
}

function sectionPriority(
  section: ScreenedSection,
  pinnedSectionIds: ReadonlySet<string>,
): number {
  const rolePriority: Record<ScreenedSection["role"], number> = {
    implementation: 4,
    overview: 3,
    configuration: 2,
    verification: 1,
    unknown: 0,
  };
  const boundedExcerpt = section.excerpt.slice(0, 24_000);
  const structuralSignals =
    boundedExcerpt.match(
      /\b(?:function|class|interface|type|def|func|if|for|while|switch|try|await|return|throw|reduce|map|filter|parse|validate|process|generate)\b/g,
    )?.length ?? 0;
  return (
    Number(section.userPinned === true || pinnedSectionIds.has(section.id)) *
      1_000_000 +
    rolePriority[effectiveEvidenceRole(section)] * 10_000 +
    Math.min(section.featureTargets?.length ?? 0, 100) * 1_000 +
    Math.min(structuralSignals, 200) * 20 +
    Math.min(section.excerpt.length, 24_000) / 24
  );
}

function eligibleSection(
  section: ScreenedSection,
  projectMap: ProjectMap,
): boolean {
  return (
    section.safety.eligible &&
    section.safety.screening === "safe" &&
    section.provenance.repositoryId === projectMap.repository.repositoryId &&
    section.provenance.commitSha === projectMap.repository.commitSha &&
    normalizeRepositoryPath(section.path) !== null
  );
}

function tokensToReferences(
  section: ScreenedSection,
  language: string,
  limits: GraphLimits,
  diagnostics: Set<string>,
): StaticImportReference[] {
  if (section.staticImports !== undefined) {
    if (section.staticImports.length > limits.maxReferencesPerSection) {
      diagnostics.add("reference-limit-reached");
    }
    return section.staticImports
      .slice(0, limits.maxReferencesPerSection)
      .map((reference) => ({
        ...reference,
        line:
          reference.line === undefined
            ? undefined
            : reference.line + section.lineStart - 1,
      }));
  }

  if (!isJavaScriptLike(section.path, language)) {
    diagnostics.add("unsupported-language-static-parse");
    return [];
  }

  if (section.excerpt.length > limits.maxSourceCharactersPerSection) {
    diagnostics.add("source-character-limit-reached");
  }
  const boundedExcerpt = section.excerpt.slice(
    0,
    limits.maxSourceCharactersPerSection,
  );
  const tokenLimit = limits.maxReferencesPerSection * 100;
  const scanned = scanModuleReferences(
    boundedExcerpt,
    tokenLimit,
    limits.maxReferencesPerSection,
  );
  return scanned.map((reference) => ({
    ...reference,
    line:
      reference.line === undefined
        ? undefined
        : reference.line + section.lineStart - 1,
  }));
}

function safeLimits(overrides?: Partial<GraphLimits>): GraphLimits {
  const result = { ...DEFAULT_GRAPH_LIMITS, ...overrides };
  for (const key of Object.keys(MAX_HARD_LIMITS) as (keyof GraphLimits)[]) {
    const value = result[key];
    if (!Number.isInteger(value) || value < 1 || value > MAX_HARD_LIMITS[key]) {
      throw new RangeError(
        `Graph limit ${key} must be an integer from 1 to ${MAX_HARD_LIMITS[key]}.`,
      );
    }
  }
  return result;
}

export interface BuildDependencyGraphOptions {
  limits?: Partial<GraphLimits>;
  pinnedSectionIds?: readonly string[];
}

/** Build a bounded static graph from pre-screened excerpts and validated map data. */
export function buildDependencyGraph(
  projectMap: ProjectMap,
  inputSections: readonly ScreenedSection[],
  options: BuildDependencyGraphOptions = {},
): DependencyGraph {
  const limits = safeLimits(options.limits);
  const pinnedSectionIds = new Set(options.pinnedSectionIds ?? []);
  const diagnostics = new Set<string>();
  if (projectMap.aliases.some((alias) => !validAlias(alias))) {
    diagnostics.add("invalid-alias-config-excluded");
  }
  const aliasMappings = new Map<string, Set<string>>();
  for (const alias of projectMap.aliases.filter(validAlias)) {
    const mappings = aliasMappings.get(alias.pattern) ?? new Set<string>();
    mappings.add(
      `${alias.targetPattern}\0${alias.basePath}\0${alias.packageRoot}`,
    );
    aliasMappings.set(alias.pattern, mappings);
  }
  if ([...aliasMappings.values()].some((mappings) => mappings.size > 1)) {
    diagnostics.add("ambiguous-alias-config");
  }
  const sectionsById = new Map<string, ScreenedSection>();
  const eligible: ScreenedSection[] = [];

  for (const section of inputSections) {
    if (sectionsById.has(section.id)) {
      diagnostics.add("duplicate-section-id");
      continue;
    }
    sectionsById.set(section.id, section);
    if (section.safety.screening === "unsafe" || !section.safety.eligible) {
      diagnostics.add("unsafe-section-excluded");
      continue;
    }
    if (section.safety.screening !== "safe") {
      diagnostics.add("unreviewed-section-excluded");
      continue;
    }
    if (
      section.provenance.repositoryId !== projectMap.repository.repositoryId
    ) {
      diagnostics.add("foreign-repository-section-excluded");
      continue;
    }
    if (section.provenance.commitSha !== projectMap.repository.commitSha) {
      diagnostics.add("foreign-revision-section-excluded");
      continue;
    }
    if (normalizeRepositoryPath(section.path) === null) {
      diagnostics.add("invalid-section-path-excluded");
      continue;
    }
    eligible.push(section);
  }

  eligible.sort(
    (left, right) =>
      sectionPriority(right, pinnedSectionIds) -
        sectionPriority(left, pinnedSectionIds) ||
      compareText(left.path, right.path) ||
      compareText(left.id, right.id),
  );
  if (eligible.length > limits.maxSections)
    diagnostics.add("section-limit-reached");
  const boundedSections = eligible.slice(0, limits.maxSections);

  const candidatePaths = new Set(
    boundedSections.map((section) => section.path),
  );
  const knownPaths = new Set(
    projectMap.knownPaths
      .map((path) => normalizeRepositoryPath(path))
      .filter((path): path is string => path !== null),
  );
  for (const section of boundedSections) knownPaths.add(section.path);

  const sectionGroups = new Map<string, ScreenedSection[]>();
  for (const section of boundedSections) {
    const group = sectionGroups.get(section.path) ?? [];
    group.push(section);
    sectionGroups.set(section.path, group);
  }

  const edges: DependencyEdge[] = [];
  const nodes: DependencyNode[] = [];
  for (const [path, pathSections] of [...sectionGroups.entries()].sort(
    ([left], [right]) => compareText(left, right),
  )) {
    const language = projectMap.languageByPath?.[path] ?? inferLanguage(path);
    const referencesByKey = new Map<
      string,
      { reference: StaticImportReference; section: ScreenedSection }
    >();
    for (const section of pathSections) {
      const references = tokensToReferences(
        section,
        language,
        limits,
        diagnostics,
      );
      for (const reference of references) {
        const key = `${reference.kind}\0${reference.specifier}\0${reference.line ?? 0}`;
        if (!referencesByKey.has(key))
          referencesByKey.set(key, { reference, section });
      }
    }
    const references = [...referencesByKey.values()].sort(
      (left, right) =>
        (left.reference.line ?? 0) - (right.reference.line ?? 0) ||
        compareText(left.reference.specifier, right.reference.specifier) ||
        compareText(left.reference.kind, right.reference.kind),
    );
    const boundedReferences = references.slice(
      0,
      limits.maxReferencesPerSection,
    );
    if (references.length > boundedReferences.length)
      diagnostics.add("reference-limit-reached");

    const excerpt = pathSections
      .map((section) =>
        section.excerpt.slice(0, limits.maxSourceCharactersPerSection),
      )
      .join("\n");
    const codeLines = excerpt
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.trim() &&
          !line.trim().startsWith("//") &&
          !line.trim().startsWith("*"),
      ).length;
    const logicTokens = tokenize(
      excerpt,
      limits.maxReferencesPerSection * 100,
    ).filter(
      (token) => token.kind === "identifier" && LOGIC_SIGNALS.has(token.value),
    ).length;
    const importCount = boundedReferences.filter(
      (item) => item.reference.kind !== "re-export",
    ).length;
    const reExportCount = boundedReferences.filter(
      (item) => item.reference.kind === "re-export",
    ).length;
    const wrapperSignals: string[] = [];
    if (reExportCount > 0 && logicTokens <= 2)
      wrapperSignals.push("mostly-re-exports");
    if (importCount + reExportCount > 0 && codeLines <= 40)
      wrapperSignals.push("small-importing-module");
    if (logicTokens <= 3) wrapperSignals.push("few-logic-signals");
    const isThinWrapper =
      importCount + reExportCount > 0 && codeLines <= 45 && logicTokens <= 3;

    nodes.push({
      path,
      sectionIds: pathSections.map((section) => section.id).sort(),
      packageRoot: packageForPath(path, projectMap.packageBoundaries).root,
      language,
      roles: [
        ...new Set(
          pathSections.map((section) => effectiveEvidenceRole(section)),
        ),
      ].sort(),
      featureTargets: [
        ...new Set(
          pathSections.flatMap((section) => section.featureTargets ?? []),
        ),
      ].sort(),
      importCount,
      reExportCount,
      codeLineCount: codeLines,
      logicSignalCount: logicTokens,
      isThinWrapper,
      wrapperSignals,
    });

    for (const item of boundedReferences) {
      if (edges.length >= limits.maxEdges) {
        diagnostics.add("edge-limit-reached");
        break;
      }
      const { reference } = item;
      const resolution = reference.resolvedPath
        ? resolveSuppliedTargetPath(
            path,
            reference,
            projectMap,
            knownPaths,
            candidatePaths,
          )
        : resolveReference(
            path,
            reference,
            projectMap,
            knownPaths,
            candidatePaths,
          );
      edges.push({
        fromPath: path,
        ...(resolution.toPath ? { toPath: resolution.toPath } : {}),
        specifier: reference.specifier,
        kind: reference.kind,
        ...(reference.line === undefined ? {} : { line: reference.line }),
        status: resolution.status,
        ...(resolution.reason ? { reason: resolution.reason } : {}),
        ...(resolution.viaAlias ? { viaAlias: resolution.viaAlias } : {}),
      });
    }
    if (edges.length >= limits.maxEdges) break;
  }

  edges.sort(
    (left, right) =>
      compareText(left.fromPath, right.fromPath) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      compareText(left.specifier, right.specifier) ||
      compareText(left.kind, right.kind),
  );

  return {
    version: DEPENDENCY_GRAPH_VERSION,
    repository: { ...projectMap.repository },
    nodes,
    edges,
    diagnostics: [...diagnostics].sort(),
    limits,
  };
}

function inferLanguage(path: string): string {
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
  if (extension === ".py") return "python";
  if (extension === ".go") return "go";
  if (extension === ".rs") return "rust";
  if (extension === ".java") return "java";
  return "unknown";
}

/** Follow wrapper and re-export edges without looping or exceeding the graph budget. */
export function relatedImplementationTargets(
  graph: DependencyGraph,
  startPath: string,
  requestedDepth = graph.limits.maxTraversalDepth,
): readonly string[] {
  const depth = Math.max(
    1,
    Math.min(requestedDepth, graph.limits.maxTraversalDepth),
  );
  const nodeByPath = new Map(graph.nodes.map((node) => [node.path, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.status !== "resolved" || !edge.toPath) continue;
    const targets = outgoing.get(edge.fromPath) ?? [];
    targets.push(edge.toPath);
    outgoing.set(edge.fromPath, targets);
  }
  const queue: Array<{ path: string; depth: number }> = [
    { path: startPath, depth: 0 },
  ];
  const visited = new Set([startPath]);
  const results = new Set<string>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth >= depth) continue;
    for (const targetPath of outgoing.get(current.path) ?? []) {
      if (visited.has(targetPath)) continue;
      visited.add(targetPath);
      const target = nodeByPath.get(targetPath);
      if (
        target &&
        !target.isThinWrapper &&
        target.roles.includes("implementation") &&
        (target.codeLineCount >= 8 || target.logicSignalCount >= 3)
      ) {
        results.add(targetPath);
      } else if (target?.isThinWrapper) {
        queue.push({ path: targetPath, depth: current.depth + 1 });
      }
    }
  }
  return [...results].sort();
}
