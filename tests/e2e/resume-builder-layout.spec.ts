import { expect, test } from "@playwright/test";

/**
 * The builder is one workspace inside the shared shell: a selection region
 * on the left, a live preview on the right, and a primary action that stays
 * reachable once the panes stack on a narrow screen.
 */

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "portrait", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "narrow", width: 320, height: 740 },
];

async function openBuilder(page: import("@playwright/test").Page) {
  await page.goto("/generate?source=demo");
  await expect(
    page.getByRole("heading", { name: "Build your resume." }),
  ).toBeVisible();
}

async function paneWidths(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const selection = document.querySelector(".generation-selection");
    const preview = document.querySelector(".generation-preview");
    return {
      selection: selection?.getBoundingClientRect().width ?? 0,
      preview: preview?.getBoundingClientRect().width ?? 0,
    };
  });
}

test("keeps one builder workspace inside the shared shell", async ({
  page,
}) => {
  await openBuilder(page);

  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Choose achievements" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "LaTeX preview" }),
  ).toBeVisible();
});

test("keeps the selection region before the preview", async ({ page }) => {
  await openBuilder(page);

  const panes = page.locator(".generation-layout > section");
  await expect(panes).toHaveCount(2);
  await expect(panes.nth(0)).toHaveClass(/generation-selection/);
  await expect(panes.nth(1)).toHaveClass(/generation-preview/);
});

test("gives the selection region more room than the preview on a wide screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBuilder(page);

  const widths = await paneWidths(page);
  expect(widths.selection).toBeGreaterThan(widths.preview);
});

test("stacks the panes and keeps the primary action reachable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBuilder(page);

  const order = await page.evaluate(() => {
    const selection = document.querySelector(".generation-selection");
    const preview = document.querySelector(".generation-preview");
    if (!selection || !preview) return null;
    return {
      selectionTop: selection.getBoundingClientRect().top,
      previewTop: preview.getBoundingClientRect().top,
    };
  });
  expect(order).not.toBeNull();
  expect(order!.selectionTop).toBeLessThan(order!.previewTop);

  const action = page.getByRole("button", { name: "Generate LaTeX" });
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
});

for (const viewport of viewports) {
  test(`keeps the builder inside the viewport width at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await openBuilder(page);

    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(
      dimensions.viewportWidth,
    );
  });
}

test("resizes the preview pane from the resizer", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable platform services and improve deployment workflows.");
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.goto("/generate?source=demo");
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toBeVisible();

  const resizer = page.getByRole("slider", { name: "Resize resume preview" });
  await expect(resizer).toBeVisible();
  const before = await paneWidths(page);

  await resizer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(resizer).toHaveAttribute("aria-valuenow", "45");
  const after = await paneWidths(page);
  expect(after.preview).toBeGreaterThan(before.preview);
  expect(after.selection).toBeLessThan(before.selection);

  await page.keyboard.press("ArrowRight");
  await expect(resizer).toHaveAttribute("aria-valuenow", "43");
});
