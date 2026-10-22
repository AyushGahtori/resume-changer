import { expect, test } from "@playwright/test";
import { MAX_JD_CHARACTERS } from "../../src/lib/jd-draft";

test("editor helper, Unicode counts and exact length boundary reflect the current draft", async ({
  page,
}) => {
  await page.goto("/");
  const jd = page.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await expect(jd).toHaveAttribute("required", "");
  await expect(jd).toHaveAttribute("aria-describedby", "jd-helper jd-count");
  await expect(page.locator("#jd-helper")).toHaveText(
    "Paste the job description from the company's career page.",
  );
  await jd.fill("Build 🚀\nAPI");
  await expect(page.locator("#jd-count")).toContainText(
    "12 / 30,000 characters",
  );
  await expect(page.locator("#jd-count")).toContainText("~3 tokens");
  await jd.fill("x".repeat(MAX_JD_CHARACTERS));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(jd).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#jd-count")).toContainText(
    "30,000 / 30,000 characters",
  );
  await expect(page.locator("#jd-count")).toContainText("~7,500 tokens");
  await jd.fill("x".repeat(MAX_JD_CHARACTERS + 1));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(jd).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#jd-error")).toContainText("30,000 characters");
  await expect(page.locator("#jd-error svg")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(page.locator("#jd-count")).toContainText("~7,501 tokens");
  await expect(
    page.locator(".jd-form").getByRole("button", { name: "Paste from URL" }),
  ).toHaveCount(0);
});
