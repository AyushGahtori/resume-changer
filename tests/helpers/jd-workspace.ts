import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The sidebar navigation link and the job description field share the
 * accessible name "Job description". A role-scoped lookup keeps the field
 * unambiguous, and the helper is the single place that knows this.
 */
export function jobDescriptionField(page: Page): Locator {
  return page.getByRole("textbox", { name: "Job description", exact: true });
}

export type JobDraft = {
  company: string;
  roleTitle: string;
  jobDescription: string;
  jobUrl?: string;
};

/**
 * Fills the job description workspace and waits until the draft is stored in
 * this browser, so later pages can rely on the saved draft.
 */
export async function fillJobDraft(page: Page, draft: JobDraft) {
  await page.goto("/");
  await page.getByLabel("Company").fill(draft.company);
  await page.getByLabel("Role title").fill(draft.roleTitle);
  if (draft.jobUrl) await page.getByLabel("Job link").fill(draft.jobUrl);
  await jobDescriptionField(page).fill(draft.jobDescription);
  await expect(page.getByRole("status")).toContainText("Saved on this device");
}
