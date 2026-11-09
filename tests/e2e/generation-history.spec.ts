import { expect, test } from "@playwright/test";
import { createOnePagePdf } from "../helpers/pdf-fixture";
import { saveJobAnalysis } from "../helpers/saved-job";

test("searches, reopens, preserves, and safely deletes a prior output", async ({
  page,
  request,
}) => {
  const id = `history-browser-${Date.now()}`;
  const createdAt = "2026-10-19T12:00:00.000Z";
  const saved = await request.post("/api/history", {
    data: {
      id,
      createdAt,
      company: "Fictional Analytics",
      role: "Applied ML Engineer",
      selectedAchievementIds: ["achievement-service-capacity-design"],
      generatedBullets: [
        {
          id: "generated-bullet-1",
          text: "Improved capacity planning for distributed services.",
          section: "experience",
          sourceAchievementIds: ["achievement-service-capacity-design"],
        },
      ],
      provider: "gemini",
      status: "compiled",
      repairAttemptCount: 1,
      latex:
        "\\documentclass{article}\\begin{document}Saved output fixture\\end{document}",
      pdfBase64: createOnePagePdf().toString("base64"),
    },
  });
  expect(saved.status()).toBe(201);

  const pdfResponse = await request.get(`/api/history/${id}/pdf`);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
  expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/history");
  await page
    .getByLabel("Search generation history")
    .fill("Fictional Analytics");
  const openButton = page
    .locator(".history-entry-open")
    .filter({ hasText: "Applied ML Engineer" });
  await expect(openButton).toBeVisible();
  await openButton.click();
  await expect(
    page.getByRole("heading", { name: "Applied ML Engineer" }),
  ).toBeVisible();
  await expect(
    page.getByTitle("Saved PDF for Applied ML Engineer"),
  ).toBeVisible();
  await page.getByRole("button", { name: "LaTeX", exact: true }).click();
  await expect(page.locator(".history-latex")).toContainText(
    "Saved output fixture",
  );

  await page.reload();
  await page.getByLabel("Search generation history").fill("Applied ML");
  await page
    .locator(".history-entry-open")
    .filter({ hasText: "Applied ML Engineer" })
    .click();
  await page.getByRole("button", { name: "LaTeX", exact: true }).click();
  await expect(page.locator(".history-latex")).toContainText(
    "Saved output fixture",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );

  await page
    .getByRole("button", { name: "Delete Applied ML Engineer generation" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page
      .locator(".history-entry-open")
      .filter({ hasText: "Applied ML Engineer" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Saved generation and its files deleted.", { exact: true }),
  ).toBeVisible();
  const historyResponse = await request.get("/api/history");
  expect(historyResponse.ok()).toBe(true);
  expect((await historyResponse.json()).entries).not.toContainEqual(
    expect.objectContaining({ id }),
  );
});

test("does not call an empty history save saved", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Role title").fill("Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable platform services and improve deployment workflows.");
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await saveJobAnalysis(page, {
    company: "Example Systems",
    roleTitle: "Platform Engineer",
    jobDescription:
      "Build reliable platform services and improve deployment workflows.",
  });
  await page.route("**/api/history", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({ status: 200, body: "" });
  });
  await page.goto("/generate?source=demo");
  await page
    .getByLabel("Select achievement achievement-service-capacity-design")
    .check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(
    "Jordan Example",
  );
  await expect(
    page.getByText("Saved to generation history on this device."),
  ).toHaveCount(0);
  await expect(page.getByText(/could not be saved to history/)).toBeVisible();
});
