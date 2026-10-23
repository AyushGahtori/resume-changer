import { expect, test } from "@playwright/test";

const switchSelector = ".library-source-switch";

test("marks the personal source as current on the default route", async ({
  page,
}) => {
  await page.goto("/library");

  const myData = page.getByRole("link", { name: "My data" });
  const demoData = page.getByRole("link", { name: "Demo data" });

  await expect(myData).toHaveAttribute("href", "/library");
  await expect(demoData).toHaveAttribute("href", "/library?source=demo");
  await expect(myData).toHaveAttribute("aria-current", "page");
  await expect(demoData).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByText("My resume data")).toBeVisible();
});

test("navigates between the sources and keeps the selection in sync", async ({
  page,
}) => {
  await page.goto("/library");

  await page.getByRole("link", { name: "Demo data" }).click();
  await expect(page).toHaveURL(/\/library\?source=demo$/);
  await expect(page.getByRole("link", { name: "Demo data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "My data" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Fictional demo data")).toBeVisible();

  await page.getByRole("link", { name: "My data" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("link", { name: "My data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("My resume data")).toBeVisible();
});

test("keeps the selected source after a direct load and a reload", async ({
  page,
}) => {
  await page.goto("/library?source=demo");
  await expect(page.getByRole("link", { name: "Demo data" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.reload();
  await expect(page.getByRole("link", { name: "Demo data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: "My data" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Fictional demo data")).toBeVisible();
});

test("restores the selected source with browser back and forward", async ({
  page,
}) => {
  await page.goto("/library");
  await page.getByRole("link", { name: "Demo data" }).click();
  await expect(page).toHaveURL(/\/library\?source=demo$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole("link", { name: "My data" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.goForward();
  await expect(page).toHaveURL(/\/library\?source=demo$/);
  await expect(page.getByRole("link", { name: "Demo data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("activates a source link with the keyboard and shows a focus ring", async ({
  page,
}) => {
  await page.goto("/library");

  const demoData = page.getByRole("link", { name: "Demo data" });
  await demoData.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/library\?source=demo$/);
  await expect(page.getByRole("link", { name: "Demo data" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // A keyboard round trip puts the control in :focus-visible state.
  const myData = page.getByRole("link", { name: "My data" });
  await myData.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(myData).toBeFocused();
  await expect(myData).toHaveCSS("outline-width", "2px");
  await expect(myData).toHaveCSS("outline-style", "solid");
});

test("marks the demo source as read-only without relying on colour alone", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add achievement" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Detailed entry" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);

  await page.goto("/library");
  await expect(page.getByText("Read-only", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add achievement" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Detailed entry" }),
  ).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`renders a segmented control with a visible selected segment in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("resume-changer.theme.v1", selectedTheme);
    }, theme);
    await page.goto("/library?source=demo");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const control = page.locator(switchSelector);
    const selected = control.getByRole("link", { name: "Demo data" });
    const inactive = control.getByRole("link", { name: "My data" });

    await expect(control).toHaveCSS("border-radius", "6px");

    const controlBox = await control.boundingBox();
    expect(controlBox?.height).toBeGreaterThanOrEqual(36);
    expect(controlBox?.height).toBeLessThanOrEqual(40);

    const surfaces = await page.evaluate(
      ([switchSelector, selectedLabel]) => {
        const switchElement = document.querySelector(switchSelector);
        const selectedElement = Array.from(
          switchElement?.querySelectorAll("a") ?? [],
        ).find((link) => link.textContent?.trim() === selectedLabel);
        const inactiveElement = Array.from(
          switchElement?.querySelectorAll("a") ?? [],
        ).find((link) => link.textContent?.trim() !== selectedLabel);
        if (!switchElement || !selectedElement || !inactiveElement) {
          return null;
        }
        return {
          track: getComputedStyle(switchElement).backgroundColor,
          selected: getComputedStyle(selectedElement).backgroundColor,
          inactive: getComputedStyle(inactiveElement).backgroundColor,
          selectedBorder: getComputedStyle(selectedElement).borderTopColor,
          trackBorder: getComputedStyle(switchElement).borderTopColor,
        };
      },
      [switchSelector, "Demo data"],
    );

    expect(surfaces).not.toBeNull();
    expect(surfaces?.selected).not.toBe(surfaces?.track);
    expect(surfaces?.inactive).not.toBe(surfaces?.selected);
    expect(surfaces?.selectedBorder).not.toBe(surfaces?.trackBorder);
  });
}

test("keeps the source switch usable on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/library?source=demo");

  await expect(page.getByRole("link", { name: "Demo data" })).toBeVisible();
  await expect(page.getByText("Read-only", { exact: true })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
});

test("renders the shared source control the same way on the generate page", async ({
  page,
}) => {
  await page.goto("/generate?source=demo");

  const sourceSelector = ".builder-source-switch";
  const control = page.locator(sourceSelector);
  await expect(control).toHaveCSS("border-radius", "6px");
  await expect(
    control.getByRole("link", { name: "Demo data" }),
  ).toHaveAttribute("aria-current", "page");

  const surfaces = await page.evaluate((selector) => {
    const switchElement = document.querySelector(selector);
    const selectedElement = switchElement?.querySelector(
      "a[aria-current='page']",
    );
    if (!switchElement || !selectedElement) return null;
    return {
      track: getComputedStyle(switchElement).backgroundColor,
      selected: getComputedStyle(selectedElement).backgroundColor,
    };
  }, sourceSelector);

  expect(surfaces).not.toBeNull();
  expect(surfaces?.selected).not.toBe(surfaces?.track);
});
