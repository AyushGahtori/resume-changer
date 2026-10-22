import { expect, test } from "@playwright/test";

test("home landmarks describe a local workspace with honest empty content", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .locator('a[aria-current="page"]'),
  ).toHaveText("Job description");
  await expect(page.getByText("Local mode", { exact: true })).toBeVisible();
  await expect(page.locator(".sidebar-bottom")).toContainText(
    "Saved on this device",
  );
  await expect(page.locator(".ats-preview")).toContainText("Not scored.");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Go Pro|Paste from URL/ }),
  ).toHaveCount(0);
  await expect(page.locator(".jd-form input, .jd-form textarea")).toHaveCount(
    4,
  );
  for (const input of await page
    .locator(".jd-form input, .jd-form textarea")
    .all())
    await expect(input).toHaveValue("");
  await expect(page.locator(".ats-preview")).not.toContainText(
    /78%|Estimated ATS match|Google|ML Engineer/,
  );
});
