import { createHash } from "node:crypto";
import {
  BASELINE_TEXT_FILE_LIMIT_BYTES,
  CONTEXT_SECTION_LIMITS,
  EXPERIMENTAL_TEXT_FILE_LIMIT_BYTES,
  type ContextSectionReaderOptions,
  type PinnedBlobResponse,
  type PinnedBlobSource,
  type ReadManySectionsInput,
  type ReadManySectionsResult,
  type ReadSectionsInput,
  type SectionReadResult,
  type SectionReaderError,
} from "./contracts";
import { inspectBoundedText } from "./content-safety";
import { extractContextSections } from "./extract-sections";

interface CachedResult {
  result: Extract<SectionReadResult, { ok: true }>;
  bytes: number;
}

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avif",
  ".bmp",
  ".class",
  ".dll",
  ".dylib",
  ".eot",
  ".eps",
  ".exe",
  ".gif",
  ".gz",
  ".heic",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".otf",
  ".pdf",
  ".png",
  ".psd",
  ".pyc",
  ".so",
  ".svg",
  ".svgz",
  ".tar",
  ".tif",
  ".tiff",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

const SECRET_PATH_PART =
  /^(?:\.env(?:\..*)?|secrets?|credentials?|private|\.ssh|certs?|keys?)$/i;
const SECRET_FILE_NAME =
  /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|.*(?:secret|credential|service[-_]?account|firebase-adminsdk).*)$/i;

/**
 * Experimental, request-scoped reader. It never persists source text and does
 * not change the existing 64 KiB production evidence policy.
 */
export function createContextSectionReader(
  source: PinnedBlobSource,
  options: ContextSectionReaderOptions = {},
) {
  const now = options.now ?? Date.now;
  const maxRunBytes = boundedInteger(
    options.maxRunBytes,
    CONTEXT_SECTION_LIMITS.maxRunBytes,
  );
  const maxReadAttempts = boundedInteger(
    options.maxReadAttempts,
    CONTEXT_SECTION_LIMITS.maxReadAttempts,
  );
  const maxCacheBytes = boundedInteger(
    options.maxCacheBytes,
    CONTEXT_SECTION_LIMITS.maxCacheBytes,
  );
  const cache = new Map<string, CachedResult>();
  const inFlight = new Map<string, Promise<SectionReadResult>>();
  let cacheBytes = 0;
  let usedBytes = 0;
  let reservedBytes = 0;
  let readAttempts = 0;

  async function readSections(
    input: ReadSectionsInput,
  ): Promise<SectionReadResult> {
    const invalid = validateInput(input);
    if (invalid) return failure("invalid-input", invalid);
    const pathError = validatePath(input.file.path);
    if (pathError) return failure("blocked-path", pathError);
    if (input.context.signal.aborted) {
      return failure("cancelled", "The source read was cancelled.");
    }
    if (now() >= input.context.deadlineEpochMs) {
      return failure(
        "deadline-exceeded",
        "The source read deadline has expired.",
      );
    }
    const authorizationDeadline = deadlineSignal(
      input.context.signal,
      input.context.deadlineEpochMs,
      now,
    );
    let authorized = false;
    try {
      authorized = await source.isAuthorized({
        repositoryId: input.repository.repositoryId,
        authorizationNamespace: input.context.authorizationNamespace,
        deadlineEpochMs: input.context.deadlineEpochMs,
        signal: authorizationDeadline.signal,
      });
    } catch {
      authorized = false;
    } finally {
      authorizationDeadline.dispose();
    }
    if (input.context.signal.aborted) {
      return failure("cancelled", "The source read was cancelled.");
    }
    if (
      authorizationDeadline.timedOut() ||
      now() >= input.context.deadlineEpochMs
    ) {
      return failure(
        "deadline-exceeded",
        "The source read exceeded its deadline.",
        true,
      );
    }
    if (!authorized) {
      return failure("forbidden", "Repository access is no longer authorized.");
    }

    const maxFileBytes = boundedRequestLimit(
      input.budget?.maxFileBytes,
      EXPERIMENTAL_TEXT_FILE_LIMIT_BYTES,
    );
    const maxDecodedMemoryBytes = boundedRequestLimit(
      input.budget?.maxDecodedMemoryBytes,
      CONTEXT_SECTION_LIMITS.maxDecodedMemoryBytes,
    );
    const maxExcerptBytes = boundedRequestLimit(
      input.budget?.maxExcerptBytes,
      CONTEXT_SECTION_LIMITS.maxExcerptBytes,
    );
    const maxExcerptLines = boundedRequestLimit(
      input.budget?.maxExcerptLines,
      CONTEXT_SECTION_LIMITS.maxExcerptLines,
    );
    if (
      maxFileBytes < 1 ||
      maxDecodedMemoryBytes < 1 ||
      maxExcerptBytes < 1 ||
      maxExcerptLines < 1
    ) {
      return failure("invalid-input", "The source read budget is invalid.");
    }

    const key = cacheKey(
      input,
      maxFileBytes,
      maxDecodedMemoryBytes,
      maxExcerptBytes,
      maxExcerptLines,
    );
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cloneSuccess(cached.result, true);
    }
    const pending = inFlight.get(key);
    if (pending) {
      const result = await pending;
      return result.ok ? cloneSuccess(result, true) : result;
    }

    const read = Promise.resolve().then(() =>
      readUncached(
        input,
        maxFileBytes,
        maxDecodedMemoryBytes,
        maxExcerptBytes,
        maxExcerptLines,
      ),
    );
    inFlight.set(key, read);
    try {
      const result = await read;
      if (result.ok) putCache(key, result);
      return result;
    } finally {
      inFlight.delete(key);
    }
  }

  async function readMany(
    input: ReadManySectionsInput,
  ): Promise<ReadManySectionsResult> {
    const results: ReadManySectionsResult["results"][number][] = [];
    const limitations: string[] = [];
    let downloadedBytes = 0;

    // Deliberately sequential: the experimental reader has a fixed concurrency
    // bound of one, while each completed file remains available after failures.
    for (const file of input.files) {
      const result = await readSections({ ...input, file });
      results.push({ fileId: file.fileId, result });
      if (result.ok) downloadedBytes += result.sourceBytes;
      else limitations.push(`${file.path}: ${result.error.message}`);
    }

    return {
      results,
      successfulFiles: results.filter((entry) => entry.result.ok).length,
      failedFiles: results.filter((entry) => !entry.result.ok).length,
      downloadedBytes,
      limitations,
    };
  }

  async function readUncached(
    input: ReadSectionsInput,
    requestedFileLimit: number,
    maxDecodedMemoryBytes: number,
    maxExcerptBytes: number,
    maxExcerptLines: number,
  ): Promise<SectionReadResult> {
    if (input.context.signal.aborted)
      return failure("cancelled", "The source read was cancelled.");
    if (now() >= input.context.deadlineEpochMs) {
      return failure(
        "deadline-exceeded",
        "The source read deadline has expired.",
      );
    }
    if (readAttempts >= maxReadAttempts) {
      return failure(
        "run-budget-exceeded",
        "The source read attempt budget is exhausted.",
      );
    }
    if (
      input.file.byteSize !== undefined &&
      input.file.byteSize > requestedFileLimit
    ) {
      return failure(
        "file-too-large",
        "The source file exceeds the experimental per-file read limit.",
      );
    }

    const availableBytes = maxRunBytes - usedBytes - reservedBytes;
    const maxBytes = Math.min(requestedFileLimit, availableBytes);
    if (
      maxBytes < 1 ||
      (input.file.byteSize !== undefined && input.file.byteSize > maxBytes)
    ) {
      return failure(
        "run-budget-exceeded",
        "The remaining run byte budget cannot fit this source file.",
      );
    }

    readAttempts += 1;
    reservedBytes += maxBytes;
    let observedBytes = 0;
    let fullyConsumed = false;
    const deadline = deadlineSignal(
      input.context.signal,
      input.context.deadlineEpochMs,
      now,
    );
    let response: PinnedBlobResponse | undefined;
    let bytes: Uint8Array | undefined;
    let decodedText: string | undefined;

    try {
      try {
        response = await source.openPinnedBlob({
          repository: input.repository,
          file: input.file,
          authorizationNamespace: input.context.authorizationNamespace,
          maxBytes,
          deadlineEpochMs: input.context.deadlineEpochMs,
          signal: deadline.signal,
        });
      } catch {
        if (input.context.signal.aborted) {
          return failure("cancelled", "The source read was cancelled.");
        }
        if (deadline.timedOut()) {
          return failure(
            "deadline-exceeded",
            "The source read exceeded its deadline.",
            true,
          );
        }
        return failure(
          "source-error",
          "The pinned source could not be read.",
          true,
        );
      }

      if (!matchesRequestedIdentity(input, response)) {
        return failure(
          "source-mismatch",
          "The source response does not match the pinned repository file.",
        );
      }

      const collected = await collectBounded(
        response.body,
        maxBytes,
        deadline.signal,
      );
      observedBytes = collected.bytesRead;
      if (!collected.ok) {
        if (input.context.signal.aborted) {
          return failure("cancelled", "The source read was cancelled.");
        }
        if (deadline.timedOut()) {
          return failure(
            "deadline-exceeded",
            "The source read exceeded its deadline.",
            true,
          );
        }
        return failure(
          collected.code,
          collected.message,
          collected.code === "source-error",
        );
      }
      bytes = collected.bytes;
      fullyConsumed = true;

      if (bytes.byteLength > maxBytes) {
        return failure(
          "file-too-large",
          "The streamed source exceeded its byte limit.",
        );
      }
      if (
        input.file.byteSize !== undefined &&
        bytes.byteLength !== input.file.byteSize
      ) {
        return failure(
          "source-size-mismatch",
          "The downloaded source size does not match the pinned inventory.",
        );
      }
      if (!matchesGitBlobHash(bytes, input.file.blobSha)) {
        return failure(
          "source-mismatch",
          "The downloaded source does not match its pinned blob hash.",
        );
      }
      if (bytes.byteLength * 2 > maxDecodedMemoryBytes) {
        return failure(
          "decoded-memory-limit",
          "The decoded source text exceeds the separate memory budget.",
        );
      }

      try {
        decodedText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return failure("invalid-utf8", "The source is not valid UTF-8 text.");
      }
      if (!decodedText)
        return failure(
          "empty-text",
          "The verified source file contains no text.",
        );
      const text = decodedText;
      if (text.length * 2 > maxDecodedMemoryBytes) {
        return failure(
          "decoded-memory-limit",
          "The decoded source text exceeds the separate memory budget.",
        );
      }
      const lines = text.replace(/\r\n?/g, "\n").split("\n");
      if (lines.at(-1) === "") lines.pop();
      const safety = inspectBoundedText(text, input.file.path);
      if (!safety.safe) {
        return failure(
          safety.reason === "binary-content"
            ? "binary-content"
            : "unsafe-content",
          safety.reason === "binary-content"
            ? "The source contains binary control data."
            : "The source was blocked by content screening.",
        );
      }
      if (
        lines.some(
          (line) => line.length > CONTEXT_SECTION_LIMITS.maxLineCharacters,
        )
      ) {
        return failure(
          "line-too-long",
          "The source contains an overlong line and was not excerpted.",
        );
      }

      const extracted = extractContextSections(text, input.file.path, {
        repository: input.repository,
        file: input.file,
        intent: input.intent,
        relevanceTerms: input.relevanceTerms,
        maxExcerptBytes,
        maxExcerptLines,
        untrustedInstructions: safety.untrustedInstructions,
        plannedDocumentation: safety.plannedDocumentation,
      });
      const excerptBytes = extracted.sections.reduce(
        (total, section) => total + section.byteSize,
        0,
      );

      return {
        ok: true,
        repositoryId: input.repository.repositoryId,
        commitSha: input.repository.commitSha,
        path: input.file.path,
        blobSha: input.file.blobSha,
        sourceBytes: bytes.byteLength,
        lineCount: lines.length,
        excerptBytes,
        sections: extracted.sections,
        limitations: extracted.limitations,
        untrustedInstructions: safety.untrustedInstructions,
        cacheHit: false,
      };
    } catch {
      return failure(
        "source-error",
        "The pinned source could not be safely processed.",
        true,
      );
    } finally {
      bytes?.fill(0);
      decodedText = "";
      if (fullyConsumed) {
        reservedBytes -= maxBytes;
        usedBytes += observedBytes;
      }
      deadline.dispose();
    }
  }

  function putCache(
    key: string,
    result: Extract<SectionReadResult, { ok: true }>,
  ) {
    const bytes = result.sourceBytes;
    if (bytes > maxCacheBytes || maxCacheBytes < 1) return;
    const old = cache.get(key);
    if (old) {
      cacheBytes -= old.bytes;
      cache.delete(key);
    }
    while (cacheBytes + bytes > maxCacheBytes) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      cacheBytes -= cache.get(oldestKey)!.bytes;
      cache.delete(oldestKey);
    }
    cache.set(key, { result: cloneSuccess(result, false), bytes });
    cacheBytes += bytes;
  }

  return {
    readSections,
    readMany,
    getMemoryStats() {
      return {
        cacheEntries: cache.size,
        cacheBytes,
        usedRunBytes: usedBytes,
        reservedRunBytes: reservedBytes,
        readAttempts,
      };
    },
    clearMemoryCache() {
      cache.clear();
      inFlight.clear();
      cacheBytes = 0;
    },
  };
}

export function compareExperimentalReadCeilings(byteSize: number): {
  valid: boolean;
  baselineEligible: boolean;
  experimentalEligible: boolean;
  recoveredBeyondBaseline: boolean;
} {
  const valid = Number.isSafeInteger(byteSize) && byteSize >= 0;
  const baselineEligible = valid && byteSize <= BASELINE_TEXT_FILE_LIMIT_BYTES;
  const experimentalEligible =
    valid && byteSize <= EXPERIMENTAL_TEXT_FILE_LIMIT_BYTES;
  return {
    valid,
    baselineEligible,
    experimentalEligible,
    recoveredBeyondBaseline: experimentalEligible && !baselineEligible,
  };
}

function validateInput(input: ReadSectionsInput): string | undefined {
  const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
  const identity = input.repository;
  const file = input.file;
  if (
    !identity ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(identity.repositoryId) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(identity.owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(identity.name) ||
    !shaPattern.test(identity.commitSha) ||
    !file ||
    !/^[A-Za-z0-9_-]{1,200}$/.test(file.fileId) ||
    !shaPattern.test(file.blobSha) ||
    (file.byteSize !== undefined &&
      (!Number.isSafeInteger(file.byteSize) || file.byteSize < 0)) ||
    (file.mode !== "100644" && file.mode !== "100755") ||
    !input.context ||
    !/^[A-Za-z0-9:_-]{1,200}$/.test(input.context.authorizationNamespace) ||
    !Number.isFinite(input.context.deadlineEpochMs) ||
    !input.context.signal ||
    ![
      "overview",
      "implementation",
      "verification",
      "configuration",
      "unknown",
    ].includes(input.intent)
  ) {
    return "The pinned repository, file, or request identity is invalid.";
  }
  return undefined;
}

function validatePath(path: string): string | undefined {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > CONTEXT_SECTION_LIMITS.maxPathLength ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    return "The repository path is invalid.";
  }
  const segments = path.split("/");
  if (
    segments.some((segment) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return true;
      }
      return (
        !decoded ||
        decoded === "." ||
        decoded === ".." ||
        decoded.includes("/") ||
        decoded.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(decoded) ||
        SECRET_PATH_PART.test(decoded)
      );
    })
  ) {
    return "The repository path is blocked by the source safety policy.";
  }
  const fileName = segments.at(-1)!.toLowerCase();
  const extension = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf("."))
    : "";
  if (BINARY_EXTENSIONS.has(extension) || SECRET_FILE_NAME.test(fileName)) {
    return "The repository path is blocked by the source safety policy.";
  }
  return undefined;
}

function cacheKey(
  input: ReadSectionsInput,
  maxFileBytes: number,
  maxDecodedMemoryBytes: number,
  maxExcerptBytes: number,
  maxExcerptLines: number,
): string {
  return createHash("sha256")
    .update(
      [
        "context-sections-v1",
        "safety-v1",
        input.context.authorizationNamespace,
        input.repository.repositoryId,
        input.repository.owner,
        input.repository.name,
        input.repository.commitSha,
        input.file.path,
        input.file.blobSha,
        input.file.byteSize ?? "unknown-size",
        input.file.mode ?? "unknown-mode",
        input.intent,
        [...(input.relevanceTerms ?? [])]
          .map((term) => term.toLowerCase())
          .sort()
          .join("\u0001"),
        maxFileBytes,
        maxDecodedMemoryBytes,
        maxExcerptBytes,
        maxExcerptLines,
      ].join("\u0000"),
    )
    .digest("hex");
}

async function collectBounded(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<
  | { ok: true; bytes: Uint8Array; bytesRead: number }
  | {
      ok: false;
      code: "file-too-large" | "cancelled" | "source-error";
      message: string;
      bytesRead: number;
    }
> {
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      if (signal.aborted) {
        await iterator.return?.();
        return {
          ok: false,
          code: "cancelled",
          message: "The source read was cancelled.",
          bytesRead,
        };
      }
      const next = await iterator.next();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        await iterator.return?.();
        return {
          ok: false,
          code: "source-error",
          message: "The pinned source returned an invalid byte stream.",
          bytesRead,
        };
      }
      bytesRead += next.value.byteLength;
      if (bytesRead > maxBytes) {
        await iterator.return?.();
        return {
          ok: false,
          code: "file-too-large",
          message: "The streamed source exceeded its byte limit.",
          bytesRead,
        };
      }
      chunks.push(next.value);
    }
  } catch {
    try {
      await iterator.return?.();
    } catch {
      // Preserve the bounded, content-free stream failure below.
    }
    return {
      ok: false,
      code: "source-error",
      message: "The pinned source stream ended unexpectedly.",
      bytesRead,
    };
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes, bytesRead };
}

function matchesRequestedIdentity(
  input: ReadSectionsInput,
  response: PinnedBlobResponse,
): boolean {
  return (
    response.repositoryId === input.repository.repositoryId &&
    response.commitSha.toLowerCase() ===
      input.repository.commitSha.toLowerCase() &&
    response.path === input.file.path &&
    response.blobSha.toLowerCase() === input.file.blobSha.toLowerCase()
  );
}

function matchesGitBlobHash(bytes: Uint8Array, expected: string): boolean {
  const algorithm = expected.length === 64 ? "sha256" : "sha1";
  const actual = createHash(algorithm)
    .update(`blob ${bytes.byteLength}\0`, "utf8")
    .update(bytes)
    .digest("hex");
  return actual.toLowerCase() === expected.toLowerCase();
}

function deadlineSignal(
  parent: AbortSignal,
  deadlineEpochMs: number,
  now: () => number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", onParentAbort, { once: true });
  const remaining = deadlineEpochMs - now();
  const timer =
    remaining <= 0
      ? ((timedOut = true), controller.abort(), undefined)
      : setTimeout(
          () => {
            timedOut = true;
            controller.abort();
          },
          Math.min(remaining, 2_147_483_647),
        );
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

function boundedInteger(value: number | undefined, maximum: number): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, maximum);
}

function boundedRequestLimit(
  value: number | undefined,
  maximum: number,
): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, maximum);
}

function failure(
  code: SectionReaderError["code"],
  message: string,
  retryable = false,
): SectionReadResult {
  return { ok: false, error: { code, message, retryable }, cacheHit: false };
}

function cloneSuccess(
  result: Extract<SectionReadResult, { ok: true }>,
  cacheHit: boolean,
): Extract<SectionReadResult, { ok: true }> {
  return {
    ...result,
    cacheHit,
    limitations: [...result.limitations],
    sections: result.sections.map((section) => ({
      ...section,
      warnings: [...section.warnings],
      dependencyHints: [...section.dependencyHints],
    })),
  };
}
