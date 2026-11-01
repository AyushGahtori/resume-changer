import { expect, test, type Page } from "@playwright/test";

async function fictionalDashboardPng(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 560;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, 900, 560);
    context.fillStyle = "#29254f";
    context.fillRect(0, 0, 900, 72);
    context.fillStyle = "#ffffff";
    context.font = "600 24px Arial";
    context.fillText("Northwind Studio · Activity", 32, 45);
    for (let index = 0; index < 4; index += 1) {
      const x = 32 + index * 211;
      context.fillStyle = "#ffffff";
      context.fillRect(x, 102, 190, 112);
      context.fillStyle = "#64748b";
      context.font = "14px Arial";
      context.fillText(
        ["Weekly posts", "Queue health", "Drafts", "Reach"][index],
        x + 14,
        132,
      );
      context.fillStyle = "#7c3aed";
      context.font = "700 24px Arial";
      context.fillText(["18", "Good", "06", "2.4k"][index], x + 14, 174);
    }
    context.fillStyle = "#ffffff";
    context.fillRect(32, 236, 836, 280);
    context.fillStyle = "#334155";
    context.font = "600 16px Arial";
    context.fillText("Publishing activity", 52, 268);
    context.strokeStyle = "#7c3aed";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(54, 432);
    context.lineTo(190, 390);
    context.lineTo(326, 408);
    context.lineTo(462, 334);
    context.lineTo(598, 358);
    context.lineTo(734, 300);
    context.lineTo(842, 318);
    context.stroke();
    return canvas.toDataURL("image/png").split(",")[1];
  });
}

test("compresses a fictional UI in the tab, previews it, and clears it without a request", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    (
      window as typeof window & { __revokedScreenshotUrls?: string[] }
    ).__revokedScreenshotUrls = [];
    URL.revokeObjectURL = (url: string) => {
      (
        window as typeof window & { __revokedScreenshotUrls?: string[] }
      ).__revokedScreenshotUrls?.push(url);
      original(url);
    };
  });
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  await page.goto("/e2e/github-context-screenshots");
  await expect(
    page.getByRole("heading", { name: "Optional screenshots" }),
  ).toBeVisible();

  const png = await fictionalDashboardPng(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "fictional-dashboard.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.getByText(/Screenshot is ready for review/)).toBeVisible();
  await expect(page.getByTestId("screenshot-count")).toHaveText("1");
  await expect(page.getByTestId("provider-calls")).toHaveText("0");
  await expect(page.getByText(/\d+ × \d+ · (WEBP|PNG)/)).toBeVisible();
  await page.getByRole("button", { name: "Review preview" }).click();
  await expect(
    page.getByAltText("Larger preview of fictional-dashboard.png"),
  ).toBeVisible();
  const thumbnail = await page
    .getByAltText("Preview of fictional-dashboard.png", { exact: true })
    .boundingBox();
  const preview = await page
    .getByAltText("Larger preview of fictional-dashboard.png")
    .boundingBox();
  expect(preview!.height).toBeGreaterThan(thumbnail!.height * 2);
  await page.screenshot({
    path: "test-results/github-context-screenshots-preview.png",
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Remove fictional-dashboard.png" })
    .click();
  await expect(page.getByTestId("screenshot-count")).toHaveText("0");
  await expect(page.getByText("No screenshots selected.")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __revokedScreenshotUrls?: string[] })
          .__revokedScreenshotUrls?.length ?? 0,
    ),
  ).toBeGreaterThan(0);
  expect(apiRequests).toEqual([]);
  await page.reload();
  await expect(page.getByTestId("screenshot-count")).toHaveText("0");
});

test("rejects a file whose declared MIME type disagrees with its bytes", async ({
  page,
}) => {
  await page.goto("/e2e/github-context-screenshots");
  const png = await fictionalDashboardPng(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: "spoofed.png",
    mimeType: "image/jpeg",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "The file type does not match" }),
  ).toBeVisible();
  await expect(page.getByTestId("screenshot-count")).toHaveText("0");
  await expect(page.getByTestId("provider-calls")).toHaveText("0");
});
