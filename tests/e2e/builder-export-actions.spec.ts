import { expect, test, type Page } from "@playwright/test";
import { createOnePagePdf } from "../helpers/pdf-fixture";
import { fillJobDraft } from "../helpers/jd-workspace";

/**
 * Task 26: the preview download, recompile, and export actions.
 *
 * The controls must only offer what the app can really deliver. A PDF that
 * was never compiled cannot be downloaded, the compile action must not run
 * twice at once, and the export package must contain the artifact that was
 * actually produced.
 */

const jobDescription =
  "Standardize AWS provisioning with Infrastructure as Code for internal services.";
const fileBase = "example-cloud-cloud-platform-engineer";

/**
 * The export archive is stored without compression, so the packaged file
 * names and the JSON metadata are readable in the downloaded bytes.
 */
async function readArchiveText(download: {
  path: () => Promise<string | null>;
}): Promise<string> {
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(path!);
  return new TextDecoder("latin1").decode(bytes);
}

async function generateLaTeX(page: Page) {
  await fillJobDraft(page, {
    company: "Example Cloud",
    roleTitle: "Cloud Platform Engineer",
    jobUrl: "https://jobs.example/cloud-platform",
    jobDescription,
  });
  await page.goto("/generate?source=demo");
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
  // The generation also writes to the local history, and the compile
  // control stays locked until that request settles.
  await expect(
    page.getByRole("button", { name: "Create PDF" }),
  ).toBeEnabled({ timeout: 30_000 });
}

test("offers no PDF download and explains the next step before a PDF exists", async ({
  page,
}) => {
  await generateLaTeX(page);

  const download = page.getByRole("button", { name: "Download PDF" });
  await expect(download).toBeDisabled();
  await expect(download).toHaveAttribute(
    "aria-describedby",
    "generation-pdf-availability",
  );
  await expect(page.getByRole("tab", { name: "PDF" })).toBeDisabled();
  await expect(
    page.locator("#generation-pdf-availability"),
  ).toHaveText(
    "No compiled PDF yet. Choose “Create PDF” to compile your generated LaTeX; the PDF download and the PDF inside the export package stay unavailable until it succeeds.",
  );
  await expect(page.getByText("PDF ready · 1 page.")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create PDF" }),
  ).toBeEnabled();
});

test("keeps the preview actions inside the preview pane on a narrow screen", async ({
  page,
}) => {
  await generateLaTeX(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const actions = page.locator(".generation-output-actions");
  await expect(actions).toBeVisible();
  expect(
    await actions.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  for (const name of [
    "Download PDF",
    "Create PDF",
    "Download export package",
  ]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
});

test("downloads the compiled PDF and enables the PDF tab", async ({ page }) => {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );
  await generateLaTeX(page);

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "PDF" })).toBeEnabled();
  await expect(page.locator("#generation-pdf-availability")).toHaveCount(0);

  const downloadButton = page.getByRole("button", { name: "Download PDF" });
  await expect(downloadButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    `${fileBase}.pdf`,
  );
});

test("recompiles the current LaTeX and keeps the controls truthful", async ({
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
  await generateLaTeX(page);

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  expect(compileCount).toBe(1);

  const recompile = page.getByRole("button", { name: "Recompile" });
  await expect(recompile).toBeEnabled();
  await recompile.click();
  await expect.poll(() => compileCount).toBe(2);
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recompile" })).toBeEnabled();
});

test("blocks a second submission and the downloads while a compile is running", async ({
  page,
}) => {
  let releaseCompile: () => void = () => {};
  await page.route("**/api/compile", async (route) => {
    await new Promise<void>((resolve) => {
      releaseCompile = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    });
  });
  await generateLaTeX(page);

  const compile = page.getByRole("button", { name: "Create PDF" });
  await compile.click();
  await expect(page.getByRole("button", { name: "Creating PDF…" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Creating PDF…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Download export package" }),
  ).toBeDisabled();
  await expect(page.locator("#generation-pdf-availability")).toHaveText(
    "Compiling your generated LaTeX into a PDF…",
  );

  releaseCompile();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Recompile" })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Download export package" }),
  ).toBeEnabled();
});

test("explains a failed compile and leaves the PDF download unavailable", async ({
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
      }),
    }),
  );
  await generateLaTeX(page);

  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.locator(".generation-preview [role=alert]")).toContainText(
    "the compiled document has 2 pages",
  );
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "PDF" })).toBeDisabled();
  await expect(page.getByText("PDF ready · 1 page.")).toHaveCount(0);
  await expect(page.locator("#generation-pdf-availability")).toContainText(
    "No compiled PDF yet.",
  );
  await expect(page.getByRole("button", { name: "Create PDF" })).toBeEnabled();
});

test("exports the compiled PDF with the LaTeX and the generation metadata", async ({
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
  await generateLaTeX(page);
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download export package" }).click();
  const archive = await readArchiveText(await downloadPromise);

  expect(archive).toContain(`${fileBase}.tex`);
  expect(archive).toContain(`${fileBase}.pdf`);
  expect(archive).toContain(`${fileBase}.metadata.json`);
  expect(archive).toContain("%PDF-");
  expect(archive).toContain('"pdf": "verified"');
  expect(archive).toContain('"pdfPages": 1');
});
