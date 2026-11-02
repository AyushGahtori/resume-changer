import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const cases = [
  { id: "status-queued", state: "queued", title: "Analysis is queued" },
  { id: "status-running", state: "analyzing", title: "Analyzing your project" },
  {
    id: "status-ready",
    state: "ready-to-review",
    title: "Analysis ready to review",
  },
  { id: "status-failed", state: "failed", title: "Analysis couldn’t finish" },
  {
    id: "status-interrupted",
    state: "interrupted",
    title: "Analysis was interrupted",
  },
] as const;

const viewportWidths = [1440, 1024, 768, 390, 320];
const themes = ["light", "dark"] as const;

test("analysis status remains readable across themes and target widths", async ({
  page,
}) => {
  const screenshotDirectory = resolve(
    process.cwd(),
    "docs/ui-review/github/task-27",
  );
  await mkdir(screenshotDirectory, { recursive: true });
  await page.goto("/e2e/github-import");
  await expect(page.getByTestId("github-import-harness-root")).toBeVisible();

  const selector = page.getByRole("combobox", {
    name: "Choose GitHub import fixture",
  });

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });

    for (const theme of themes) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);

      for (const statusCase of cases) {
        await selector.selectOption(statusCase.id);
        const component = page.locator(`[data-state="${statusCase.state}"]`);

        await expect(component).toBeVisible();
        await expect(
          component.getByRole("heading", { name: statusCase.title }),
        ).toBeVisible();
        await expect(
          component.getByRole("link", { name: "Back to library" }),
        ).toBeVisible();
        await expect(
          component.getByRole("button", { name: "Cancel analysis" }),
        ).toBeVisible();
        await expect(component.getByRole("progressbar")).toHaveCount(0);
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          )
          .toBe(true);

        await component.screenshot({
          path: resolve(
            screenshotDirectory,
            `${statusCase.state}-${theme}-${width}.png`,
          ),
        });
      }
    }
  }
});
