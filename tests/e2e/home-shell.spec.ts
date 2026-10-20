import { expect, test } from "@playwright/test";

const destinations = [
  { href: "/", label: "Job description" },
  { href: "/library", label: "Achievement library" },
  { href: "/generate", label: "Resume builder" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

test("keeps shell landmarks and route labels available on every destination", async ({
  page,
}) => {
  test.setTimeout(120_000);

  for (const destination of destinations) {
    await page.goto(destination.href, {
      timeout: 60_000,
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("complementary")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .locator('[aria-current="page"]'),
    ).toHaveText(destination.label);
    await expect(
      page.getByRole("link", { name: destination.label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: "Resume Changer home" }),
    ).toBeVisible();
  }
});

test("contains long form values at desktop, tablet, and mobile widths", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("LongCompanyName".repeat(12));
  await page.getByLabel("Role title").fill("SeniorRoleTitle".repeat(12));
  await page
    .getByLabel("Job link")
    .fill(`https://${"longsubdomain".repeat(8)}.example/jobs/123`);
  await page
    .getByLabel("Job description")
    .fill("LongDescriptionValue".repeat(120));

  const viewports = [
    { width: 1440, height: 900, sidebarWidth: 260, inset: "32px" },
    { width: 1024, height: 768, sidebarWidth: 220, inset: "24px" },
    { width: 390, height: 844, sidebarWidth: 390, inset: "16px" },
    { width: 320, height: 720, sidebarWidth: 320, inset: "16px" },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    const shellLayout = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>(".app-frame")!;
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
      const navigation =
        document.querySelector<HTMLElement>(".main-navigation")!;
      const content = document.querySelector<HTMLElement>(".page-content")!;
      const topbar = document.querySelector<HTMLElement>(".topbar")!;

      return {
        documentOverflow:
          document.documentElement.scrollWidth - window.innerWidth,
        shellOverflow: shell.scrollWidth - shell.clientWidth,
        navigationOverflow: navigation.scrollWidth - navigation.clientWidth,
        navigationOverflowMode: getComputedStyle(navigation).overflowX,
        sidebarWidth: sidebar.getBoundingClientRect().width,
        contentInset: getComputedStyle(content).paddingLeft,
        topbarHeight: getComputedStyle(topbar).height,
      };
    });

    expect(shellLayout.documentOverflow).toBeLessThanOrEqual(0);
    expect(shellLayout.shellOverflow).toBeLessThanOrEqual(0);
    expect(shellLayout.sidebarWidth).toBe(viewport.sidebarWidth);
    expect(shellLayout.contentInset).toBe(viewport.inset);
    expect(Number.parseFloat(shellLayout.topbarHeight)).toBeGreaterThanOrEqual(
      viewport.width <= 700 ? 56 : 60,
    );

    if (viewport.width <= 700) {
      expect(shellLayout.navigationOverflow).toBeGreaterThan(0);
      expect(shellLayout.navigationOverflowMode).toBe("auto");
      const settingsLink = page.getByRole("link", {
        name: "Settings",
        exact: true,
      });
      await settingsLink.scrollIntoViewIfNeeded();
      await expect(settingsLink).toBeVisible();
    }
  }
});

test("supports pointer hover, keyboard focus, and the theme control", async ({
  page,
}) => {
  await page.goto("/");

  const libraryLink = page.getByRole("link", {
    name: "Achievement library",
    exact: true,
  });
  const idleBackground = await libraryLink.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await libraryLink.hover();
  await expect
    .poll(() =>
      libraryLink.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    )
    .not.toBe(idleBackground);

  await page.keyboard.press("Tab");
  const brandLink = page.getByRole("link", { name: "Resume Changer home" });
  await expect(brandLink).toBeFocused();
  await expect(brandLink).toHaveCSS("outline-style", "solid");

  const themeToggle = page.getByRole("button", { name: "Switch to dark mode" });
  await themeToggle.focus();
  await expect(themeToggle).toHaveCSS("outline-style", "solid");
  await themeToggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
});
