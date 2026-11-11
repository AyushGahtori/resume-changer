const loopbackHost = /^(?:127\.0\.0\.1|localhost):\d{2,5}$/;

/** Keeps emulator CSP origins on loopback, including a non-default local port. */
export function emulatorConnectOrigins(hosts: readonly string[] = []): string {
  const origins = new Set<string>([
    "http://127.0.0.1:9099",
    "http://127.0.0.1:8080",
  ]);
  for (const host of hosts) {
    if (!loopbackHost.test(host)) continue;
    origins.add(`http://${host}`);
  }
  return [...origins].join(" ");
}

export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  emulator: boolean,
  emulatorHosts: readonly string[] = [],
): string {
  if (!/^[A-Za-z0-9+/=]+$/.test(nonce))
    throw new Error("Invalid request nonce.");
  const emulatorOrigins = emulator
    ? ` ${emulatorConnectOrigins(emulatorHosts)}`
    : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://accounts.google.com${emulatorOrigins}${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    `frame-src 'self' blob: https://*.firebaseapp.com https://accounts.google.com${emulatorOrigins}`,
    "object-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}
