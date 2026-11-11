import { PRODUCTION_PROJECT_ID } from "./targets.mjs";

const HOSTED_KEYS = [
  "target",
  "baseURL",
  "deploymentId",
  "commit",
  "firebaseProjectId",
  "databaseId",
  "runId",
  "users",
  "maxConcurrency",
  "browserPercent",
  "seed",
  "maxNewSessionEveryMs",
  "maxDailyInvocationMs",
  "quotaMode",
  "usageSnapshotFile",
];

function fail(message) {
  const error = new Error(message);
  error.code = "simulation-config";
  return error;
}

function isPlaceholder(value) {
  return typeof value === "string" && value.includes("REPLACE_");
}

export function parseSimulationConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw fail("The simulation config must be a JSON object.");
  }
  const keys = Object.keys(input);
  const extra = keys.filter((key) => !HOSTED_KEYS.includes(key));
  const missing = HOSTED_KEYS.filter((key) => !keys.includes(key));
  if (extra.length > 0 || missing.length > 0) {
    throw fail("The simulation config keys do not match the contract.");
  }
  for (const value of Object.values(input)) {
    if (isPlaceholder(value))
      throw fail("The simulation config still contains a placeholder.");
  }
  if (input.target !== "vercel-preview" && input.target !== "local-demo") {
    throw fail("The simulation target is not supported.");
  }
  let url;
  try {
    url = new URL(input.baseURL);
  } catch {
    throw fail("The simulation origin is not a URL.");
  }
  if (url.username || url.password) {
    throw fail("The simulation origin must not contain credentials.");
  }
  if (input.target === "vercel-preview") {
    if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app")) {
      throw fail("A hosted simulation must use an immutable preview hostname.");
    }
  } else if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  ) {
    throw fail("A local simulation must stay on loopback.");
  }
  if (
    input.firebaseProjectId === PRODUCTION_PROJECT_ID ||
    !/^[a-z][a-z0-9-]{4,62}$/.test(input.firebaseProjectId)
  ) {
    throw fail(
      "The simulation Firebase project is not an allowed test project.",
    );
  }
  if (
    input.target === "vercel-preview" &&
    input.firebaseProjectId.startsWith("demo-")
  ) {
    throw fail("A hosted simulation cannot use a demo Firebase project.");
  }
  if (
    input.target === "local-demo" &&
    !input.firebaseProjectId.startsWith("demo-")
  ) {
    throw fail("A local simulation must use a demo Firebase project.");
  }
  if (!/^(\(default\)|[a-z][a-z0-9-]{2,62})$/.test(input.databaseId)) {
    throw fail("The simulation database id is invalid.");
  }
  if (!/^sim-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.runId)) {
    throw fail("The simulation run id is invalid.");
  }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.deploymentId)) {
    throw fail("The deployment id is invalid.");
  }
  if (!/^[a-f0-9]{40}$/.test(input.commit)) {
    throw fail("The commit must be a full git SHA.");
  }
  if (
    input.users !== 1000 ||
    input.maxConcurrency !== 100 ||
    input.browserPercent !== 5 ||
    input.seed !== 42 ||
    input.maxNewSessionEveryMs !== 2000 ||
    input.maxDailyInvocationMs !== 14_400_000 ||
    input.quotaMode !== "free-budgeted" ||
    typeof input.usageSnapshotFile !== "string" ||
    input.usageSnapshotFile.includes("..")
  ) {
    throw fail(
      "The simulation schedule settings do not match the hosted contract.",
    );
  }
  return input;
}
