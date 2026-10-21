import { expect, type Page } from "@playwright/test";
import { createOnePagePdf } from "./pdf-fixture";
import {
  studioGeneration,
  studioLibrary,
  studioMeasurements,
} from "./studio-fixtures";
import { renderStudioGeneration } from "../../src/lib/generation/studio-generation";

export async function mockStudioServices(page: Page) {
  await page.route("**/api/resume/skills?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(studioMeasurements),
    }),
  );
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );
  await page.route("**/api/resume/edit", (route) => {
    const generation = renderStudioGeneration(
      studioLibrary,
      route.request().postDataJSON(),
      studioMeasurements,
    );
    generation.metadata.layout = {
      pageCount: 1,
      pageWidth: 612,
      pageHeight: 792,
      contentTop: 40,
      contentBottom: 720,
      usableHeight: 727,
      bottomGap: 30,
      utilization: 0.94,
      visibleWordCount: 300,
      clipped: false,
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generation,
        pdfBase64: createOnePagePdf().toString("base64"),
      }),
    });
  });
}

export async function openStudio(page: Page, withPdf = true) {
  await mockStudioServices(page);
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable platform services.");
  await expect(page.getByRole("status")).toContainText("Saved locally");
  await page.goto("/generate?source=demo");
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(studioGeneration),
    }),
  );
  for (const point of studioLibrary.jobs[0].points.slice(0, 2))
    await page.getByLabel(`Select achievement ${point.id}`).check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(
    page.getByRole("heading", { name: "Make it yours." }),
  ).toBeVisible();
  if (withPdf) {
    await page.getByRole("button", { name: "Create PDF" }).click();
    await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  }
}
