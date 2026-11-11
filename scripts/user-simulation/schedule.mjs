/** Selected workload defaults. These are not platform detection thresholds. */

export const STAGES = [
  {
    id: "baseline",
    target: 1,
    observeMs: 180_000,
    apiPerSec: 0.2,
    httpPerSec: 2,
    requiresCompletedJourney: true,
  },
  { id: "A", target: 2, observeMs: 300_000, apiPerSec: 0.3, httpPerSec: 2 },
  { id: "B", target: 5, observeMs: 300_000, apiPerSec: 0.5, httpPerSec: 3 },
  { id: "C", target: 10, observeMs: 600_000, apiPerSec: 1, httpPerSec: 4 },
  { id: "D", target: 20, observeMs: 600_000, apiPerSec: 2, httpPerSec: 5 },
  { id: "E", target: 35, observeMs: 600_000, apiPerSec: 3, httpPerSec: 6 },
  { id: "F", target: 50, observeMs: 600_000, apiPerSec: 4, httpPerSec: 8 },
  { id: "G", target: 75, observeMs: 600_000, apiPerSec: 6, httpPerSec: 10 },
  { id: "H", target: 100, observeMs: null, apiPerSec: 8, httpPerSec: 12 },
];

export const PROFILE_120 = {
  id: "120",
  target: 120,
  apiPerSec: 10,
  httpPerSec: 15,
  browserCap: 6,
};

export const ADMISSION_INTERVAL_MS = 2_000;
export const STAGE_REACH_TIMEOUT_MS = 15 * 60 * 1000;
export const TOTAL_USERS = 1_000;

export function isBrowserUser(userNumber) {
  return (
    Math.floor((userNumber * 5) / 100) >
    Math.floor(((userNumber - 1) * 5) / 100)
  );
}

export function countBrowserUsers(total = TOTAL_USERS) {
  let count = 0;
  for (let user = 1; user <= total; user += 1) {
    if (isBrowserUser(user)) count += 1;
  }
  return count;
}

export function browserCap(stageTarget) {
  return Math.ceil((stageTarget * 5) / 100);
}

export function createStartGate(stage, now) {
  return {
    apiPerSec: stage.apiPerSec,
    httpPerSec: stage.httpPerSec,
    nextHttp: now,
    nextApi: now,
  };
}

/** Reserve the next first-party start. Idle time does not become burst credit. */
export function reserveStart(gate, kind, now) {
  const httpGap = 1000 / gate.httpPerSec;
  const apiGap = 1000 / gate.apiPerSec;
  const earliest =
    kind === "api"
      ? Math.max(gate.nextHttp, gate.nextApi, now)
      : Math.max(gate.nextHttp, now);
  gate.nextHttp = earliest + httpGap;
  if (kind === "api") gate.nextApi = earliest + apiGap;
  return { startAt: earliest, queueMs: earliest - now };
}

export function createAdmissionGate(now) {
  return { nextAt: now };
}

export function reserveAdmission(gate, now) {
  const startAt = Math.max(gate.nextAt, now);
  gate.nextAt = startAt + ADMISSION_INTERVAL_MS;
  return { startAt, queueMs: startAt - now };
}

export function stageOccupancy({ target, active, elapsedMs }) {
  if (active >= target) return { reached: true, reason: null };
  if (elapsedMs >= STAGE_REACH_TIMEOUT_MS) {
    return {
      reached: false,
      reason: "target-not-reached",
      active,
      target,
    };
  }
  return { reached: false, reason: null, active, target };
}

export function splitLatency(queueMs, responseMs) {
  return { queueMs, networkMs: responseMs };
}
