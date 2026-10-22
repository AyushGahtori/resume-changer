import { expect, test } from "@playwright/test";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.beforeEach(async ({ page }) => {
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    join(
      process.env.RESUME_LIBRARY_ROOT ??
        join(tmpdir(), "resume-changer-playwright-data-3010"),
      "data",
      "resume-library.json",
    ),
  );
  await page.goto("/library");
});

test("achievement library remains scrollable on a full desktop viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.reload();

  const beforeScroll = await page.evaluate(() => ({
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  expect(beforeScroll.pageHeight).toBeGreaterThan(beforeScroll.viewportHeight);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await expect(page.locator(".library-secondary")).toBeInViewport();
});

test("creates a point with a metric and persists it after reload", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.getByRole("button", { name: "Detailed entry" }).click();
  await page.getByLabel("Achievement ID").fill("achievement-e2e-created");
  await page
    .getByLabel("Achievement text")
    .fill("Created in the synthetic browser test.");
  await page
    .getByLabel("Tags, separated by commas")
    .fill("testing, reliability");
  await page.getByLabel("Linked skills").selectOption("skill-automation");
  await page.getByRole("button", { name: "Add metric" }).click();
  await page
    .locator(".metric-fields")
    .getByLabel("Label")
    .fill("Test coverage");
  await page.locator(".metric-fields").getByLabel("Value").fill("100");
  await page
    .locator(".metric-fields")
    .getByLabel("Evidence")
    .fill("Synthetic test evidence.");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/library/points") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save achievement" }).click();
  expect((await saved).ok()).toBe(true);

  await expect(page.getByText("achievement-e2e-created")).toBeVisible();
  await expect(page.getByText("Saved to your local library.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Created in the synthetic browser test."),
  ).toBeVisible();
  await expect(page.getByText("Test coverage")).toBeVisible();
});

test("saves a manual point through the shared Imagination Canvas", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page
    .getByRole("button", { name: "Add achievement", exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("A user-verified achievement created in the shared canvas.");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/library/points") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save achievement", exact: true })
    .click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("Saved to your local library.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(
      "A user-verified achievement created in the shared canvas.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("updates text, tags, provenance, and enabled state", async ({ page }) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-ci-cd-pipeline" });
  await point.getByRole("button", { name: "Edit" }).click();
  await page
    .getByLabel("Achievement text")
    .fill("Updated synthetic workflow achievement.");
  await page
    .getByLabel("Tags, separated by commas")
    .fill("release, verification");
  await page.getByLabel("Provenance type").selectOption("direct-user");
  await page.getByLabel("Source label").fill("Browser test update");
  await page.getByLabel("Use this point in resume selection").uncheck();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/library/points/"),
  );
  await page.getByRole("button", { name: "Save achievement" }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("Saved to your local library.")).toBeVisible();

  await expect(
    page.getByText("Updated synthetic workflow achievement."),
  ).toBeVisible();
  await expect(page.getByText("Browser test update")).toBeVisible();
  await expect(
    page
      .locator(".library-point")
      .filter({ hasText: "achievement-ci-cd-pipeline" })
      .locator(".point-status"),
  ).toHaveText("Disabled");
  await page.reload();
  await expect(
    page.getByText("Updated synthetic workflow achievement."),
  ).toBeVisible();
});

test("cancel discards the unsaved editor changes", async ({ page }) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });
  const original = await point.locator(".library-point-text").innerText();
  await point.getByRole("button", { name: "Edit" }).click();
  await page
    .getByLabel("Achievement text")
    .fill("This edit must be discarded.");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();

  await expect(page.getByText(original, { exact: true })).toBeVisible();
  await expect(page.getByText("This edit must be discarded.")).toHaveCount(0);
});

test("rejects a duplicate point ID without altering existing data", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Detailed entry" }).click();
  await page.getByLabel("Achievement ID").fill("achievement-ci-cd-pipeline");
  await page
    .getByLabel("Achievement text")
    .fill("Duplicate synthetic ID should be rejected.");
  await page.getByRole("button", { name: "Save achievement" }).click();

  await expect(page.locator(".editor-error")).toContainText(
    "conflicts with the library data",
  );
  await expect(
    page
      .locator(".library-point")
      .filter({ hasText: "achievement-ci-cd-pipeline" }),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page
      .locator(".library-point")
      .filter({ hasText: "achievement-ci-cd-pipeline" }),
  ).toHaveCount(1);
});

test("keeps demo data read-only", async ({ page }) => {
  await page.goto("/library?source=demo");
  await expect(
    page.getByRole("button", { name: "Add achievement" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("keeps the entered values and the open editor when a save fails", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Detailed entry" }).click();
  await page.getByLabel("Achievement ID").fill("achievement-ci-cd-pipeline");
  await page
    .getByLabel("Achievement text")
    .fill("Duplicate synthetic ID should be rejected.");
  await page.getByLabel("Tags, separated by commas").fill("release, blocked");
  await page.getByRole("button", { name: "Save achievement" }).click();

  await expect(page.locator(".editor-error")).toContainText(
    "conflicts with the library data",
  );
  // The editor stays open with everything the user typed.
  await expect(page.locator(".point-editor")).toBeVisible();
  await expect(page.getByLabel("Achievement ID")).toHaveValue(
    "achievement-ci-cd-pipeline",
  );
  await expect(page.getByLabel("Achievement text")).toHaveValue(
    "Duplicate synthetic ID should be rejected.",
  );
  await expect(page.getByLabel("Tags, separated by commas")).toHaveValue(
    "release, blocked",
  );
  await expect(page.locator(".editor-error")).toHaveAttribute("role", "alert");
});

test("returns focus to the edit control after a successful save", async ({
  page,
}) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-orders-api" });
  const edit = point.getByRole("button", { name: "Edit" });

  await edit.click();
  await page
    .getByLabel("Achievement text")
    .fill("Updated synthetic orders achievement.");
  await page.getByRole("button", { name: "Save achievement" }).click();

  await expect(page.getByText("Saved to your local library.")).toBeVisible();
  await expect(page.locator(".point-editor")).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test("returns focus to the add control when the Imagination Canvas closes", async ({
  page,
}) => {
  const add = page.getByRole("button", {
    name: "Add achievement",
    exact: true,
  });
  await add.click();
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close editor" }).click();

  await expect(
    page.getByRole("heading", { name: "Imagination Canvas" }),
  ).toHaveCount(0);
  await expect(add).toBeFocused();
});

test("keeps the detailed editor within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole("button", { name: "Detailed entry" }).click();

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
  await expect(page.getByLabel("Achievement text")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save achievement" }),
  ).toBeVisible();
});

test("keeps the point editor within a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Add achievement" }).click();
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
  await expect(page.getByLabel("Achievement text")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save achievement" }),
  ).toBeVisible();
});
