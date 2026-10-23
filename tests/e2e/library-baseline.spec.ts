import { expect, test } from "@playwright/test";

/**
 * Task 01 baseline coverage for the Achievement Library.
 *
 * These assertions describe the library as it exists before the visual
 * redesign. They lock in the facts the redesign must keep: the reading
 * order, the library-wide summary counts, the point anatomy, the facet
 * chip behaviour, and the read-only rule for demo data.
 */
test.describe("achievement library baseline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library?source=demo");
  });

  test("keeps the page reading order and landmarks", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "Achievement library" }),
    ).toBeVisible();
    await expect(page.locator(".library-heading .eyebrow")).toHaveText(
      "YOUR EXPERIENCE",
    );
    await expect(
      page.getByText("Browse the resume information saved in this workspace."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByText("Achievement library"),
    ).toHaveAttribute("aria-current", "page");

    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".library-page > *")).map(
        (element) => String(element.className).split(" ")[0],
      ),
    );
    expect(order).toEqual([
      "library-page-header",
      "library-notice",
      "library-overview",
      "library-controls",
      "library-content",
    ]);
  });

  test("reports library-wide summary counts that ignore the filters", async ({
    page,
  }) => {
    await expect(page.getByRole("term")).toHaveText([
      "Jobs",
      "Projects",
      "Points",
      "Skills",
      "Credentials",
    ]);
    await expect(page.getByRole("definition")).toHaveText([
      "2",
      "2",
      "13",
      "14",
      "2",
    ]);
    await expect(page.getByText("13 of 13 achievement points")).toBeVisible();

    await page.getByLabel("Point status").selectOption("disabled");

    await expect(
      page.getByText(
        "None of the 13 achievements in this library match the current search and filters.",
      ),
    ).toBeVisible();
    await expect(page.getByText("0 of 13 achievement points")).toBeVisible();
    await expect(page.getByRole("definition")).toHaveText([
      "2",
      "2",
      "13",
      "14",
      "2",
    ]);
  });

  test("shows status, provenance, metric evidence, and distinct chips", async ({
    page,
  }) => {
    const point = page
      .locator(".library-point")
      .filter({ hasText: "achievement-service-capacity-design" });

    await expect(point.locator(".point-status")).toHaveText("Enabled");
    await expect(point.locator(".point-provenance")).toContainText("Source:");
    await expect(point.locator(".point-provenance")).toContainText(
      "project-document",
    );
    await expect(point.locator(".point-metrics")).toContainText(
      "Throughput improvement",
    );
    await expect(point.locator(".point-metrics")).toContainText("28%");
    await expect(point.locator(".point-metrics")).toContainText(
      "Synthetic benchmark scenario",
    );
    await expect(
      point.getByRole("button", { name: "Filter by #system-design" }),
    ).toBeVisible();
    await expect(
      point.getByRole("button", { name: "Filter by skill System Design" }),
    ).toBeVisible();

    await point
      .getByRole("button", { name: "Filter by skill System Design" })
      .click();
    await expect(page.getByLabel("Linked skill")).toHaveValue(
      "skill-system-design",
    );
  });

  test("lists skills and credentials with their real counts", async ({
    page,
  }) => {
    const details = page.locator(".library-detail");
    await expect(details.nth(0).locator(".library-section-count")).toHaveText(
      "14",
    );
    await expect(details.nth(1).locator(".library-section-count")).toHaveText(
      "2",
    );

    await details.nth(0).locator("summary").click();
    await expect(page.locator(".skill-list li")).toHaveCount(14);
    await expect(page.locator(".skill-listed").first()).toHaveText(
      "On current resume",
    );
    await expect(page.locator(".skill-unlisted").first()).toHaveText(
      "Library only",
    );

    await details.nth(1).locator("summary").click();
    await expect(page.locator(".credential-list li")).toHaveCount(2);
    await expect(
      page.getByText("Cloud Deployment Foundations (Demo)"),
    ).toBeVisible();
  });

  test("shows the group kind, title, and date range", async ({ page }) => {
    const job = page
      .locator(".experience-group")
      .filter({ hasText: "Platform Engineer" });
    await expect(job).toHaveAttribute("aria-label", "Job: Platform Engineer");
    await expect(job.locator(".experience-kind")).toHaveText("JOB");
    await expect(job.locator(".experience-subtitle")).toHaveText(
      "Example Cloud Labs",
    );
    await expect(job.locator(".experience-dates")).toHaveText(
      /Jan 2023\s+–\s+Present/,
    );

    const project = page
      .locator(".experience-group")
      .filter({ hasText: "QueueBoard" });
    await expect(project).toHaveAttribute("aria-label", "Project: QueueBoard");
    await expect(project.locator(".experience-kind")).toHaveText("PROJECT");
    await expect(project.locator(".experience-dates")).toHaveText(
      /Feb 2024\s+–\s+Aug 2024/,
    );
  });

  test("keeps the demo source read-only and labelled", async ({ page }) => {
    await expect(page.getByText("Fictional demo data")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add achievement" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Detailed entry" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "My data" })).toHaveAttribute(
      "href",
      "/library",
    );
  });

  test("keeps the personal route editable with both creation actions", async ({
    page,
  }) => {
    await page.goto("/library");

    await expect(page.getByText("My resume data")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Detailed entry" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add achievement" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "My data" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
