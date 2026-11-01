import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDirectory = join(
  process.cwd(),
  "docs",
  "ui-review",
  "task-08-evidence-ui",
);

async function openEvidenceHarness(page: import("@playwright/test").Page) {
  await page.goto("/e2e/github-context-evidence");
  await expect(page.getByTestId("context-evidence-harness")).toBeVisible();
  await expect(page.getByTestId("github-context-evidence-ui")).toBeVisible();
}

test("inventory views preserve reason distinctions and never inspect excluded source", async ({
  page,
}) => {
  let apiRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests += 1;
  });
  await openEvidenceHarness(page);

  const panel = page.getByTestId("github-context-evidence-ui");
  await expect(panel.getByTestId("evidence-file-row")).toHaveCount(3);
  await panel
    .getByRole("button", { name: "View selected excerpt" })
    .first()
    .click();
  await expect(panel.getByTestId("evidence-source-preview")).toContainText(
    "0123456789ab…01234567",
  );
  await expect(panel.getByTestId("evidence-source-preview")).toContainText(
    "Lines 1–12",
  );

  await panel.getByRole("button", { name: /^Excluded/ }).click();
  await expect(panel.getByTestId("evidence-file-row")).toHaveCount(7);
  await expect(
    panel.getByText("Credential-like filename rule").first(),
  ).toBeVisible();
  await expect(
    panel.getByText(
      /does not mean the file contents were read or a credential was found/,
    ),
  ).toBeVisible();
  await expect(
    panel.getByText("Content screening detected a possible secret."),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /View selected excerpt/ }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: /Inspect source/ }),
  ).toHaveCount(0);
  await expect(panel.getByText("Metadata only").first()).toBeVisible();
  expect(apiRequests).toBe(0);
});

test("full bundle disables add accessibly and offers an explicit replacement flow", async ({
  page,
}) => {
  await openEvidenceHarness(page);
  await page.getByLabel("Choose evidence fixture state").selectOption("full");
  const panel = page.getByTestId("github-context-evidence-ui");
  await expect(panel.getByTestId("evidence-bundle-limit-notice")).toContainText(
    "has reached the 5-file limit",
  );
  await panel.getByRole("button", { name: /^Eligible/ }).click();
  const disabledAdd = panel.getByRole("button", {
    name: "Add src/auth/session.ts to selected evidence",
  });
  await expect(disabledAdd).toBeDisabled();
  await expect(disabledAdd).toHaveAttribute("aria-describedby");
  await expect(
    panel.getByText(
      /Remove a selected file before adding src\/auth\/session\.ts/,
    ),
  ).toBeAttached();

  await panel.getByRole("button", { name: "Replace…" }).first().click();
  await panel
    .getByLabel("Choose selected file to replace with src/auth/session.ts")
    .selectOption("overview-readme");
  await panel.getByRole("button", { name: "Replace selected file" }).click();
  await panel.getByRole("button", { name: /^Selected/ }).click();
  await expect(panel.getByText("src/auth/session.ts")).toBeVisible();
  await expect(panel.getByText("README.md")).toHaveCount(0);
  await panel
    .getByRole("button", {
      name: "Remove src/auth/session.ts from selected evidence",
    })
    .click();
  await panel.getByRole("button", { name: /^Eligible/ }).click();
  const freedSlotAdd = panel.getByRole("button", {
    name: "Add src/auth/session.ts to selected evidence",
  });
  await expect(freedSlotAdd).toBeEnabled();
  await freedSlotAdd.click();
  await panel.getByRole("button", { name: /^Selected/ }).click();
  await expect(panel.getByText("src/auth/session.ts")).toBeVisible();
});

test("stale and empty inventories show distinct next steps", async ({
  page,
}) => {
  await openEvidenceHarness(page);
  await page.getByLabel("Choose evidence fixture state").selectOption("stale");
  const panel = page.getByTestId("github-context-evidence-ui");
  await expect(panel.getByTestId("evidence-stale-notice")).toContainText(
    "Selection needs review",
  );
  await expect(panel.getByText(/older prepared bundle/)).toBeVisible();

  await page.getByLabel("Choose evidence fixture state").selectOption("empty");
  await expect(panel.getByText("No files are selected yet")).toBeVisible();
  await panel.getByRole("button", { name: /^All files/ }).click();
  await expect(
    panel.getByText("No repository files are available"),
  ).toBeVisible();
});

test("large inventories render bounded pages and keep search responsive", async ({
  page,
}) => {
  await openEvidenceHarness(page);
  await page.getByLabel("Choose evidence fixture state").selectOption("large");
  const panel = page.getByTestId("github-context-evidence-ui");
  await panel.getByRole("button", { name: /^All files/ }).click();
  await expect(panel.getByTestId("evidence-file-row")).toHaveCount(50);
  await expect(panel.getByText("Showing 1–50 of 10,000")).toBeVisible();
  await panel.getByRole("button", { name: "Next" }).click();
  await expect(panel.getByText("Showing 51–100 of 10,000")).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search repository evidence" })
    .fill("feature-09987");
  await expect(panel.getByTestId("evidence-file-row")).toHaveCount(1);
  await expect(
    panel.getByText("packages/feature-09987/src/module.ts"),
  ).toBeVisible();
});

test("keyboard controls work and reduced motion removes transitions", async ({
  page,
}) => {
  await openEvidenceHarness(page);
  const panel = page.getByTestId("github-context-evidence-ui");
  const eligibleFilter = panel.getByRole("button", { name: /^Eligible/ });
  await eligibleFilter.focus();
  await page.keyboard.press("Enter");
  await expect(eligibleFilter).toHaveAttribute("aria-pressed", "true");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionProperty = await panel
    .locator('[role="progressbar"] span')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionProperty);
  expect(transitionProperty).toBe("none");

  await page.setViewportSize({ width: 320, height: 740 });
  const interactiveHeights = await panel
    .locator("button, input, select")
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().height),
    );
  expect(interactiveHeights.length).toBeGreaterThan(0);
  expect(Math.min(...interactiveHeights)).toBeGreaterThanOrEqual(44);
});

test("captures both themes at the five required viewport widths", async ({
  page,
}) => {
  mkdirSync(screenshotDirectory, { recursive: true });
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ];

  await openEvidenceHarness(page);
  for (const theme of ["light", "dark"] as const) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(
        page.getByTestId("github-context-evidence-ui"),
      ).toBeVisible();
      await page.screenshot({
        path: join(
          screenshotDirectory,
          `${theme}-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(
        overflow,
        `${theme} at ${viewport.width}px should reflow without page overflow`,
      ).toBe(false);
    }
  }
});
