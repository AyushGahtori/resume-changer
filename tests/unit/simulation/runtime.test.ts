import { afterEach, describe, expect, it } from "vitest";
import {
  acceptIdentityClaims,
  isHostedSimulation,
  isLocalSimulation,
  simulationForbidden,
  simulationUid,
} from "@/lib/simulation/runtime";

const runId = "sim-20261111-001";
const runnerKey = "0123456789abcdef0123456789abcdef";

function hosted(overrides: Record<string, string | undefined> = {}) {
  return {
    RESUME_SIMULATION_MODE: "1",
    RESUME_APP_MODE: "firebase",
    AI_PROVIDER: "mock",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    RESUME_SIMULATION_RUN_ID: runId,
    RESUME_SIMULATION_RUNNER_KEY: runnerKey,
    RESUME_SIMULATION_ORIGIN: "https://resume-changer-abc123.vercel.app",
    RESUME_SIMULATION_FIREBASE_PROJECT_ID: "resume-changer-simulation-test",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "resume-changer-simulation-test",
    NEXT_PUBLIC_FIREBASE_DATABASE_ID: "(default)",
    ...overrides,
  };
}

const now = 1_700_000_000;

function claims(overrides: Record<string, unknown> = {}) {
  return {
    aud: "resume-changer-simulation-test",
    iss: "https://securetoken.google.com/resume-changer-simulation-test",
    sub: simulationUid(runId, 1),
    exp: now + 60,
    auth_time: now,
    email: "user-1@example.test",
    email_verified: false,
    simulation: true,
    simulationRunId: runId,
    firebase: { sign_in_provider: "custom" },
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.RESUME_SIMULATION_MODE;
});

describe("hosted simulation guard", () => {
  it("accepts a matching preview and rejects production, emulators, and demo projects", () => {
    expect(isHostedSimulation(hosted())).toBe(true);
    expect(
      isHostedSimulation(
        hosted({
          RESUME_SIMULATION_FIREBASE_PROJECT_ID: "resume-changer-ayush-prod",
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: "resume-changer-ayush-prod",
        }),
      ),
    ).toBe(false);
    expect(isHostedSimulation(hosted({ VERCEL_ENV: "production" }))).toBe(
      false,
    );
    expect(
      isHostedSimulation(
        hosted({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098" }),
      ),
    ).toBe(false);
    expect(
      isHostedSimulation(
        hosted({
          RESUME_SIMULATION_FIREBASE_PROJECT_ID:
            "demo-resume-changer-simulation",
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-resume-changer-simulation",
        }),
      ),
    ).toBe(false);
    expect(isLocalSimulation(hosted())).toBe(false);
  });

  it("accepts a custom simulation identity only while the runtime is valid", () => {
    expect(
      acceptIdentityClaims(
        claims(),
        "resume-changer-simulation-test",
        now,
        hosted(),
      ),
    ).toBe("simulation");
    expect(() =>
      acceptIdentityClaims(claims(), "resume-changer-simulation-test", now, {}),
    ).toThrow(/Sign in/);
    expect(() =>
      acceptIdentityClaims(
        claims({ simulationRunId: "sim-other" }),
        "resume-changer-simulation-test",
        now,
        hosted(),
      ),
    ).toThrow(/Sign in/);
    expect(
      acceptIdentityClaims(
        claims({
          sub: "alice",
          email_verified: true,
          firebase: { sign_in_provider: "google.com" },
          simulation: undefined,
        }),
        "resume-changer-simulation-test",
        now,
        hosted(),
      ),
    ).toBe("google");
  });

  it("blocks AI routes whenever simulation mode is set and limits a valid runtime", () => {
    expect(
      simulationForbidden("/api/ai/select-achievements", "POST", {
        RESUME_SIMULATION_MODE: "1",
      }),
    ).toBe(true);
    expect(simulationForbidden("/api/library/profile", "PATCH", hosted())).toBe(
      false,
    );
    expect(simulationForbidden("/api/compile", "POST", hosted())).toBe(true);
    expect(simulationForbidden("/api/generate", "POST", hosted())).toBe(true);
    expect(simulationForbidden("/api/history/item/pdf", "GET", hosted())).toBe(
      true,
    );
    expect(simulationForbidden("/api/simulation/config", "GET", hosted())).toBe(
      false,
    );
  });
});
