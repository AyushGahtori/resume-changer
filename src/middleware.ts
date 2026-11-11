import { NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "./lib/cloud/headers";

export function middleware(request: NextRequest) {
  if (process.env.VERCEL !== "1" && process.env.RESUME_APP_MODE !== "firebase")
    return NextResponse.next();
  const nonce = btoa(crypto.randomUUID());
  const emulatorEnabled =
    process.env.VERCEL !== "1" &&
    Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    emulatorEnabled,
    emulatorEnabled
      ? [
          process.env.FIREBASE_AUTH_EMULATOR_HOST,
          process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
          process.env.FIRESTORE_EMULATOR_HOST,
        ].filter((host): host is string => Boolean(host))
      : [],
  );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.headers.set(
    "Cross-Origin-Opener-Policy",
    "same-origin-allow-popups",
  );
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.well-known/workflow/|.*\\.(?:svg|png|jpg|webp|gif|woff2)$).*)",
  ],
};
