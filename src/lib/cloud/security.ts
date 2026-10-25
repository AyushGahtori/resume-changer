export class AccountAccessError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AUTH_REQUIRED"
      | "FORBIDDEN"
      | "INVALID_REQUEST"
      | "PAYLOAD_TOO_LARGE"
      | "CONFIGURATION_ERROR"
      | "RATE_LIMITED",
    readonly status: number,
  ) {
    super(message);
    this.name = "AccountAccessError";
  }
}

export function getAppMode(
  environment: Record<string, string | undefined> = process.env,
): "local" | "firebase" {
  const configured = environment.RESUME_APP_MODE;
  if (environment.VERCEL === "1") {
    if (configured && configured !== "firebase") {
      throw new AccountAccessError(
        "Hosted account storage is not configured correctly.",
        "CONFIGURATION_ERROR",
        503,
      );
    }
    return "firebase";
  }
  if (!configured || configured === "local") return "local";
  if (configured === "firebase") return "firebase";
  throw new AccountAccessError(
    "Unknown application storage mode.",
    "CONFIGURATION_ERROR",
    503,
  );
}

export function requireSafeUid(uid: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new AccountAccessError(
      "The account identity is invalid.",
      "FORBIDDEN",
      403,
    );
  }
  return uid;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const allowed = new Set([url.origin]);
  if (process.env.VERCEL === "1") {
    // Hosting may use an internal request hostname. Only deployment-controlled
    // origins are trusted; never use arbitrary forwarded-host headers.
    for (const host of [
      process.env.VERCEL_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ])
      if (host) allowed.add(`https://${host}`);
    if (process.env.RESUME_APP_ORIGIN)
      allowed.add(new URL(process.env.RESUME_APP_ORIGIN).origin);
  } else if (
    assertSafeEmulator() &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    // Next's development middleware normalizes the loopback hostname.
    for (const host of ["localhost", "127.0.0.1"])
      allowed.add(`${url.protocol}//${host}${url.port ? `:${url.port}` : ""}`);
  }
  if (!origin || !allowed.has(origin)) {
    throw new AccountAccessError(
      "This request must come from this website.",
      "FORBIDDEN",
      403,
    );
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new AccountAccessError(
      "Cross-site requests are not allowed.",
      "FORBIDDEN",
      403,
    );
  }
}

/** A stale tab must not replay private mutations under a newly signed-in account. */
export function assertAccountBinding(request: Request, uid: string): void {
  const intended = request.headers.get("x-workspace-account");
  const changesData = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  if ((changesData && !intended) || (intended && intended !== uid)) {
    throw new AccountAccessError(
      "The active account changed. Reload your workspace before continuing.",
      "FORBIDDEN",
      403,
    );
  }
}

export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    throw new AccountAccessError(
      "This request is too large.",
      "PAYLOAD_TOO_LARGE",
      413,
    );
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AccountAccessError(
          "This request is too large.",
          "PAYLOAD_TOO_LARGE",
          413,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function privatePdfPath(
  uid: string,
  generationId: string,
  sha256: string,
): string {
  requireSafeUid(uid);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(generationId) ||
    !/^[a-f0-9]{64}$/.test(sha256)
  ) {
    throw new AccountAccessError(
      "The saved output reference is invalid.",
      "INVALID_REQUEST",
      400,
    );
  }
  return `accounts/${uid}/generations/${generationId}/${sha256}.pdf`;
}

export function assertSafeEmulator(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const enabled = Boolean(
    environment.FIREBASE_AUTH_EMULATOR_HOST ||
    environment.FIRESTORE_EMULATOR_HOST,
  );
  if (!enabled) return false;
  if (
    environment.VERCEL === "1" ||
    !environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.startsWith("demo-")
  ) {
    throw new AccountAccessError(
      "Emulators may only be used with a local demo project.",
      "CONFIGURATION_ERROR",
      503,
    );
  }
  for (const host of [
    environment.FIREBASE_AUTH_EMULATOR_HOST,
    environment.FIRESTORE_EMULATOR_HOST,
  ]) {
    if (host && !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(host)) {
      throw new AccountAccessError(
        "An emulator endpoint is invalid.",
        "CONFIGURATION_ERROR",
        503,
      );
    }
  }
  return true;
}
