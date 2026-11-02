import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const evidenceDirectory = resolve(
  process.cwd(),
  "docs/ui-review/github/task-26",
);

test("trust rail covers supported budget states responsively in both themes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  mkdirSync(evidenceDirectory, { recursive: true });

  const viewports = [
    { width: 1440, height: 1000 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 800 },
  ];

  for (const theme of ["light", "dark"] as const) {
    await page.goto("/e2e/github-import");
    await page.evaluate((selectedTheme) => {
      document.documentElement.dataset.theme = selectedTheme;
    }, theme);

    const fixturePicker = page.getByRole("combobox", {
      name: "Choose GitHub import fixture",
    });

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await fixturePicker.selectOption("trust-within-budget");
      const rail = page.getByTestId("github-import-trust-rail");
      await expect(rail).toBeVisible();
      await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
      await expect(
        page.getByText("Not included", { exact: true }),
      ).toBeVisible();
      await expect(page.getByTestId("trust-budget-status")).toHaveText(
        "Within configured limits",
      );

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(
        overflow,
        `${theme} ${viewport.width}px should not overflow horizontally`,
      ).toBe(false);

      await page.screenshot({
        path: resolve(
          evidenceDirectory,
          `${theme}-${viewport.width}-within-budget.png`,
        ),
        fullPage: true,
      });

      await fixturePicker.selectOption("trust-over-budget");
      await expect(page.getByTestId("trust-budget-status")).toHaveText(
        "Partial scope",
      );
      await expect(page.getByTestId("trust-save")).toBeDisabled();
      await expect(page.getByTestId("trust-save-status")).toContainText(
        "No selected drafts are eligible yet",
      );
      await page.screenshot({
        path: resolve(
          evidenceDirectory,
          `${theme}-${viewport.width}-partial-zero-eligible.png`,
        ),
        fullPage: true,
      });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await fixturePicker.selectOption("trust-within-budget");
    const details = page.locator("details summary");
    await details.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("details")).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await page.screenshot({
      path: resolve(
        evidenceDirectory,
        `${theme}-1440-budget-expanded-focus.png`,
      ),
      fullPage: true,
    });

    await page.getByTestId("trust-save").click();
    await expect(page.getByTestId("trust-save")).toBeDisabled();
    await expect(page.getByTestId("trust-save-status")).toContainText(
      "Saving the eligible selections",
    );
    await page.screenshot({
      path: resolve(evidenceDirectory, `${theme}-1440-pending-save.png`),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/e2e/github-import");
    await page.evaluate((selectedTheme) => {
      document.documentElement.dataset.theme = selectedTheme;
    }, theme);
    await page
      .getByRole("combobox", { name: "Choose GitHub import fixture" })
      .selectOption("trust-within-budget");
    await page.getByTestId("trust-discard").click();
    await expect(page.getByTestId("trust-confirm-discard")).toBeFocused();
    await expect(
      page.getByText(/already saved stay in your Achievement Library/),
    ).toBeVisible();
    await page.screenshot({
      path: resolve(evidenceDirectory, `${theme}-390-discard-confirmation.png`),
      fullPage: true,
    });
  }
});

test("back, save and staged discard remain separate actions", async ({
  page,
}) => {
  await page.goto("/e2e/github-import");
  await page
    .getByRole("combobox", { name: "Choose GitHub import fixture" })
    .selectOption("trust-within-budget");

  await page.getByTestId("trust-discard").click();
  await expect(page.getByTestId("trust-confirm-discard")).toBeVisible();
  await page.getByRole("button", { name: "Keep drafts" }).click();
  await expect(page.getByTestId("trust-confirm-discard")).toHaveCount(0);

  await page.getByTestId("trust-back").click();
  await expect(page.getByTestId("github-import-trust-rail")).toBeVisible();
  await expect(page.getByTestId("trust-save-status")).not.toContainText(
    "Saving",
  );
});
