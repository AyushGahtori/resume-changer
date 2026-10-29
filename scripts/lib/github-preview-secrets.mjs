import { spawnSync } from "node:child_process";

/** Secret values are passed on stdin, never command arguments or diagnostic logs. */
export function publishGithubPreviewSecrets(
  values,
  cli,
  run = spawnSync,
  replace = false,
) {
  const request = Object.entries(values).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]+$/.test(key) || typeof value !== "string" || !value)
      throw new Error("Invalid Preview secret entry.");
    return {
      key,
      value,
      type: "sensitive",
      target: ["preview"],
      gitBranch: "phase-one",
      comment: "Private phase-one GitHub runtime configuration.",
    };
  });
  // The CLI's --input path currently requires a JSON object, even though the
  // service API also supports batches. Keep values on stdin in either case.
  for (const entry of request) {
    const result = run(
      process.execPath,
      [
        cli,
        "api",
        `/v10/projects/resume-changer/env${replace ? "?upsert=true" : ""}`,
        "--method",
        "POST",
        "--input",
        "-",
        "--scope",
        "ayushs-projects-ab23dbca",
      ],
      {
        input: JSON.stringify(entry),
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      const error = new Error("Vercel Preview secret publication failed.");
      error.key = entry.key;
      error.code = result.error?.code;
      error.status = result.status;
      error.diagnostic = safeCliDiagnostic(result, request);
      throw error;
    }
  }
  const checked = run(
    process.execPath,
    [
      cli,
      "api",
      "/v10/projects/resume-changer/env?gitBranch=phase-one",
      "--scope",
      "ayushs-projects-ab23dbca",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (checked.status !== 0) {
    const error = new Error("Vercel Preview secret verification failed.");
    error.code = checked.error?.code;
    error.status = checked.status;
    throw error;
  }
  const envs = JSON.parse(checked.stdout).envs;
  if (
    !Array.isArray(envs) ||
    !request.every((item) =>
      envs.some(
        (env) =>
          env.key === item.key &&
          env.gitBranch === "phase-one" &&
          env.target?.includes("preview") &&
          ["sensitive", "encrypted"].includes(env.type),
      ),
    )
  )
    throw new Error("Vercel Preview secret read-back did not match.");
}

function safeCliDiagnostic(result, entries) {
  let diagnostic = `${result.stderr ?? ""} ${result.stdout ?? ""}`;
  for (const entry of entries)
    diagnostic = diagnostic.replaceAll(entry.value, "[redacted]");
  diagnostic = diagnostic.replace(
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
    "[redacted PEM]",
  );
  diagnostic = diagnostic.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  diagnostic = diagnostic.replace(/\s+/g, " ").trim();
  return diagnostic.slice(0, 240);
}
