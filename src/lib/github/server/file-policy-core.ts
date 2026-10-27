import { createHash } from "node:crypto";

export type Result<T> =
  { ok: true; value: T } | { ok: false; error: DomainError };

export type DomainErrorCode =
  | "invalid-input"
  | "forbidden"
  | "unavailable"
  | "not-found"
  | "version-conflict"
  | "limit-exceeded"
  | "rate-limited"
  | "needs-context"
  | "invalid-evidence"
  | "io-error"
  | "cancelled"
  | "interrupted"
  | "upstream-error";

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  retryable: boolean;
}

export type EvidenceCategory =
  | "purpose"
  | "stack"
  | "product-surface"
  | "core-method"
  | "corroboration"
  | "measurement"
  | "ui-style"
  | "helper"
  | "unknown";

/** The public inventory projection. It intentionally has no content field. */
export interface FileCandidate {
  id: string;
  path: string;
  blobSha: string;
  mode: string;
  byteSize: number;
  category?: EvidenceCategory;
  reasonCodes?: readonly string[];
  eligibility?: "eligible" | "excluded" | "unknown";
  selected?: boolean;
  pinned?: boolean;
}

export interface FileExclusion {
  fileId: string;
  path?: string;
  reasonCode: string;
}

export const EVIDENCE_LIMITS = Object.freeze({
  maxFetchedFiles: 20,
  maxFileBytes: 64 * 1024,
  maxFetchedBytes: 512 * 1024,
  maxFilesPerRequest: 12,
  maxLinesPerFile: 200,
  maxLinesPerRequest: 1_500,
  maxCharsPerFile: 12_000,
  maxCharsPerRequest: 80_000,
  maxPathLength: 1_024,
  maxLineCharacters: 2_000,
});

const TEXT_EXTENSIONS = new Set([
  ".adoc",
  ".bash",
  ".c",
  ".cc",
  ".cfg",
  ".cjs",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cts",
  ".go",
  ".graphql",
  ".gql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".kt",
  ".less",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".php",
  ".properties",
  ".py",
  ".rb",
  ".rs",
  ".rst",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".tf",
  ".proto",
  ".yaml",
  ".yml",
  ".zsh",
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avif",
  ".bmp",
  ".class",
  ".dll",
  ".dylib",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".otf",
  ".pdf",
  ".png",
  ".pyc",
  ".so",
  ".svgz",
  ".tar",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

const BLOCKED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".vercel",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

const SECRET_PATH_PART =
  /^(?:\.env(?:\..*)?|secrets?|credentials?|private|\.ssh|certs?|keys?)$/i;
const SECRET_FILE_NAME =
  /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*(?:secret|credential|service[-_]?account|firebase-adminsdk).*)$/i;
const GENERATED_FILE_NAME =
  /(?:\.generated\.[^.]+|\.min\.(?:js|css)|\.map|\.lock|\.snap)$/i;
const LOCK_FILE_NAME =
  /^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|cargo\.lock|composer\.lock|gemfile\.lock|poetry\.lock|pipfile\.lock|go\.sum)$/i;

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd)\s*[:=]\s*["']?([A-Za-z0-9/+_.=-]{28,})/i,
];

export function domainError(
  code: DomainErrorCode,
  message: string,
  retryable = false,
): DomainError {
  return { code, message, retryable };
}

export function normalizeRepositoryPath(path: unknown): string | null {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > EVIDENCE_LIMITS.maxPathLength
  ) {
    return null;
  }
  if (path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.startsWith("//"))
    return null;

  const segments = path.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return null;
  }

  return segments.map((segment) => segment.normalize("NFC")).join("/");
}

export function getPathExclusionReason(
  candidate: Pick<FileCandidate, "path" | "mode" | "byteSize">,
): string | null {
  const path = normalizeRepositoryPath(candidate.path);
  if (!path) return "unsafe-path";
  if (candidate.mode !== "100644" && candidate.mode !== "100755")
    return "unsafe-file-mode";
  if (!Number.isSafeInteger(candidate.byteSize) || candidate.byteSize < 0)
    return "invalid-file-size";

  const segments = path.split("/");
  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.some((segment) => BLOCKED_DIRECTORY_NAMES.has(segment))) {
    return "generated-or-vendored-path";
  }
  if (segments.some((segment) => SECRET_PATH_PART.test(segment)))
    return "secret-bearing-path";

  const fileName = segments.at(-1) ?? "";
  if (SECRET_FILE_NAME.test(fileName)) return "secret-bearing-path";
  if (GENERATED_FILE_NAME.test(fileName) || LOCK_FILE_NAME.test(fileName)) {
    return "generated-or-lockfile";
  }

  const extension = extensionOf(fileName);
  if (BINARY_EXTENSIONS.has(extension)) return "binary-file";
  if (extension === ".ipynb") return "unsupported-notebook";
  if (!TEXT_EXTENSIONS.has(extension)) return "unsupported-file-type";
  if (candidate.byteSize > EVIDENCE_LIMITS.maxFileBytes)
    return "file-too-large";

  return null;
}

export function classifyPath(path: string): EvidenceCategory {
  const normalized = normalizeRepositoryPath(path)?.toLowerCase();
  if (!normalized) return "unknown";
  const name = normalized.split("/").at(-1) ?? normalized;
  if (
    /(^|\/)(tests?|specs?|__tests__)(\/|$)/.test(normalized) ||
    /\.(?:test|spec)\.[^.]+$/.test(name)
  ) {
    return "corroboration";
  }
  if (
    /(^|\/)(reports?|benchmarks?|evaluations?)(\/|$)/.test(normalized) ||
    /(?:benchmark|evaluation|metrics?|results?)[-_]?(?:report|summary)?\.(?:json|csv|md|txt)$/.test(
      name,
    )
  ) {
    return "measurement";
  }
  if (/\.(?:css|scss|sass|less)$/.test(name)) return "ui-style";
  if (
    /(^|\/)(docs?|documentation|design)(\/|$)/.test(normalized) ||
    /^(?:readme|architecture|overview|design)(?:\.[^.]+)?$/.test(name)
  ) {
    return "purpose";
  }
  if (
    /^(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|build\.gradle|composer\.json|requirements\.txt|gemfile)$/i.test(
      name,
    )
  ) {
    return "stack";
  }
  if (/\.(?:ya?ml|toml|ini|cfg|conf|jsonc?)$/.test(name)) return "stack";
  if (
    /(^|\/)(?:api|routes?|pages?|app|components?|commands?|cli)(\/|$)/.test(
      normalized,
    ) ||
    /(?:route|controller|page|endpoint)\.[^.]+$/.test(name)
  ) {
    return "product-surface";
  }
  if (
    /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|sql)$/.test(
      name,
    )
  ) {
    return "core-method";
  }
  return "unknown";
}

export interface ContentSafetyResult {
  safe: boolean;
  reasonCode?: string;
  untrustedInstructions: boolean;
  staleDocumentation: boolean;
}

export function inspectFileContent(
  text: unknown,
  path: string,
): ContentSafetyResult {
  if (typeof text !== "string") {
    return {
      safe: false,
      reasonCode: "invalid-content",
      untrustedInstructions: false,
      staleDocumentation: false,
    };
  }

  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > EVIDENCE_LIMITS.maxFileBytes) {
    return {
      safe: false,
      reasonCode: "file-too-large",
      untrustedInstructions: false,
      staleDocumentation: false,
    };
  }
  if (text.includes("\u0000") || hasBinaryControls(text)) {
    return {
      safe: false,
      reasonCode: "binary-content",
      untrustedInstructions: false,
      staleDocumentation: false,
    };
  }

  const lines = normalizeSourceText(text).split("\n");
  if (lines.some((line) => line.length > EVIDENCE_LIMITS.maxLineCharacters)) {
    return {
      safe: false,
      reasonCode: "long-minified-line",
      untrustedInstructions: false,
      staleDocumentation: false,
    };
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      safe: false,
      reasonCode: "secret-content",
      untrustedInstructions: false,
      staleDocumentation: false,
    };
  }

  const untrustedInstructions =
    /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|system|developer|safety)\s+instructions|(?:reveal|print|exfiltrate)\s+(?:the\s+)?(?:system prompt|credentials|secrets)|do not follow (?:the )?(?:system|developer) instructions/i.test(
      text,
    );
  const staleDocumentation =
    classifyPath(path) === "purpose" &&
    /\b(?:planned|will be implemented|not yet implemented|future work|roadmap)\b/i.test(
      text,
    );

  return { safe: true, untrustedInstructions, staleDocumentation };
}

export function normalizeSourceText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Counts physical source lines; a terminal newline does not add an empty line. */
export function getPhysicalLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = normalizeSourceText(text).split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index).toLowerCase() : "";
}

function hasBinaryControls(text: string): boolean {
  let controls = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (
      (code < 0x20 &&
        code !== 0x09 &&
        code !== 0x0a &&
        code !== 0x0c &&
        code !== 0x0d) ||
      code === 0x7f
    ) {
      controls += 1;
      if (controls > 0) return true;
    }
  }
  return false;
}
