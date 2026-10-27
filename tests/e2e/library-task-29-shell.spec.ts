import { expect, test } from "@playwright/test";

/**
 * Task 29 coverage for the library shell.
 *
 * The library is a page inside the shared workspace shell, so the frame, the
 * source switch and the way the page loads are part of the library's own
 * behaviour and are checked here rather than in the page-specific specs.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("frames the library inside the shared workspace shell", async ({
  page,
}) => {
  await expect(
    page.getByRole("heading", { name: "Achievement library", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("YOUR EXPERIENCE")).toBeVisible();
  await expect(
    page.getByText("Browse the resume information saved in this workspace."),
  ).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Achievement library" }),
  ).toHaveAttribute("aria-current", "page");
});

test("names the library summary and the search region", async ({ page }) => {
  await expect(
    page.getByRole("region", { name: "Library summary" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Search and filter library" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Skills and credentials" }),
  ).toBeVisible();
});

test("marks the source the reader is looking at", async ({ page }) => {
  const source = page.locator(".library-source-switch");
  await expect(source).toBeVisible();
  await expect(source.getByRole("link", { name: "Demo data" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(source.getByRole("link", { name: "My data" })).toHaveAttribute(
    "href",
    "/library",
  );
});

for (const source of ["demo", "personal"] as const) {
  test(`loads ${source} without a console error or a failed request`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const errorResponses: string[] = [];
    const failedRequests: string[] = [];
    const activityRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/(github\/|library\/notifications)/.test(request.url()))
        activityRequests.push(request.url());
    });

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        errorResponses.push(`${response.status()} ${response.url()}`);
      }
    });
    page.on("requestfailed", (request) => {
      /*
       * The shell prefetches the other routes, and the browser cancels a
       * prefetch that is no longer needed. A cancelled prefetch is not a
       * failure of the page, so only the other failures are collected.
       */
      const reason = request.failure()?.errorText ?? "";
      if (reason.includes("ERR_ABORTED")) return;
      failedRequests.push(`${request.method()} ${request.url()} ${reason}`);
    });

    await page.goto(source === "demo" ? "/library?source=demo" : "/library", {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: "Achievement library", level: 1 }),
    ).toBeVisible();

    if (source === "demo" || process.env.GITHUB_IMPORT_E2E_BACKEND !== "1")
      expect(activityRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(errorResponses).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
}

test("keeps the shell navigation reachable from the keyboard", async ({
  page,
}) => {
  const source = page.locator(".library-source-switch");
  const demo = source.getByRole("link", { name: "Demo data" });
  await demo.focus();
  await expect(demo).toBeFocused();
  expect(
    await demo.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
});

test("offers the add and detailed-entry controls on the personal route", async ({
  page,
}) => {
  await page.goto("/library");

  const toolbar = page.locator(".library-edit-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Detailed entry" }),
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Add achievement", exact: true }),
  ).toBeVisible();

  /*
   * The demo library is read-only, so the same controls must not be offered
   * there. The reader is looking at a sample, not at data they own.
   */
  await page.goto("/library?source=demo");
  await expect(page.locator(".library-edit-toolbar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add achievement", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
});
