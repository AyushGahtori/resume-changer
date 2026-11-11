import { AccountAccessError, requireSafeUid } from "@/lib/cloud/security";

export const PRODUCTION_FIREBASE_PROJECT_ID = "resume-changer-ayush-prod";

const runIdPattern = /^sim-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const projectIdPattern = /^[a-z][a-z0-9-]{4,62}$/;
const databaseIdPattern = /^(\(default\)|[a-z][a-z0-9-]{2,62})$/;
const loopbackHost = /^(?:127\.0\.0\.1|localhost):\d{2,5}$/;
const readOnly = new Set(["GET", "HEAD", "OPTIONS"]);

export type SimulationEnvironment = Record<string, string | undefined>;

function authFailure() {
  return new AccountAccessError(
    "Sign in to access your workspace.",
    "AUTH_REQUIRED",
    401,
  );
}

function runnerKeyOk(value: string | undefined) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 200 &&
    !/\s/.test(value)
  );
}

function originOk(value: string | undefined, hosted: boolean) {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.pathname !== "/" && url.pathname !== "") return false;
  if (hosted) {
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".vercel.app") &&
      url.hostname.split(".").length >= 3
    );
  }
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}

function sharedSimulationSettings(environment: SimulationEnvironment) {
  const projectId = environment.RESUME_SIMULATION_FIREBASE_PROJECT_ID;
  return (
    environment.RESUME_SIMULATION_MODE === "1" &&
    environment.RESUME_APP_MODE === "firebase" &&
    environment.AI_PROVIDER === "mock" &&
    runIdPattern.test(environment.RESUME_SIMULATION_RUN_ID ?? "") &&
    runnerKeyOk(environment.RESUME_SIMULATION_RUNNER_KEY) &&
    projectId === environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID &&
    projectId !== PRODUCTION_FIREBASE_PROJECT_ID &&
    projectIdPattern.test(projectId ?? "") &&
    databaseIdPattern.test(environment.NEXT_PUBLIC_FIREBASE_DATABASE_ID ?? "")
  );
}

/** Preview deployment bound to one non-production Firebase project. */
export function isHostedSimulation(
  environment: SimulationEnvironment = process.env,
) {
  return (
    sharedSimulationSettings(environment) &&
    environment.VERCEL === "1" &&
    environment.VERCEL_ENV === "preview" &&
    !environment.FIREBASE_AUTH_EMULATOR_HOST &&
    !environment.FIRESTORE_EMULATOR_HOST &&
    !environment.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST &&
    !environment.RESUME_SIMULATION_FIREBASE_PROJECT_ID?.startsWith("demo-") &&
    originOk(environment.RESUME_SIMULATION_ORIGIN, true)
  );
}

/** Loopback demo project used to exercise the same claims before any cloud run. */
export function isLocalSimulation(
  environment: SimulationEnvironment = process.env,
) {
  const projectId = environment.RESUME_SIMULATION_FIREBASE_PROJECT_ID;
  return (
    sharedSimulationSettings(environment) &&
    environment.VERCEL !== "1" &&
    projectId?.startsWith("demo-") === true &&
    loopbackHost.test(environment.FIREBASE_AUTH_EMULATOR_HOST ?? "") &&
    environment.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ===
      environment.FIREBASE_AUTH_EMULATOR_HOST &&
    loopbackHost.test(environment.FIRESTORE_EMULATOR_HOST ?? "") &&
    originOk(environment.RESUME_SIMULATION_ORIGIN, false)
  );
}

export function isSimulationRuntime(
  environment: SimulationEnvironment = process.env,
) {
  return isHostedSimulation(environment) || isLocalSimulation(environment);
}

export function simulationUid(runId: string, userNumber: number) {
  return `sim-${runId}-u${String(userNumber).padStart(4, "0")}`;
}

export function simulationUidMatches(uid: string, runId: string) {
  return new RegExp(`^sim-${runId}-u\\d{4}$`).test(uid);
}

function claimString(claims: Record<string, unknown>, key: string) {
  const value = claims[key];
  return typeof value === "string" ? value : undefined;
}

function signInProvider(claims: Record<string, unknown>) {
  const firebase = claims.firebase;
  if (
    !firebase ||
    typeof firebase !== "object" ||
    !("sign_in_provider" in firebase)
  )
    return undefined;
  const provider = firebase.sign_in_provider;
  return typeof provider === "string" ? provider : undefined;
}

/**
 * Google users keep the verified-email rule. Custom-token simulation users are
 * accepted only inside a validated simulation runtime, and their contact email
 * is fictional rather than a verified Gmail identity.
 */
export function acceptIdentityClaims(
  claims: Record<string, unknown>,
  projectId: string,
  nowSeconds: number,
  environment: SimulationEnvironment = process.env,
): "google" | "simulation" {
  const provider = signInProvider(claims);
  const subject = claimString(claims, "sub");
  if (
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    !subject ||
    typeof claims.exp !== "number" ||
    claims.exp <= nowSeconds ||
    typeof claims.auth_time !== "number" ||
    claims.auth_time < 0 ||
    claims.auth_time > nowSeconds + 15
  )
    throw authFailure();
  try {
    requireSafeUid(subject);
  } catch {
    throw authFailure();
  }
  if (provider === "google.com" && claims.email_verified === true)
    return "google";
  const runId = environment.RESUME_SIMULATION_RUN_ID ?? "";
  const email = claimString(claims, "email");
  if (
    isSimulationRuntime(environment) &&
    provider === "custom" &&
    claims.simulation === true &&
    claimString(claims, "simulationRunId") === runId &&
    simulationUidMatches(subject, runId) &&
    email?.endsWith("@example.test") === true
  )
    return "simulation";
  throw authFailure();
}

function expensive(path: string) {
  return (
    path.startsWith("/api/ai/") ||
    path.startsWith("/api/github") ||
    path.startsWith("/api/resume/") ||
    path === "/api/generate" ||
    path === "/api/compile" ||
    /\/pdf$/.test(path)
  );
}

/**
 * Simulation mode may use session, library reads, manual metadata, manual
 * points, read-only history, and the runner fingerprint. AI and other
 * expensive handlers are refused before they run.
 */
export function simulationForbidden(
  pathname: string,
  method: string,
  environment: SimulationEnvironment = process.env,
) {
  if (environment.RESUME_SIMULATION_MODE !== "1") return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  if (expensive(path)) return true;
  if (!isSimulationRuntime(environment)) return false;
  if (readOnly.has(method)) {
    if (path === "/api/history" || /^\/api\/history\/[^/]+$/.test(path))
      return false;
    if (path === "/api/account/library") return false;
    if (path === "/api/simulation/config") return false;
    if (path === "/api/auth/session") return false;
    return true;
  }
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

export function simulationConfigBody(
  environment: SimulationEnvironment = process.env,
) {
  if (!isSimulationRuntime(environment)) return null;
  return {
    runId: environment.RESUME_SIMULATION_RUN_ID,
    origin: environment.RESUME_SIMULATION_ORIGIN,
    firebaseProjectId: environment.RESUME_SIMULATION_FIREBASE_PROJECT_ID,
    databaseId: environment.NEXT_PUBLIC_FIREBASE_DATABASE_ID,
    aiDisabled: true as const,
  };
}
