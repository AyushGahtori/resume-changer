import { expect, test } from "@playwright/test";

test("loads the personal canvas route directly and after refresh", async ({
  page,
}) => {
  await page.goto("/library/imagination");

  const canvas = page.getByRole("heading", {
    name: "Imagination Canvas",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".library-page")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Achievement library" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Workspace");
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Achievement library");
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toContainText("Imagination Canvas");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas", exact: true }),
  ).toBeVisible();
});

test("keeps the demo source read-only on direct navigation and refresh", async ({
  page,
}) => {
  await page.goto("/library/imagination?source=demo");

  await expect(page).toHaveURL(/\/library\/imagination\?source=demo$/);
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas" }),
  ).toBeVisible();
  await expect(page.getByText(/Demo data is read-only/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save achievement" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Back to Achievement library" }),
  ).toHaveAttribute("href", "/library?source=demo");

  await page.reload();
  await expect(page).toHaveURL(/\/library\/imagination\?source=demo$/);
  await expect(page.getByText(/Demo data is read-only/)).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`keeps the workspace shell in ${theme} mode on the canvas route`, async ({
    page,
  }) => {
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("resume-changer.theme.v1", selectedTheme);
    }, theme);
    await page.goto("/library/imagination");

    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Imagination Canvas", exact: true }),
    ).toBeVisible();
  });
}
