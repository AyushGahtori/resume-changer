import { expect, test } from "@playwright/test";

const HELPER_COPY = "Paste the job description from the company's career page.";

for (const theme of ["light", "dark"] as const) {
  test(`shows the required JD label, badge, and helper copy in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((theme) => {
      localStorage.setItem("resume-changer.theme.v1", theme);
    }, theme);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const form = page.getByRole("form", { name: "Role details" });
    const heading = form.locator(".description-heading");
    const label = form.getByRole("textbox", {
      name: "Job description",
      exact: true,
    });

    // The label and the REQUIRED badge share one row.
    await expect(
      heading.getByText("Job description", { exact: true }),
    ).toBeVisible();
    const badge = heading.getByText("REQUIRED", { exact: true });
    await expect(badge).toBeVisible();

    // The helper line carries the exact reference copy.
    const helper = form.locator("#jd-helper");
    await expect(helper).toHaveText(HELPER_COPY);
    await expect(helper).toBeVisible();

    // The helper is programmatically associated with the textarea.
    await expect(label).toHaveAttribute(
      "aria-describedby",
      "jd-helper jd-count",
    );

    const appearance = await form.evaluate((element) => {
      const form = element as HTMLElement;
      const read = (selector: string) => {
        const node = form.querySelector(selector);
        if (!node) return null;
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderColor: style.borderTopColor,
          borderWidth: style.borderTopWidth,
          borderRadius: style.borderTopLeftRadius,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          textTransform: style.textTransform,
          letterSpacing: style.letterSpacing,
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        };
      };

      const headingBox = form
        .querySelector(".description-heading")!
        .getBoundingClientRect();
      const labelBox = form
        .querySelector(".description-heading label")!
        .getBoundingClientRect();
      const badgeBox = form
        .querySelector(".required-label")!
        .getBoundingClientRect();
      const helperBox = form
        .querySelector("#jd-helper")!
        .getBoundingClientRect();
      const textareaBox = form
        .querySelector("textarea")!
        .getBoundingClientRect();

      return {
        label: read(".description-heading label"),
        badge: read(".required-label"),
        helper: read("#jd-helper"),
        headingBox: { top: headingBox.top, bottom: headingBox.bottom },
        labelBox: { top: labelBox.top, bottom: labelBox.bottom },
        badgeBox: { top: badgeBox.top, bottom: badgeBox.bottom },
        helperBox: { top: helperBox.top, bottom: helperBox.bottom },
        textareaBox: { top: textareaBox.top },
        documentOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    // The label is 14px/20px semibold primary text.
    expect(appearance.label).toMatchObject({
      fontSize: "14px",
      lineHeight: "20px",
      fontWeight: "600",
    });
    expect(appearance.label?.letterSpacing).toBe("normal");

    // The badge is a compact uppercase orange marker on a pale orange fill.
    expect(appearance.badge).toMatchObject({
      fontSize: "11px",
      lineHeight: "14px",
      fontWeight: "600",
      textTransform: "uppercase",
      borderRadius: "4px",
    });

    // The helper is secondary supporting copy.
    expect(appearance.helper).toMatchObject({
      fontSize: "13px",
      lineHeight: "18px",
    });

    // Label and badge sit on the same line: they overlap vertically.
    expect(appearance.badgeBox.top).toBeLessThan(appearance.labelBox.bottom);
    expect(appearance.labelBox.top).toBeLessThan(appearance.badgeBox.bottom);

    // The helper sits between the label row and the textarea.
    expect(appearance.helperBox.top).toBeGreaterThan(
      appearance.headingBox.bottom,
    );
    expect(appearance.textareaBox.top).toBeGreaterThan(
      appearance.helperBox.bottom,
    );

    expect(appearance.documentOverflow).toBeLessThanOrEqual(0);

    await page.screenshot({
      path: testInfo.outputPath(`home-jd-editor-${theme}.png`),
      fullPage: true,
      animations: "disabled",
      style: "nextjs-portal { display: none !important; }",
    });
  });
}

test("keeps the required badge visually distinct from the optional chip", async ({
  page,
}) => {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Role details" });

  const tokens = await form.evaluate((element) => {
    const form = element as HTMLElement;
    const read = (selector: string) => {
      const node = form.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderTopColor,
        borderWidth: style.borderTopWidth,
      };
    };
    return {
      optional: read(".optional-label"),
      required: read(".required-label"),
    };
  });

  // The REQUIRED badge uses the orange attention palette, not the neutral
  // outline the optional LINK OPTIONAL chip uses.
  expect(tokens.optional?.backgroundColor).not.toBe(
    tokens.required?.backgroundColor,
  );
  expect(tokens.optional?.color).not.toBe(tokens.required?.color);
  expect(tokens.optional?.borderWidth).toBe("1px");
});

test("associates the helper, error, and count text with the textarea", async ({
  page,
}) => {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Role details" });
  const textarea = form.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });

  // Before validation the textarea is described by the helper and the count.
  await expect(textarea).toHaveAttribute(
    "aria-describedby",
    "jd-helper jd-count",
  );
  await expect(textarea).not.toHaveAttribute("aria-invalid", "true");

  // Triggering validation adds the error message to the description chain
  // without removing the helper or the count.
  await form.getByRole("button", { name: "Save draft" }).click();

  await expect(textarea).toHaveAttribute(
    "aria-describedby",
    "jd-helper jd-error jd-count",
  );
  await expect(textarea).toHaveAttribute("aria-invalid", "true");

  const alert = form.getByRole("alert");
  await expect(alert).toHaveAttribute("id", "jd-error");
  await expect(alert).toContainText("Enter a job description before saving.");

  // The error pairs a red alert icon with the message text.
  await expect(alert.locator("svg")).toHaveCount(1);

  // The required label and its badge are never replaced by the error.
  await expect(
    form.locator(".description-heading").getByText("Job description", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    form.locator(".description-heading").getByText("REQUIRED", { exact: true }),
  ).toBeVisible();
  await expect(form.locator("#jd-helper")).toHaveText(HELPER_COPY);
});

test("keeps the user's text and the helper when validation fails", async ({
  page,
}) => {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Role details" });
  const textarea = form.getByRole("textbox", {
    name: "Job description",
    exact: true,
  });

  await textarea.fill("Drafted role description text.");
  await form.getByRole("button", { name: "Save draft" }).click();

  // The entered text is preserved and the helper stays visible.
  await expect(textarea).toHaveValue("Drafted role description text.");
  await expect(form.locator("#jd-helper")).toBeVisible();
  await expect(form.locator("#jd-helper")).toHaveText(HELPER_COPY);
});

test("wraps the label and badge gracefully on narrow screens", async ({
  page,
}) => {
  await page.goto("/");
  const form = page.getByRole("form", { name: "Role details" });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);

    const geometry = await form.evaluate((element) => {
      const form = element as HTMLElement;
      const heading = form.querySelector(".description-heading")!;
      const label = heading.querySelector("label")!.getBoundingClientRect();
      const badge = heading
        .querySelector(".required-label")!
        .getBoundingClientRect();
      const helper = form.querySelector("#jd-helper")!.getBoundingClientRect();
      const textarea = form.querySelector("textarea")!.getBoundingClientRect();
      return {
        labelTop: label.top,
        labelRight: label.right,
        labelBottom: label.bottom,
        badgeLeft: badge.left,
        badgeRight: badge.right,
        badgeTop: badge.top,
        badgeBottom: badge.bottom,
        helperTop: helper.top,
        helperBottom: helper.bottom,
        textareaTop: textarea.top,
        formRight: form.getBoundingClientRect().right,
        formOverflow: form.scrollWidth - form.clientWidth,
        documentOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    // The badge never overlaps the label and both stay inside the form.
    expect(geometry.labelRight).toBeLessThanOrEqual(geometry.badgeLeft + 0.5);
    expect(geometry.badgeRight).toBeLessThanOrEqual(geometry.formRight);

    // The label and the badge share one row: they overlap vertically.
    expect(geometry.badgeTop).toBeLessThan(geometry.labelBottom);
    expect(geometry.labelTop).toBeLessThan(geometry.badgeBottom);

    // The helper stays directly above the textarea.
    expect(geometry.helperTop).toBeGreaterThan(geometry.badgeTop);
    expect(geometry.textareaTop).toBeGreaterThan(geometry.helperBottom);

    expect(geometry.formOverflow).toBeLessThanOrEqual(0);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
  }
});
