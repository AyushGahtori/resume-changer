import { expect, test } from "@playwright/test";

test("role fields stay optional, labeled, ordered and independently editable", async ({
  page,
}) => {
  await page.goto("/");
  const company = page.getByLabel("Company", { exact: true });
  const role = page.getByLabel("Role title", { exact: true });
  const link = page.getByLabel("Job link", { exact: true });
  await expect(company).toHaveAttribute("autocomplete", "organization");
  await expect(role).toHaveAttribute("autocomplete", "organization-title");
  await expect(link).toHaveAttribute("inputmode", "url");
  for (const input of [company, role, link]) {
    await expect(input).not.toHaveAttribute("required");
    await expect(input).toHaveCSS("height", "44px");
  }
  await company.focus();
  await page.keyboard.type("A role with punctuation & symbols");
  await page.keyboard.press("Tab");
  await expect(role).toBeFocused();
  await role.fill("Staff Platform Engineer");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await link.fill("ftp://example.test/job");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Maintain accessible services.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(link).toBeFocused();
  await expect(link).toHaveAttribute("aria-describedby", "job-url-error");
  await expect(page.locator("#job-url-error")).toHaveText(
    "Enter an HTTP or HTTPS link.",
  );
  await link.fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".form-save-feedback")).toContainText(
    "Draft saved in this browser",
  );
  await expect(company).toHaveValue("A role with punctuation & symbols");
  await expect(role).toHaveValue("Staff Platform Engineer");
});
