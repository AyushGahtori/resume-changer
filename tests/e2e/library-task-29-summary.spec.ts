import { expect, test } from "@playwright/test";

/**
 * Task 29 coverage for the library summary.
 *
 * The summary is the reader's first answer to "what is in this library?",
 * so every number on it has to be the real number, and the point count has
 * to follow the filters the same way the list does.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("shows the real counts of the loaded library", async ({ page }) => {
  const summary = page.getByRole("region", { name: "Library summary" });
  const counts = summary.locator(".library-counts");

  await expect(counts.locator("dt", { hasText: "Jobs" })).toBeVisible();
  await expect(counts.locator("dd").nth(0)).toHaveText("2");
  await expect(counts.locator("dd").nth(1)).toHaveText("2");
  await expect(counts.locator("dd").nth(2)).toHaveText("13");
  await expect(counts.locator("dd").nth(3)).toHaveText("14");
  await expect(counts.locator("dd").nth(4)).toHaveText("2");
});

test("names the identity and the source of the library", async ({ page }) => {
  const summary = page.getByRole("region", { name: "Library summary" });

  await expect(summary.getByText("Fictional demo data")).toBeVisible();
  await expect(
    summary.getByRole("heading", { name: "Jordan Example" }),
  ).toBeVisible();
  await expect(
    summary.getByText("Software Engineer | Cloud Platforms"),
  ).toBeVisible();
});

test("keeps the summary total while the count line follows the filters", async ({
  page,
}) => {
  const summary = page.getByRole("region", { name: "Library summary" });
  const pointCount = summary.locator(".library-counts dd").nth(2);
  await expect(pointCount).toHaveText("13");

  await page.getByLabel("Point source").selectOption("project-document");

  /*
   * The number in the summary is the size of the library, so it does not
   * move. The count line above the list is the one that follows the
   * filters, and it says how many of the total are on screen.
   */
  await expect(pointCount).toHaveText("13");
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "9 of 13 achievement points",
  );
});

test("shows the personal source label on the personal route", async ({
  page,
}) => {
  await page.goto("/library");

  const summary = page.getByRole("region", { name: "Library summary" });
  await expect(summary.getByText("My resume data")).toBeVisible();
  await expect(summary.getByText("Fictional demo data")).toHaveCount(0);
});
