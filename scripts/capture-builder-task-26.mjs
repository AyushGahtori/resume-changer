import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Review capture for Task 26 (preview download, recompile, and export
 * actions). The script drives the builder with the demo library only and
 * answers the compile route with a local fixture, so the captures never
 * reach a real compiler, a real AI provider, or personal data.
 *
 * Start a dev server first, for example:
 *   RESUME_LIBRARY_ROOT=<temp folder> npx next dev -p 3111
 * then run: node scripts/capture-builder-task-26.mjs
 */

const baseUrl = process.env.CAPTURE_BASE_URL ?? "http://127.0.0.1:3111";
const outputDir = resolve(
  process.env.CAPTURE_OUTPUT_DIR ?? "docs/ui-review/resume-builder-task-26",
);

const onePagePdf = Buffer.from(
  "%PDF-1.4\n" +
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n" +
    "trailer\n<< /Size 4 /Root 1 0 R >>\n%%EOF\n",
);

const viewports = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
const captured = [];

for (const theme of ["light", "dark"]) {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    await context.addInitScript(
      (value) => {
        window.localStorage.setItem("resume-changer.theme.v1", value);
      },
      theme,
    );
    const page = await context.newPage();
    await page.route("**/api/compile", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "X-PDF-Pages": "1" },
        body: onePagePdf,
      }),
    );

    await page.goto(`${baseUrl}/`);
    await page.getByLabel("Company").fill("Example Cloud");
    await page.getByLabel("Role title").fill("Cloud Platform Engineer");
    await page
      .getByRole("textbox", { name: "Job description", exact: true })
      .fill("Standardize AWS provisioning with Infrastructure as Code.");
    await page.goto(`${baseUrl}/generate?source=demo`);
    await page
      .getByLabel("Select achievement achievement-service-capacity-design")
      .check();
    await page.getByRole("button", { name: "Generate LaTeX" }).click();
    await page.getByLabel("Generated LaTeX").waitFor({ state: "visible" });

    const preview = page.locator(".generation-preview");
    const heading = page
      .locator(".generation-preview .generation-section-heading")
      .first();
    const prefix = `${theme}-${viewport.name}`;

    await heading.screenshot({
      path: join(outputDir, `${prefix}-latex-no-pdf-actions.png`),
    });
    await preview.screenshot({
      path: join(outputDir, `${prefix}-latex-no-pdf-preview.png`),
    });
    captured.push(`${prefix}-latex-no-pdf-actions.png`);

    await page.getByRole("button", { name: "Create PDF" }).click();
    await page.getByText("PDF ready · 1 page.").waitFor({ state: "visible" });
    await heading.screenshot({
      path: join(outputDir, `${prefix}-pdf-ready-actions.png`),
    });
    captured.push(`${prefix}-pdf-ready-actions.png`);

    await page.getByRole("tab", { name: "LaTeX" }).click();
    await heading.screenshot({
      path: join(outputDir, `${prefix}-latex-with-pdf-actions.png`),
    });
    captured.push(`${prefix}-latex-with-pdf-actions.png`);

    await page.getByRole("tab", { name: "PDF" }).click();
    await page.screenshot({
      path: join(outputDir, `${prefix}-pdf-ready-page.png`),
      fullPage: false,
    });
    captured.push(`${prefix}-pdf-ready-page.png`);

    await context.close();
  }
}

await browser.close();
console.log(`Captured ${captured.length} images in ${outputDir}`);
for (const file of captured) console.log(`- ${file}`);
