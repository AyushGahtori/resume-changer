import { expect, test } from "@playwright/test";
import { chooseLibraryOption } from "./support/library-select";

/**
 * Task 29 coverage for the library filters.
 *
 * Each facet is checked on its own, and the two ways of reaching a facet
 * are checked against each other: choosing from the select, and clicking
 * the tag or skill chip on a point. Both have to leave the same filter
 * state behind.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("narrows the list to one job", async ({ page }) => {
  await chooseLibraryOption(
    page,
    "Job or project",
    "job:job-sampleworks-studio",
  );

  await expect(
    page.getByRole("heading", { name: "Software Engineer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Platform Engineer" }),
  ).toHaveCount(0);
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "3 of 13 achievement points",
  );
});

test("narrows the list to one point source", async ({ page }) => {
  await chooseLibraryOption(page, "Point source", "user-notes");

  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "4 of 13 achievement points",
  );
  await expect(
    page.getByText("achievement-service-capacity-design"),
  ).toHaveCount(0);
  await expect(
    page.getByText("achievement-service-observability"),
  ).toBeVisible();
});

test("narrows the list to one linked skill", async ({ page }) => {
  await chooseLibraryOption(page, "Linked skill", "skill-docker");

  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "1 of 13 achievement points",
  );
  await expect(
    page.getByText("achievement-queueboard-deployment"),
  ).toBeVisible();
});

test("narrows the list to one tag", async ({ page }) => {
  await chooseLibraryOption(page, "Tag", "accessibility");

  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "2 of 13 achievement points",
  );
  await expect(page.getByText("achievement-accessible-admin-ui")).toBeVisible();
  await expect(
    page.getByText("achievement-fieldnotes-map-interface"),
  ).toBeVisible();
});

test("applies the tag facet when a tag chip is clicked", async ({ page }) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-ci-cd-pipeline" });

  await point.getByRole("button", { name: "#automation" }).click();

  await expect(page.getByRole("combobox", { name: "Tag" })).toHaveAttribute(
    "data-value",
    "automation",
  );
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "3 of 13 achievement points",
  );
  await expect(page.getByText("achievement-ci-cd-pipeline")).toBeVisible();
});

test("applies the skill facet when a skill chip is clicked", async ({
  page,
}) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-ci-cd-pipeline" });

  await point.getByRole("button", { name: "GitHub Actions" }).click();

  await expect(
    page.getByRole("combobox", { name: "Linked skill" }),
  ).toHaveAttribute("data-value", "skill-github-actions");
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "2 of 13 achievement points",
  );
});

test("offers the reset action only while a filter is active", async ({
  page,
}) => {
  const reset = page.getByRole("button", { name: "Reset filters" });
  await expect(reset).toHaveCount(0);

  await chooseLibraryOption(page, "Tag", "accessibility");
  await expect(reset).toBeVisible();

  await reset.click();

  await expect(reset).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Tag" })).toHaveAttribute(
    "data-value",
    "",
  );
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "13 of 13 achievement points",
  );
});

test("keeps the facets reachable from the keyboard", async ({ page }) => {
  const tag = page.getByRole("combobox", { name: "Tag" });
  await tag.focus();
  await expect(tag).toBeFocused();
  expect(
    await tag.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(tag).toHaveAttribute("data-value", "accessibility");
  await expect(page.locator(".library-filter-summary span")).toHaveText(
    "2 of 13 achievement points",
  );
});
