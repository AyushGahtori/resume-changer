import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const screenshotDirectory = join(
  process.cwd(),
  ".runtime",
  "github-setup",
  "task-22",
);

async function openFixture(
  page: import("@playwright/test").Page,
  fixtureId: string,
) {
  await page.goto("/e2e/github-import");
  await expect(page.getByTestId("github-import-harness-root")).toBeVisible();
  await expect(
    page.getByText(
      "Synthetic fixtures only. No GitHub, provider, filesystem, or approval calls.",
    ),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Choose GitHub import fixture" })
    .selectOption(fixtureId);
  await expect(page.getByTestId("github-import-harness-case")).toHaveAttribute(
    "data-case-id",
    fixtureId,
  );
}

async function setTheme(
  page: import("@playwright/test").Page,
  theme: "light" | "dark",
) {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
}

function setupSection(page: import("@playwright/test").Page) {
  return page.locator("section[data-readiness]");
}

test("setup stays readable at review widths in both themes", async ({
  page,
}) => {
  await mkdir(screenshotDirectory, { recursive: true });
  const featureRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(?:github|ai|generate)(?:\/|\?|$)/.test(request.url())) {
      featureRequests.push(request.url());
    }
  });
  await openFixture(page, "setup-ready");
  await expect(
    page.getByRole("heading", { name: "Import GitHub project evidence" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Repository", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Achievement Library project")).toBeVisible();
  await expect(page.getByLabel("Your role on this project")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue without PR scope" }),
  ).toBeVisible();

  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1050 });
      await expectNoHorizontalOverflow(page);
      await setupSection(page).screenshot({
        path: join(screenshotDirectory, `t22-${theme}-${width}-public.png`),
      });
    }

    await page.setViewportSize({ width: 1440, height: 1050 });
    await page
      .getByRole("combobox", { name: "Choose GitHub import fixture" })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("combobox", { name: "Repository", exact: true }),
    ).toBeFocused();
    await setupSection(page).screenshot({
      path: join(screenshotDirectory, `t22-${theme}-1440-keyboard-focus.png`),
    });
  }

  expect(featureRequests).toEqual([]);
});

test("empty and denied setup states keep repository access truthful", async ({
  page,
}) => {
  await mkdir(screenshotDirectory, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 390]) {
      await openFixture(page, "setup-empty");
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 1050 });
      await expect(
        page.getByRole("combobox", { name: "Repository", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("combobox", { name: "Repository", exact: true }),
      ).toContainText("No repositories available yet");
      await expectNoHorizontalOverflow(page);
      await setupSection(page).screenshot({
        path: join(screenshotDirectory, `t22-${theme}-${width}-empty.png`),
      });

      await openFixture(page, "setup-private-denied");
      await setTheme(page, theme);
      await expect(
        page.getByText("Access denied", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Review GitHub access" }).first(),
      ).toBeVisible();
      await expect(page.getByText(/coming soon/i)).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await setupSection(page).screenshot({
        path: join(
          screenshotDirectory,
          `t22-${theme}-${width}-private-denied.png`,
        ),
      });
    }
  }
});

test("keyboard selection invokes no analysis or network request by itself", async ({
  page,
}) => {
  const featureRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(?:github|ai|generate)(?:\/|\?|$)/.test(request.url())) {
      featureRequests.push(request.url());
    }
  });
  await openFixture(page, "setup-ready");

  await page
    .getByRole("combobox", { name: "Choose GitHub import fixture" })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", { name: "Repository", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: /on GitHub \(opens in a new tab\)/ }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Achievement Library project")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Your role on this project")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: /#17 Add project summary/ }),
  ).toBeFocused();
  await page.keyboard.press("Space");

  expect(featureRequests).toEqual([]);
});
