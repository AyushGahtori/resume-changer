import { expect, test } from "@playwright/test";

test("preserves landmarks, breadcrumbs, and navigation on each route", async ({
  page,
}) => {
  test.setTimeout(90_000);
  for (const [href, label] of [
    ["/", "Job description"],
    ["/library", "Achievement library"],
    ["/generate", "Resume builder"],
    ["/history", "History"],
    ["/settings", "Settings"],
  ]) {
    await page.goto(href);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("complementary")).toHaveCount(
      href === "/" ? 2 : 1,
    );
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .locator('[aria-current="page"]'),
    ).toHaveText(label);
    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: "Resume Changer home" }),
    ).toHaveCount(1);
  }
});

test("uses the frame insets and contains long values across breakpoints", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Company", exact: true })
    .fill("LongCompanyName".repeat(12));
  await page
    .getByRole("textbox", { name: "Role title", exact: true })
    .fill("SeniorRoleTitle".repeat(12));
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("LongDescriptionValue".repeat(100));
  for (const width of [1440, 1280, 1152, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const content = page.getByRole("main");
    await expect(content).toHaveCSS(
      "padding-left",
      width <= 700 ? "16px" : width <= 1100 ? "24px" : "32px",
    );
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      frameOverflow:
        document.querySelector(".app-frame")!.scrollWidth -
        document.querySelector(".app-frame")!.clientWidth,
      topbarHeight: document.querySelector(".topbar")!.getBoundingClientRect()
        .height,
    }));
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.frameOverflow).toBeLessThanOrEqual(0);
    expect(layout.topbarHeight).toBeGreaterThanOrEqual(56);
    for (const name of [
      "Clear draft",
      "Analyze job description",
      "Save draft",
    ]) {
      const button = page.getByRole("button", { name });
      const bounds = await button.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  }
});

test("keeps sidebar branding and workspace status readable in both themes", async ({
  page,
}) => {
  await page.goto("/");
  await page.setViewportSize({ width: 1440, height: 900 });
  const sidebar = page
    .getByRole("complementary")
    .filter({ has: page.getByRole("navigation", { name: "Main navigation" }) });
  await expect(sidebar).toHaveCSS("padding-left", "24px");
  await expect(
    sidebar.getByRole("link", { name: "Resume Changer home" }),
  ).toHaveAttribute("href", "/");
  await expect(sidebar.locator(".brand-mark svg")).toHaveClass(/lucide/);
  await expect(sidebar.locator(".brand")).toHaveCSS("font-size", "16px");
  await expect(sidebar.locator(".sidebar-label")).toHaveCSS(
    "font-size",
    "11px",
  );
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(
      sidebar.getByText("Private workspace", { exact: true }),
    ).toHaveCSS("font-size", "14px");
    await expect(
      sidebar.getByText("Saved on this device", { exact: true }),
    ).toHaveCSS("font-size", "13px");
    await expect(sidebar.getByRole("link")).toHaveCount(6);
    await expect(sidebar.getByText("Go Pro", { exact: true })).toHaveCount(0);
    await expect(sidebar.locator(".nav-icon svg.lucide")).toHaveCount(5);
  }
});

test("scrolls a short mobile drawer and keeps its footer after navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 360 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  await expect(drawer).toHaveCSS("overflow-y", "auto");
  await expect(drawer.locator(".sidebar-bottom")).toHaveCSS(
    "margin-top",
    "24px",
  );
  await drawer
    .getByRole("link", { name: "Settings", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    drawer.getByRole("link", { name: "Settings", exact: true }),
  ).toBeInViewport();
  await drawer.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/settings$/);
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("main")).not.toHaveAttribute("inert");
});
