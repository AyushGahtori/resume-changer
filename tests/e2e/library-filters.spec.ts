import { expect, test } from "@playwright/test";

/**
 * The library counts the achievement points that are actually visible and
 * offers a real sort. Both are read from the loaded library, so they describe
 * the current data and never hide or lose a record.
 */
const libraryRoute = "/library?source=demo";

async function groupLabels(page: import("@playwright/test").Page) {
  return page
    .locator(".experience-group")
    .evaluateAll((groups) =>
      groups.map((group) => group.getAttribute("aria-label")),
    );
}

test.beforeEach(async ({ page }) => {
  await page.goto(libraryRoute);
});

test("shows the matching point count apart from the summary metrics", async ({
  page,
}) => {
  const resultCount = page.locator(".library-result-count");

  await expect(resultCount).toHaveText("13 of 13 achievement points");

  // The total in the summary card stays the size of the whole library.
  await expect(page.locator(".library-counts dd").nth(2)).toHaveText("13");

  await page.getByLabel("Tag").selectOption("automation");
  await expect(resultCount).toHaveText("3 of 13 achievement points");
  await expect(page.locator(".library-counts dd").nth(2)).toHaveText("13");

  await page.getByLabel("Tag").selectOption("geospatial");
  await expect(resultCount).toHaveText("1 of 13 achievement points");
  await expect(page.locator(".library-point")).toHaveCount(1);
});

test("uses singular copy when a single point matches", async ({ page }) => {
  const resultCount = page.locator(".library-result-count");

  await page.getByLabel("Tag").selectOption("geospatial");
  await expect(resultCount).toHaveText("1 of 13 achievement points");

  await page.getByLabel("Tag").selectOption("");
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");
  await expect(resultCount).toHaveText("0 of 13 achievement points");
  await expect(page.getByRole("status")).toHaveText(
    "None of the 13 achievements in this library match the current search and filters.",
  );
});

test("reorders the groups for every sort option", async ({ page }) => {
  const sort = page.getByLabel("Sort");
  await expect(sort).toHaveValue("most-recent");

  // The most recent order puts the ongoing role first and the finished
  // roles in the order they ended.
  expect(await groupLabels(page)).toEqual([
    "Job: Platform Engineer",
    "Job: Software Engineer",
    "Project: QueueBoard",
    "Project: FieldNotes",
  ]);

  await sort.selectOption("oldest");
  expect(await groupLabels(page)).toEqual([
    "Job: Software Engineer",
    "Job: Platform Engineer",
    "Project: FieldNotes",
    "Project: QueueBoard",
  ]);

  await sort.selectOption("alphabetical");
  expect(await groupLabels(page)).toEqual([
    "Job: Platform Engineer",
    "Job: Software Engineer",
    "Project: FieldNotes",
    "Project: QueueBoard",
  ]);
});

test("sorts the points inside a group and keeps the count", async ({
  page,
}) => {
  await page.getByLabel("Sort").selectOption("alphabetical");

  const firstGroupPoints = page
    .locator(".experience-group")
    .first()
    .locator(".library-point-text");
  const texts = await firstGroupPoints.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent ?? ""),
  );
  expect(texts).toEqual(
    [...texts].sort((left, right) => left.localeCompare(right)),
  );

  await expect(page.locator(".library-result-count")).toHaveText(
    "13 of 13 achievement points",
  );
  await expect(page.locator(".library-point")).toHaveCount(13);
});

test("keeps the sort and the count while the filters change", async ({
  page,
}) => {
  await page.getByLabel("Sort").selectOption("oldest");
  await page.getByLabel("Tag").selectOption("automation");

  await expect(page.locator(".library-result-count")).toHaveText(
    "3 of 13 achievement points",
  );
  expect(await groupLabels(page)).toEqual([
    "Job: Software Engineer",
    "Job: Platform Engineer",
    "Project: FieldNotes",
  ]);

  await page.getByLabel("Sort").selectOption("most-recent");
  await expect(page.locator(".library-result-count")).toHaveText(
    "3 of 13 achievement points",
  );
  expect(await groupLabels(page)).toEqual([
    "Job: Platform Engineer",
    "Job: Software Engineer",
    "Project: FieldNotes",
  ]);
});

test("shows the reset action only while the filters are not default", async ({
  page,
}) => {
  const reset = page.getByRole("button", { name: "Reset filters" });
  await expect(reset).toHaveCount(0);

  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("automation");
  await expect(reset).toBeVisible();

  await page.getByLabel("Point status").selectOption("enabled");
  await expect(reset).toBeVisible();

  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(
    page.getByRole("searchbox", { name: "Search library" }),
  ).toHaveValue("");
  await expect(page.getByLabel("Point status")).toHaveValue("all");
  await expect(page.locator(".library-result-count")).toHaveText(
    "13 of 13 achievement points",
  );
});

test("keeps the data source and the theme when the filters are reset", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByLabel("Tag").selectOption("automation");
  await page.getByRole("button", { name: "Reset filters" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(/source=demo/);
  await expect(page.getByText("Fictional demo data")).toBeVisible();
});
