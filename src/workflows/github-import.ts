import { sleep } from "workflow";
import { executeHostedImportJob } from "./github-import-step";

export async function githubImportWorkflow(jobId: string) {
  "use workflow";
  for (let attempt = 0; attempt < 24; attempt++) {
    if (await executeHostedImportJob(jobId)) return;
    await sleep("5s");
  }
}
