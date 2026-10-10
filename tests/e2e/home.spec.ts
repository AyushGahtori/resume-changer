import { expect, test } from "@playwright/test";

test("shows the initial local resume workspace", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "A better fit, built from your experience.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Your workspace is ready",
  );
});
