import { expect, test } from "@playwright/test";
import { JD_URL_EXTRACTION_ROUTE } from "../../src/lib/jd-url-extraction";

/**
 * Task 17 of docs/UI_Tasks_home.md.
 *
 * The plan allows a "Paste from URL" action next to the job-description
 * metrics only when an approved safe extraction capability exists. This build
 * has none, so the control must be absent rather than rendered as a dead
 * enabled button, and the page must never request a user-supplied URL.
 */

test("omits the paste-from-URL control while no extraction service exists", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator(".input-metrics")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Paste from URL" }),
  ).toHaveCount(0);
  await expect(page.getByText("Paste from URL")).toHaveCount(0);
});

test("never requests a user-supplied job URL from the page", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      !url.startsWith("http://127.0.0.1:") &&
      !url.startsWith("http://localhost:")
    ) {
      externalRequests.push(url);
    }
    await route.continue();
  });

  await page.goto("/");

  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable fictional services for a synthetic team.");

  await page
    .getByRole("textbox", { name: "Job link", exact: true })
    .fill("https://careers.example.com/job/42");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator(".form-save-feedback")).toContainText(
    "Draft saved in this browser",
  );

  expect(externalRequests).toEqual([]);
});

test("does not expose the extraction route to the browser", async ({
  page,
}) => {
  const extractionRequests: string[] = [];
  await page.route("**/*", async (route) => {
    if (route.request().url().includes(JD_URL_EXTRACTION_ROUTE)) {
      extractionRequests.push(route.request().url());
    }
    await route.continue();
  });

  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable fictional services for a synthetic team.");

  expect(extractionRequests).toEqual([]);
});

test("keeps the metrics row readable without the URL action", async ({
  page,
}) => {
  await page.goto("/");

  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill("Build reliable fictional services for a synthetic team.");

  await expect(page.locator(".input-metrics")).toContainText(
    "/ 30,000 characters",
  );
  await expect(page.locator(".input-metrics")).toContainText("tokens");
});

for (const theme of ["light", "dark"] as const) {
  test(`keeps the metrics row free of overflow in ${theme} mode`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("resume-changer.theme.v1", value);
    }, theme);
    await page.goto("/");

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
      { width: 390, height: 844 },
      { width: 320, height: 720 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => {
        const footer = document.querySelector(".form-footer")!;
        const metrics = document.querySelector(".input-metrics")!;
        const footerBox = footer.getBoundingClientRect();
        const metricsBox = metrics.getBoundingClientRect();
        return {
          footerOverflow: footer.scrollWidth - footer.clientWidth,
          documentOverflow: document.documentElement.scrollWidth - innerWidth,
          metricsRight: metricsBox.right,
          footerRight: footerBox.right,
          metricsLeft: metricsBox.left,
          footerLeft: footerBox.left,
        };
      });

      expect(geometry.footerOverflow).toBeLessThanOrEqual(0);
      expect(geometry.documentOverflow).toBeLessThanOrEqual(0);
      expect(geometry.metricsLeft).toBeGreaterThanOrEqual(
        geometry.footerLeft - 1,
      );
      expect(geometry.metricsRight).toBeLessThanOrEqual(
        geometry.footerRight + 1,
      );
    }
  });
}
