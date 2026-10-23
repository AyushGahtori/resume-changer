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
  requirementEvidence: [
    {
      requirement: "AWS provisioning",
      availableAchievementIds: [cloudAchievementId],
    },
    {
      requirement: "Standardize deployment checks",
      availableAchievementIds: [cloudAchievementId],
    },
  ],
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
        rationale: "Relevant to the analyzed job description.",
        supportingAchievementIds: [],
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
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill(jobDescription);
  await expect(page.locator(".draft-state")).toContainText(
    "Saved on this device",
  );

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
  await expect(recommendation).toContainText("2 / 2 supported");
  await expect(
    recommendation.getByRole("progressbar", {
      name: "Requirements covered by selected achievements",
    }),
  ).toHaveAttribute("value", "2");
  await recommendation.getByText("AWS provisioning").click();
  await expect(recommendation).toContainText("Example Cloud Labs");
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
  await expect(recommendation).toContainText("0 / 2 supported");
  await expect(recommendation).toContainText("Not selected");
  await expect(suggestedSkill).toBeEnabled();
  await expect(suggestedSkill).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(recommendation).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(attempts).toBe(2);
});

const selectionCount = ".generation-selection .generation-section-heading p";

test("finds evidence by search and by experience without losing the selection", async ({
  page,
}) => {
  await page.goto("/generate?source=demo");

  const search = page.getByRole("searchbox", { name: "Search achievements" });
  const experience = page.getByLabel("Filter by experience");
  await expect(search).toBeVisible();
  await expect(experience).toBeVisible();
  await expect(page.locator(".generation-point")).toHaveCount(13);
  await expect(page.locator(selectionCount)).toContainText("0 selected");
  await expect(page.locator(selectionCount)).toContainText("13 enabled");

  // An achievement is selected in a group the search will hide.
  await page.getByLabel("Select achievement achievement-orders-api").check();
  await expect(page.locator(selectionCount)).toContainText("1 selected");

  await search.fill("queueboard");
  await expect(page.locator(".generation-point")).toHaveCount(3);
  await expect(page.locator(".generation-filter-count")).toHaveText(
    "3 of 13 achievements match",
  );
  // The search hides the selected achievement, it does not deselect it.
  await expect(page.locator(selectionCount)).toContainText("1 selected");

  // The experience filter and the search combine.
  await experience.selectOption("job-example-cloud-labs");
  await expect(page.locator(".generation-point")).toHaveCount(0);
  await expect(page.locator(".generation-no-matches")).toBeVisible();
  await expect(page.locator(selectionCount)).toContainText("1 selected");

  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.locator(".generation-point")).toHaveCount(13);
  await expect(search).toHaveValue("");
  await expect(experience).toHaveValue("");
  await expect(page.locator(selectionCount)).toContainText("1 selected");
});

test("tells an empty search apart from an empty library", async ({ page }) => {
  await page.goto("/generate?source=demo");

  // The reset only appears while a search or a filter is active.
  await expect(page.getByRole("button", { name: "Reset filters" })).toHaveCount(
    0,
  );

  await page
    .getByRole("searchbox", { name: "Search achievements" })
    .fill("nothing matches this");
  await expect(page.locator(".generation-no-matches")).toHaveText(
    "No achievements match this search.",
  );
  // The library still holds evidence, so this is not the empty library.
  await expect(page.locator(".generation-empty")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reset filters" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(page.locator(".generation-point")).toHaveCount(13);
  await expect(page.locator(".generation-no-matches")).toHaveCount(0);
});

test("reaches the search and the experience filter with the keyboard", async ({
  page,
}) => {
  await page.goto("/generate?source=demo");

  const search = page.getByRole("searchbox", { name: "Search achievements" });
  await search.focus();
  await page.keyboard.type("worker");
  await expect(page.locator(".generation-point")).toHaveCount(1);
  await expect(page.locator(".generation-filter-count")).toHaveText(
    "1 of 13 achievements match",
  );

  // The field shows a visible focus ring.
  const focus = await page.evaluate(() => {
    const field = document.querySelector(".generation-search-field");
    const style = getComputedStyle(field!);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(focus.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThan(0);

  // The experience filter takes the keyboard too.
  await page.getByLabel("Filter by experience").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Filter by experience")).not.toHaveValue("");
});

test("keeps the search row inside a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/generate?source=demo");

  const search = page.getByRole("searchbox", { name: "Search achievements" });
  await search.fill(
    "a very long search that keeps going well past the width of the panel",
  );
  await expect(page.locator(".generation-point")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(search).toBeVisible();
});
