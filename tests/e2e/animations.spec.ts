import { expect, test } from "@playwright/test";
import { waitForAnimationsToSettle } from "../helpers/animations";
import { jobDescriptionField } from "../helpers/jd-workspace";

test("settles while an animation that never finishes is on screen", async ({
  page,
}) => {
  await page.goto("/");

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ai/analyze-job-description", async (route) => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis: {} }),
    });
  });

  await jobDescriptionField(page).fill("Build reliable services.");
  await page.getByRole("button", { name: "Analyze job description" }).click();

  // The button shows a spinner while the analysis runs. The spinner rotates
  // forever, so waiting for it to finish would wait forever.
  await expect(
    page
      .getByRole("form", { name: "Role details" })
      .getByRole("button", { name: "Analyzing..." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("form", { name: "Role details" })
      .getByRole("button", { name: "Analyzing..." })
      .locator(".home-action-spinner"),
  ).toBeVisible();

  await waitForAnimationsToSettle(page.locator(".app-frame"));

  release();
});

test("settles while a transition is replaced by a newer one", async ({
  page,
}) => {
  await page.goto("/");

  // Each viewport change restarts the sidebar transition. A transition that
  // is replaced is cancelled, and its `finished` promise rejects with an
  // `AbortError` instead of resolving.
  for (const width of [1440, 1152, 1024, 768, 720, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await waitForAnimationsToSettle(page.locator(".app-frame"));
  }

  const sidebarWidth = await page
    .locator("#workspace-sidebar")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(sidebarWidth).toBeGreaterThan(0);
});
