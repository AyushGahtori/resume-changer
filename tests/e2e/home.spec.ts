import { expect, test } from "@playwright/test";
import { MAX_JD_CHARACTERS } from "../../src/lib/jd-draft";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("No saved draft");
});

test("renders the workspace shell and all primary destinations", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Start with the role." }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Job description" }),
  ).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Achievement library" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(
    page.getByRole("heading", { name: "Achievement library" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Resume builder" }).click();
  await expect(page).toHaveURL(/\/generate$/);
  await expect(
    page.getByRole("heading", { name: "Resume builder" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("saves and restores the JD and role details locally", async ({ page }) => {
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Role title").fill("Backend Engineer");
  await page.getByLabel("Job link").fill("https://jobs.example/role");
  await page
    .getByLabel("Job description")
    .fill("Build reliable APIs and improve data services.");

  await expect(page.getByRole("status")).toContainText("Saved locally");
  await expect(page.getByText("~12 tokens")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Company")).toHaveValue("Example Systems");
  await expect(page.getByLabel("Role title")).toHaveValue("Backend Engineer");
  await expect(page.getByLabel("Job link")).toHaveValue(
    "https://jobs.example/role",
  );
  await expect(page.getByLabel("Job description")).toHaveValue(
    "Build reliable APIs and improve data services.",
  );
});

test("validates empty, oversized, and malformed job descriptions", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator("#jd-error")).toContainText(
    "Enter a job description before saving.",
  );

  await page
    .getByLabel("Job description")
    .fill("x".repeat(MAX_JD_CHARACTERS + 1));
  await expect(page.getByText("30,001 / 30,000 characters")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator("#jd-error")).toContainText("30,000 characters");

  await page.getByLabel("Job description").fill("Backend engineer");
  await page.getByLabel("Job link").fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Enter an HTTP or HTTPS link.")).toBeVisible();
});

test("clears the saved draft", async ({ page }) => {
  await page.getByLabel("Company").fill("Example Systems");
  await page.getByLabel("Job description").fill("A short job description.");
  await expect(page.getByRole("status")).toContainText("Saved locally");

  await page.getByRole("button", { name: "Clear draft" }).click();
  await expect(page.getByLabel("Company")).toHaveValue("");
  await expect(page.getByLabel("Job description")).toHaveValue("");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("Company")).toHaveValue("");
  await expect(page.getByLabel("Job description")).toHaveValue("");
});

test("persists the selected theme and remains usable on a narrow viewport", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();

  const pageWidth = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(pageWidth).toBeLessThanOrEqual(0);
});

test("fits the JD workspace within a standard desktop viewport", async ({
  page,
}) => {
  for (const height of [950, 700]) {
    await page.setViewportSize({ width: 1440, height });

    const pageHeight = await page.evaluate(() => {
      const textarea = document
        .querySelector(".jd-form textarea")!
        .getBoundingClientRect();
      const footer = document
        .querySelector(".form-footer")!
        .getBoundingClientRect();

      return {
        document: document.documentElement.scrollHeight - window.innerHeight,
        textareaBottom: textarea.bottom,
        textareaWidth: textarea.width,
        footerBottom: footer.bottom,
        footerTop: footer.top,
      };
    });
    expect(pageHeight.document).toBeLessThanOrEqual(0);
    expect(pageHeight.textareaBottom).toBeLessThanOrEqual(height);
    expect(pageHeight.textareaWidth).toBeLessThanOrEqual(880);
    expect(pageHeight.footerBottom).toBeLessThanOrEqual(height);
    expect(pageHeight.footerTop).toBeGreaterThan(0);
  }
});
