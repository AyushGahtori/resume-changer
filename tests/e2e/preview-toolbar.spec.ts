import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createOnePagePdf } from "../helpers/pdf-fixture";

async function openCompiledPreview(page: Page) {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable platform services and improve deployment workflows.");
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.goto("/generate?source=demo");
});

test("moves between the output format tabs with the keyboard", async ({
  page,
}) => {
  await openCompiledPreview(page);

  const latexTab = page.getByRole("tab", { name: "LaTeX" });
  const pdfTab = page.getByRole("tab", { name: "PDF" });
  await expect(pdfTab).toHaveAttribute("aria-selected", "true");

  await pdfTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(latexTab).toHaveAttribute("aria-selected", "true");
  await expect(latexTab).toBeFocused();
  await expect(page.getByLabel("Generated LaTeX")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(pdfTab).toHaveAttribute("aria-selected", "true");
  await expect(pdfTab).toBeFocused();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();

  await page.keyboard.press("Home");
  await expect(latexTab).toHaveAttribute("aria-selected", "true");
  await expect(latexTab).toBeFocused();

  await page.keyboard.press("End");
  await expect(pdfTab).toHaveAttribute("aria-selected", "true");
  await expect(pdfTab).toBeFocused();
});

test("marks the focused format tab with a visible focus ring", async ({
  page,
}) => {
  await openCompiledPreview(page);

  const latexTab = page.getByRole("tab", { name: "LaTeX" });
  const pdfTab = page.getByRole("tab", { name: "PDF" });

  // Moving the selection with the keyboard also moves the focus, which is
  // what makes the focus ring visible.
  await pdfTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(latexTab).toBeFocused();

  const focusRing = await latexTab.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(focusRing.focusVisible).toBe(true);
  expect(focusRing.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusRing.outlineWidth)).toBeGreaterThan(0);

  const latexBackground = await latexTab.evaluate((element) =>
    window.getComputedStyle(element).backgroundColor,
  );
  const pdfBackground = await pdfTab.evaluate((element) =>
    window.getComputedStyle(element).backgroundColor,
  );
  expect(latexBackground).not.toBe(pdfBackground);
});

test("keeps the zoom inside the supported range and keeps it across formats", async ({
  page,
}) => {
  await openCompiledPreview(page);

  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  const frame = page.getByTitle("Generated resume PDF");

  for (let step = 0; step < 5; step += 1) {
    await zoomOut.click();
  }
  await expect(page.getByText("50%", { exact: true })).toBeVisible();
  await expect(zoomOut).toBeDisabled();
  await expect(frame).toHaveAttribute("src", /#zoom=50&toolbar=0$/);

  for (let step = 0; step < 15; step += 1) {
    await zoomIn.click();
  }
  await expect(page.getByText("200%", { exact: true })).toBeVisible();
  await expect(zoomIn).toBeDisabled();
  await expect(frame).toHaveAttribute("src", /#zoom=200&toolbar=0$/);

  await page.getByRole("tab", { name: "LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toBeVisible();
  await page.getByRole("tab", { name: "PDF" }).click();
  await expect(page.getByText("200%", { exact: true })).toBeVisible();
  await expect(frame).toHaveAttribute("src", /#zoom=200&toolbar=0$/);
});

test("gives every viewer control a working action and an accessible name", async ({
  page,
}) => {
  await openCompiledPreview(page);

  const toolbar = page.getByRole("group", { name: "PDF viewer controls" });
  const controls = toolbar.getByRole("button");
  await expect(controls).toHaveCount(5);

  for (const control of await controls.all()) {
    await expect(control).toHaveAccessibleName(/\S/);
    const tooltip = await control.getAttribute("title");
    expect(tooltip?.trim()).toBeTruthy();
  }

  // Every labelled control repeats its visible text in the accessible name.
  await expect(
    toolbar.getByRole("button", { name: "Open full screen" }),
  ).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Fit width" })).toBeVisible();

  await expect(toolbar.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await expect(
    toolbar.getByRole("button", { name: "Fit width" }),
  ).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", { name: "Fit page" }).click();
  await expect(
    toolbar.getByRole("button", { name: "Fit page" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    toolbar.getByRole("button", { name: "Fit width" }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTitle("Generated resume PDF")).toHaveAttribute(
    "src",
    /#view=Fit&toolbar=0$/,
  );
});

test("enters and leaves full screen from the viewer toolbar", async ({
  page,
}) => {
  await openCompiledPreview(page);

  const toolbar = page.getByRole("group", { name: "PDF viewer controls" });
  await toolbar.getByRole("button", { name: "Open full screen" }).click();
  await expect(
    toolbar.getByRole("button", { name: "Exit full screen" }),
  ).toBeVisible();

  await toolbar.getByRole("button", { name: "Exit full screen" }).click();
  await expect(
    toolbar.getByRole("button", { name: "Open full screen" }),
  ).toBeVisible();
});

test("keeps the viewer toolbar inside a narrow viewport", async ({ page }) => {
  await openCompiledPreview(page);
  await page.setViewportSize({ width: 320, height: 720 });

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );

  const toolbar = page.getByRole("group", { name: "PDF viewer controls" });
  const box = await toolbar.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});
