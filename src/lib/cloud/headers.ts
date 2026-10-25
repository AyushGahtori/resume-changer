export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  emulator: boolean,
): string {
  if (!/^[A-Za-z0-9+/=]+$/.test(nonce))
    throw new Error("Invalid request nonce.");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://accounts.google.com${emulator ? " http://127.0.0.1:9099 http://127.0.0.1:8080" : ""}${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
    `frame-src 'self' blob: https://*.firebaseapp.com https://accounts.google.com${emulator ? " http://127.0.0.1:9099" : ""}`,
    "object-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}
