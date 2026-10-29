const required = [
  "GITHUB_APP_ID",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_CALLBACK_URL",
  "GITHUB_FIREBASE_SERVICE_ACCOUNT",
  "GITHUB_VAULT_KEY",
  "GITHUB_HOSTED_NAMESPACE",
  "GEMINI_API_KEY",
] as const;
export function hostedGithubConfigured(
  environment: Record<string, string | undefined> = process.env,
) {
  return (
    environment.VERCEL === "1" &&
    environment.GITHUB_RUNTIME_ENABLED === "1" &&
    required.every((key) => Boolean(environment[key]?.trim()))
  );
}
