import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDirectory = join(
  process.cwd(),
  "docs",
  "ui-review",
  "task-23-evidence",
);

async function chooseEvidenceCase(
  page: import("@playwright/test").Page,
  caseId: "evidence-safe" | "evidence-blocked" | "evidence-manual",
) {
  await page
    .getByRole("combobox", { name: "Choose GitHub import fixture" })
    .selectOption(caseId);
  await expect(page.getByTestId("github-evidence-panel")).toBeVisible();
}

test("Task 23 disclosure, search, inspection and selection edits stay local", async ({
  page,
}) => {
  let apiRequests = 0;
  await page.route("**/api/**", async (route) => {
    apiRequests += 1;
    await route.continue();
  });
  await page.goto("/e2e/github-import");
  await chooseEvidenceCase(page, "evidence-safe");

  const panel = page.getByTestId("github-evidence-panel");
  const disclosure = panel.locator(":scope > details");
  const summary = disclosure.locator(":scope > summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");

  const search = page.getByRole("searchbox", {
    name: "Search repository files",
  });
  await search.fill("summary.ts");
  await expect(panel.locator("[data-file-id]")).toHaveCount(1);
  await expect(
    page.getByRole("button", {
      name: "Inspect source apps/dashboard/src/summary.ts",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Inspect source apps/dashboard/src/summary.ts",
    })
    .click();
  await expect(
    panel.getByRole("heading", { name: "Source excerpts" }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: "Remove apps/dashboard/src/summary.ts from the selected files",
    })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "Selection change staged",
  );
  expect(apiRequests).toBe(0);
});

test("Task 23 distinguishes blocked files from safe pinned files", async ({
  page,
}) => {
  await page.goto("/e2e/github-import");
  await chooseEvidenceCase(page, "evidence-blocked");

  const panel = page.getByTestId("github-evidence-panel");
  await panel.locator(":scope > details > summary").click();
  await expect(
    panel.getByText("Blocked by the safety rule", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cannot add config/.env.example" }),
  ).toBeDisabled();
  await expect(
    panel.getByRole("heading", { name: "Partial scope and limitations" }),
  ).toBeVisible();

  await chooseEvidenceCase(page, "evidence-manual");
  await page
    .getByTestId("github-evidence-panel")
    .locator(":scope > details")
    .evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
  await expect(panel.getByText("Pinned by you", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Remove apps/dashboard/test/summary.test.ts from the selected files",
    }),
  ).toBeEnabled();
});

test("Task 23 layout snapshots cover both themes and required responsive widths", async ({
  page,
}) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.goto("/e2e/github-import");
  await chooseEvidenceCase(page, "evidence-safe");

  const widths = [1440, 1024, 768, 390, 320];
  for (const theme of ["light", "dark"] as const) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 500 ? 820 : 960 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);

      const disclosure = page
        .getByTestId("github-evidence-panel")
        .locator(":scope > details");
      await disclosure.evaluate((element) => {
        (element as HTMLDetailsElement).open = false;
      });
      await expect(disclosure).not.toHaveAttribute("open", "");
      await page.screenshot({
        path: join(screenshotDirectory, `${theme}-collapsed-${width}.png`),
        fullPage: true,
      });

      await disclosure.locator(":scope > summary").click();
      await expect(disclosure).toHaveAttribute("open", "");
      const documentWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(documentWidth).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: join(screenshotDirectory, `${theme}-expanded-${width}.png`),
        fullPage: true,
      });

      const search = page.getByRole("searchbox", {
        name: "Search repository files",
      });
      const summary = disclosure.locator(":scope > summary");
      await disclosure.evaluate((element) => {
        (element as HTMLDetailsElement).open = false;
      });
      await summary.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      await expect(search).toBeFocused();
      expect(
        await search.evaluate((input) => input.matches(":focus-visible")),
      ).toBe(true);
      await page.screenshot({
        path: join(screenshotDirectory, `${theme}-keyboard-focus-${width}.png`),
        fullPage: true,
      });
    }
  }
});

test("Task 23 blocked and pinned states remain readable on desktop and mobile", async ({
  page,
}) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  await page.goto("/e2e/github-import");

  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 820 : 960 });
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      for (const state of ["evidence-blocked", "evidence-manual"] as const) {
        await chooseEvidenceCase(page, state);
        const disclosure = page
          .getByTestId("github-evidence-panel")
          .locator(":scope > details");
        await disclosure.evaluate((element) => {
          (element as HTMLDetailsElement).open = false;
        });
        await disclosure.locator(":scope > summary").click();
        await expect(disclosure).toHaveAttribute("open", "");
        await page.screenshot({
          path: join(
            screenshotDirectory,
            `${theme}-${state.replace("evidence-", "")}-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
  }
});
