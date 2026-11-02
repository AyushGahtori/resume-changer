import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const screenshotRoot = join(
  process.cwd(),
  "docs",
  "ui-review",
  "github",
  "task-25",
);
const reviewWidths = [1440, 1024, 768, 390, 320] as const;
const themes = ["light", "dark"] as const;

async function chooseCase(page: Page, caseId: string) {
  await page.goto("/e2e/github-import");
  await page.getByLabel("Choose GitHub import fixture").selectOption(caseId);
  await expect(page.getByTestId("measurement-fields")).toBeVisible();
}

async function selectMetric(page: Page, metricId: string) {
  await page.getByLabel("Measurement definition").selectOption(metricId);
}

test("Task 25 measurement branches render at desktop and mobile sizes in both themes", async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir(screenshotRoot, { recursive: true });

  const scenarios = [
    "web-result",
    "ml-result",
    "comparison-invalid",
    "target",
    "skip",
    "recipe",
  ] as const;

  for (const scenario of scenarios) {
    for (const theme of themes) {
      for (const width of reviewWidths) {
        await page.setViewportSize({ width, height: 1000 });
        let scenarioPage = page;
        let isolatedContext: Awaited<
          ReturnType<typeof browser.newContext>
        > | null = null;
        if (scenario === "ml-result") {
          isolatedContext = await browser.newContext({
            viewport: { width, height: 1000 },
          });
          scenarioPage = await isolatedContext.newPage();
          await scenarioPage.route(
            "**/_next/static/chunks/app/e2e/github-import/**",
            async (route) => {
              const response = await route.fetch();
              const source = await response.text();
              // Change only this isolated browser's test bundle. The shared
              // fixed fixture then represents an unnamed 0.92 score, forcing
              // the UI to ask for its ML definition before treating it as a
              // result.
              const transformed = source
                .replace(
                  'originalValues:[245],originalUnits:["ms"],definitionId:"web-api-latency-p95"',
                  'originalValues:[0.92],originalUnits:["fraction"],definitionId:null',
                )
                .replace(
                  'required:!1,definitionId:"web-api-latency-p95",choices:["Measured result","Skip","Defer"]',
                  'required:!1,definitionId:null,choices:["Measured result","Skip","Defer"]',
                );
              if (transformed === source) {
                throw new Error(
                  "Could not prepare the isolated ML browser fixture.",
                );
              }
              await route.fulfill({ response, body: transformed });
            },
          );
          await scenarioPage.goto("/e2e/github-import");
          await scenarioPage
            .getByLabel("Choose GitHub import fixture")
            .selectOption("measurement-result");
          await expect(
            scenarioPage.getByText(/A score such as 0.92 is ambiguous/i),
          ).toBeVisible();
          await scenarioPage
            .getByRole("button", { name: "Change answer" })
            .click();
          await scenarioPage
            .getByRole("button", { name: "Measured result" })
            .click();
          await selectMetric(scenarioPage, "metric-ml-classification-macro-f1");
          await expect(
            scenarioPage
              .getByText(/macro-F1 score/i)
              .filter({ visible: true })
              .first(),
          ).toBeVisible();
        } else if (scenario === "web-result") {
          await chooseCase(scenarioPage, "measurement-result");
          await expect(
            scenarioPage.getByText(/p95 API latency/i).first(),
          ).toBeVisible();
          await expect(
            scenarioPage.getByText(/not end-to-end browser latency/i),
          ).toBeVisible();
          await scenarioPage
            .getByLabel("Endpoint or operation")
            .fill("/api/publish");
          await scenarioPage
            .getByLabel("Workload or dataset size")
            .fill("10 requests per second");
          await scenarioPage
            .getByLabel("Environment and conditions")
            .fill("repeatable synthetic load test");
          await scenarioPage
            .getByLabel("How was this measured?")
            .fill("Synthetic load-test report, run 14");
          await expect(
            scenarioPage.getByTestId("measurement-local-preview"),
          ).toBeVisible();
        } else if (scenario === "comparison-invalid") {
          await chooseCase(scenarioPage, "measurement-result");
          await scenarioPage
            .getByRole("button", { name: "Add a comparable baseline" })
            .click();
          await scenarioPage
            .getByRole("spinbutton", { name: "Baseline" })
            .fill("-1");
          await scenarioPage
            .getByLabel("Endpoint or operation")
            .fill("/api/publish");
          await scenarioPage
            .getByLabel("Workload or dataset size")
            .fill("10 requests per second");
          await scenarioPage
            .getByLabel("Environment and conditions")
            .fill("repeatable synthetic load test");
          await scenarioPage
            .getByLabel("How was this measured?")
            .fill("Synthetic run 14");
          await expect(
            scenarioPage.getByText(/normalized value must be between/i).first(),
          ).toBeVisible();
          await expect(
            scenarioPage.getByRole("button", { name: "Preview measurement" }),
          ).toBeDisabled();
        } else if (scenario === "target") {
          await chooseCase(scenarioPage, "measurement-target");
          await expect(
            scenarioPage.getByTestId("measurement-target-state"),
          ).toBeVisible();
          await expect(
            scenarioPage.getByTestId("measurement-server-preview"),
          ).toHaveCount(0);
        } else if (scenario === "skip") {
          await chooseCase(scenarioPage, "measurement-skip");
          await expect(
            scenarioPage.getByTestId("measurement-skip-state"),
          ).toBeVisible();
        } else {
          await chooseCase(scenarioPage, "measurement-result");
          await scenarioPage
            .getByRole("button", { name: "Change answer" })
            .click();
          await scenarioPage.getByRole("button", { name: "Defer" }).click();
          await expect(
            scenarioPage.getByTestId("measurement-recipe"),
          ).toBeVisible();
        }

        await scenarioPage.evaluate((selectedTheme) => {
          if (selectedTheme === "dark") {
            document.documentElement.dataset.theme = "dark";
          } else {
            delete document.documentElement.dataset.theme;
          }
        }, theme);
        await scenarioPage.setViewportSize({ width, height: 1000 });
        const component = scenarioPage.getByTestId("measurement-fields");
        await expect(component).toBeVisible();
        await component.screenshot({
          path: join(screenshotRoot, `${scenario}-${theme}-${width}.png`),
          animations: "disabled",
        });
        await isolatedContext?.close();
      }
    }
  }

  await chooseCase(page, "measurement-result");
  await page.getByLabel("Choose GitHub import fixture").focus();
  await page.keyboard.press("Tab");
  const component = page.getByTestId("measurement-fields");
  const focused = component.locator(":focus-visible");
  await expect(focused).toBeVisible();
  await component.screenshot({
    path: join(screenshotRoot, "keyboard-focus-light-1440.png"),
    animations: "disabled",
  });
});
