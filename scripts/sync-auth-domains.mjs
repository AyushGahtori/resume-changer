import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { syncAuthDomains } from "./lib/auth-domains.mjs";

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const project = argument("--project");
if (!project)
  throw new Error(
    "Pass the intended Firebase project explicitly with --project.",
  );
const config = JSON.parse(readFileSync("firebase.json", "utf8"));
const configuredProject = JSON.parse(readFileSync(".firebaserc", "utf8"))
  .projects.default;
let packageFile;
for (const base of [
  process.cwd(),
  ...process.env.PATH.split(path.delimiter).map((entry) =>
    path.resolve(entry, "../.."),
  ),
]) {
  try {
    const candidate = createRequire(path.join(base, "package.json")).resolve(
      "firebase-tools/package.json",
    );
    if (JSON.parse(readFileSync(candidate, "utf8")).version === "15.34.1") {
      packageFile = candidate;
      break;
    }
  } catch {
    /* npm exec supplies the pinned CLI on PATH. */
  }
}
if (!packageFile)
  throw new Error(
    "Run with npm exec --package=firebase-tools@15.34.1 -- node scripts/sync-auth-domains.mjs --project <project> [--apply].",
  );
const cli = createRequire(packageFile);
const { Command } = cli("./lib/command");
const { requireAuth } = cli("./lib/requireAuth");
const api = cli("./lib/gcp/auth");
try {
  await new Command("auth:verify-domains")
    .before(requireAuth)
    .action(async (options) => {
      if (options.projectId !== project)
        throw new Error("The CLI resolved an unexpected project.");
      const result = await syncAuthDomains(
        {
          project,
          configuredProject,
          domains: config.auth.authorizedDomains,
          apply: process.argv.includes("--apply"),
        },
        api,
      );
      console.log(JSON.stringify(result));
    })
    .runner()({ project, nonInteractive: true });
} catch (error) {
  // Do not print CLI request objects or credentials on administrative failures.
  console.error(
    error instanceof Error && !("context" in error)
      ? error.message
      : "Firebase domain verification failed. Check your CLI login and project.",
  );
  process.exitCode = 1;
}
