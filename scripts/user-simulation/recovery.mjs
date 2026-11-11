/** Decide what a single save did. Never replay a challenged or conflicting write. */

export function reconcileSave(observation) {
  const status = observation.status ?? 0;
  if (
    observation.kind === "challenge" ||
    status === 401 ||
    status === 403 ||
    status === 429 ||
    observation.deploymentChanged
  ) {
    return {
      action: "pause",
      retry: false,
      reason: observation.kind ?? `http-${status}`,
    };
  }
  if (observation.readBack === "conflict") {
    return { action: "fail", retry: false, reason: "conflict" };
  }
  if (observation.kind === "committed" || observation.readBack === "match") {
    return { action: "checkpoint", retry: false, reason: null };
  }
  if (observation.kind === "uncertain" && observation.readBack === "absent") {
    return {
      action: "retry-once",
      retry: observation.retries < 1,
      reason: "absent",
    };
  }
  if (observation.kind === "uncertain") {
    return { action: "pause", retry: false, reason: "unverifiable" };
  }
  return { action: "fail", retry: false, reason: "failed" };
}

export function resumeAllowed(saved, current) {
  if (!saved || !current) return false;
  return (
    saved.runId === current.runId &&
    saved.commit === current.commit &&
    saved.deploymentId === current.deploymentId &&
    saved.baseURL === current.baseURL &&
    saved.firebaseProjectId === current.firebaseProjectId &&
    saved.fixtureHash === current.fixtureHash &&
    saved.users === current.users &&
    saved.seed === current.seed
  );
}
