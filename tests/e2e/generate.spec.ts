import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByLabel("Job description")
    .fill("Build reliable platform services and improve deployment workflows.");
  await expect(page.getByRole("status")).toContainText("Saved locally");
  await page.goto("/generate?source=demo");
});

test("selects points, generates LaTeX, copies and downloads the output", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const point = page.getByLabel(
    "Select achievement achievement-service-capacity-design",
  );
  await point.check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();

  const preview = page.getByLabel("Generated LaTeX");
  await expect(preview).toContainText("Jordan Example");
  await expect(preview).toContainText("Redesigned service boundaries");
  await expect(page.locator(".generation-metadata")).toContainText(
    "1 achievement",
  );
  await expect(point).toBeChecked();

  await page.getByRole("button", { name: "Copy LaTeX" }).click();
  await expect(page.getByText("LaTeX copied.", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("\\ResumeHeader{Jordan Example}");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download LaTeX file" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "example-systems-platform-engineer.tex",
  );
});

test("returns structured validation and renderer errors from the API", async ({
  request,
}) => {
  const base = {
    dataSource: "demo",
    company: "Example Systems",
    roleTitle: "Platform Engineer",
    jobUrl: "",
    jobDescription: "Build reliable platform services.",
    selectedAchievementIds: ["achievement-service-capacity-design"],
  };

  const invalidRequest = await request.post("/api/generate", {
    data: { ...base, selectedAchievementIds: [] },
  });
  expect(invalidRequest.status()).toBe(400);
  await expect(invalidRequest.json()).resolves.toMatchObject({
    error: "Check the job details and selected achievements.",
    issues: expect.arrayContaining([
      expect.objectContaining({ path: "selectedAchievementIds" }),
    ]),
  });

  const invalidSelection = await request.post("/api/generate", {
    data: { ...base, selectedAchievementIds: ["achievement-unknown"] },
  });
  expect(invalidSelection.status()).toBe(400);
  await expect(invalidSelection.json()).resolves.toMatchObject({
    error: expect.stringContaining("Unknown achievement ID"),
  });
});

test("keeps the generation layout within the viewport width on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
  await expect(
    page.getByRole("heading", { name: "Build your resume." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate LaTeX" }),
  ).toBeVisible();
});
