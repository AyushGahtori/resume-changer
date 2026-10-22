import { expect, test } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contrastRatio } from "./support/color";

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

/**
 * Writes the example library with the first achievement turned off.
 *
 * The state is part of the saved data, so a card is checked against a
 * library that really holds a disabled point.
 */
async function writeLibraryWithDisabledPoint() {
  const libraryRoot =
    process.env.RESUME_LIBRARY_ROOT ??
    join(tmpdir(), "resume-changer-playwright-data-3010");
  const example = JSON.parse(
    await readFile(
      join(process.cwd(), "examples", "sample-resume-library.json"),
      "utf8",
    ),
  );
  example.jobs[0].points[0].enabled = false;
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(
    join(libraryRoot, "data", "resume-library.json"),
    JSON.stringify(example, null, 2),
    "utf8",
  );
}

test("states the state of an achievement in words", async ({ page }) => {
  await writeLibraryWithDisabledPoint();
  await page.reload();

  const disabled = page
    .locator(".library-point")
    .first()
    .locator(".point-status");
  await expect(disabled).toHaveText("Disabled");
  await expect(disabled).toHaveClass(/is-disabled/);
  // The icon repeats the label, it does not stand in for it.
  await expect(disabled.locator("svg")).toHaveCount(1);

  const enabled = page
    .locator(".library-point")
    .nth(1)
    .locator(".point-status");
  await expect(enabled).toHaveText("Enabled");
  await expect(enabled).toHaveClass(/is-enabled/);
  await expect(enabled.locator("svg")).toHaveCount(1);
});

test("keeps the status pill readable in both themes", async ({ page }) => {
  await writeLibraryWithDisabledPoint();
  await page.reload();

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("resume-changer.theme.v1", value);
    }, theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    for (const status of await page.locator(".point-status").all()) {
      const pill = await status.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          color: style.color,
          background: style.backgroundColor,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
        };
      });

      expect(pill.fontSize).toBe("12px");
      expect(pill.lineHeight).toBe("16px");
      expect(
        contrastRatio(pill.color, pill.background),
        `status pill in ${theme} mode`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("offers the edit action and nothing else on a personal card", async ({
  page,
}) => {
  const card = page.locator(".library-point").first();
  const header = card.locator(".point-row-actions");

  // The header holds the state and the one supported action.
  const actions = header.getByRole("button");
  await expect(actions).toHaveCount(1);
  await expect(actions).toHaveText(/Edit/);

  // The card offers no switch, no favourite, no delete and no overflow menu:
  // the current schema and routes support none of them.
  await expect(card.locator("input[type=checkbox]")).toHaveCount(0);
  await expect(
    header.getByRole("button", {
      name: /delete|favou?rite|toggle|more|overflow|…/i,
    }),
  ).toHaveCount(0);
});

test("keeps the demo library free of an editor action", async ({ page }) => {
  await page.goto("/library?source=demo");

  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  // The demo still states the state of every achievement.
  const statuses = page.locator(".point-status");
  await expect(statuses).toHaveCount(13);
  await expect(statuses.first()).toHaveText("Enabled");
});

test("opens the editor from the keyboard", async ({ page }) => {
  const edit = page
    .locator(".library-point")
    .first()
    .getByRole("button", { name: "Edit" });

  // The action is reached by tabbing, like any other control.
  let reached = false;
  for (let attempt = 0; attempt < 40 && !reached; attempt += 1) {
    await page.keyboard.press("Tab");
    reached = await edit.evaluate((node) => node === document.activeElement);
  }
  expect(reached).toBe(true);

  const focus = await edit.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(focus.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focus.outlineWidth)).toBeGreaterThan(0);

  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Edit achievement" }),
  ).toBeVisible();
});

test("changes the state of an achievement only through the editor", async ({
  page,
}) => {
  const card = page
    .locator(".library-point")
    .filter({ hasText: "achievement-ci-cd-pipeline" });
  const status = card.locator(".point-status");
  await expect(status).toHaveText("Enabled");

  // The card itself offers no switch for the state.
  await expect(card.locator("input[type=checkbox]")).toHaveCount(0);

  await card.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Use this point in resume selection").uncheck();

  // The card still reports the stored state until the change is saved.
  await expect(status).toHaveText("Enabled");

  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/api/library/points/"),
  );
  await page.getByRole("button", { name: "Save achievement" }).click();
  expect((await saved).ok()).toBe(true);

  await expect(status).toHaveText("Disabled");
  await expect(status).toHaveClass(/is-disabled/);
});
