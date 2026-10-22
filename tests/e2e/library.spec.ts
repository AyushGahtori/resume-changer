import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("shows a grouped fictional library and its source details", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Jordan Example" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Platform Engineer" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "QueueBoard" })).toBeVisible();
  await expect(page.getByText("achievement-ci-cd-pipeline")).toBeVisible();
  await expect(page.locator(".point-provenance")).toHaveCount(13);
  await expect(page.getByText("Fictional demo data")).toBeVisible();
  await page.locator(".library-detail").nth(1).locator("summary").click();
  await expect(
    page.getByText("Cloud Deployment Foundations (Demo)"),
  ).toBeVisible();
});

test("searches and combines facets, then resets them", async ({ page }) => {
  await page
    .getByLabel("Job or project")
    .selectOption("job:job-example-cloud-labs");
  await page.getByLabel("Point source").selectOption("project-document");
  await page.getByLabel("Point status").selectOption("enabled");
  await page.getByLabel("Linked skill").selectOption("skill-github-actions");
  await page.getByLabel("Tag").selectOption("automation");

  await expect(page.getByText("achievement-ci-cd-pipeline")).toBeVisible();
  await expect(
    page.getByText("achievement-cloud-deployment-platform"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reset filters" }).click();
  await expect(
    page.getByText("achievement-cloud-deployment-platform"),
  ).toBeVisible();
  await expect(page.getByLabel("Job or project")).toHaveValue("");
});

test("shows an empty state and supports searching credentials", async ({
  page,
}) => {
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");
  await expect(page.getByRole("status")).toHaveText(
    "None of the 13 achievements in this library match the current search and filters.",
  );
  await expect(
    page.getByRole("heading", { name: "No achievements match these filters" }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("Cloud Deployment Foundations");
  await expect(
    page.getByText("Cloud Deployment Foundations (Demo)"),
  ).toBeVisible();
});

test("keeps the library usable on a narrow viewport without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Achievement library" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
  await expect(page.getByLabel("Search library")).toBeVisible();
  await expect(page.getByLabel("Tag")).toBeVisible();
});

test("offers explicit personal and demo source navigation", async ({
  page,
}) => {
  await expect(page.getByRole("link", { name: "My data" })).toHaveAttribute(
    "href",
    "/library",
  );
  await expect(page.getByRole("link", { name: "Demo data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
