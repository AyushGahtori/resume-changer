import { expect, test } from "@playwright/test";

import { createOnePagePdf } from "../helpers/pdf-fixture";

async function generateResume(page: import("@playwright/test").Page) {
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
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

test("shows the real LaTeX and the compiled PDF, and states the page count", async ({
  page,
}) => {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );
  await generateResume(page);

  // The LaTeX view shows the generated document, not a placeholder.
  const latex = page.getByLabel("Generated LaTeX");
  await expect(latex).toContainText("Jordan Example");
  await expect(latex).toContainText("Redesigned service boundaries");
  await expect(page.getByRole("heading", { name: "LaTeX preview" })).toBeVisible();

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(
    page.getByRole("heading", { name: "PDF preview" }),
  ).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  // The page count comes from the compile response.
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  // No page fill is claimed, because the compile response does not report one.
  await expect(page.getByText(/page fill/)).toHaveCount(0);

  // Switching formats keeps the same document.
  await page.getByRole("tab", { name: "LaTeX" }).click();
  await expect(latex).toContainText("Jordan Example");
  await page.getByRole("tab", { name: "PDF" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
});

test("keeps the real document visible while compiling and after a failure", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/compile", async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "X-PDF-Pages": "1" },
        body: createOnePagePdf(),
      });
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PAGE_LIMIT_EXCEEDED",
        error:
          "This resume must fit on one page; the compiled document has 2 pages.",
        diagnostics: "Compiled page count: 2.",
      }),
    });
  });
  await generateResume(page);
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  const frame = page.getByTitle("Generated resume PDF");
  const source = await frame.getAttribute("src");

  await page.getByRole("button", { name: "Recompile" }).click();
  await expect(page.locator(".generation-preview [role=alert]")).toContainText(
    "the compiled document has 2 pages",
  );
  // The failed compile does not replace the real output with a placeholder.
  await expect(frame).toHaveAttribute("src", source!);
  await page.getByRole("tab", { name: "LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
});

test("bounds the LaTeX document in its own scrollable pane", async ({
  page,
}) => {
  await generateResume(page);
  const metrics = await page
    .locator(".latex-preview")
    .evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.overflowY).toBe("auto");
});

test("places the preview below the editor on narrow screens with a return path", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await generateResume(page);
  const returnLink = page.getByRole("link", { name: "Back to editing" });
  await expect(returnLink).toBeHidden();
  const wide = await page.evaluate(() => {
    const editing = document.getElementById("resume-editing");
    const preview = document.querySelector(".generation-preview");
    if (!editing || !preview) return null;
    return {
      editingRight: editing.getBoundingClientRect().right,
      previewLeft: preview.getBoundingClientRect().left,
    };
  });
  expect(wide).not.toBeNull();
  // The preview pane sits beside the editing content on a wide screen.
  expect(wide!.previewLeft).toBeGreaterThanOrEqual(wide!.editingRight - 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(returnLink).toBeVisible();
  const narrow = await page.evaluate(() => {
    const editing = document.getElementById("resume-editing");
    const preview = document.querySelector(".generation-preview");
    if (!editing || !preview) return null;
    return {
      editingBottom: editing.getBoundingClientRect().bottom,
      previewTop: preview.getBoundingClientRect().top,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  expect(narrow).not.toBeNull();
  // The preview sits below the primary editing content on a narrow screen.
  expect(narrow!.previewTop).toBeGreaterThanOrEqual(narrow!.editingBottom - 1);
  expect(narrow!.scrollWidth).toBeLessThanOrEqual(narrow!.clientWidth);

  await returnLink.click();
  await expect(page.locator("#resume-editing")).toBeInViewport();
});

test("renders the preview in both themes", async ({ page }) => {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );
  await generateResume(page);
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  const viewport = page.locator(".pdf-preview-viewport");
  const light = await viewport.evaluate((node) => getComputedStyle(node).borderTopColor);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  const dark = await viewport.evaluate((node) => getComputedStyle(node).borderTopColor);
  expect(dark).not.toBe(light);
});
