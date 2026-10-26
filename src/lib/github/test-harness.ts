export const GITHUB_IMPORT_HARNESS_ENV = "GITHUB_IMPORT_E2E_HARNESS";

export function isGithubImportHarnessEnabled(
  environment: Record<string, string | undefined>,
) {
  return (
    environment.VERCEL !== "1" &&
    environment[GITHUB_IMPORT_HARNESS_ENV] === "1" &&
    environment.RESUME_APP_MODE === "local"
  );
}
