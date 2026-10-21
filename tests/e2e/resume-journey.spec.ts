import { expect, test, type Download, type Page } from "@playwright/test";
import { createOnePagePdf } from "../helpers/pdf-fixture";
import { fillJobDraft, jobDescriptionField } from "../helpers/jd-workspace";
import { renderStudioGeneration } from "../../src/lib/generation/studio-generation";
import { studioLibrary, studioMeasurements } from "../helpers/studio-fixtures";

/**
 * The full user journey: enter a job description, read the analysis, review
 * and select achievements, generate LaTeX, compile a PDF, apply a manual
 * override, and export the result.
 *
 * Every AI route is answered from a fixed fixture, and PDF compilation is
 * answered from a deterministic one-page PDF, so the journey never reaches a
 * real model, a real compiler, or a paid API.
 */

const jobDescription = [
  "Standardize AWS provisioning with Infrastructure as Code.",
  "Own deployment checks for internal platform services.",
].join(" ");

const analysis = {
  targetTitle: "Cloud Platform Engineer",
  seniority: "Early career",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment workflows"],
  toolsAndPlatforms: ["AWS", "Terraform"],
  domainConcepts: ["Cloud infrastructure"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};

const capacityId = "achievement-service-capacity-design";
const cloudId = "achievement-cloud-deployment-platform";

const overriddenText =
  "Standardized AWS environment provisioning and deployment checks for three internal services with reviewed infrastructure-as-code modules.";

const fileBase = "example-cloud-cloud-platform-engineer";

async function mockAnalysis(page: Page) {
  await page.route("**/api/ai/analyze-job-description", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    }),
  );
}

async function mockCompile(page: Page) {
  await page.route("**/api/compile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );
}

/**
 * Reads the STORED zip that the export package produces, so the test checks
 * the real archive a user receives rather than a stand-in.
 */
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

test("carries a job description through analysis, selection, PDF, overrides, and export", async ({
  page,
}) => {
  await mockAnalysis(page);
  await mockCompile(page);

  // 1. Enter and save the job description.
  await fillJobDraft(page, {
    company: "Example Cloud",
    roleTitle: "Cloud Platform Engineer",
    jobDescription,
  });
  await expect(jobDescriptionField(page)).toHaveValue(jobDescription);

  // 2. Read the analysis before anything is generated.
  await page.getByRole("button", { name: "Analyze job description" }).click();
  const analysisPanel = page.getByRole("region", {
    name: "Job description analysis",
  });
  await expect(analysisPanel).toBeVisible();
  await expect(analysisPanel).toContainText("Cloud Platform Engineer");
  await expect(analysisPanel).toContainText("AWS provisioning");
  await expect(analysisPanel).toContainText("Infrastructure as Code");
  await expect(
    page.getByText(
      "This analysis could not be saved in this browser. Resume builder recommendations may require analyzing the job again.",
    ),
  ).toHaveCount(0);

  // 3. Carry the analysis into the builder and review the selected points.
  await page.getByRole("link", { name: "Resume builder" }).click();
  await page.getByRole("link", { name: "Demo data", exact: true }).click();
  await expect(page).toHaveURL(/\/generate\?source=demo$/);
  await expect(page.locator(".generation-draft")).toContainText(
    "Cloud Platform Engineer",
  );
  await expect(
    page.getByRole("button", { name: "Suggest points" }),
  ).toBeEnabled();

  const capacity = page.getByLabel(`Select achievement ${capacityId}`);
  const cloud = page.getByLabel(`Select achievement ${cloudId}`);
  await capacity.check();
  await cloud.check();
  await expect(
    page.locator(".generation-section-heading").first(),
  ).toContainText("2 selected");
  await expect(page.locator(".generation-point").first()).toContainText(
    "Redesigned service boundaries and capacity planning",
  );

  // 4. Generate the LaTeX from the reviewed selection.
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  const latex = page.getByLabel("Generated LaTeX");
  await expect(latex).toContainText("Jordan Example");
  await expect(latex).toContainText("Redesigned service boundaries");
  await expect(latex).toContainText(
    "Standardized AWS environment provisioning",
  );
  await expect(page.locator(".generation-metadata")).toContainText(
    "2 achievements",
  );

  // 5. Compile the PDF and confirm the one-page result.
  await page.getByRole("button", { name: "Create PDF" }).click();
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();

  // 6. Apply a manual override in the studio.
  const studio = page.getByRole("region", { name: "Generated resume review" });
  await expect(studio).toBeVisible();
  await page
    .getByRole("button", { name: `Edit achievement ${cloudId}`, exact: true })
    .click();
  await page.getByLabel("Achievement text").fill(overriddenText);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(overriddenText, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply changes →", exact: true }),
  ).toBeEnabled();

  // The applied draft is re-rendered and re-compiled, so the same mocked
  // services answer the studio's own requests.
  await page.route("**/api/resume/edit", (route) => {
    const request = route.request().postDataJSON();
    expect(request.context).toMatchObject({
      company: "Example Cloud",
      roleTitle: "Cloud Platform Engineer",
    });
    const bullet = request.document.bullets.find(
      (item: { id: string }) => item.id === cloudId,
    );
    expect(bullet.text).toBe(overriddenText);
    const generation = renderStudioGeneration(
      studioLibrary,
      request,
      studioMeasurements,
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        generation,
        pdfBase64: createOnePagePdf().toString("base64"),
      }),
    });
  });

  await page
    .getByRole("button", { name: "Apply changes →", exact: true })
    .click();
  await expect(
    page.getByText("Changes applied.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();

  // 7. Export the package and confirm it carries the reviewed output.
  const packageDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download export package" }).click();
  const downloaded = await packageDownload;
  expect(downloaded.suggestedFilename()).toBe(`${fileBase}.zip`);
  await expect(
    page.getByText("Export package downloaded with LaTeX, PDF, and metadata.", {
      exact: true,
    }),
  ).toBeVisible();

  const entries = await readZipEntries(downloaded);
  expect([...entries.keys()]).toEqual([
    `${fileBase}.tex`,
    `${fileBase}.pdf`,
    `${fileBase}.metadata.json`,
  ]);

  const tex = new TextDecoder().decode(entries.get(`${fileBase}.tex`));
  expect(tex).toContain("Jordan Example");
  expect(tex).toContain(overriddenText);

  const pdf = entries.get(`${fileBase}.pdf`)!;
  expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");

  const metadata = JSON.parse(
    new TextDecoder().decode(entries.get(`${fileBase}.metadata.json`)),
  );
  expect(metadata).toMatchObject({
    schemaVersion: 1,
    generation: {
      company: "Example Cloud",
      roleTitle: "Cloud Platform Engineer",
      selectedAchievementIds: [capacityId, cloudId],
    },
    validation: { pdf: "verified", pdfPages: 1 },
    files: [`${fileBase}.tex`, `${fileBase}.pdf`, `${fileBase}.metadata.json`],
  });
});
