export const PUBLISHED_FREE_DAILY = {
  firebaseWriteUnits: 40_000,
  firebaseReadUnits: 50_000,
};

export const DAILY_RUN_CEILING = {
  firebaseWriteUnits: 10_000,
  firebaseReadUnits: 12_500,
  storageBytes: 50 * 1024 * 1024,
  firebaseOutboundBytes: 100 * 1024 * 1024,
  vercelRequests: 75_000,
  vercelInvocations: 75_000,
  vercelActiveCpuSeconds: 900,
  vercelMemoryGbHours: 10,
  vercelTransferBytes: 500 * 1024 * 1024,
};

export const RESOURCE_KEYS = Object.keys(DAILY_RUN_CEILING);
const CLEANUP_FRACTION = 0.2;
export const SNAPSHOT_STALE_MS = 15 * 60 * 1000;

function pacificOffsetHours(now) {
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(now));
  const name =
    zone.find((part) => part.type === "timeZoneName")?.value ?? "GMT-8";
  const match = /GMT([+-]\d+)/.exec(name);
  return match ? Number(match[1]) : -8;
}

/** Next Firestore free-tier reset: midnight Pacific, not midnight Berlin. */
export function nextFirestoreReset(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(now))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const utcHour = String(-pacificOffsetHours(now)).padStart(2, "0");
  const todayStart = Date.parse(
    `${parts.year}-${parts.month}-${parts.day}T${utcHour}:00:00.000Z`,
  );
  if (Number.isNaN(todayStart)) {
    throw new Error("The Firestore quota window could not be calculated.");
  }
  return now >= todayStart ? todayStart + 24 * 60 * 60 * 1000 : todayStart;
}

export function snapshotFresh(snapshot, now) {
  if (!snapshot || typeof snapshot.observedAt !== "string") return false;
  const observed = Date.parse(snapshot.observedAt);
  if (Number.isNaN(observed)) return false;
  return now - observed <= SNAPSHOT_STALE_MS && observed <= now + 5_000;
}

export function boundedAllowance(dailyCeiling, remaining) {
  if (
    remaining === undefined ||
    remaining === null ||
    !Number.isFinite(remaining)
  ) {
    return { ok: false, reason: "unknown-balance" };
  }
  if (remaining < 0) return { ok: false, reason: "unknown-balance" };
  return {
    ok: true,
    amount: Math.min(dailyCeiling, Math.floor(remaining / 2)),
  };
}

/**
 * @param {object} snapshot
 * @param {number} now
 * @returns {{ ok: boolean, reason: string | null, admission: Record<string, number> | null }}
 */
export function admissionBudgets(snapshot, now) {
  if (!snapshotFresh(snapshot, now)) {
    return { ok: false, reason: "stale-snapshot", admission: null };
  }
  const admission = {};
  for (const key of RESOURCE_KEYS) {
    const bounded = boundedAllowance(
      DAILY_RUN_CEILING[key],
      snapshot.remaining?.[key],
    );
    if (!bounded.ok)
      return { ok: false, reason: bounded.reason, admission: null };
    const alreadyUsed = snapshot.ledgerUsed?.[key] ?? 0;
    const remainingRun = Math.max(0, bounded.amount - alreadyUsed);
    admission[key] = Math.floor(remainingRun * (1 - CLEANUP_FRACTION));
  }
  return { ok: true, reason: null, admission };
}

/**
 * @param {Record<string, number>} modeled
 * @param {Record<string, number> | null} observedWorst
 * @returns {Record<string, number>}
 */
export function lifecycleReserve(modeled, observedWorst) {
  if (!observedWorst) return { ...modeled };
  const next = { ...modeled };
  for (const key of Object.keys(modeled)) {
    const seen = observedWorst[key];
    if (seen === undefined || seen === null) continue;
    next[key] = Math.max(modeled[key], seen * 2);
  }
  return next;
}

export function affordableNewUsers(admission, perUser) {
  let count = Number.POSITIVE_INFINITY;
  for (const key of RESOURCE_KEYS) {
    const cost = perUser[key] ?? 0;
    if (cost <= 0) continue;
    count = Math.min(count, Math.floor((admission[key] ?? 0) / cost));
  }
  return Number.isFinite(count) ? count : 0;
}

/**
 * @param {{ users: number, reserved: Record<string, number>, used: Record<string, number> }} ledger
 * @param {Record<string, number>} perUser
 */
export function reserveUser(ledger, perUser) {
  const next = {
    ...ledger,
    reserved: { ...ledger.reserved },
    users: ledger.users + 1,
  };
  for (const key of RESOURCE_KEYS) {
    next.reserved[key] = (next.reserved[key] ?? 0) + (perUser[key] ?? 0);
  }
  return next;
}

/** @returns {{ users: number, reserved: Record<string, number>, used: Record<string, number> }} */
export function emptyLedger() {
  return {
    users: 0,
    reserved: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])),
    used: Object.fromEntries(RESOURCE_KEYS.map((key) => [key, 0])),
  };
}
