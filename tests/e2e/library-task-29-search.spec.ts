import { expect, test } from "@playwright/test";

/**
 * Task 29 coverage for the library search.
 *
 * The search is the one control that reaches everything in the library, so
 * each thing it can reach is checked on its own: the point text, the point
 * id, a linked skill, and the credential list, which the search reaches
 * without touching the point list.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("finds a point by its own id", async ({ page }) => {
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("achievement-ci-cd-pipeline");

  await expect(page.getByText("achievement-ci-cd-pipeline")).toBeVisible();
  await expect(
    page.getByText("achievement-cloud-deployment-platform"),
  ).toHaveCount(0);
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "1 of 13 achievement points",
  );
});

test("finds a point by the words in its text", async ({ page }) => {
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("capacity planning");

  await expect(
    page.getByText("achievement-service-capacity-design"),
  ).toBeVisible();
  await expect(page.getByText("achievement-ci-cd-pipeline")).toHaveCount(0);
});

test("finds the points and the skill that share a linked skill", async ({
  page,
}) => {
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("GitHub Actions");

  await expect(page.getByText("achievement-ci-cd-pipeline")).toBeVisible();
  await expect(
    page.getByText("achievement-fieldnotes-import-pipeline"),
  ).toBeVisible();
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "2 of 13 achievement points",
  );
  await expect(
    page
      .getByRole("region", { name: "Skills and credentials" })
      .locator(".skill-list")
      .getByText("GitHub Actions"),
  ).toBeVisible();
});

test("reports an empty result and an empty skill list together", async ({
  page,
}) => {
  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("no matching library content");

  await expect(page.getByRole("status")).toHaveText(
    "No achievement points match these filters.",
  );
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "0 of 13 achievement points",
  );
  await expect(page.getByText("No skills match this search.")).toBeVisible();
  await expect(
    page.getByText("No credentials match this search."),
  ).toBeVisible();
});

test("announces the result count in a live region", async ({ page }) => {
  const summary = page.locator(".library-filter-summary");
  await expect(summary).toHaveAttribute("aria-live", "polite");

  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("queueboard");

  await expect(summary.locator("span")).toHaveText(
    "3 of 13 achievement points",
  );
});

test("clears the search with the keyboard", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.fill("queueboard");
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "3 of 13 achievement points",
  );

  await search.focus();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");

  await expect(search).toHaveValue("");
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "13 of 13 achievement points",
  );
});
