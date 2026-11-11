import { describe, expect, it } from "vitest";
import {
  admissionBudgets,
  affordableNewUsers,
  emptyLedger,
  lifecycleReserve,
  nextFirestoreReset,
  reserveUser,
} from "../../../scripts/user-simulation/budgets.mjs"; // pragma: allowlist secret
import { parseSimulationConfig as parseHostedConfig } from "../../../scripts/user-simulation/config.mjs"; // pragma: allowlist secret
import {
  reconcileSave,
  resumeAllowed,
} from "../../../scripts/user-simulation/recovery.mjs"; // pragma: allowlist secret
import {
  browserCap,
  countBrowserUsers,
  createAdmissionGate,
  createStartGate,
  isBrowserUser,
  reserveAdmission,
  reserveStart,
  splitLatency,
  stageOccupancy,
  STAGES,
} from "../../../scripts/user-simulation/schedule.mjs"; // pragma: allowlist secret
import {
  assertProvisioningArmed,
  identityFor,
} from "../../../scripts/user-simulation/identities.mjs"; // pragma: allowlist secret
import { isHostingChallenge } from "../../../scripts/user-simulation/http.mjs"; // pragma: allowlist secret
import { deletableIdentities } from "../../../scripts/user-simulation/targets.mjs"; // pragma: allowlist secret

const config = {
  target: "vercel-preview",
  baseURL: "https://resume-changer-abc123.vercel.app",
  deploymentId: "dpl_preview123",
  commit: "a".repeat(40),
  firebaseProjectId: "resume-changer-simulation-test", // pragma: allowlist secret
  databaseId: "(default)",
  runId: "sim-20261111-001",
  users: 1000,
  maxConcurrency: 100,
  browserPercent: 5,
  seed: 42,
  maxNewSessionEveryMs: 2000,
  maxDailyInvocationMs: 14_400_000,
  quotaMode: "free-budgeted",
  usageSnapshotFile: ".runtime/user-simulation/quota-snapshot.json", // pragma: allowlist secret
};

function snapshot(now: number, remainingWrite = 40_000) {
  return {
    observedAt: new Date(now).toISOString(),
    remaining: {
      firebaseWriteUnits: remainingWrite,
      firebaseReadUnits: 50_000,
      storageBytes: 1024 * 1024 * 1024,
      firebaseOutboundBytes: 1024 * 1024 * 1024,
      vercelRequests: 1_000_000,
      vercelInvocations: 1_000_000,
      vercelActiveCpuSeconds: 10_000,
      vercelMemoryGbHours: 100,
      vercelTransferBytes: 1024 * 1024 * 1024,
    },
    ledgerUsed: {},
  };
}

describe("paced schedule", () => {
  it("assigns exactly 50 browser users and caps browsers with the stage", () => {
    expect(countBrowserUsers()).toBe(50);
    expect(countBrowserUsers() + 950).toBe(1000);
    expect(isBrowserUser(1)).toBe(false);
    expect(browserCap(100)).toBe(5);
    expect(browserCap(1)).toBe(1);
    expect(STAGES.at(-1)?.target).toBe(100);
    expect(STAGES.at(-1)?.apiPerSec).toBe(8);
  });

  it("spaces request starts without storing burst credit", () => {
    const gate = createStartGate({ apiPerSec: 1, httpPerSec: 2 }, 0);
    expect(reserveStart(gate, "api", 0)).toEqual({ startAt: 0, queueMs: 0 });
    expect(reserveStart(gate, "api", 0)).toEqual({
      startAt: 1000,
      queueMs: 1000,
    });
    const later = reserveStart(gate, "http", 10_000);
    expect(later.startAt).toBe(10_000);
    expect(later.queueMs).toBe(0);
    expect(splitLatency(later.queueMs, 40).networkMs).toBe(40);
  });

  it("admits one session at a time and reports a missed stage target", () => {
    const admissions = createAdmissionGate(0);
    expect(reserveAdmission(admissions, 0).startAt).toBe(0);
    expect(reserveAdmission(admissions, 0).startAt).toBe(2000);
    expect(
      stageOccupancy({ target: 5, active: 2, elapsedMs: 15 * 60 * 1000 }),
    ).toMatchObject({ reached: false, reason: "target-not-reached" });
    expect(
      stageOccupancy({ target: 5, active: 5, elapsedMs: 1 }),
    ).toMatchObject({
      reached: true,
    });
  });
});

describe("paced budgets", () => {
  it("keeps the next Firestore reset on Pacific midnight", () => {
    const berlinMidnight = Date.parse("2026-11-12T00:00:00+01:00");
    const reset = nextFirestoreReset(berlinMidnight);
    expect(new Date(reset).toISOString()).toBe("2026-11-12T08:00:00.000Z");
  });

  it("refuses unknown or stale balances and reserves a whole user before admission", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(admissionBudgets(snapshot(now - 16 * 60 * 1000), now).ok).toBe(
      false,
    );
    expect(
      admissionBudgets(
        { observedAt: new Date(now).toISOString(), remaining: {} },
        now,
      ).ok,
    ).toBe(false);
    const open = admissionBudgets(snapshot(now, 40_000), now);
    expect(open.ok).toBe(true);
    expect(open.admission?.firebaseWriteUnits).toBe(8_000);
    const perUser = lifecycleReserve(
      {
        firebaseWriteUnits: 55,
        firebaseReadUnits: 40,
        storageBytes: 1,
        firebaseOutboundBytes: 1,
        vercelRequests: 1,
        vercelInvocations: 1,
        vercelActiveCpuSeconds: 1,
        vercelMemoryGbHours: 1,
        vercelTransferBytes: 1,
      },
      null,
    );
    expect(lifecycleReserve(perUser, { firebaseWriteUnits: 40 })).toMatchObject(
      {
        firebaseWriteUnits: 80,
      },
    );
    expect(affordableNewUsers(open.admission, perUser)).toBeGreaterThan(0);
    const ledger = reserveUser(emptyLedger(), perUser);
    expect(ledger.users).toBe(1);
    expect(ledger.reserved.firebaseWriteUnits).toBe(55);
    const restarted = { ...ledger };
    expect(restarted.users).toBe(1);
  });

  it("pauses when the write budget cannot buy one more full journey", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    const tight = admissionBudgets(snapshot(now, 10), now);
    expect(
      affordableNewUsers(tight.admission, {
        firebaseWriteUnits: 55,
        firebaseReadUnits: 1,
        storageBytes: 1,
        firebaseOutboundBytes: 1,
        vercelRequests: 1,
        vercelInvocations: 1,
        vercelActiveCpuSeconds: 1,
        vercelMemoryGbHours: 1,
        vercelTransferBytes: 1,
      }),
    ).toBe(0);
  });
});

describe("paced config and recovery", () => {
  it("rejects production, placeholders, and credentialed origins", () => {
    expect(parseHostedConfig(config).runId).toBe("sim-20261111-001"); // pragma: allowlist secret
    expect(() =>
      parseHostedConfig({
        // pragma: allowlist secret
        ...config,
        firebaseProjectId: "resume-changer-ayush-prod",
      }),
    ).toThrow(/test project/);
    expect(() =>
      parseHostedConfig({
        // pragma: allowlist secret
        ...config,
        baseURL: "https://user:secret@resume-changer-abc123.vercel.app",
      }),
    ).toThrow(/credentials/);
    expect(
      () => parseHostedConfig({ ...config, commit: "REPLACE_WITH_COMMIT_SHA" }), // pragma: allowlist secret
    ).toThrow(/placeholder/);
    expect(() => parseHostedConfig({ ...config, extra: true })).toThrow(
      // pragma: allowlist secret
      /keys/,
    );
  });

  it("does not retry a challenge, and retries an absent save only once", () => {
    expect(
      reconcileSave({ kind: "challenge", status: 403, retries: 0 }).retry,
    ).toBe(false);
    expect(
      reconcileSave({ kind: "uncertain", readBack: "absent", retries: 0 })
        .action,
    ).toBe("retry-once");
    expect(
      reconcileSave({ kind: "uncertain", readBack: "absent", retries: 1 })
        .retry,
    ).toBe(false);
    expect(
      reconcileSave({ kind: "uncertain", readBack: "match", retries: 0 })
        .action,
    ).toBe("checkpoint");
    expect(
      reconcileSave({ kind: "committed", readBack: "conflict", retries: 0 })
        .action,
    ).toBe("fail");
    expect(
      resumeAllowed(
        { ...config, fixtureHash: "abc" },
        { ...config, fixtureHash: "def" },
      ),
    ).toBe(false);
    expect(
      resumeAllowed(
        { ...config, fixtureHash: "abc" },
        { ...config, fixtureHash: "abc" },
      ),
    ).toBe(true);
  });

  it("cleans only manifest members of the named test project", () => {
    const uid = identityFor(config.runId, 4).uid;
    expect(uid).toBe("sim-sim-20261111-001-u0004");
    expect(
      deletableIdentities(
        {
          projectId: config.firebaseProjectId,
          runId: config.runId,
          users: [
            { projectId: config.firebaseProjectId, runId: config.runId, uid },
          ],
        },
        config.firebaseProjectId,
        config.runId,
      ),
    ).toEqual([uid]);
    expect(() =>
      deletableIdentities(
        {
          projectId: "resume-changer-ayush-prod",
          runId: config.runId,
          users: [],
        },
        "resume-changer-ayush-prod",
        config.runId,
      ),
    ).toThrow(/production/);
    expect(() => assertProvisioningArmed(config.firebaseProjectId)).toThrow(
      /disabled/,
    );
  });
});

describe("hosted challenge detection", () => {
  it("stops on a Vercel challenge and ignores an application JSON denial", () => {
    const challenge = new Headers({
      "content-type": "text/html",
      "x-vercel-mitigated": "challenge",
    });
    expect(isHostingChallenge(403, challenge)).toBe(true);
    const application = new Headers({ "content-type": "application/json" });
    expect(isHostingChallenge(403, application)).toBe(false);
  });
});
