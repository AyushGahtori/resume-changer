import type { Page } from "@playwright/test";
import { homeAnalysis } from "./home-analysis";

/**
 * Stores an analyzed job on the account the e2e server is using.
 * The builder reads this list, so a browser draft alone is not enough.
 * When the account is already at the saved-job cap, the oldest test record
 * is removed first so a later spec can still save the job it needs.
 */
export async function saveJobAnalysis(
  page: Page,
  input: {
    company: string;
    roleTitle?: string;
    jobUrl?: string;
    jobDescription: string;
  },
) {
  const listed = await page.request.get("/api/job-analyses");
  if (listed.ok()) {
    const body = (await listed.json()) as { jobs?: { id: string }[] };
    const jobs = body.jobs ?? [];
    if (jobs.length >= 40) {
      const oldest = jobs[jobs.length - 1];
      if (oldest) await page.request.delete(`/api/job-analyses/${oldest.id}`);
    }
  }

  const payload = {
    company: input.company,
    roleTitle: input.roleTitle ?? "",
    jobUrl: input.jobUrl ?? "",
    jobDescription: input.jobDescription,
    analysis: {
      ...homeAnalysis,
      targetTitle: input.roleTitle?.trim() || homeAnalysis.targetTitle,
    },
  };
  let response = await page.request.post("/api/job-analyses", {
    data: payload,
  });
  for (
    let attempt = 0;
    response.status() === 409 && attempt < 6;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    response = await page.request.post("/api/job-analyses", { data: payload });
  }
  if (!response.ok()) {
    throw new Error(
      `Saving the analyzed job failed (${response.status()}): ${await response.text()}`,
    );
  }
  return (await response.json()) as { job: { id: string } };
}
