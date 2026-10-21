import { expect, test } from "@playwright/test";
import { waitForAnimationsToSettle } from "../helpers/animations";

const destinations = [
  { href: "/", label: "Job description" },
  { href: "/library", label: "Achievement library" },
  { href: "/generate", label: "Resume builder" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

function parseRgb(color: string) {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error("Expected an RGB color, received: " + color);
  }

  return channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const [red, green, blue] = parseRgb(color);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("marks only the current destination on every route, including after refresh", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto("/");
  for (const destination of destinations) {
    const navigation = page.getByRole("navigation", {
      name: "Main navigation",
    });
    if (destination.href !== "/") {
      await navigation.getByRole("link", { name: destination.label }).click();
    }
    await expect(page).toHaveURL(new RegExp(destination.href + "$"), {
      timeout: 30_000,
    });
    const activeLink = navigation.getByRole("link", {
      name: destination.label,
    });

    await expect(navigation.getByRole("link")).toHaveCount(5);
    await expect(activeLink).toHaveAttribute("aria-current", "page");
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);

    await page.reload();
    await expect(activeLink).toHaveAttribute("aria-current", "page");
    await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  }
});

test("provides visible active, hover, and keyboard focus states in both themes", async ({
  page,
}) => {
  const navigation = page.getByRole("navigation", {
    name: "Main navigation",
  });
  const activeLink = navigation.getByRole("link", {
    name: "Job description",
  });
  const inactiveLink = navigation.getByRole("link", {
    name: "Achievement library",
  });

  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") {
      await page.getByRole("button", { name: "Switch to dark mode" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    }

    await waitForAnimationsToSettle(activeLink);

    // Keep explicit theme-color checks as well as waiting for transitions.
    await expect(activeLink).toHaveCSS(
      "color",
      theme === "dark" ? "rgb(167, 139, 250)" : "rgb(194, 65, 12)",
    );
    await expect(activeLink).toHaveCSS(
      "background-color",
      theme === "dark" ? "rgb(50, 37, 72)" : "rgb(255, 247, 237)",
    );

    const readActiveStyles = () =>
      activeLink.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontWeight: Number(style.fontWeight),
        };
      });
    await expect
      .poll(async () => {
        const styles = await readActiveStyles();
        return contrastRatio(styles.color, styles.backgroundColor);
      })
      .toBeGreaterThanOrEqual(4.5);
    const activeStyles = await readActiveStyles();
    const inactiveWeight = Number(
      await inactiveLink.evaluate(
        (element) => getComputedStyle(element).fontWeight,
      ),
    );

    expect(activeStyles.fontWeight).toBeGreaterThan(inactiveWeight);
    expect(
      contrastRatio(activeStyles.color, activeStyles.backgroundColor),
    ).toBeGreaterThanOrEqual(4.5);

    await page.mouse.move(0, 0);
    const idleBackground = await inactiveLink.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await inactiveLink.hover();
    await expect
      .poll(() =>
        inactiveLink.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .not.toBe(idleBackground);

    await page.evaluate(() => {
      const focusedElement = document.activeElement;
      if (focusedElement instanceof HTMLElement) focusedElement.blur();
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Resume Changer home" }),
    ).toBeFocused();

    for (const destination of destinations) {
      await page.keyboard.press("Tab");
      const destinationLink = navigation.getByRole("link", {
        name: destination.label,
      });
      await expect(destinationLink).toBeFocused();

      if (destination.href === "/") {
        const focusStyles = await activeLink.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            outlineColor: style.outlineColor,
            outlineStyle: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
            backgroundColor: style.backgroundColor,
          };
        });
        expect(focusStyles.outlineStyle).toBe("solid");
        expect(focusStyles.outlineWidth).toBeGreaterThanOrEqual(3);
        expect(
          contrastRatio(focusStyles.outlineColor, focusStyles.backgroundColor),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  }
});

test("keeps sidebar rows contained across desktop, zoom-equivalent, and mobile widths", async ({
  page,
}) => {
  for (const width of [1440, 1152, 1024, 768, 720, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });

    if (width <= 700) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Navigation menu" }),
      ).toBeVisible();
    }
    await waitForAnimationsToSettle(page.locator(".app-frame"));

    const metrics = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
      const navigation =
        document.querySelector<HTMLElement>(".main-navigation")!;
      const sidebarRight = sidebar.getBoundingClientRect().right;
      const items = Array.from(
        navigation.querySelectorAll<HTMLElement>(".nav-link"),
      ).map((link) => {
        const label = link.lastElementChild as HTMLElement;
        const icon = link.querySelector("svg")!;
        const bounds = link.getBoundingClientRect();
        const labelBounds = label.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          height: bounds.height,
          top: bounds.top,
          bottom: bounds.bottom,
          gap: getComputedStyle(link).gap,
          labelRight: labelBounds.right,
          labelTop: labelBounds.top,
          labelBottom: labelBounds.bottom,
          labelVisible: labelBounds.width > 1 && labelBounds.height > 1,
          iconWidth: icon.getBoundingClientRect().width,
          iconHeight: icon.getBoundingClientRect().height,
        };
      });

      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        sidebarRight,
        collapsed: document
          .querySelector(".app-frame")!
          .classList.contains("is-sidebar-collapsed"),
        navigationWidth: navigation.clientWidth,
        navigationScrollWidth: navigation.scrollWidth,
        overflowX: getComputedStyle(navigation).overflowX,
        navRowGap: getComputedStyle(navigation).rowGap,
        navColumnGap: getComputedStyle(navigation).columnGap,
        activeLeft: document
          .querySelector(".nav-link.is-active")!
          .getBoundingClientRect().left,
        items,
      };
    });

    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.sidebarRight).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.items).toHaveLength(5);
    expect(metrics.navRowGap).toBe("8px");
    expect(metrics.navColumnGap).toBe("8px");
    expect(metrics.activeLeft).toBeGreaterThanOrEqual(0);
    if (metrics.collapsed) {
      // Collapsed-rail tooltips intentionally extend beyond the rail.
      expect(metrics.overflowX).toBe("visible");
    } else {
      expect(metrics.navigationScrollWidth).toBeLessThanOrEqual(
        metrics.navigationWidth,
      );
    }
    if (width <= 700) {
      expect(metrics.overflowX).toBe("visible");
    }

    for (const item of metrics.items) {
      expect(
        item.height,
        "row height at viewport " + width + "px",
      ).toBeGreaterThanOrEqual(48);
      expect(item.gap).toBe(metrics.collapsed ? "0px" : "12px");
      expect(item.iconWidth).toBe(20);
      expect(item.iconHeight).toBe(20);
      expect(item.labelVisible).toBe(!metrics.collapsed);
      if (item.labelVisible) {
        expect(item.labelRight).toBeLessThanOrEqual(item.right);
        expect(item.labelTop).toBeGreaterThanOrEqual(item.top);
        expect(item.labelBottom).toBeLessThanOrEqual(item.bottom);
      }
      expect(item.left).toBeGreaterThanOrEqual(0);
      expect(item.right).toBeLessThanOrEqual(metrics.sidebarRight);
    }
    if (width <= 700) {
      await page.getByRole("button", { name: "Close navigation" }).click();
      await expect(page.locator("#workspace-sidebar")).toBeHidden();
    }
  }
});
