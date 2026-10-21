import { expect, test, type Download, type Page } from "@playwright/test";
import { createOnePagePdf } from "../helpers/pdf-fixture";
import { fillJobDraft } from "../helpers/jd-workspace";

/**
 * The export package a user takes away from the app: the generated LaTeX,
 * the verified PDF when one exists, and the reproducibility metadata. The
 * metadata must describe the generation without carrying the private job
 * text or the internal fitting trace.
 */

const jobDescription =
  "Standardize AWS provisioning with Infrastructure as Code for internal services.";
const fileBase = "example-cloud-cloud-platform-engineer";

async function readZipEntries(
  download: Download,
): Promise<Map<string, Uint8Array>> {
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const bytes = new Uint8Array(await readFile(path!));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = decoder.decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    );
    const contentStart = nameStart + nameLength + extraLength;
    entries.set(name, bytes.slice(contentStart, contentStart + size));
    offset = contentStart + size;
  }
  return entries;
}

async function generateFor(page: Page, withPdf: boolean) {
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
  if (!withPdf) return;
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
}

test("exports the LaTeX and metadata when no verified PDF exists", async ({
  page,
}) => {
  await generateFor(page, false);

  const downloadPromise = page.waitForEvent(
    "download",
    (item) => item.suggestedFilename() === `${fileBase}.zip`,
  );
  await page.getByRole("button", { name: "Download export package" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${fileBase}.zip`);
  await expect(
    page.getByText(
      "Export package downloaded with LaTeX and metadata. No verified PDF was available to include.",
      { exact: true },
    ),
  ).toBeVisible();

  const entries = await readZipEntries(download);
  expect([...entries.keys()]).toEqual([
    `${fileBase}.tex`,
    `${fileBase}.metadata.json`,
  ]);

  const tex = new TextDecoder().decode(entries.get(`${fileBase}.tex`));
  expect(tex).toContain("Jordan Example");
  expect(tex).toContain("Redesigned service boundaries and capacity planning");

  const metadata = JSON.parse(
    new TextDecoder().decode(entries.get(`${fileBase}.metadata.json`)),
  );
  expect(metadata).toMatchObject({
    schemaVersion: 1,
    generation: {
      company: "Example Cloud",
      roleTitle: "Cloud Platform Engineer",
      selectedAchievementIds: ["achievement-service-capacity-design"],
    },
    validation: { latex: "valid", pdf: "not-generated", pdfPages: null },
    files: [`${fileBase}.tex`, `${fileBase}.metadata.json`],
  });
});

test("exports the verified PDF alongside the LaTeX and metadata", async ({
  page,
}) => {
  await generateFor(page, true);

  const downloadPromise = page.waitForEvent(
    "download",
    (item) => item.suggestedFilename() === `${fileBase}.zip`,
  );
  await page.getByRole("button", { name: "Download export package" }).click();
  const download = await downloadPromise;
  await expect(
    page.getByText("Export package downloaded with LaTeX, PDF, and metadata.", {
      exact: true,
    }),
  ).toBeVisible();

  const entries = await readZipEntries(download);
  expect([...entries.keys()]).toEqual([
    `${fileBase}.tex`,
    `${fileBase}.pdf`,
    `${fileBase}.metadata.json`,
  ]);
  expect(
    new TextDecoder().decode(entries.get(`${fileBase}.pdf`)!.slice(0, 5)),
  ).toBe("%PDF-");

  const metadata = JSON.parse(
    new TextDecoder().decode(entries.get(`${fileBase}.metadata.json`)),
  );
  expect(metadata.validation).toMatchObject({
    pdf: "verified",
    pdfPages: 1,
  });
});

test("keeps the private job text out of the exported metadata", async ({
  page,
}) => {
  await generateFor(page, true);

  const downloadPromise = page.waitForEvent(
    "download",
    (item) => item.suggestedFilename() === `${fileBase}.zip`,
  );
  await page.getByRole("button", { name: "Download export package" }).click();
  const entries = await readZipEntries(await downloadPromise);

  const metadata = new TextDecoder().decode(
    entries.get(`${fileBase}.metadata.json`),
  );
  expect(metadata).not.toContain(
    "Infrastructure as Code for internal services",
  );
  expect(metadata).not.toContain("https://jobs.example/cloud-platform");
  expect(metadata).not.toContain("jobDescription");
  expect(metadata).not.toContain("jobUrl");
});

test("downloads the LaTeX and PDF files under the expected names", async ({
  page,
}) => {
  await generateFor(page, true);

  // The output panel shows one view at a time, and compiling switches it to
  // the PDF. The LaTeX download lives on the LaTeX view.
  await page.getByRole("tab", { name: "LaTeX" }).click();
  const latexDownload = page.waitForEvent(
    "download",
    (item) => item.suggestedFilename() === `${fileBase}.tex`,
  );
  await page.getByRole("button", { name: "Download LaTeX file" }).click();
  expect((await latexDownload).suggestedFilename()).toBe(`${fileBase}.tex`);

  await page.getByRole("tab", { name: "PDF" }).click();
  const pdfDownload = page.waitForEvent(
    "download",
    (item) => item.suggestedFilename() === `${fileBase}.pdf`,
  );
  await page.getByRole("button", { name: "Download PDF" }).click();
  expect((await pdfDownload).suggestedFilename()).toBe(`${fileBase}.pdf`);
});
