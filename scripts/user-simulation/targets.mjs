export const PRODUCTION_PROJECT_ID = "resume-changer-ayush-prod";

export function assertTestProject(projectId) {
  if (!projectId || projectId === PRODUCTION_PROJECT_ID) {
    throw Object.assign(
      new Error("Refusing the production Firebase project."),
      {
        code: "production-project",
      },
    );
  }
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) {
    throw Object.assign(new Error("The Firebase test project id is invalid."), {
      code: "simulation-config",
    });
  }
}

export function simulationUid(runId, userNumber) {
  return `sim-${runId}-u${String(userNumber).padStart(4, "0")}`;
}

export function deletableIdentities(manifest, projectId, runId) {
  assertTestProject(projectId);
  if (
    !manifest ||
    manifest.projectId !== projectId ||
    manifest.runId !== runId
  ) {
    throw Object.assign(
      new Error("Cleanup refused because the manifest does not match."),
      {
        code: "cleanup-mismatch",
      },
    );
  }
  const prefix = `sim-${runId}-u`;
  const users = Array.isArray(manifest.users) ? manifest.users : [];
  return users
    .filter(
      (user) =>
        user.projectId === projectId &&
        user.runId === runId &&
        typeof user.uid === "string" &&
        user.uid.startsWith(prefix),
    )
    .map((user) => user.uid);
}
