import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("Task 28 shows ready, read, and expired import inbox actions", async ({
  page,
}) => {
  await page.goto("/e2e/github-import");
  const selector = page.getByRole("combobox", {
    name: "Choose GitHub import fixture",
  });

  await selector.selectOption("notifications-unread");
  await expect(page.getByTestId("github-import-notifications")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Project analysis finished — review achievements",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Draft achievements are ready for your review. They have not been saved.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mark as read" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Review" })).toHaveAttribute(
    "href",
    "/library/github/summary-import",
  );

  await selector.selectOption("notifications-read");
  await expect(page.getByText("Read", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark as read" })).toHaveCount(
    0,
  );

  await selector.selectOption("notifications-expired");
  await expect(
    page.getByRole("heading", { name: "The review window has expired" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Start again" })).toHaveAttribute(
    "href",
    "/library/github/new?projectId=fictional-dashboard-project&restart=1",
  );
  await expect(page.getByText(/staged result expired/i)).toBeVisible();
});

test("Task 28 keeps GitHub attachment personal-only in the existing library", async ({
  page,
}) => {
  const libraryNavigationLink = () =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Achievement library", exact: true });

  await page.goto("/library");
  await expect(libraryNavigationLink()).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "Attach GitHub to QueueBoard" }),
  ).toHaveAttribute("href", "/library/github/new?projectId=project-queueboard");

  await page.goto("/library?source=demo");
  await expect(libraryNavigationLink()).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: /^Attach GitHub to / }),
  ).toHaveCount(0);
  await expect(page.getByTestId("github-import-notifications")).toHaveCount(0);

  await page.goto("/library/imagination?source=demo");
  await expect(libraryNavigationLink()).toHaveAttribute("aria-current", "page");
});

test("Task 28 activity inbox stays usable across themes and narrow widths", async ({
  page,
}) => {
  await page.goto("/e2e/github-import");
  await page
    .getByRole("combobox", { name: "Choose GitHub import fixture" })
    .selectOption("notifications-multiple");

  const inbox = page.getByTestId("github-import-notifications");
  await expect(inbox).toBeVisible();
  await expect(inbox.locator("article[data-import-id]")).toHaveCount(2);
  await expect(inbox.locator("article[data-notification-id]")).toHaveCount(4);
  await expect(
    inbox.getByText("Long Cross Platform Data Processing Project").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark as read" }).first().focus();

  const screenshotDirectory = join(
    process.cwd(),
    "docs",
    "ui-review",
    "github-task-28",
  );
  await mkdir(screenshotDirectory, { recursive: true });

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);

    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      await page.mouse.move(width - 2, 4);
      await inbox.screenshot({
        path: join(screenshotDirectory, `t28-${theme}-${width}-activity.png`),
        animations: "disabled",
      });
    }
  }
});
