import { expect, test } from "@playwright/test";

test("reference heading copy keeps the established fonts and readable mobile scale", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".eyebrow")).toHaveText("NEW APPLICATION 01 / 04");
  await expect(page.locator(".eyebrow").getByRole("button")).toHaveCount(0);
  const title = page.getByRole("heading", {
    name: "Start with the role.",
    exact: true,
  });
  const intro = page.locator(".page-intro");
  await expect(intro).toHaveText(
    "Add the job description and let AI analyze it for a stronger, ATS-optimized resume.",
  );
  await expect(intro).toHaveCSS("font-size", "16px");
  await expect(intro).toHaveCSS("line-height", "24px");
  await expect(title).toHaveCSS("font-weight", "700");
  await expect(title).toHaveCSS("font-family", /Georgia/);
  await expect(intro).toHaveCSS("font-family", /Arial/);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(title).toHaveCSS("font-size", width > 700 ? "40px" : "32px");
    const boxes = await page
      .locator(".page-heading-row, .jd-work-grid")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, right: r.right };
        }),
      );
    expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top - 23);
    expect(boxes[0].right).toBeLessThanOrEqual(width);
  }
});
