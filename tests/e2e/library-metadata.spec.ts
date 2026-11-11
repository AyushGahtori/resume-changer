import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/library");
});

test("optional library metadata saves partial records and rejects a bad email", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("button", { name: "Edit profile" }),
  ).toBeVisible();
  const fields = page.locator(
    "input[name='fullName'], input[name='headline'], input[name='email'], input[name='phone'], input[name='location'], input[name='company'], input[name='title']",
  );
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(fields.first()).not.toHaveAttribute("required", "");
  await expect(fields.first()).not.toHaveAttribute("aria-required", "true");
  await page.getByLabel("Resume contact email").fill("not-an-email");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.locator(".library-metadata-editor").getByRole("alert"),
  ).toBeVisible();
  await expect(page.getByLabel("Resume contact email")).toHaveValue(
    "not-an-email",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add job" }).click();
  await page.getByRole("button", { name: "Save job" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No job changes to save.",
  );
  await expect(page.getByRole("region", { name: "Jobs" })).not.toContainText(
    "Untitled job",
  );

  await page.getByRole("button", { name: "Add job" }).click();
  await page.getByLabel("Company").fill("Fictional Partial Company");
  const saved = page.waitForResponse(
    (response) =>
      /\/api\/library\/jobs\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save job" }).click();
  expect((await saved).ok()).toBeTruthy();
  const savedCompany = page
    .getByRole("region", { name: "Jobs" })
    .getByText("Fictional Partial Company", { exact: true });
  await expect(savedCompany).toBeVisible();
  await page.reload();
  await expect(savedCompany).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});

test("demo data does not open the optional metadata editors", async ({
  page,
}) => {
  await page.goto("/library?source=demo");
  await expect(page.getByRole("button", { name: "Edit profile" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Add job" })).toHaveCount(0);
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
});
