import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSimulationConfig } from "./user-simulation/config.mjs"; // pragma: allowlist secret
import {
  admissionBudgets,
  affordableNewUsers,
  lifecycleReserve,
} from "./user-simulation/budgets.mjs"; // pragma: allowlist secret
import { renderReport } from "./user-simulation/report.mjs"; // pragma: allowlist secret
import { countBrowserUsers } from "./user-simulation/schedule.mjs"; // pragma: allowlist secret
import {
  assertTestProject,
  deletableIdentities,
} from "./user-simulation/targets.mjs"; // pragma: allowlist secret

const command = process.argv[2];
const args = new Map();
for (let index = 3; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith("--")) continue;
  args.set(token.slice(2), process.argv[index + 1]);
  index += 1;
}

function fail(message, code = 2) {
  console.error(message);
  process.exitCode = code;
}

async function readConfig() {
  const file = args.get("config");
  if (!file) throw new Error("Pass --config with the simulation JSON file."); // pragma: allowlist secret
  return parseSimulationConfig(JSON.parse(await readFile(file, "utf8"))); // pragma: allowlist secret
}

function modeledUser() {
  return lifecycleReserve(
    {
      firebaseWriteUnits: 55,
      firebaseReadUnits: 40,
      storageBytes: 8_000,
      firebaseOutboundBytes: 20_000,
      vercelRequests: 80,
      vercelInvocations: 40,
      vercelActiveCpuSeconds: 2,
      vercelMemoryGbHours: 0.01,
      vercelTransferBytes: 200_000,
    },
    null,
  );
}

async function writeSummary(config, summary) {
  const directory = resolve(
    ".runtime/user-simulation", // pragma: allowlist secret
    config?.runId ?? "unconfigured",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(resolve(directory, "report.md"), renderReport(summary));
  return directory;
}

async function estimate() {
  const config = await readConfig();
  const perUser = modeledUser();
  console.log(
    JSON.stringify(
      {
        users: config.users,
        browserUsers: countBrowserUsers(config.users),
        apiUsers: config.users - countBrowserUsers(config.users),
        perUser,
        documentWritesLowerBound: config.users * 55,
        note: "Offline estimate. Not a bill and not permission to admit cloud users.",
      },
      null,
      2,
    ),
  );
}

async function preflight() {
  const config = await readConfig();
  assertTestProject(config.firebaseProjectId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        target: config.target,
        origin: config.baseURL,
        projectId: config.firebaseProjectId,
        runId: config.runId,
        network: false,
      },
      null,
      2,
    ),
  );
}

async function paused(config, reason) {
  const summary = {
    status: "paused",
    reason,
    runId: config.runId,
    deploymentId: config.deploymentId,
    commit: config.commit,
    baseURL: config.baseURL,
    firebaseProjectId: config.firebaseProjectId,
    users: config.users,
    completed: 0,
    failed: 0,
    paused: 0,
    notStarted: config.users,
    stage: "not started",
    peakActiveSessions: 0,
  };
  const directory = await writeSummary(config, summary);
  console.log(`${reason}. Report: ${directory}/report.md`);
  process.exitCode = 2;
}

async function guarded() {
  const config = await readConfig();
  assertTestProject(config.firebaseProjectId);
  let snapshot = null;
  try {
    snapshot = JSON.parse(await readFile(config.usageSnapshotFile, "utf8"));
  } catch {
    await paused(config, "paused_quota");
    return;
  }
  const budgets = admissionBudgets(snapshot, Date.now());
  if (!budgets.ok) {
    await paused(
      config,
      budgets.reason === "stale-snapshot" ? "paused_telemetry" : "paused_quota",
    );
    return;
  }
  const affordable = affordableNewUsers(budgets.admission, modeledUser());
  if (affordable < 1) {
    await paused(config, "paused_quota");
    return;
  }
  if (process.env.SIMULATION_ADMIN_EXECUTE !== "1") { // pragma: allowlist secret
    await paused(config, "paused_admin_not_armed");
    return;
  }
  if (command === "prepare" || command === "resume") {
    await paused(config, "paused_before_send");
    return;
  }
  const { runHosted } = await import("./user-simulation/hosted-run.mjs"); // pragma: allowlist secret
  await runHosted({ config, command, affordable });
}

async function report() {
  const runId = args.get("run-id");
  if (!runId) return fail("Pass --run-id.");
  const file = resolve(".runtime/user-simulation", runId, "report.md"); // pragma: allowlist secret
  console.log(await readFile(file, "utf8"));
}

async function cleanup() {
  const runId = args.get("run-id");
  if (!runId) return fail("Pass --run-id.");
  const manifestPath = resolve(
    ".runtime/user-simulation", // pragma: allowlist secret
    runId,
    "manifest.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const uids = deletableIdentities(manifest, manifest.projectId, runId);
  if (process.env.SIMULATION_ADMIN_EXECUTE !== "1") { // pragma: allowlist secret
    console.log(
      JSON.stringify({
        deleted: false,
        candidates: uids.length,
        reason:
          "Admin cleanup stays disabled until SIMULATION_ADMIN_EXECUTE=1.", // pragma: allowlist secret
      }),
    );
    return;
  }
  console.log(JSON.stringify({ deleted: false, candidates: uids.length }));
}

const commands = {
  estimate,
  preflight,
  prepare: () => guarded(),
  pilot: () => guarded(),
  run: () => guarded(),
  resume: () => guarded(),
  report,
  cleanup,
};

if (!commands[command]) {
  fail(
    "Use estimate, preflight, prepare, pilot, run, resume, report, or cleanup.",
  );
} else {
  commands[command]().catch((error) => {
    fail(error.message);
  });
}
