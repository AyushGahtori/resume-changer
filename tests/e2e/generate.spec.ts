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
  await expect(page.getByRole("status")).toContainText("Saved locally");
  await page.goto("/generate?source=demo");
});

test("selects points, generates LaTeX, copies and downloads the output", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const point = page.getByLabel(
    "Select achievement achievement-service-capacity-design",
  );
  await point.check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();

  const preview = page.getByLabel("Generated LaTeX");
  await expect(preview).toContainText("Jordan Example");
  await expect(preview).toContainText("Redesigned service boundaries");
  await expect(
    page.getByRole("status", { name: "Generation method" }),
  ).toHaveText(
    "Generated internally by Resume Changer from your selected evidence. AI did not rewrite the content.",
  );
  await expect(page.locator(".generation-metadata")).toContainText(
    "1 achievement",
  );
  await expect(
    page.getByRole("region", { name: "Generated resume review" }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved to generation history on this device."),
  ).toBeVisible();
  const historyResponse = await page.request.get("/api/history");
  expect(historyResponse.ok()).toBe(true);
  await expect(historyResponse.json()).resolves.toEqual(
    expect.objectContaining({
      entries: expect.arrayContaining([
        expect.objectContaining({
          company: "Example Systems",
          role: "Platform Engineer",
          status: "drafted",
          provider: "none",
        }),
      ]),
    }),
  );

  await page.getByRole("button", { name: "Copy LaTeX" }).click();
  await expect(page.getByText("LaTeX copied.", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("\\ResumeHeader{Jordan Example}");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download LaTeX file" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "example-systems-platform-engineer.tex",
  );

  const packageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download export package" }).click();
  expect((await packageDownload).suggestedFilename()).toBe(
    "example-systems-platform-engineer.zip",
  );
  await expect(
    page.getByText(
      "Export package downloaded with LaTeX and metadata. No verified PDF was available to include.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("returns structured validation and renderer errors from the API", async ({
  request,
}) => {
  const base = {
    dataSource: "demo",
    company: "Example Systems",
    roleTitle: "Platform Engineer",
    jobUrl: "",
    jobDescription: "Build reliable platform services.",
    selectedAchievementIds: ["achievement-service-capacity-design"],
  };

  const invalidRequest = await request.post("/api/generate", {
    data: { ...base, selectedAchievementIds: [] },
  });
  expect(invalidRequest.status()).toBe(400);
  await expect(invalidRequest.json()).resolves.toMatchObject({
    error: "Check the job details and selected achievements.",
    issues: expect.arrayContaining([
      expect.objectContaining({ path: "selectedAchievementIds" }),
    ]),
  });

  const invalidSelection = await request.post("/api/generate", {
    data: { ...base, selectedAchievementIds: ["achievement-unknown"] },
  });
  expect(invalidSelection.status()).toBe(400);
  await expect(invalidSelection.json()).resolves.toMatchObject({
    error: expect.stringContaining("Unknown achievement ID"),
  });
});

test("compiles, previews, zooms, exits full screen, and downloads a PDF", async ({
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

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(
    page.getByRole("heading", { name: "PDF preview" }),
  ).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  await expect(
    page.getByText("Saved to generation history on this device."),
  ).toBeVisible();
  const compiledHistory = await page.request.get("/api/history");
  expect((await compiledHistory.json()).entries).toContainEqual(
    expect.objectContaining({
      company: "Example Systems",
      role: "Platform Engineer",
      status: "compiled",
      pdfPath: expect.stringMatching(/\.pdf$/),
    }),
  );

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("110%", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toHaveAttribute(
    "src",
    /#zoom=110&toolbar=0$/,
  );

  await page.getByRole("button", { name: "Open full screen" }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(true);
  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
    .toBe(false);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "example-systems-platform-engineer.pdf",
  );

  const packageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download export package" }).click();
  expect((await packageDownload).suggestedFilename()).toBe(
    "example-systems-platform-engineer.zip",
  );
  await expect(
    page.getByText("Export package downloaded with LaTeX, PDF, and metadata.", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
  await page.getByRole("tab", { name: "PDF" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
});

test("shows actionable PDF compile errors and keeps the LaTeX available", async ({
  page,
}) => {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PAGE_LIMIT_EXCEEDED",
        error:
          "This resume must fit on one page; the compiled document has 2 pages.",
        diagnostics:
          "Compiled page count: 2. Reduce or reprioritize content; template typography and spacing are fixed.",
      }),
    }),
  );
  await generateResume(page);

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.locator(".generation-preview [role=alert]")).toContainText(
    "the compiled document has 2 pages",
  );
  await page.getByText("Compiler details").click();
  await expect(page.getByText("Compiled page count: 2.")).toBeVisible();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
  await expect(page.getByRole("tab", { name: "PDF" })).toBeDisabled();
  await expect(
    page.getByText("Saved to generation history on this device."),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/history");
      const entries = (await response.json()).entries as Array<{
        company?: string;
        role: string;
        status: string;
      }>;
      return entries.some(
        (entry) =>
          entry.company === "Example Systems" &&
          entry.role === "Platform Engineer" &&
          entry.status === "failed",
      );
    })
    .toBe(true);
});

test("rejects a successful HTTP response that is not a valid PDF", async ({
  page,
}) => {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: "not a PDF",
    }),
  );
  await generateResume(page);

  await page.getByRole("button", { name: "Create PDF" }).click();

  await expect(page.locator(".generation-preview [role=alert]")).toContainText(
    "server response was not a valid PDF",
  );
  await expect(page.getByRole("tab", { name: "PDF" })).toBeDisabled();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
});

test("keeps the generation layout within the viewport width on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
  await expect(
    page.getByRole("heading", { name: "Build your resume." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate LaTeX" }),
  ).toBeVisible();
});
