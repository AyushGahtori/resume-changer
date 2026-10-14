import { expect, test } from "@playwright/test";

const jobDescription = "Build reliable AWS platform services.";
const analysis = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment checks"],
  toolsAndPlatforms: ["AWS"],
  domainConcepts: ["Platform engineering"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};

const cloudAchievementId = "achievement-cloud-deployment-platform";
const serviceAchievementId = "achievement-service-capacity-design";
const skillId = "skill-infrastructure-as-code";

const selectionResponse = {
  mode: "ai",
  budget: { availableLines: 30, usedLines: 9 },
  recommendations: {
    selections: [
      {
        achievementId: cloudAchievementId,
        section: "experience",
        confidence: 0.94,
        rationale: "Direct evidence of AWS infrastructure provisioning.",
      },
      {
        achievementId: serviceAchievementId,
        section: "experience",
        confidence: 0.81,
        rationale: "Relevant platform capacity and deployment work.",
      },
    ],
    requirementCoverage: [
      {
        requirement: "AWS provisioning",
        coveredByAchievementIds: [cloudAchievementId],
      },
      {
        requirement: "Standardize deployment checks",
        coveredByAchievementIds: [cloudAchievementId],
      },
    ],
    skillRecommendations: [
      {
        skillId,
        rationale: "Supported by the selected cloud deployment achievement.",
        supportingAchievementIds: [cloudAchievementId],
      },
    ],
    confidence: 0.9,
    summary: "Selected evidence that supports the analyzed platform role.",
  },
};

test("analyzes a saved JD, retries point suggestions, and allows grounded overrides", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page.getByLabel("Job description").fill(jobDescription);
  await expect(page.locator(".draft-state")).toContainText("Saved locally");

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
  await expect(
    page.getByText(
      "This analysis could not be saved in this browser. Resume builder recommendations may require analyzing the job again.",
    ),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Resume builder" }).click();
  const demoDataLink = page.getByRole("link", {
    name: "Demo data",
    exact: true,
  });
  await Promise.all([
    page.waitForURL("**/generate?source=demo"),
    demoDataLink.click(),
  ]);
  await expect(demoDataLink).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".generation-draft")).toContainText(
    "Platform Engineer",
  );
  const suggestButton = page.getByRole("button", { name: "Suggest points" });
  await expect(suggestButton).toBeEnabled();

  let attempts = 0;
  let receivedRequest: unknown;
  await page.route("**/api/ai/select-achievements", async (route) => {
    attempts += 1;
    receivedRequest = route.request().postDataJSON();
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "AI service is temporarily unavailable.",
          code: "SERVICE_UNAVAILABLE",
          retryable: true,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(selectionResponse),
    });
  });

  await suggestButton.click();
  await expect(
    page.locator(".generation-selection [role=alert]"),
  ).toContainText("AI service is temporarily unavailable.");
  await expect(
    page.getByRole("button", { name: "Retry suggestions" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Retry suggestions" }).click();
  const recommendation = page.getByRole("region", {
    name: "AI recommendations",
  });
  await expect(recommendation).toContainText("Requirement coverage");
  await expect(recommendation).toContainText("AWS provisioning");
  await expect(
    page
      .locator(".generation-point")
      .filter({ hasText: "Standardized AWS environment provisioning" })
      .locator(".selection-point-reason"),
  ).toContainText("Direct evidence of AWS infrastructure");

  expect(receivedRequest).toMatchObject({
    dataSource: "demo",
    jobDescription,
    analysis,
  });
  await expect(
    page.getByLabel(`Select achievement ${cloudAchievementId}`),
  ).toBeChecked();
  await expect(
    page.getByLabel(`Select achievement ${serviceAchievementId}`),
  ).toBeChecked();

  const suggestedSkill = page.getByRole("checkbox", {
    name: /Infrastructure as Code/,
  });
  await expect(suggestedSkill).toBeChecked();
  await page.getByLabel(`Select achievement ${cloudAchievementId}`).uncheck();
  await expect(suggestedSkill).toBeDisabled();
  await expect(suggestedSkill).not.toBeChecked();
  expect(attempts).toBe(2);
});
