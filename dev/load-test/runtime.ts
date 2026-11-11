export const LOAD_TEST_PROJECT_ID = "demo-resume-changer-loadtest";

const loopbackHost = /^(?:127\.0\.0\.1|localhost):\d{2,5}$/;

export type LoadTestEnvironment = Record<string, string | undefined>;

export function isLoadTestRuntime(
  environment: LoadTestEnvironment = process.env,
) {
  return (
    environment.RESUME_LOAD_TEST === "1" &&
    environment.VERCEL !== "1" &&
    environment.RESUME_APP_MODE === "firebase" &&
    environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID === LOAD_TEST_PROJECT_ID &&
    environment.NEXT_PUBLIC_FIREBASE_DATABASE_ID === "(default)" &&
    loopbackHost.test(environment.FIREBASE_AUTH_EMULATOR_HOST ?? "") &&
    environment.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ===
      environment.FIREBASE_AUTH_EMULATOR_HOST &&
    loopbackHost.test(environment.FIRESTORE_EMULATOR_HOST ?? "")
  );
}

export function loadTestSafetyBody(
  environment: LoadTestEnvironment = process.env,
) {
  if (!isLoadTestRuntime(environment)) return null;
  return {
    mode: "firebase" as const,
    projectId: LOAD_TEST_PROJECT_ID,
    databaseId: "(default)" as const,
    authEmulatorHost: environment.FIREBASE_AUTH_EMULATOR_HOST,
    firestoreEmulatorHost: environment.FIRESTORE_EMULATOR_HOST,
  };
}

const readOnly = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Local load-test runs may use the session, library reads, manual metadata,
 * and manual points. AI, generation, compilation, resume measurement, and
 * GitHub import are refused before a handler runs.
 */
export function loadTestForbidden(
  pathname: string,
  method: string,
  environment: LoadTestEnvironment = process.env,
) {
  if (!isLoadTestRuntime(environment)) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (
    path.startsWith("/api/ai/") ||
    path.startsWith("/api/github") ||
    path.startsWith("/api/resume/") ||
    path === "/api/generate" ||
    path === "/api/compile"
  )
    return true;
  if (readOnly.has(method)) return false;
  if (
    path === "/api/auth/session" &&
    (method === "POST" || method === "DELETE")
  )
    return false;
  if (path === "/api/library/profile" && method === "PATCH") return false;
  if (path === "/api/library/skills" && method === "PUT") return false;
  if (path === "/api/library/points" && method === "POST") return false;
  if (/^\/api\/library\/jobs\/[^/]+$/.test(path) && method === "PUT")
    return false;
  if (/^\/api\/library\/projects\/[^/]+$/.test(path) && method === "PUT")
    return false;
  return true;
}
