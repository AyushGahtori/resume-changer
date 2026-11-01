const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const ENCODED_PATH_SEPARATOR_OR_DOT = /%(?:2e|2f|5c)/iu;
const FORBIDDEN_CONFIG_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

export function normalizeInventoryPath(path: string): string | null {
  if (
    !path ||
    path.length > 1_024 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    CONTROL_CHARACTER.test(path) ||
    ENCODED_PATH_SEPARATOR_OR_DOT.test(path)
  ) {
    return null;
  }

  const segments = path.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":"),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export function isSafeConfigKey(key: string): boolean {
  return !FORBIDDEN_CONFIG_KEYS.has(key);
}

export function resolveConfigTarget(
  configPath: string,
  baseUrl: unknown,
  targetPattern: string,
): string | null {
  if (
    !targetPattern ||
    targetPattern.startsWith("/") ||
    targetPattern.startsWith("\\") ||
    targetPattern.includes("\\") ||
    CONTROL_CHARACTER.test(targetPattern) ||
    ENCODED_PATH_SEPARATOR_OR_DOT.test(targetPattern) ||
    /^[a-z][a-z\d+.-]*:/iu.test(targetPattern)
  ) {
    return null;
  }

  const wildcardCount = [...targetPattern].filter(
    (character) => character === "*",
  ).length;
  if (wildcardCount > 1) return null;

  const targetSegments = targetPattern.replace(/^\.\//u, "").split("/");
  if (
    targetSegments.some(
      (segment) =>
        !segment ||
        segment === ".." ||
        segment === "." ||
        segment.includes(":"),
    )
  ) {
    return null;
  }

  const baseSegments = configPath.split("/").slice(0, -1);
  if (typeof baseUrl === "string") {
    const normalizedBase = normalizeRelativeConfigPath(baseUrl);
    if (normalizedBase === null) return null;
    if (normalizedBase) baseSegments.push(...normalizedBase.split("/"));
  }

  const result = [...baseSegments, ...targetSegments].filter(Boolean).join("/");
  return normalizeInventoryPath(result);
}

export function resolveLocalExtends(
  configPath: string,
  value: unknown,
): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    CONTROL_CHARACTER.test(value) ||
    ENCODED_PATH_SEPARATOR_OR_DOT.test(value) ||
    /^[a-z][a-z\d+.-]*:/iu.test(value)
  ) {
    return null;
  }
  const segments = value.replace(/^\.\//u, "").split("/");
  if (
    segments.some((segment) => !segment || segment === ".." || segment === ".")
  ) {
    return null;
  }
  const dir = configPath.split("/").slice(0, -1);
  const requested = [...dir, ...segments].join("/");
  const withExtension = /\.jsonc?$/iu.test(requested)
    ? requested
    : `${requested}.json`;
  return normalizeInventoryPath(withExtension);
}

function normalizeRelativeConfigPath(value: string): string | null {
  if (value === "." || value === "./") return "";
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    CONTROL_CHARACTER.test(value) ||
    ENCODED_PATH_SEPARATOR_OR_DOT.test(value) ||
    /^[a-z][a-z\d+.-]*:/iu.test(value)
  ) {
    return null;
  }
  const segments = value.replace(/^\.\//u, "").split("/").filter(Boolean);
  if (
    segments.some(
      (segment) => segment === ".." || segment === "." || segment.includes(":"),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

export function isGeneratedOrVendored(path: string): boolean {
  const generated = new Set([
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
  return path
    .split("/")
    .some((segment) => generated.has(segment.toLowerCase()));
}

export function isForbiddenConfigKey(key: string): boolean {
  return FORBIDDEN_CONFIG_KEYS.has(key);
}
