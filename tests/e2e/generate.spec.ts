import { expect, test } from "@playwright/test";

function createOnePagePdf() {
  const stream = "BT /F1 24 Tf 72 720 Td (Resume Preview Test) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(source);
}

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
    .getByLabel("Job description")
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
  await expect(point).toBeChecked();

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
});

test("reviews generated bullets, reorders evidence, edits wording, and toggles sections", async ({
  page,
}) => {
  let compileCount = 0;
  await page.route("**/api/compile", (route) => {
    compileCount += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    });
  });
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page
    .getByLabel("Select achievement achievement-cloud-deployment-platform")
    .check();
  await page
    .getByLabel("Select achievement achievement-queueboard-worker-model")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toBeVisible();
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();

  await expect(
    page.getByRole("region", { name: "Generated resume review" }),
  ).toContainText("Evidence · achievement-queueboard-worker-model");
  await page
    .getByLabel("Review bullet achievement-cloud-deployment-platform")
    .fill("Standardized verified cloud deployments and release checks.");
  await page
    .getByRole("button", {
      name: "Move bullet up: achievement-cloud-deployment-platform",
    })
    .click();
  await page.getByLabel("Include Projects section").uncheck();
  await page.getByLabel("Include credentials").uncheck();
  await page.getByLabel("Include skill Python").check();
  const updateRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/generate") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Apply review changes" }).click();
  const request = await updateRequest;
  expect(request.postDataJSON().selectedSkillIds).toContain("skill-python");
  expect(request.postDataJSON().selectedAchievementIds).toEqual([
    "achievement-cloud-deployment-platform",
    "achievement-service-capacity-design",
    "achievement-queueboard-worker-model",
  ]);
  await expect.poll(() => compileCount).toBe(2);

  await page.getByRole("tab", { name: "LaTeX" }).click();
  const preview = page.getByLabel("Generated LaTeX");
  await expect(preview).toContainText(
    "Standardized verified cloud deployments and release checks.",
  );
  await expect(preview).not.toContainText("\\section*{Projects}");
  await expect(preview).not.toContainText(
    "\\section*{Licenses and Certifications}",
  );
  const latex = await preview.innerText();
  expect(latex.indexOf("Standardized verified cloud deployments")).toBeLessThan(
    latex.indexOf("Redesigned service boundaries"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
});

test("keeps the reviewed draft visible when applying edits fails", async ({
  page,
}) => {
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  const preview = page.getByLabel("Generated LaTeX");
  await expect(preview).toContainText("Redesigned service boundaries", {
    timeout: 15_000,
  });

  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Resume update temporarily failed." }),
    }),
  );
  await page
    .getByLabel("Review bullet achievement-service-capacity-design")
    .fill("Edited draft that should remain available after a failed update.");
  await page.getByRole("button", { name: "Apply review changes" }).click();

  await expect(
    page.locator('.generation-error-message[role="alert"]'),
  ).toContainText("Resume update temporarily failed.");
  await expect(
    page.getByRole("region", { name: "Generated resume review" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Review bullet achievement-service-capacity-design"),
  ).toHaveValue(
    "Edited draft that should remain available after a failed update.",
  );
  await expect(preview).toContainText("Redesigned service boundaries");
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

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("110%", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toHaveAttribute(
    "src",
    /#zoom=110$/,
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
