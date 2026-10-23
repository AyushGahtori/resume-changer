import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createOnePagePdf } from "../helpers/pdf-fixture";

const previewStatus = ".preview-status";

async function saveDraft(page: Page) {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable platform services and improve deployment workflows.");
  await expect(page.getByRole("status")).toContainText("Saved on this device");
}

async function openBuilder(page: Page) {
  await saveDraft(page);
  await page.goto("/generate?source=demo");
}

async function generateDraft(page: Page) {
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
}

function mockPdf(route: import("@playwright/test").Route) {
  return route.fulfill({
    status: 200,
    contentType: "application/pdf",
    headers: { "X-PDF-Pages": "1" },
    body: createOnePagePdf(),
  });
}

test("shows an empty preview before a document exists", async ({ page }) => {
  await openBuilder(page);

  const empty = page.locator(".generation-preview-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("Your generated LaTeX will appear here.");
  await expect(page.locator(previewStatus)).toHaveCount(0);
});

test("distinguishes a ready LaTeX document from a ready PDF", async ({
  page,
}) => {
  await page.route("**/api/compile", mockPdf);
  await openBuilder(page);
  await generateDraft(page);

  const status = page.locator(previewStatus);
  await expect(status).toHaveClass(/status-banner--success/);
  await expect(status).toContainText("LaTeX ready.");

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  await expect(status).toContainText("PDF ready · 1 page.");
  await expect(status).toHaveClass(/status-banner--success/);
});

test("shows a compiling state and then the compiled document", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/compile", async (route) => {
    await gate;
    await mockPdf(route);
  });
  await openBuilder(page);
  await generateDraft(page);

  await page.getByRole("button", { name: "Create PDF" }).click();
  const compiling = page.locator(`${previewStatus}.status-banner--info`);
  await expect(compiling).toBeVisible();
  await expect(compiling).toContainText("Compiling the PDF");
  await expect(compiling).toHaveAttribute("role", "status");

  release?.();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  await expect(
    page.locator(`${previewStatus}.status-banner--success`),
  ).toContainText("PDF ready · 1 page.");
  await expect(compiling).toHaveCount(0);
});

test("reports a validation error and keeps the reason visible", async ({
  page,
}) => {
  await openBuilder(page);
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Check the job details and selected achievements.",
        issues: [{ path: "selectedAchievementIds", message: "Pick one." }],
      }),
    }),
  );
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();

  const error = page.locator(`${previewStatus}.status-banner--error`);
  await expect(error).toBeVisible();
  await expect(error).toContainText(
    "Check the job details and selected achievements.",
  );
  await expect(error).toHaveAttribute("role", "alert");
  await expect(page.getByLabel("Generated LaTeX")).toHaveCount(0);
});

test("keeps the compiler diagnostics and allows a retry", async ({ page }) => {
  let attempt = 0;
  await page.route("**/api/compile", (route) => {
    attempt += 1;
    if (attempt === 1) {
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          code: "PAGE_LIMIT_EXCEEDED",
          error:
            "This resume must fit on one page; the compiled document has 2 pages.",
          diagnostics: "Compiled page count: 2.",
        }),
      });
    }
    return mockPdf(route);
  });
  await openBuilder(page);
  await generateDraft(page);

  await page.getByRole("button", { name: "Create PDF" }).click();
  const error = page.locator(`${previewStatus}.status-banner--error`);
  await expect(error).toContainText("the compiled document has 2 pages");
  await page.getByText("Compiler details").click();
  await expect(page.getByText("Compiled page count: 2.")).toBeVisible();

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  await expect(
    page.locator(`${previewStatus}.status-banner--success`),
  ).toContainText("PDF ready · 1 page.");
  await expect(error).toHaveCount(0);
});

test("keeps the generation provenance accurate and separate from the status", async ({
  page,
}) => {
  await openBuilder(page);
  await generateDraft(page);

  const provenance = page.getByRole("status", { name: "Generation method" });
  await expect(provenance).toHaveText(
    "Generated internally by Resume Changer from your selected evidence. AI did not rewrite the content.",
  );
  await expect(provenance).toHaveClass(/status-banner--info/);
  await expect(page.locator(previewStatus)).toHaveClass(
    /status-banner--success/,
  );
});

test("announces the status without taking the focus", async ({ page }) => {
  await page.route("**/api/compile", mockPdf);
  await openBuilder(page);
  await generateDraft(page);

  const createPdf = page.getByRole("button", { name: "Create PDF" });
  await createPdf.click();

  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  await expect(page.locator(previewStatus)).not.toBeFocused();
  const focusMovedIntoStatus = await page.evaluate(() => {
    const banner = document.querySelector(".preview-status");
    return banner ? banner.contains(document.activeElement) : false;
  });
  expect(focusMovedIntoStatus).toBe(false);
});
