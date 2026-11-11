import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function defaultFirebaseProjectId() {
  const path = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../.firebaserc",
  );
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Preview service-account checks need the default project in .firebaserc.",
    );
  }
  const project = parsed?.projects?.default;
  if (typeof project !== "string" || !project.trim())
    throw new Error(
      "Preview service-account checks need the default project in .firebaserc.",
    );
  return project;
}

function assertPreviewServiceAccount(environment) {
  if (environment.VERCEL_ENV !== "preview") return;
  const raw = environment.GITHUB_FIREBASE_SERVICE_ACCOUNT;
  if (typeof raw !== "string" || !raw.trim()) return;
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      "Preview deployments cannot accept GITHUB_FIREBASE_SERVICE_ACCOUNT unless it is JSON for a non-production Firebase project.",
    );
  }
  const projectId =
    credentials &&
    typeof credentials === "object" &&
    !Array.isArray(credentials) &&
    typeof credentials.project_id === "string"
      ? credentials.project_id
      : "";
  if (!projectId || projectId === defaultFirebaseProjectId())
    throw new Error(
      "Preview deployments cannot hold a service account for the production Firebase project. Give Preview its own non-production project.",
    );
}

export function checkHostedAccountConfig(environment) {
  if (environment.RESUME_LOAD_TEST) {
    throw new Error(
      "Hosted builds cannot enable the local load-test runtime.",
    );
  }
  if (environment.VERCEL !== "1") return;
  assertPreviewServiceAccount(environment);
  const required = [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "NEXT_PUBLIC_FIREBASE_DATABASE_ID",
  ];
  const missing = required.filter((key) => !environment[key]?.trim());
  if (missing.length)
    throw new Error(
      `Hosted account configuration is missing: ${missing.join(", ")}. Configure this deployment environment before building.`,
    );
  // Firebase Admin's verifier imports jwks-rsa -> jose from CommonJS. Vercel
  // disables Node's require(ESM) capability unless explicitly enabled. This
  // is required by every hosted session request, not only GitHub imports.
  const flags = (environment.NODE_OPTIONS ?? "")
    .split(/\s+/)
    .filter((flag) =>
      [
        "--experimental-require-module",
        "--no-experimental-require-module",
      ].includes(flag),
    );
  if (flags.at(-1) !== "--experimental-require-module")
    throw new Error(
      "Hosted Firebase accounts require NODE_OPTIONS=--experimental-require-module in this deployment environment.",
    );
  if (environment.RESUME_APP_MODE && environment.RESUME_APP_MODE !== "firebase")
    throw new Error("Hosted account mode must be firebase.");
  if (
    Object.entries(environment).some(
      ([key, value]) => key.includes("EMULATOR_HOST") && value,
    )
  )
    throw new Error("Hosted account builds cannot use local emulators.");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  checkHostedAccountConfig(process.env);
}
