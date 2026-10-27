import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const widths = [1440, 1024, 768, 390, 320] as const;
const themes = ["light", "dark"] as const;
const screenshotDirectory = resolve(
  process.cwd(),
  "docs/ui-review/github/task-29",
);

type FixtureKind = "default" | "expanded" | "long" | "empty" | "error";

async function selectLayout(
  page: import("@playwright/test").Page,
  state: "setup" | "analysis" | "review" = "review",
) {
  await page.goto("/e2e/github-import");
  await page
    .getByRole("combobox", { name: "Choose GitHub import fixture" })
    .selectOption("layout-" + state);
  return page.getByTestId("github-import-layout");
}

async function setFixture(
  layout: import("@playwright/test").Locator,
  kind: FixtureKind,
) {
  await layout.evaluate((root, fixtureKind) => {
    const header = root.querySelector('[data-slot="header"]');
    const progress = root.querySelector('[data-slot="progress"]');
    const main = root.querySelector('[data-slot="main"]');
    const rail = root.querySelector('[data-slot="rail"]');
    const actions = root.querySelector('[data-slot="actions"]');

    if (!header || !progress || !main || !rail || !actions) {
      throw new Error("The layout fixture is missing a named slot.");
    }

    const panel = (title: string, body: string) => {
      const card = document.createElement("article");
      card.style.cssText =
        "margin: 0 0 12px; padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); color: var(--color-text-primary);";

      const heading = document.createElement("h2");
      heading.textContent = title;
      heading.style.cssText =
        "margin: 0 0 8px; font-size: 18px; line-height: 1.4;";

      const description = document.createElement("p");
      description.textContent = body;
      description.style.cssText =
        "margin: 0; color: var(--color-text-secondary); line-height: 1.5;";

      card.append(heading, description);
      main.append(card);
      return card;
    };

    const evidence = (parent: HTMLElement, open: boolean) => {
      const details = document.createElement("details");
      details.open = open;
      details.style.cssText =
        "margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border);";

      const summary = document.createElement("summary");
      summary.textContent = "Observed evidence · src/lib/data/writers.ts";
      summary.style.cssText =
        "cursor: pointer; color: var(--color-violet-strong);";

      const code = document.createElement("pre");
      code.textContent =
        "export function writeAchievementUpdate(input: ReviewedAchievement) {\n  const validated = AchievementUpdateSchema.parse(input);\n  return writeWithBackupAndLock(validated);\n}";
      code.style.cssText =
        "margin: 12px 0 0; padding: 12px; border-radius: 6px; background: var(--color-surface-alt); font: 12px/1.5 monospace;";

      details.append(summary, code);
      parent.append(details);
      return details;
    };

    header.replaceChildren();
    const title = document.createElement("h1");
    title.textContent =
      fixtureKind === "long"
        ? "Review " +
          "example-labs/" +
          "repository-with-a-deliberately-long-name-".repeat(7)
        : "Review GitHub project evidence";
    title.style.cssText =
      "margin: 0; font-family: Georgia, serif; line-height: 1.2;";
    header.append(title);

    progress.replaceChildren();
    const stepList = document.createElement("ol");
    stepList.style.cssText =
      "display: flex; flex-wrap: wrap; gap: 16px; margin: 0; padding: 0; list-style: none; color: var(--color-text-secondary);";
    for (const label of ["1. Set up", "2. Analyze", "3. Review and save"]) {
      const step = document.createElement("li");
      step.textContent = label;
      stepList.append(step);
    }
    progress.append(stepList);

    main.replaceChildren();
    if (fixtureKind === "empty") {
      const empty = document.createElement("p");
      empty.textContent = "No achievement drafts are ready to review.";
      main.append(empty);
    } else if (fixtureKind === "error") {
      const error = document.createElement("p");
      error.setAttribute("role", "alert");
      error.textContent =
        "We could not load this review. Your saved achievements are unchanged.";
      error.style.cssText =
        "margin: 0; padding: 16px; border-radius: 8px; background: var(--color-error-subtle); color: var(--color-error-strong);";
      main.append(error);
    } else {
      const firstCard = panel(
        "Implemented validated local achievement updates",
        "Added file locking, temporary writes and backup replacement to preserve data integrity.",
      );
      panel(
        "Built structured achievement writing boundaries",
        "Kept provider abstraction, evidence mapping and review behavior in separate modules.",
      );
      panel(
        "Integrated repository evidence review",
        fixtureKind === "long"
          ? "Source path: " +
              "apps/dashboard/src/nested-folder/".repeat(12) +
              "repository-summary-and-validation-details.tsx"
          : "Kept selected source excerpts beside the drafts they support.",
      );
      if (fixtureKind === "expanded") evidence(firstCard, true);
      if (fixtureKind === "default") evidence(firstCard, false);
      if (fixtureKind === "long") {
        evidence(firstCard, true);
        const lastCard = main.lastElementChild;
        if (lastCard instanceof HTMLElement) {
          const focusTarget = document.createElement("button");
          focusTarget.type = "button";
          focusTarget.setAttribute("data-testid", "last-card-control");
          focusTarget.textContent = "Review the final long evidence card";
          focusTarget.style.cssText =
            "min-height: 44px; margin-top: 12px; padding: 8px 12px; border: 1px solid var(--color-border-strong); border-radius: 6px; background: var(--color-surface); color: var(--color-text-primary);";
          lastCard.append(focusTarget);
        }
      }
    }

    rail.replaceChildren();
    const privacy = panel(
      "Privacy and boundaries",
      "Selected files are screened. Nothing is saved automatically.",
    );
    const runSummary = document.createElement("section");
    runSummary.style.cssText =
      "padding: 16px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface);";
    const summaryTitle = document.createElement("h2");
    summaryTitle.textContent = "Run summary";
    summaryTitle.style.cssText = "margin: 0 0 8px; font-size: 16px;";
    const summaryBody = document.createElement("p");
    summaryBody.textContent =
      fixtureKind === "long"
        ? "Repository: " +
          "example-labs/" +
          "repository-with-a-long-project-name-".repeat(6)
        : "Repository: example-labs/fictional-dashboard · 8 files · 3 PRs";
    summaryBody.style.cssText =
      "margin: 0; color: var(--color-text-secondary); line-height: 1.5;";
    runSummary.append(summaryTitle, summaryBody);
    rail.append(privacy, runSummary);

    actions.replaceChildren();
    for (const label of [
      "Save selected achievements",
      "Back to Achievement Library",
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText =
        "min-height: 44px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-violet); color: #fff; cursor: pointer;";
      actions.append(button);
    }
  }, kind);
}

async function setTheme(
  page: import("@playwright/test").Page,
  theme: (typeof themes)[number],
) {
  await page.evaluate((value) => {
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
}

test("keeps every slot readable at target widths and captures theme/state snapshots", async ({
  page,
}) => {
  test.setTimeout(180_000);
  mkdirSync(screenshotDirectory, { recursive: true });
  const layout = await selectLayout(page);

  for (const fixture of ["default", "expanded", "long"] as const) {
    await setFixture(layout, fixture);

    for (const theme of themes) {
      await setTheme(page, theme);

      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });

        const layoutMetrics = await layout.evaluate((root) => {
          const rect = (selector: string) => {
            const element = root.querySelector(selector);
            if (!element) return null;
            const bounds = element.getBoundingClientRect();
            return {
              x: bounds.x,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
              width: bounds.width,
              height: bounds.height,
            };
          };

          const rootBounds = root.getBoundingClientRect();
          return {
            rootRight: rootBounds.right,
            header: rect('[data-slot="header"]'),
            progress: rect('[data-slot="progress"]'),
            main: rect('[data-slot="main"]'),
            rail: rect('[data-slot="rail"]'),
            actions: rect('[data-slot="actions"]'),
            pageWidth: document.documentElement.scrollWidth,
          };
        });

        expect(layoutMetrics.pageWidth).toBeLessThanOrEqual(width);
        expect(layoutMetrics.rootRight).toBeLessThanOrEqual(width);
        expect(layoutMetrics.header?.height ?? 0).toBeGreaterThan(0);
        expect(layoutMetrics.progress?.height ?? 0).toBeGreaterThan(0);
        expect(layoutMetrics.main?.width ?? 0).toBeGreaterThan(0);
        expect(layoutMetrics.rail?.width ?? 0).toBeGreaterThan(0);
        expect(layoutMetrics.actions?.height ?? 0).toBeGreaterThan(0);
        expect(layoutMetrics.progress!.top).toBeGreaterThanOrEqual(
          layoutMetrics.header!.bottom,
        );
        expect(layoutMetrics.main!.top).toBeGreaterThanOrEqual(
          layoutMetrics.progress!.bottom,
        );
        expect(layoutMetrics.actions!.top).toBeGreaterThanOrEqual(
          layoutMetrics.rail!.bottom,
        );

        if (width <= 960) {
          expect(layoutMetrics.rail!.top).toBeGreaterThanOrEqual(
            layoutMetrics.main!.bottom - 1,
          );
        } else {
          expect(layoutMetrics.rail!.x).toBeGreaterThanOrEqual(
            layoutMetrics.main!.right,
          );
        }

        const screenshotPath = resolve(
          screenshotDirectory,
          fixture + "-" + theme + "-" + width + ".png",
        );
        await layout.screenshot({
          path: screenshotPath,
          animations: "disabled",
        });
      }
    }
  }
});

test("keeps empty and error content with summary and actions in the reading flow", async ({
  page,
}) => {
  const layout = await selectLayout(page);

  for (const fixture of ["empty", "error"] as const) {
    await setFixture(layout, fixture);
    await page.setViewportSize({ width: 390, height: 844 });

    if (fixture === "empty") {
      await expect(
        page.getByText("No achievement drafts are ready to review."),
      ).toBeVisible();
    } else {
      await expect(layout.getByRole("alert")).toBeVisible();
    }

    await expect(layout.locator('[data-slot="rail"]')).toBeVisible();
    await expect(layout.locator('[data-slot="actions"]')).toBeVisible();
    await expect(
      layout.getByRole("button", { name: "Save selected achievements" }),
    ).toBeVisible();
    const pageWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(pageWidth).toBeLessThanOrEqual(390);
  }
});

test("keeps the last card keyboard focus visible at 200 percent zoom", async ({
  page,
}) => {
  const layout = await selectLayout(page);
  await setFixture(layout, "long");
  await page.setViewportSize({ width: 720, height: 700 });
  await setTheme(page, "dark");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });

  await page
    .getByRole("combobox", { name: "Choose GitHub import fixture" })
    .focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  const focusTarget = layout.getByTestId("last-card-control");
  await expect(focusTarget).toBeFocused();

  const focusMetrics = await focusTarget.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      viewportHeight: window.innerHeight,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });

  expect(focusMetrics.top).toBeGreaterThanOrEqual(0);
  expect(focusMetrics.bottom).toBeLessThanOrEqual(focusMetrics.viewportHeight);
  expect(focusMetrics.outlineStyle).toBe("solid");
  expect(focusMetrics.outlineWidth).toBe("2px");
  expect(focusMetrics.pageWidth).toBeLessThanOrEqual(
    focusMetrics.viewportWidth,
  );
  await layout.screenshot({
    path: resolve(screenshotDirectory, "focus-200-percent-dark.png"),
    animations: "disabled",
  });
});
