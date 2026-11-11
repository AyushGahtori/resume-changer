import { assertTestProject, simulationUid } from "./targets.mjs";

export function identityFor(runId, userNumber) {
  return {
    uid: simulationUid(runId, userNumber),
    email: `user-${userNumber}@example.test`,
    claims: { simulation: true, simulationRunId: runId },
  };
}

/**
 * Provisioning uses Firebase Admin on the operator machine only.
 * It stays disabled unless the operator arms it for the explicit test project.
 */
export function assertProvisioningArmed(projectId) {
  assertTestProject(projectId);
  if (process.env.SIMULATION_ADMIN_EXECUTE !== "1") {
    throw Object.assign(
      new Error(
        "Admin provisioning stays disabled until SIMULATION_ADMIN_EXECUTE=1 is set for the test project.",
      ),
      { code: "admin-not-armed" },
    );
  }
}
