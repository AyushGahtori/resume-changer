import { expect, test } from "@playwright/test";

const jobDescription =
  "Standardize AWS provisioning with Infrastructure as Code.";
const analysis = {
  targetTitle: "Cloud Platform Engineer",
  seniority: "Early career",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment workflows"],
  toolsAndPlatforms: ["AWS", "Terraform"],
  domainConcepts: ["Cloud infrastructure"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};

const achievementId = "achievement-cloud-deployment-platform";
const originalText =
  "Standardized AWS environment provisioning and deployment checks for three internal services.";
const proposedText =
  "Standardized AWS environment provisioning and deployment checks for three internal services using Infrastructure as Code.";

test("Guided Tailor requires approval and renders only the approved rewrite", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Cloud Platform Engineer");
  await page.getByLabel("Job description").fill(jobDescription);
  await expect(page.getByRole("status")).toContainText("Saved locally");

  await page.route("**/api/ai/analyze-job-description", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    });
  });
  await page.getByRole("button", { name: "Analyze job description" }).click();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Resume builder" }).click();
  await Promise.all([
    page.waitForURL("**/generate?source=demo"),
    page.getByRole("link", { name: "Demo data", exact: true }).click(),
  ]);
  await page.getByLabel(`Select achievement ${achievementId}`).check();

  let tailoringRequest: unknown;
  await page.route("**/api/ai/tailor-achievements", async (route) => {
    tailoringRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "The proposed wording aligns the point with the analyzed JD.",
        analyzedTerms: ["AWS provisioning", "Infrastructure as Code"],
        proposals: [
          {
            achievementId,
            originalText,
            proposedText,
            rationale:
              "The source confirms AWS provisioning and deployment checks.",
            addedTerms: ["Infrastructure as Code"],
          },
        ],
      }),
    });
  });

  await page.getByRole("button", { name: "Guided Tailor" }).click();
  const review = page.getByRole("region", { name: "Guided Tailor review" });
  await expect(review).toContainText(originalText);
  await expect(review).toContainText(proposedText);
  await expect(review).toContainText("Infrastructure as Code");
  const approval = review.getByRole("checkbox", {
    name: "Use tailored wording for this point",
  });
  await expect(approval).not.toBeChecked();
  expect(tailoringRequest).toMatchObject({
    dataSource: "demo",
    jobDescription,
    analysis,
    achievementIds: [achievementId],
  });

  await review.getByRole("button", { name: "Approve all unchanged" }).click();
  await expect(approval).toBeChecked();
  await review.getByRole("button", { name: "Revoke all" }).click();
  await expect(approval).not.toBeChecked();

  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  const preview = page.getByLabel("Generated LaTeX");
  await expect(preview).toContainText(originalText);
  await expect(preview).not.toContainText("using Infrastructure as Code");

  await approval.check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(preview).toContainText(proposedText);
  await expect(preview).not.toContainText(originalText);

  const editedText =
    "Standardized AWS environment provisioning and deployment checks for three internal services with Terraform modules.";
  await review
    .getByLabel(`Tailored wording for ${achievementId}`)
    .fill(editedText);
  await expect(approval).not.toBeChecked();
  await expect(
    review.getByRole("button", { name: "Approve all unchanged" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Generated LaTeX")).toHaveCount(0);
  await approval.check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(editedText);
});
