import { expect, test } from "@playwright/test";

const draftKey = "resume-changer.jd-draft.v1";
const cacheKey = "resume-changer.jd-analysis.v1";

for (const theme of ["light", "dark"]) {
  test(`draft feedback visual review in ${theme}`, async ({ page }) => {
    await page.goto("/");
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole("textbox", { name: "Job description", exact: true })
        .fill("Build reliable services and maintain accessible interfaces.");
      await expect(page.locator(".draft-state")).toHaveText(
        "Saved on this device",
      );
      await page.getByRole("heading", { name: "Start with the role." }).click();
      if (width < 700)
        await expect(page.locator("#workspace-sidebar")).toBeHidden();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `docs/ui-review/task-20/${theme}-${width}.png`,
        fullPage: true,
        animations: "disabled",
        style: "nextjs-portal { display: none !important; }",
      });
    }
  });
}

test("first load, debounced save, restore, explicit save, clear and refresh", async ({
  page,
}) => {
  await page.goto("/");
  const status = page.locator(".draft-state");
  await expect(status).toHaveText("No saved draft");
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.getByLabel("Company", { exact: true }).fill("Example Systems");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable APIs.");
  await expect(status).toHaveText("Saving...");
  await page.clock.runFor(349);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), draftKey),
  ).toBeNull();
  await page.clock.runFor(1);
  await expect(status).toHaveText("Saved on this device");
  await page.reload();
  await expect(page.getByLabel("Company", { exact: true })).toHaveValue(
    "Example Systems",
  );
  await expect(page.locator(".storage-notice")).toContainText(
    "restored from this device",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".form-save-feedback")).toContainText(
    "Draft saved in this browser",
  );
  await page.evaluate((key) => localStorage.setItem(key, "stale"), cacheKey);
  await page.getByRole("button", { name: "Clear draft", exact: true }).click();
  await expect(status).toHaveText("No saved draft");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), cacheKey),
  ).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Job description", exact: true }),
  ).toHaveValue("");
  await expect(status).toHaveText("No saved draft");
});

test("unavailable storage keeps readable errors and the editable draft", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".storage-notice")).toContainText(
    "Local storage is unavailable",
  );
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Keep this draft available.");
  await expect(page.locator(".draft-state")).toHaveText(
    "Could not save locally",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".form-save-feedback")).toContainText(
    "Could not save the draft",
  );
  await page.waitForTimeout(500);
  await expect(page.locator(".form-save-feedback")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Job description", exact: true }),
  ).toHaveValue("Keep this draft available.");
});

test("invalid stored data is explained, edits invalidate analysis, failed clear is visible", async ({
  page,
}) => {
  await page.addInitScript(
    (key) => localStorage.setItem(key, "invalid-json"),
    draftKey,
  );
  await page.goto("/");
  await expect(page.locator(".storage-notice")).toContainText(
    "could not be restored",
  );
  await page.evaluate((key) => localStorage.setItem(key, "stale"), cacheKey);
  await page.getByLabel("Company", { exact: true }).fill("New company");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), cacheKey),
  ).toBeNull();
  await expect(page.locator(".storage-notice")).toHaveCount(0);
  await page.evaluate(() => {
    Storage.prototype.removeItem = () => {
      throw new Error("Blocked");
    };
  });
  await page.getByRole("button", { name: "Clear draft", exact: true }).click();
  await expect(page.locator(".draft-state")).toHaveText(
    "Could not save locally",
  );
});
