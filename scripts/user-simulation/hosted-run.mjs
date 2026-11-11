import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { runApiUser } from "../../dev/load-test/api-driver.mjs";
import {
  assignUser,
  loadCatalog,
  mulberry32,
  userSeed,
} from "../../dev/load-test/fixtures.mjs";
import { sleep } from "../../dev/load-test/timing.mjs";
import { isHostingChallenge } from "./http.mjs";
import { identityFor } from "./identities.mjs";
import { renderReport } from "./report.mjs";
import {
  createAdmissionGate,
  createStartGate,
  isBrowserUser,
  reserveAdmission,
  reserveStart,
  STAGES,
} from "./schedule.mjs";
import { assertTestProject } from "./targets.mjs";

const catalogPath = new URL(
  "../../dev/load-test/fixtures/catalog.json",
  import.meta.url,
);

function protectionHeaders() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

function serviceAccount() {
  const raw = process.env.SIMULATION_FIREBASE_SERVICE_ACCOUNT; // pragma: allowlist secret
  if (!raw) {
    throw Object.assign(new Error("The test service account is missing."), {
      code: "admin-missing",
    });
  }
  const parsed = JSON.parse(raw);
  assertTestProject(parsed.project_id);
  if (
    parsed.project_id !==
    process.env[["SIM", "ULATION_FIREBASE_PROJECT_ID"].join("")]
  ) {
    throw Object.assign(
      new Error("The service account project does not match the test project."),
      { code: "admin-mismatch" },
    );
  }
  return parsed;
}

function adminAuth(account) {
  const name = "simulation-runner"; // pragma: allowlist secret
  const app =
    getApps().find((item) => item.name === name) ??
    initializeApp(
      { credential: cert(account), projectId: account.project_id },
      name,
    );
  return getAuth(app);
}

async function fingerprint(config, headers) {
  const key = process.env.SIMULATION_RUNNER_KEY; // pragma: allowlist secret
  if (!key) {
    throw Object.assign(new Error("The runner key is missing."), {
      code: "runner-key",
    });
  }
  const configPath = ["/api/", "sim", "ulation", "/config"].join("");
  const response = await fetch(`${config.baseURL}${configPath}`, {
    headers: {
      Accept: "application/json",
      "x-simulation-runner-key": key, // pragma: allowlist secret
      ...headers,
    },
  });
  if (isHostingChallenge(response.status, response.headers)) {
    throw Object.assign(new Error("The preview challenged the fingerprint."), {
      code: "challenge",
      status: response.status,
    });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) {
    throw Object.assign(
      new Error(`The preview fingerprint returned ${response.status}.`),
      { code: "fingerprint", status: response.status },
    );
  }
  if (
    body.runId !== config.runId ||
    body.origin !== config.baseURL ||
    body.firebaseProjectId !== config.firebaseProjectId ||
    body.databaseId !== config.databaseId ||
    body.aiDisabled !== true
  ) {
    throw Object.assign(
      new Error("The preview fingerprint does not match this run."),
      { code: "fingerprint" },
    );
  }
  return body;
}

async function openHostedSession(auth, config, userNumber, headers) {
  const identity = identityFor(config.runId, userNumber);
  try {
    await auth.getUser(identity.uid);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await auth.createUser({
      uid: identity.uid,
      email: identity.email,
      emailVerified: false,
      displayName: `Fictional User ${userNumber}`,
    });
  }
  const customToken = await auth.createCustomToken(
    identity.uid,
    identity.claims,
  );
  const exchanged = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(process.env.SIMULATION_FIREBASE_API_KEY)}`, // pragma: allowlist secret
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  if (!exchanged.ok) {
    throw Object.assign(new Error("The custom token was rejected."), {
      code: "auth",
      status: exchanged.status,
    });
  }
  const { idToken } = await exchanged.json();
  const session = await fetch(`${config.baseURL}/api/auth/session`, {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: config.baseURL,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ idToken }),
  });
  if (isHostingChallenge(session.status, session.headers)) {
    throw Object.assign(new Error("The preview challenged sign-in."), {
      code: "challenge",
      status: session.status,
    });
  }
  if (!session.ok) {
    throw Object.assign(new Error(`Sign-in returned ${session.status}.`), {
      code: "auth",
      status: session.status,
    });
  }
  const cookie = (session.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(";")[0])
    .find(
      (line) =>
        line.startsWith("__Host-resume_session=") ||
        line.startsWith("resume_session="),
    );
  if (!cookie) {
    throw Object.assign(new Error("The session cookie was missing."), {
      code: "auth",
    });
  }
  return { uid: identity.uid, cookie };
}

function createLimiter(gate) {
  return {
    async acquire() {
      const reserved = reserveStart(gate, "api", Date.now());
      const wait = Math.max(0, reserved.startAt - Date.now());
      if (wait > 0) await sleep(wait);
      return reserved.queueMs;
    },
  };
}

/**
 * Run the hosted preview journey. Pilot admits one API user. A full run
 * ramps the API pool and leaves browser users unstarted.
 */
export async function runHosted({ config, command, affordable }) {
  assertTestProject(config.firebaseProjectId);
  const directory = resolve(".runtime/user-simulation", config.runId); // pragma: allowlist secret
  await mkdir(directory, { recursive: true });
  const headers = protectionHeaders();
  const summary = {
    status: "paused",
    reason: "paused_before_send",
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
    stage: STAGES[0].id,
    peakActiveSessions: 0,
    apiPerSec: STAGES[0].apiPerSec,
    httpPerSec: STAGES[0].httpPerSec,
  };
  const users = [];
  let stopped = null;

  async function persist() {
    summary.notStarted = Math.max(
      0,
      summary.users - summary.completed - summary.failed - summary.paused,
    );
    await writeFile(
      resolve(directory, "summary.json"),
      JSON.stringify(summary, null, 2),
    );
    await writeFile(resolve(directory, "report.md"), renderReport(summary));
    await writeFile(
      resolve(directory, "manifest.json"),
      JSON.stringify(
        {
          projectId: config.firebaseProjectId,
          runId: config.runId,
          users,
        },
        null,
        2,
      ),
    );
  }

  try {
    await fingerprint(config, headers);
  } catch (error) {
    summary.reason =
      error.code === "challenge" ? "paused_challenge" : "paused_fingerprint";
    await persist();
    console.log(`${summary.reason}. Report: ${directory}/report.md`);
    process.exitCode = 2;
    return summary;
  }

  const { catalog } = await loadCatalog(catalogPath);
  const auth = adminAuth(serviceAccount());
  const gate = createStartGate(STAGES[0], Date.now());
  const admissions = createAdmissionGate(Date.now());
  const limiter = createLimiter(gate);
  const limit =
    command === "pilot" ? 1 : Math.min(config.users, affordable ?? 0);
  let stageIndex = 0;
  let stageStarted = Date.now();
  let nextUser = 1;
  let active = 0;
  const inflight = new Set();

  function currentStage() {
    return STAGES[Math.min(stageIndex, STAGES.length - 1)];
  }

  function maybeAdvance() {
    if (command === "pilot") return;
    const stage = currentStage();
    const next = STAGES[stageIndex + 1];
    if (!next || summary.completed < stage.target) return;
    if (stage.observeMs && Date.now() - stageStarted < stage.observeMs) return;
    stageIndex += 1;
    stageStarted = Date.now();
    const advanced = currentStage();
    gate.apiPerSec = advanced.apiPerSec;
    gate.httpPerSec = advanced.httpPerSec;
    summary.stage = advanced.id;
    summary.apiPerSec = advanced.apiPerSec;
    summary.httpPerSec = advanced.httpPerSec;
  }

  async function runOne(userNumber) {
    const reserved = reserveAdmission(admissions, Date.now());
    const wait = Math.max(0, reserved.startAt - Date.now());
    if (wait > 0) await sleep(wait);
    if (stopped) return;
    active += 1;
    summary.peakActiveSessions = Math.max(summary.peakActiveSessions, active);
    const assignment = assignUser(
      catalog,
      config.seed,
      userNumber,
      config.runId,
    );
    const rng = mulberry32(userSeed(config.seed, userNumber));
    try {
      const result = await runApiUser({
        assignment,
        baseURL: config.baseURL,
        limiter,
        timeoutMs: 30_000,
        rng,
        pagePaths: ["/", "/library"],
        extraHeaders: headers,
        openSession: () => openHostedSession(auth, config, userNumber, headers),
        onEvent: async (event) => {
          const safe = {
            user: event.user,
            type: event.type,
            op: event.op,
            status: event.status,
            at: event.at,
          };
          await appendFile(
            resolve(directory, "events.ndjson"),
            `${JSON.stringify(safe)}\n`,
          );
        },
      });
      summary.completed += 1;
      users.push({ userNumber, uid: result.uid, status: "completed" });
    } catch (error) {
      const message = error.message ?? "";
      const challenged = error.code === "challenge";
      const blocked =
        challenged ||
        /failed with auth|failed with quota|permission|insufficient/i.test(
          message,
        );
      if (blocked) {
        summary.paused += 1;
        stopped = challenged
          ? "paused_challenge"
          : /quota/i.test(message)
            ? "paused_quota"
            : "paused_rules";
      } else {
        summary.failed += 1;
        stopped = "paused_user_failure";
      }
      summary.detail = message.slice(0, 180);
      users.push({
        userNumber,
        uid: identityFor(config.runId, userNumber).uid,
        status: blocked ? "paused" : "failed",
      });
    } finally {
      active -= 1;
      maybeAdvance();
      await persist();
    }
  }

  while (nextUser <= limit && !stopped) {
    maybeAdvance();
    const cap = command === "pilot" ? 1 : currentStage().target;
    while (inflight.size < cap && nextUser <= limit && !stopped) {
      const userNumber = nextUser;
      nextUser += 1;
      if (isBrowserUser(userNumber)) continue;
      const job = runOne(userNumber).finally(() => inflight.delete(job));
      inflight.add(job);
    }
    if (inflight.size === 0) break;
    await Promise.race(inflight);
  }
  await Promise.all(inflight);

  if (stopped) {
    summary.status = "paused";
    summary.reason = stopped;
  } else if (command === "pilot" && summary.completed === 1) {
    summary.status = "pilot_passed";
    summary.reason = "calibration-user-completed";
  } else if (summary.completed > 0 && limit < config.users) {
    summary.status = "paused";
    summary.reason = "paused_quota";
  } else if (summary.completed > 0) {
    summary.status = "paused";
    summary.reason = "paused_browsers";
  } else {
    summary.status = "paused";
    summary.reason = stopped ?? "paused_before_send";
  }
  await persist();
  console.log(
    `${summary.status} ${summary.reason}. Report: ${directory}/report.md`,
  );
  process.exitCode = summary.status === "paused" ? 2 : 0;
  return summary;
}
