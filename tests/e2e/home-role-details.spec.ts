import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`keeps role details and JD in one named form in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("resume-changer.theme.v1", theme);
    }, theme);
    await page.goto("/");
    const form = page.getByRole("form", { name: "Role details" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(form).toBeVisible();
    await expect(page.locator(".draft-state")).toHaveText("No saved draft");
    await expect(
      form.getByRole("heading", { name: "Role details", level: 2 }),
    ).toHaveCSS("font-size", "20px");
    await expect(
      form.getByText("Target position", { exact: true }),
    ).toBeVisible();
    await expect(
      form.getByText("LINK OPTIONAL", { exact: true }),
    ).toBeVisible();
    await expect(form.getByRole("textbox")).toHaveCount(4);
    await expect(
      form.getByRole("textbox", { name: "Company", exact: true }),
    ).not.toHaveAttribute("required");
    await expect(
      form.getByRole("textbox", { name: "Role title", exact: true }),
    ).not.toHaveAttribute("required");
    await expect(
      form.getByRole("textbox", { name: "Job description", exact: true }),
    ).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 900, inset: 24 },
      { width: 1024, height: 768, inset: 16 },
      { width: 390, height: 844, inset: 16 },
      { width: 320, height: 720, inset: 12 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await form.evaluate((element) => {
        const form = element as HTMLElement;
        const style = getComputedStyle(form);
        const box = form.getBoundingClientRect();
        const header = form.querySelector(".form-topline")!;
        const title = header.querySelector("h2")!.getBoundingClientRect();
        const badge = header
          .querySelector(".optional-label")!
          .getBoundingClientRect();
        const fields = form
          .querySelector(".metadata-fields")!
          .getBoundingClientRect();
        const divider = form
          .querySelector(".form-divider")!
          .getBoundingClientRect();
        const editor = form
          .querySelector(".description-heading")!
          .getBoundingClientRect();
        return {
          padding: style.paddingLeft,
          radius: style.borderRadius,
          border: style.borderTopWidth,
          shadow: style.boxShadow,
          nestedForms: form.querySelectorAll("form").length,
          titleRight: title.right,
          badgeLeft: badge.left,
          fieldsBottom: fields.bottom,
          dividerTop: divider.top,
          dividerBottom: divider.bottom,
          editorTop: editor.top,
          right: box.right,
          overflow: form.scrollWidth - form.clientWidth,
          documentOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      expect(geometry.padding).toBe(`${viewport.inset}px`);
      expect(geometry.radius).toBe("8px");
      expect(geometry.border).toBe("1px");
      expect(geometry.nestedForms).toBe(0);
      expect(geometry.titleRight).toBeLessThanOrEqual(geometry.badgeLeft);
      expect(
        geometry.dividerTop - geometry.fieldsBottom,
      ).toBeGreaterThanOrEqual(20);
      expect(
        geometry.editorTop - geometry.dividerBottom,
      ).toBeGreaterThanOrEqual(20);
      expect(geometry.right).toBeLessThanOrEqual(viewport.width);
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
      if (theme === "dark") expect(geometry.shadow).toBe("none");
      if (viewport.width !== 320) {
        await page.screenshot({
          path: testInfo.outputPath(
            `home-${viewport.width}x${viewport.height}-${theme}.png`,
          ),
          fullPage: true,
          animations: "disabled",
          style: "nextjs-portal { display: none !important; }",
        });
      }
    }
  });
}

test("keeps validation and restored-draft notices with the named form", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("resume-changer.jd-draft.v1", "invalid-json"),
  );
  await page.goto("/");
  const form = page.getByRole("form", { name: "Role details" });
  await expect(page.locator(".storage-notice")).toBeVisible();
  await form.getByRole("button", { name: "Save draft" }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Enter a job description",
  );
  const jd = form.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });
  await expect(jd).toHaveAttribute(
    "aria-describedby",
    "jd-helper jd-error jd-count",
  );
  await jd.fill("Build reliable fictional services.");
  await form
    .getByRole("textbox", { name: "Job link", exact: true })
    .fill("javascript:alert(1)");
  await form.getByRole("button", { name: "Save draft" }).click();
  await expect(form.locator("#job-url-error")).toContainText("HTTP or HTTPS");
  await expect(jd).toHaveValue("Build reliable fictional services.");
  await form.getByRole("textbox", { name: "Job link", exact: true }).fill("");
  await form.getByRole("button", { name: "Save draft" }).click();
  await expect(form.locator(".form-save-feedback")).toContainText(
    "Draft saved in this browser",
  );
  await expect(
    form.getByRole("textbox", { name: "Company", exact: true }),
  ).toHaveValue("");
});
