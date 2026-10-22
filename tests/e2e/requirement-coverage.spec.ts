import { expect, test, type Page } from "@playwright/test";

const jobDescription = "Build reliable AWS platform services.";

const baseAnalysis = {
  targetTitle: "Platform Engineer",
  seniority: "Entry level",
  requiredQualifications: ["AWS provisioning", "Kubernetes orchestration"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment checks"],
  toolsAndPlatforms: ["AWS"],
  domainConcepts: ["Platform engineering"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};

const emptyAnalysis = {
  ...baseAnalysis,
  requiredQualifications: [],
  responsibilities: [],
};

const selectionResponse = {
  mode: "ai",
  budget: { availableLines: 30, usedLines: 9 },
  requirementEvidence: [
    {
      requirement: "AWS provisioning",
      availableAchievementIds: ["achievement-cloud-deployment-platform"],
    },
    {
      requirement: "Standardize deployment checks",
      availableAchievementIds: ["achievement-cloud-deployment-platform"],
    },
  ],
  recommendations: {
    selections: [
      {
        achievementId: "achievement-cloud-deployment-platform",
        section: "experience",
        confidence: 0.94,
        rationale: "Direct evidence of AWS infrastructure provisioning.",
      },
    ],
    requirementCoverage: [
      {
        requirement: "AWS provisioning",
        coveredByAchievementIds: ["achievement-cloud-deployment-platform"],
      },
      {
        requirement: "Standardize deployment checks",
        coveredByAchievementIds: ["achievement-cloud-deployment-platform"],
      },
    ],
    skillRecommendations: [],
    confidence: 0.9,
    summary: "Selected evidence that supports the analyzed platform role.",
  },
};

async function saveJobDraft(page: Page, description = jobDescription) {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill(description);
  await expect(page.locator(".draft-state")).toContainText(
    "Saved on this device",
  );
}

async function analyzeJob(page: Page, analysis: unknown) {
  await page.route("**/api/ai/analyze-job-description", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    }),
  );
  await page.getByRole("button", { name: "Analyze job description" }).click();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();
}

async function openBuilder(page: Page) {
  await page.getByRole("link", { name: "Resume builder" }).click();
  const demoDataLink = page.getByRole("link", {
    name: "Demo data",
    exact: true,
  });
  await Promise.all([
    page.waitForURL("**/generate?source=demo"),
    demoDataLink.click(),
  ]);
}

test("reports the coverage of the current job analysis and its source", async ({
  page,
}) => {
  await saveJobDraft(page);
  await analyzeJob(page, baseAnalysis);
  await openBuilder(page);

  const analysis = page.getByRole("region", { name: "Job analysis" });
  await expect(analysis).toContainText("Analyzed");
  await expect(analysis).toContainText(
    "Compared against the saved job description for Platform Engineer, Entry level, Example Cloud.",
  );
  await expect(analysis).toContainText(
    "3 requirements extracted from this job description.",
  );

  await page.route("**/api/ai/select-achievements", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(selectionResponse),
    }),
  );
  await page.getByRole("button", { name: "Suggest points" }).click();

  const coverage = page.getByRole("region", { name: "AI recommendations" });
  // Two of the three analyzed requirements are supported by the evidence.
  await expect(coverage).toContainText("2 / 3 supported");
  await expect(coverage).toContainText(
    "3 job requirements analyzed from this job description.",
  );
  await expect(coverage).toContainText("1 no match");
  await expect(coverage).toContainText("No match found");
  await expect(
    coverage.getByRole("progressbar", {
      name: "Requirements covered by selected achievements",
    }),
  ).toHaveAttribute("value", "2");
});

test("reports an empty job analysis without claiming coverage", async ({
  page,
}) => {
  await saveJobDraft(page);
  await analyzeJob(page, emptyAnalysis);
  await openBuilder(page);

  const analysis = page.getByRole("region", { name: "Job analysis" });
  await expect(analysis).toContainText("No requirements");
  await expect(analysis).toContainText(
    "The job analysis did not extract any requirements or responsibilities from this job description.",
  );
  await expect(
    page.getByRole("region", { name: "AI recommendations" }),
  ).toHaveCount(0);
});

test("reports a stale job analysis instead of an outdated one", async ({
  page,
}) => {
  await saveJobDraft(page);
  await analyzeJob(page, baseAnalysis);
  // The job description changes after the analysis, so the saved analysis no
  // longer describes the current draft.
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable Kubernetes platform services.");
  await expect(page.locator(".draft-state")).toContainText(
    "Saved on this device",
  );
  await openBuilder(page);

  const analysis = page.getByRole("region", { name: "Job analysis" });
  await expect(analysis).toContainText("Not analyzed");
  await expect(analysis).toContainText(
    "No job analysis is available for this job description yet.",
  );
  await expect(analysis.getByRole("link")).toHaveText(
    "Analyze this job description",
  );
});

test("reports a failed request without claiming coverage", async ({ page }) => {
  await saveJobDraft(page);
  await analyzeJob(page, baseAnalysis);
  await openBuilder(page);

  await page.route("**/api/ai/select-achievements", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "AI service is temporarily unavailable.",
        code: "SERVICE_UNAVAILABLE",
        retryable: true,
      }),
    }),
  );
  await page.getByRole("button", { name: "Suggest points" }).click();

  const analysis = page.getByRole("region", { name: "Job analysis" });
  await expect(analysis).toContainText("Unavailable");
  await expect(analysis).toContainText(
    "The last request for this job description failed, so requirement coverage is unavailable.",
  );
  await expect(
    page.getByRole("region", { name: "AI recommendations" }),
  ).toHaveCount(0);
});
