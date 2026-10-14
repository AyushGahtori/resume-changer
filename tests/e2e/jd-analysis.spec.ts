import { expect, test } from "@playwright/test";

const analysis = {
  targetTitle: "Software Engineer, ML Platform",
  seniority: "New graduate",
  requiredQualifications: ["Expected 2025 or 2026 graduate"],
  preferredQualifications: ["Familiarity with Python, Go, or C++"],
  responsibilities: ["Optimize GPU model serving"],
  toolsAndPlatforms: ["Python", "Go", "C++"],
  domainConcepts: ["Distributed systems"],
  atsTerms: ["GPU serving", "feature store"],
  inferredContext: ["The role likely supports production ML workloads."],
  terminology: [{ term: "machine learning", alternatives: ["ML"] }],
};

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("No saved draft");
});

test("shows structured JD analysis with evidence distinctions and terminology", async ({
  page,
}) => {
  await page.getByLabel("Role title").fill("ML Platform Engineer");
  await page
    .getByLabel("Job description")
    .fill("Build and optimize machine learning infrastructure.");
  await page.route("**/api/ai/analyze-job-description", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    });
  });

  await page.getByRole("button", { name: "Analyze job description" }).click();

  const panel = page.getByRole("region", { name: "Job description analysis" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Software Engineer, ML Platform");
  await expect(panel).toContainText("Explicit requirements");
  await expect(panel).toContainText("Expected 2025 or 2026 graduate");
  await expect(panel).toContainText("Preferred qualifications");
  await expect(panel).toContainText("Inferred context, not requirements");
  await expect(panel).toContainText("production ML workloads");
  await expect(panel).toContainText("machine learning: ML");
});

test("shows a retry action after transient analysis failure and keeps the draft", async ({
  page,
}) => {
  await page.getByLabel("Job description").fill("Build reliable services.");
  let attempts = 0;
  await page.route("**/api/ai/analyze-job-description", async (route) => {
    attempts += 1;
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
      body: JSON.stringify({ analysis }),
    });
  });

  await page.getByRole("button", { name: "Analyze job description" }).click();
  await expect(
    page.getByText("AI service is temporarily unavailable."),
  ).toBeVisible();
  await expect(page.getByLabel("Job description")).toHaveValue(
    "Build reliable services.",
  );

  await page.getByRole("button", { name: "Retry analysis" }).click();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();
  expect(attempts).toBe(2);
});
