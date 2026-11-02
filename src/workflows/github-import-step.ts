export async function executeHostedImportJob(jobId: string) {
  "use step";
  console.info("GitHub import worker step started.");
  const { getHostedGithubRuntime } =
    await import("../lib/github/server/hosted/runtime");
  return (await getHostedGithubRuntime()).runJob(jobId);
}
