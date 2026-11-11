export function percentile(values, rank) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

export function windowHealth(
  samples,
  now,
  {
    minSamples = 20,
    windowMs = 60_000,
    maxErrorRate = 0.05,
    maxP95 = 5_000,
  } = {},
) {
  const recent = samples.filter((sample) => now - sample.at <= windowMs);
  if (recent.length < minSamples) {
    return { stop: false, sampleCount: recent.length };
  }
  const errorRate =
    recent.filter((sample) => sample.error).length / recent.length;
  const p95 = percentile(
    recent.map((sample) => sample.latencyMs),
    95,
  );
  return {
    stop: errorRate > maxErrorRate || p95 > maxP95,
    errorRate,
    p95,
    sampleCount: recent.length,
  };
}

export function summarizeRun(state) {
  const apiSamples = state.requests.filter(
    (sample) => sample.channel === "api",
  );
  const latencies = apiSamples.map((sample) => sample.latencyMs);
  const waits = apiSamples.map((sample) => sample.limiterWaitMs);
  const errors = apiSamples.filter((sample) => sample.error).length;
  const elapsedSeconds = Math.max(
    1,
    (state.finishedAt - state.startedAt) / 1000,
  );
  return {
    label: state.passed ? "passed" : "failed",
    correctness: state.correctness,
    performance: state.performance,
    exitReason: state.exitReason,
    attempted: state.attempted,
    completed: state.completed,
    failed: state.failed,
    interrupted: state.interrupted,
    notStarted: state.notStarted,
    apiUsers: state.apiUsers,
    browserUsers: state.browserUsers,
    maxActive: state.maxActive,
    maxBrowsers: state.maxBrowsers,
    applicationRequests: apiSamples.length,
    applicationErrorRate: apiSamples.length ? errors / apiSamples.length : 0,
    requestRatePerSecond: apiSamples.length / elapsedSeconds,
    latencyMs: {
      samples: latencies.length,
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    limiterWaitMs: {
      samples: waits.length,
      p50: percentile(waits, 50),
      p95: percentile(waits, 95),
    },
    browserTraffic: state.browserTraffic,
    logicalWrites: state.logicalWrites,
    estimatedUnits: state.estimatedUnits,
    providerRequests: state.providerRequests,
    externalRequests: state.externalRequests,
    generatorLimited: state.generatorLimited,
    eventLoopDelayMs: state.eventLoopDelayMs,
  };
}

export function renderReport(summary, limitations) {
  const latency = summary.latencyMs;
  return [
    "# Local load-test report",
    "",
    `Result: ${summary.label}. Correctness ${summary.correctness}. Performance ${summary.performance}.`,
    `Exit reason: ${summary.exitReason}.`,
    "",
    "## Users",
    "",
    `- Attempted: ${summary.attempted}`,
    `- Completed: ${summary.completed}`,
    `- Failed: ${summary.failed}`,
    `- Interrupted: ${summary.interrupted}`,
    `- Not started: ${summary.notStarted}`,
    `- API users: ${summary.apiUsers}`,
    `- Browser users: ${summary.browserUsers}`,
    `- Peak active sessions: ${summary.maxActive}`,
    `- Peak browser sessions: ${summary.maxBrowsers}`,
    "",
    "## Traffic",
    "",
    `- Application requests: ${summary.applicationRequests}`,
    `- Observed request rate: ${summary.requestRatePerSecond.toFixed(2)} per second`,
    `- Unexpected application error rate: ${(summary.applicationErrorRate * 100).toFixed(2)}%`,
    `- Network latency samples: ${latency.samples}; p50 ${latency.p50 ?? "n/a"} ms; p95 ${latency.p95 ?? "n/a"} ms; p99 ${latency.p99 ?? "n/a"} ms`,
    `- Limiter queue wait p50 ${summary.limiterWaitMs.p50 ?? "n/a"} ms; p95 ${summary.limiterWaitMs.p95 ?? "n/a"} ms`,
    `- Browser page, document, and static responses: ${summary.browserTraffic}`,
    `- Logical library writes: ${summary.logicalWrites}`,
    `- Estimated Enterprise units: ${summary.estimatedUnits ?? "not attached"}`,
    `- Provider requests: ${summary.providerRequests}`,
    `- External requests: ${summary.externalRequests}`,
    "",
    "## Limits",
    "",
    ...limitations.map((item) => `- ${item}`),
    "",
    "This local emulator run is not evidence that the hosted Vercel or Firebase deployment can serve the same concurrency.",
    "",
  ].join("\n");
}
