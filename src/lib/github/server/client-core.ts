import { isIP } from "node:net";
import { readerOperation, reportReaderFailure } from "./reader-diagnostics";

export const GITHUB_API_ORIGIN = "https://api.github.com";
export const GITHUB_API_VERSION = "2026-03-10";
export const GITHUB_ACCEPT_JSON = "application/vnd.github+json";
export const GITHUB_ACCEPT_RAW = "application/vnd.github.raw+json";

const MAX_REDIRECTS = 2;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ANALYSIS_RESPONSE_BYTES = 12 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RATE_LIMIT_RETRIES = 1;

export type GithubErrorCode =
  | "invalid-input"
  | "forbidden"
  | "not-found"
  | "unavailable"
  | "limit-exceeded"
  | "rate-limited"
  | "cancelled"
  | "upstream-error";

export interface GithubError {
  code: GithubErrorCode;
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export type Result<T> =
  { ok: true; value: T } | { ok: false; error: GithubError };

export type GithubQueryValue = string | number | boolean;
export type GithubQuery = Readonly<
  Record<string, GithubQueryValue | readonly GithubQueryValue[] | undefined>
>;

export interface GithubRequestContext {
  /** Stable ID shared by every GitHub request made for one analysis. */
  runId: string;
  /** Absolute UTC epoch deadline in milliseconds. */
  deadline: number;
  signal: AbortSignal;
  budgetKind?: "github-http" | "pr-http";
  fetchedBody?: { fileId: string; decodedBytes: number };
}

export interface GithubRateMetadata {
  limit?: number;
  remaining?: number;
  resetAt?: number;
  retryAfterSeconds?: number;
}

export interface GithubPaginationLink {
  path: string;
  query: Readonly<Record<string, string | readonly string[]>>;
}

export interface GithubResponse<T> {
  data: T | null;
  status: number;
  wireBytes: number;
  etag?: string;
  rateLimit: GithubRateMetadata;
  nextPage?: GithubPaginationLink;
  notModified?: boolean;
}

export interface GithubCredentialHandle {
  /** Resolve a server-held token. Return null for public-only access. */
  getAccessToken(context: GithubRequestContext): Promise<string | null>;
}

export interface GithubResolvedDestination {
  hostname: "api.github.com";
  addresses: readonly string[];
}

/**
 * The injected adapter must honor the signal and manual redirect mode, connect
 * to one of the validated addresses, and retain api.github.com as the TLS
 * server name and certificate hostname.
 */
export type GithubFetch = (
  input: URL,
  init: RequestInit,
  destination: GithubResolvedDestination,
) => Promise<Response>;

export type GithubBudgetResource =
  "github-http-attempts" | "github-wire-bytes" | "github-decoded-bytes";

export interface GithubBudgetReservation {
  runId: string;
  resource: GithubBudgetResource;
  amount: number;
  maximum: number;
  reservationKey: string;
  kind?: "github-http" | "pr-http";
  fetchedBody?: { fileId: string; decodedBytes: number };
}

export interface GithubBudgetLedger {
  /** Reserve shared budget before using it; null means the shared limit is exhausted. */
  reserve(input: GithubBudgetReservation): Promise<string | null>;
  /** Commit actual usage for a prior reservation. */
  commitUsage(input: {
    runId: string;
    resource: GithubBudgetResource;
    reservationId: string;
    amount: number;
  }): Promise<void>;
}

export interface GithubClientDependencies {
  fetch: GithubFetch;
  resolveAddresses(
    hostname: string,
    signal: AbortSignal,
  ): Promise<readonly string[]>;
  credentials: GithubCredentialHandle;
  ledger: GithubBudgetLedger;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Tests may lower this value; production requests can never exceed 10 seconds. */
  requestTimeoutMs?: number;
  /** Tests may lower this value; production responses can never exceed 8 MiB. */
  maxResponseBytes?: number;
  onAttemptSettled?: (
    context: GithubRequestContext,
    attemptId: string,
  ) => Promise<void | GithubError>;
}

export interface GithubGetInput {
  path: string;
  query?: GithubQuery;
  context: GithubRequestContext;
  responseByteLimit?: number;
}

export interface GithubClient {
  getJson<T = unknown>(
    input: GithubGetInput,
  ): Promise<Result<GithubResponse<T>>>;
  getText(input: GithubGetInput): Promise<Result<GithubResponse<string>>>;
}

class SafeTransportFailure extends Error {
  constructor(readonly safeError: GithubError) {
    super(safeError.message);
  }
}

function failure<T>(
  code: GithubErrorCode,
  message: string,
  retryable = false,
  retryAfterSeconds?: number,
): Result<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  };
}

function safeFailure(
  code: GithubErrorCode,
  message: string,
  retryable = false,
  retryAfterSeconds?: number,
): SafeTransportFailure {
  return new SafeTransportFailure({
    code,
    message,
    retryable,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

function isControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isSafePath(path: string): boolean {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    isControlCharacter(path)
  )
    return false;

  const segments = path.slice(1).split("/");
  if (segments.some((segment) => segment.length === 0)) return false;
  for (const [index, segment] of segments.entries()) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    // GitHub refs may contain slashes, but only this fixed API parameter may decode one.
    if (
      index === 4 &&
      segments.length === 5 &&
      segments[0] === "repos" &&
      segments[3] === "commits" &&
      decoded.includes("/")
    ) {
      if (
        decoded.includes("%") ||
        /[\u0000-\u0020\u007f~^:?*\\[]/.test(decoded) ||
        decoded.includes("@{") ||
        decoded.endsWith(".") ||
        decoded
          .split("/")
          .some(
            (part) => !part || part.startsWith(".") || part.endsWith(".lock"),
          )
      )
        return false;
      continue;
    }
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      isControlCharacter(decoded)
    )
      return false;
    let nested = decoded;
    for (let depth = 0; depth < 2 && /%[0-9a-f]{2}/i.test(nested); depth += 1) {
      try {
        nested = decodeURIComponent(nested);
      } catch {
        return false;
      }
      if (
        nested === "." ||
        nested === ".." ||
        nested.includes("/") ||
        nested.includes("\\") ||
        isControlCharacter(nested)
      )
        return false;
    }
  }
  return true;
}

function makeRequestUrl(path: string, query?: GithubQuery): URL {
  if (!isSafePath(path)) {
    throw safeFailure("invalid-input", "The GitHub API path is invalid.");
  }

  const url = new URL(path, GITHUB_API_ORIGIN);
  if (!isTrustedDestination(url)) {
    throw safeFailure(
      "invalid-input",
      "The GitHub API destination is invalid.",
    );
  }

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (!/^[A-Za-z0-9_.~-]{1,100}$/.test(key) || value === undefined) {
        if (value === undefined) continue;
        throw safeFailure("invalid-input", "The GitHub API query is invalid.");
      }
      const values = Array.isArray(value) ? value : [value];
      if (values.length > 100) {
        throw safeFailure("invalid-input", "The GitHub API query is invalid.");
      }
      for (const item of values) {
        if (
          !["string", "number", "boolean"].includes(typeof item) ||
          (typeof item === "number" && !Number.isFinite(item)) ||
          isControlCharacter(String(item)) ||
          String(item).length > 2_000
        ) {
          throw safeFailure(
            "invalid-input",
            "The GitHub API query is invalid.",
          );
        }
        url.searchParams.append(key, String(item));
      }
    }
  }
  if (!isSafeUrlQuery(url)) {
    throw safeFailure("invalid-input", "The GitHub API query is invalid.");
  }
  return url;
}

function isSafeUrlQuery(url: URL): boolean {
  if (url.search.length > 4_096) return false;
  let count = 0;
  for (const [key, value] of url.searchParams) {
    count += 1;
    if (
      count > 100 ||
      !/^[A-Za-z0-9_.~-]{1,100}$/.test(key) ||
      value.length > 2_000 ||
      isControlCharacter(value)
    )
      return false;
  }
  return true;
}

function isTrustedDestination(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.origin === GITHUB_API_ORIGIN &&
    url.hostname === "api.github.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    isSafePath(url.pathname) &&
    isSafeUrlQuery(url)
  );
}

function ipv6Groups(address: string): number[] | null {
  let input = address.toLowerCase();
  const lastColon = input.lastIndexOf(":");
  if (input.includes(".")) {
    const ipv4Part = input.slice(lastColon + 1);
    if (isIP(ipv4Part) !== 4) return null;
    const octets = ipv4Part.split(".").map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    input = `${input.slice(0, lastColon)}:${high}:${low}`;
  }

  const [leftPart, rightPart, ...extra] = input.split("::");
  if (extra.length > 0) return null;
  const left = leftPart ? leftPart.split(":") : [];
  const right = rightPart ? rightPart.split(":") : [];
  if ([...left, ...right].some((group) => !/^[0-9a-f]{1,4}$/.test(group)))
    return null;
  const missing = 8 - left.length - right.length;
  if (
    (input.includes("::") && missing < 1) ||
    (!input.includes("::") && missing !== 0)
  )
    return null;
  const groups = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  if (groups.length !== 8) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function isUnsafeAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  const family = isIP(normalized);
  if (family === 4) {
    const octets = normalized.split(".").map(Number);
    const [a, b, c, d] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 255 && b === 255 && c === 255 && d === 255)
    );
  }
  if (family !== 6) return true;
  const groups = ipv6Groups(normalized);
  if (!groups) return true;
  const allZero = groups.every((group) => group === 0);
  const loopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const globalUnicast = groups[0] >= 0x2000 && groups[0] <= 0x3fff; // 2000::/3
  const ipv4Mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const ipv4Compatible = groups.slice(0, 6).every((group) => group === 0);
  const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8;
  const teredo = groups[0] === 0x2001 && groups[1] === 0;
  const sixToFour = groups[0] === 0x2002;
  return (
    allZero ||
    loopback ||
    !globalUnicast ||
    (groups[0] & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (groups[0] & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    ipv4Mapped ||
    ipv4Compatible ||
    documentation ||
    teredo ||
    sixToFour
  );
}

function validateResolvedAddresses(addresses: readonly string[]): void {
  if (addresses.length === 0 || addresses.length > 32) {
    throw safeFailure(
      "unavailable",
      "GitHub could not be reached safely.",
      true,
    );
  }
  if (addresses.some(isUnsafeAddress)) {
    throw safeFailure("forbidden", "The GitHub destination is not allowed.");
  }
}

function safeHeaderValue(
  value: string | null,
  maxLength = 512,
): string | undefined {
  if (!value || value.length > maxLength || isControlCharacter(value))
    return undefined;
  return value;
}

function safeHeaderNumber(value: string | null): number | undefined {
  if (!value || !/^\d{1,16}$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseRetryAfter(
  value: string | null,
  now: number,
): number | undefined {
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(Math.ceil(seconds)) &&
      seconds >= 0 &&
      seconds <= 2_592_000
      ? Math.ceil(seconds)
      : undefined;
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  const seconds = Math.max(0, Math.ceil((date - now) / 1_000));
  return seconds <= 2_592_000 ? seconds : undefined;
}

function readRateMetadata(headers: Headers, now: number): GithubRateMetadata {
  const limit = safeHeaderNumber(headers.get("x-ratelimit-limit"));
  const remaining = safeHeaderNumber(headers.get("x-ratelimit-remaining"));
  const resetAt = safeHeaderNumber(headers.get("x-ratelimit-reset"));
  const retryAfterSeconds = parseRetryAfter(headers.get("retry-after"), now);
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function parseNextPage(
  linkHeader: string | null,
): GithubPaginationLink | undefined {
  if (!linkHeader) return undefined;
  if (linkHeader.length > 8_192 || isControlCharacter(linkHeader)) {
    throw safeFailure(
      "upstream-error",
      "GitHub returned invalid pagination data.",
    );
  }

  const nextLinks: string[] = [];
  const expression = /<([^<>]+)>\s*;\s*rel\s*=\s*(?:"([^"]+)"|([^;,\s]+))/g;
  for (const match of linkHeader.matchAll(expression)) {
    const rels = (match[2] ?? match[3] ?? "").split(/\s+/);
    if (rels.includes("next")) nextLinks.push(match[1]);
  }
  if (nextLinks.length === 0) return undefined;
  if (nextLinks.length !== 1) {
    throw safeFailure(
      "upstream-error",
      "GitHub returned invalid pagination data.",
    );
  }

  let url: URL;
  try {
    url = new URL(nextLinks[0], GITHUB_API_ORIGIN);
  } catch {
    throw safeFailure(
      "upstream-error",
      "GitHub returned invalid pagination data.",
    );
  }
  if (!isTrustedDestination(url)) {
    throw safeFailure(
      "upstream-error",
      "GitHub returned an unsafe pagination destination.",
    );
  }

  const queryEntries: Array<[string, string | string[]]> = [];
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    queryEntries.push([key, values.length === 1 ? values[0] : values]);
  }
  const query = Object.fromEntries(queryEntries);
  return { path: url.pathname, query };
}

function linkAbortSignal(
  outer: AbortSignal,
  controller: AbortController,
): () => void {
  const abort = () => controller.abort(outer.reason);
  if (outer.aborted) abort();
  else outer.addEventListener("abort", abort, { once: true });
  return () => outer.removeEventListener("abort", abort);
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function throwForAbort(signal: AbortSignal, timedOut: boolean): void {
  if (timedOut) {
    throw safeFailure("upstream-error", "The GitHub request timed out.", true);
  }
  if (signal.aborted) {
    throw safeFailure("cancelled", "The GitHub request was cancelled.");
  }
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function defaultSleep(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted)
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function isRateLimited(response: Response, rate: GithubRateMetadata): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      (rate.remaining === 0 || rate.retryAfterSeconds !== undefined))
  );
}

function rateDelaySeconds(rate: GithubRateMetadata, now: number): number {
  if (rate.retryAfterSeconds !== undefined) return rate.retryAfterSeconds;
  if (rate.remaining === 0 && rate.resetAt !== undefined)
    return Math.max(0, rate.resetAt - Math.floor(now / 1_000));
  // GitHub recommends waiting at least one minute when a secondary limit has
  // no Retry-After or exhausted-primary-reset header.
  return 60;
}

function safeStatusFailure(
  response: Response,
  rate: GithubRateMetadata,
  now: number,
): SafeTransportFailure {
  if (response.status === 404) {
    return safeFailure(
      "not-found",
      "The GitHub resource was not found or is not accessible.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    if (isRateLimited(response, rate)) {
      const delay = rateDelaySeconds(rate, now);
      return safeFailure(
        "rate-limited",
        "GitHub temporarily limited this analysis.",
        true,
        delay,
      );
    }
    return safeFailure("forbidden", "GitHub denied access to this resource.");
  }
  if (response.status === 429) {
    const delay = rateDelaySeconds(rate, now);
    return safeFailure(
      "rate-limited",
      "GitHub temporarily limited this analysis.",
      true,
      delay,
    );
  }
  return safeFailure(
    response.status >= 500 ? "unavailable" : "upstream-error",
    "GitHub could not complete the request.",
    response.status >= 500,
  );
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A body cancellation failure must not replace the safe transport result.
  }
}

export function createGithubClient(
  deps: GithubClientDependencies,
): GithubClient {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const requestTimeoutMs = Math.min(
    DEFAULT_REQUEST_TIMEOUT_MS,
    Math.max(1, deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS),
  );
  const maxResponseBytes = Math.min(
    MAX_RESPONSE_BYTES,
    Math.max(1, deps.maxResponseBytes ?? MAX_RESPONSE_BYTES),
  );
  const queues = new Map<string, Promise<void>>();
  let nextAttemptId = 0;

  function enqueue<T>(
    context: GithubRequestContext,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = queues.get(context.runId) ?? Promise.resolve();
    let deadlineReached = false;
    const queueController = new AbortController();
    const removeExternalAbort = linkAbortSignal(
      context.signal,
      queueController,
    );
    const queueTimeout = setTimeout(
      () => {
        deadlineReached = true;
        queueController.abort();
      },
      Math.max(0, context.deadline - now()),
    );
    const slot = previous
      .catch(() => undefined)
      .then(async () => {
        if (context.signal.aborted) {
          return undefined as T;
        }
        if (context.deadline <= now()) {
          throw safeFailure(
            "limit-exceeded",
            "The GitHub analysis deadline expired.",
          );
        }
        return work();
      });
    const settled = slot.then(
      () => undefined,
      () => undefined,
    );
    queues.set(context.runId, settled);
    void settled.finally(() => {
      if (queues.get(context.runId) === settled) queues.delete(context.runId);
    });
    return abortable(slot, queueController.signal)
      .catch((error: unknown) => {
        if (deadlineReached) {
          throw safeFailure(
            "limit-exceeded",
            "The GitHub analysis deadline expired.",
          );
        }
        throw error;
      })
      .finally(() => {
        clearTimeout(queueTimeout);
        removeExternalAbort();
      });
  }

  async function charge(
    context: GithubRequestContext,
    resource: GithubBudgetResource,
    amount: number,
    reservationKey: string,
  ): Promise<void> {
    let reservationId: string | null;
    try {
      reservationId = await deps.ledger.reserve({
        runId: context.runId,
        resource,
        amount,
        maximum:
          resource === "github-http-attempts"
            ? 32
            : MAX_ANALYSIS_RESPONSE_BYTES,
        reservationKey,
        kind: context.budgetKind,
        fetchedBody: context.fetchedBody,
      });
    } catch {
      throw safeFailure(
        "unavailable",
        "The GitHub analysis budget is unavailable.",
        true,
      );
    }
    if (!reservationId) {
      throw safeFailure(
        "limit-exceeded",
        "The GitHub analysis budget is exhausted.",
      );
    }
    try {
      await deps.ledger.commitUsage({
        runId: context.runId,
        resource,
        reservationId,
        amount,
      });
    } catch {
      throw safeFailure(
        "unavailable",
        "The GitHub analysis budget is unavailable.",
        true,
      );
    }
  }

  async function createAttemptSignal(context: GithubRequestContext): Promise<{
    signal: AbortSignal;
    cleanup: () => void;
    timedOut: () => boolean;
  }> {
    const controller = new AbortController();
    const removeOuterListener = linkAbortSignal(context.signal, controller);
    let timedOut = false;
    const remainingMs = context.deadline - now();
    if (remainingMs <= 0) {
      removeOuterListener();
      throw safeFailure(
        "limit-exceeded",
        "The GitHub analysis deadline expired.",
      );
    }
    const timeout = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.min(requestTimeoutMs, remainingMs),
    );
    return {
      signal: controller.signal,
      timedOut: () => timedOut,
      cleanup: () => {
        clearTimeout(timeout);
        removeOuterListener();
      },
    };
  }

  async function readResponseBytes(
    response: Response,
    context: GithubRequestContext,
    requestId: string,
    signal: AbortSignal,
    timedOut: () => boolean,
    responseLimit: number,
  ): Promise<Uint8Array> {
    const contentEncoding = response.headers.get("content-encoding");
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
      await cancelBody(response);
      throw safeFailure(
        "upstream-error",
        "GitHub returned an unsupported response encoding.",
      );
    }
    const announcedLength = response.headers.get("content-length");
    if (
      announcedLength &&
      (!/^\d{1,16}$/.test(announcedLength) ||
        Number(announcedLength) > responseLimit)
    ) {
      await cancelBody(response);
      throw safeFailure(
        "limit-exceeded",
        "The GitHub response exceeded the size limit.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        let read: ReadableStreamReadResult<Uint8Array>;
        try {
          read = await abortable(reader.read(), signal);
        } catch (error) {
          throwForAbort(signal, timedOut());
          if (isAbortError(error))
            throw safeFailure("cancelled", "The GitHub request was cancelled.");
          throw safeFailure(
            "upstream-error",
            "GitHub returned an incomplete response.",
            true,
          );
        }
        if (read.done) break;
        const size = read.value.byteLength;
        total += size;
        const chunkIndex = chunks.length;
        await abortable(
          charge(
            context,
            "github-wire-bytes",
            size,
            `${requestId}:wire:${chunkIndex}`,
          ),
          signal,
        );
        // Fetch is asked for identity encoding and compressed bodies are
        // rejected above, so streamed wire bytes are also decoded bytes.
        await abortable(
          charge(
            context,
            "github-decoded-bytes",
            size,
            `${requestId}:decoded:${chunkIndex}`,
          ),
          signal,
        );
        if (total > responseLimit || total > MAX_ANALYSIS_RESPONSE_BYTES) {
          try {
            await reader.cancel();
          } catch {
            // The size limit remains the primary response error.
          }
          throw safeFailure(
            "limit-exceeded",
            "The GitHub response exceeded the size limit.",
          );
        }
        if (chunks.length >= 16_384) {
          await reader.cancel();
          throw safeFailure(
            "limit-exceeded",
            "The GitHub response contained too many stream chunks.",
          );
        }
        chunks.push(read.value.slice());
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Keep the original safe error.
      }
      throw error;
    } finally {
      reader.releaseLock();
    }

    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  async function request<T>(
    input: GithubGetInput,
    accept: string,
    decode: (bytes: Uint8Array) => T,
  ): Promise<Result<GithubResponse<T>>> {
    try {
      if (
        !/^[A-Za-z0-9_-]{1,128}$/.test(input.context.runId) ||
        !Number.isFinite(input.context.deadline) ||
        !(input.context.signal instanceof AbortSignal) ||
        (input.responseByteLimit !== undefined &&
          (!Number.isSafeInteger(input.responseByteLimit) ||
            input.responseByteLimit < 1))
      ) {
        throw safeFailure(
          "invalid-input",
          "The GitHub analysis identity is invalid.",
        );
      }
      const initialUrl = makeRequestUrl(input.path, input.query);
      return await enqueue(input.context, async () => {
        let url = initialUrl;
        let redirects = 0;
        let rateRetries = 0;

        for (;;) {
          if (!isTrustedDestination(url)) {
            throw safeFailure(
              "forbidden",
              "The GitHub destination is not allowed.",
            );
          }
          const attemptSignal = await createAttemptSignal(input.context);
          const attemptId = `${input.context.runId}:${++nextAttemptId}`;
          let response: Response | undefined;
          const attemptStarted = now();
          let diagnosticStage = "dns";
          try {
            let addresses: readonly string[];
            try {
              addresses = await abortable(
                deps.resolveAddresses(url.hostname, attemptSignal.signal),
                attemptSignal.signal,
              );
            } catch (error) {
              throwForAbort(attemptSignal.signal, attemptSignal.timedOut());
              if (isAbortError(error))
                throw safeFailure(
                  "cancelled",
                  "The GitHub request was cancelled.",
                );
              throw safeFailure(
                "unavailable",
                "GitHub could not be reached safely.",
                true,
              );
            }
            validateResolvedAddresses(addresses);

            let token: string | null;
            diagnosticStage = "credentials";
            try {
              token = await abortable(
                deps.credentials.getAccessToken(input.context),
                attemptSignal.signal,
              );
            } catch (error) {
              throwForAbort(attemptSignal.signal, attemptSignal.timedOut());
              if (isAbortError(error))
                throw safeFailure(
                  "cancelled",
                  "The GitHub request was cancelled.",
                );
              throw safeFailure(
                "unavailable",
                "GitHub authorization is unavailable.",
                true,
              );
            }
            if (
              token !== null &&
              (token.length === 0 ||
                token.length > 8_192 ||
                isControlCharacter(token))
            ) {
              throw safeFailure(
                "forbidden",
                "GitHub authorization is invalid.",
              );
            }

            diagnosticStage = "attempt-budget";
            await abortable(
              charge(
                input.context,
                "github-http-attempts",
                1,
                `${attemptId}:attempt`,
              ),
              attemptSignal.signal,
            );
            const headers = new Headers({
              Accept: accept,
              "Accept-Encoding": "identity",
              "User-Agent": "resume-changer-github-integration",
              "X-GitHub-Api-Version": GITHUB_API_VERSION,
            });
            if (token) headers.set("Authorization", `Bearer ${token}`);

            diagnosticStage = "fetch";
            try {
              response = await abortable(
                deps.fetch(
                  url,
                  {
                    method: "GET",
                    headers,
                    redirect: "manual",
                    signal: attemptSignal.signal,
                  },
                  { hostname: "api.github.com", addresses },
                ),
                attemptSignal.signal,
              );
            } catch (error) {
              throwForAbort(attemptSignal.signal, attemptSignal.timedOut());
              if (isAbortError(error))
                throw safeFailure(
                  "cancelled",
                  "The GitHub request was cancelled.",
                );
              throw safeFailure(
                "unavailable",
                "GitHub could not complete the request.",
                true,
              );
            }
            throwForAbort(attemptSignal.signal, attemptSignal.timedOut());

            if ([301, 302, 303, 307, 308].includes(response.status)) {
              const location = response.headers.get("location");
              await cancelBody(response);
              if (
                !location ||
                location.length > 2_048 ||
                isControlCharacter(location)
              ) {
                throw safeFailure(
                  "upstream-error",
                  "GitHub returned an invalid redirect.",
                );
              }
              let destination: URL;
              try {
                destination = new URL(location, url);
              } catch {
                throw safeFailure(
                  "upstream-error",
                  "GitHub returned an invalid redirect.",
                );
              }
              if (!isTrustedDestination(destination)) {
                throw safeFailure(
                  "forbidden",
                  "GitHub returned an unsafe redirect destination.",
                );
              }
              redirects += 1;
              if (redirects > MAX_REDIRECTS) {
                throw safeFailure(
                  "limit-exceeded",
                  "GitHub redirected too many times.",
                );
              }
              url = destination;
              continue;
            }

            const responseTime = now();
            const rateLimit = readRateMetadata(response.headers, responseTime);
            if (isRateLimited(response, rateLimit)) {
              await cancelBody(response);
              const delaySeconds = rateDelaySeconds(rateLimit, responseTime);
              const remainingMs = input.context.deadline - now();
              const safeError = safeStatusFailure(
                response,
                rateLimit,
                responseTime,
              );
              if (
                rateRetries < MAX_RATE_LIMIT_RETRIES &&
                delaySeconds * 1_000 + requestTimeoutMs < remainingMs
              ) {
                rateRetries += 1;
                try {
                  await abortable(
                    sleep(delaySeconds * 1_000, input.context.signal),
                    input.context.signal,
                  );
                } catch {
                  if (input.context.signal.aborted)
                    throw safeFailure(
                      "cancelled",
                      "The GitHub request was cancelled.",
                    );
                  throw safeError;
                }
                continue;
              }
              throw safeError;
            }

            if (response.status === 304) {
              return {
                ok: true,
                value: {
                  data: null,
                  status: response.status,
                  wireBytes: 0,
                  etag: safeHeaderValue(response.headers.get("etag")),
                  rateLimit,
                  notModified: true,
                },
              };
            }
            if (!response.ok) {
              await cancelBody(response);
              throw safeStatusFailure(response, rateLimit, responseTime);
            }

            diagnosticStage = "response-body";
            const nextPage = parseNextPage(response.headers.get("link"));
            const bytes = await readResponseBytes(
              response,
              input.context,
              attemptId,
              attemptSignal.signal,
              attemptSignal.timedOut,
              Math.min(
                maxResponseBytes,
                input.responseByteLimit ?? maxResponseBytes,
              ),
            );
            let data: T;
            diagnosticStage = "decode";
            try {
              data = decode(bytes);
            } catch {
              throw safeFailure(
                "upstream-error",
                "GitHub returned an invalid response.",
              );
            }
            return {
              ok: true,
              value: {
                data,
                status: response.status,
                wireBytes: bytes.byteLength,
                etag: safeHeaderValue(response.headers.get("etag")),
                rateLimit,
                ...(nextPage ? { nextPage } : {}),
              },
            };
          } catch (error) {
            reportReaderFailure({
              runId: input.context.runId,
              operation: readerOperation(url.pathname),
              stage: diagnosticStage,
              timedOut: attemptSignal.timedOut(),
              elapsedMs: Math.max(0, now() - attemptStarted),
              upstreamStatus: response?.status,
            });
            throw error;
          } finally {
            if (response?.body && !response.bodyUsed)
              await cancelBody(response);
            attemptSignal.cleanup();
            const settlementError = await deps.onAttemptSettled?.(
              input.context,
              attemptId,
            );
            if (settlementError)
              throw new SafeTransportFailure(settlementError);
          }
        }
      });
    } catch (error) {
      if (error instanceof SafeTransportFailure) {
        return { ok: false, error: error.safeError };
      }
      if (input.context.signal.aborted) {
        return failure("cancelled", "The GitHub request was cancelled.");
      }
      return failure(
        "upstream-error",
        "GitHub could not complete the request.",
        true,
      );
    }
  }

  return {
    getJson<T = unknown>(input: GithubGetInput) {
      return request<T>(input, GITHUB_ACCEPT_JSON, (bytes) => {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        return JSON.parse(text) as T;
      });
    },
    getText(input: GithubGetInput) {
      return request(input, GITHUB_ACCEPT_RAW, (bytes) =>
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    },
  };
}
