import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function checkHostedAccountConfig(environment) {
  if (environment.VERCEL !== "1") return;
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
