/** Content-free labels only: never include a URL, response, credential or exception. */
export function readerOperation(path: string) {
  if (/^\/repos\/[^/]+\/[^/]+\/commits\//.test(path)) return "commit-metadata";
  if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) return "repository-metadata";
  if (path.includes("/git/trees/")) return "repository-tree";
  if (path.includes("/git/blobs/")) return "repository-blob";
  return "other";
}

export function reportReaderFailure(input: {
  runId: string;
  operation: ReturnType<typeof readerOperation>;
  stage: string;
  timedOut?: boolean;
  elapsedMs?: number;
  upstreamStatus?: number;
  checkpointCalls?: number;
  checkpointMs?: number;
}) {
  if (process.env.VERCEL !== "1") return;
  console.warn("GitHub reader failure.", {
    runId: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.runId)
      ? input.runId
      : "invalid",
    operation: input.operation,
    stage: input.stage,
    timedOut: input.timedOut,
    elapsedMs: input.elapsedMs,
    upstreamStatus: input.upstreamStatus,
    checkpointCalls: input.checkpointCalls,
    checkpointMs: input.checkpointMs,
  });
}
