import { getGithubServices } from "../lib/github/server/composition";

/** Entry consumed by the supervised host, using the same factory as Next. */
export async function createGithubImportWorkerRuntime() {
  const services = await getGithubServices();
  const recovered = await services.runner.recover();
  if (!recovered.ok) throw new Error(recovered.error.message);
  return { runner: services.runner };
}

/** Standalone Node entry. This file never imports the Next-only boundary. */
export async function startGithubImportWorker(): Promise<void> {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const services = await getGithubServices();
    const result = await services.worker.run({ signal: controller.signal });
    if (!result.ok) {
      process.stderr.write(`${result.error.message}\n`);
      process.exitCode = result.error.code === "unavailable" ? 1 : 2;
    }
  } catch {
    process.stderr.write("GitHub import worker could not start.\n");
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  void startGithubImportWorker();
}
