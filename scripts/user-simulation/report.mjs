export function renderReport(summary) {
  const lines = [
    "# Paced user simulation",
    "",
    `Result: ${summary.status}.`,
    `Run: ${summary.runId ?? "unset"}.`,
    `Deployment: ${summary.deploymentId ?? "unset"} @ ${summary.commit ?? "unset"}.`,
    `Origin: ${summary.baseURL ?? "unset"}.`,
    `Firebase project: ${summary.firebaseProjectId ?? "unset"}.`,
    "",
    `- Last stage: ${summary.stage ?? "not started"}`,
    `- Peak active sessions: ${summary.peakActiveSessions ?? 0}`,
    `- API start cap: ${summary.apiPerSec ?? 0}/sec`,
    `- HTTP start cap: ${summary.httpPerSec ?? 0}/sec`,
    `- Completed users: ${summary.completed ?? 0}`,
    `- Failed users: ${summary.failed ?? 0}`,
    `- Paused users: ${summary.paused ?? 0}`,
    `- Not started: ${summary.notStarted ?? summary.users ?? 0}`,
    `- Reason: ${summary.reason ?? "none"}`,
    "",
    "The runner manifest is the authority for distinct test accounts. Vercel request totals are not user counts, and Web Analytics is not expected to show 1,000 visitors.",
    "",
    "This report does not claim the hosted free deployment served 100 concurrent sessions unless the stage was actually reached.",
  ];
  return `${lines.join("\n")}\n`;
}
