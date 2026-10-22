import { expect, test } from "@playwright/test";

/**
 * Task 29 coverage for the achievement card surface.
 *
 * A card has to carry the point's identity, its evidence and its state
 * without the reader having to open anything, so each part is checked on
 * its own and the parts that are easy to confuse - the tag and the skill,
 * the status and the source - are checked to stay distinct.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/library?source=demo");
});

test("shows the identity, the text and the state of a point", async ({
  page,
}) => {
  const card = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });

  await expect(card.locator("code")).toHaveText(
    "achievement-service-capacity-design",
  );
  await expect(card.locator(".library-point-text")).toHaveText(
    "Redesigned service boundaries and capacity planning for a multi-tenant processing platform.",
  );
  await expect(card.locator(".point-status")).toHaveText("Enabled");
});

test("keeps the provenance of a point inspectable", async ({ page }) => {
  const card = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });

  await expect(card.locator(".point-provenance")).toContainText(
    "Source: project-document",
  );
  await expect(card.locator(".point-provenance")).toContainText(
    "Synthetic demo scenario",
  );
});

test("shows a metric with its value, its evidence and its context", async ({
  page,
}) => {
  const card = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });
  const metrics = card.getByRole("list", { name: "Achievement metrics" });

  await expect(metrics).toBeVisible();
  await expect(metrics.locator("li")).toHaveCount(1);
  await expect(metrics.locator(".point-metric-label")).toHaveText(
    "Throughput improvement",
  );
  await expect(metrics.locator(".point-metric-value")).toHaveText("28%");
  await expect(metrics.locator("li")).toContainText(
    "The fictional demo benchmark records 28% higher throughput after the service-boundary redesign.",
  );
  await expect(metrics.locator("li")).toContainText(
    "Synthetic benchmark scenario",
  );
});

test("keeps tags and linked skills distinct", async ({ page }) => {
  const card = page
    .locator(".library-point")
    .filter({ hasText: "achievement-ci-cd-pipeline" });
  const facets = card.locator(".point-facets");

  await expect(facets.locator(".facet-chip:not(.is-skill)")).toHaveCount(3);
  await expect(facets.locator(".facet-chip.is-skill")).toHaveCount(2);
  await expect(facets.getByRole("button", { name: "#ci-cd" })).toBeVisible();
  await expect(
    facets.getByRole("button", { name: "GitHub Actions" }),
  ).toBeVisible();
});

test("leaves a point without metrics without a metric list", async ({
  page,
}) => {
  const card = page
    .locator(".library-point")
    .filter({ hasText: "achievement-ci-cd-pipeline" });

  await expect(card.locator(".point-metrics")).toHaveCount(0);
});

test("offers the edit action on the personal route", async ({ page }) => {
  await page.goto("/library");

  const card = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("shows the skills and the credentials of the library", async ({
  page,
}) => {
  const secondary = page.getByRole("region", {
    name: "Skills and credentials",
  });
  const skills = secondary.locator("details").first();
  const credentials = secondary.locator("details").nth(1);

  await skills.locator("summary").click();
  await expect(skills.locator(".skill-list li")).toHaveCount(14);
  await expect(skills.getByText("System Design")).toBeVisible();
  await expect(skills.getByText("On current resume").first()).toBeVisible();
  await expect(skills.getByText("Library only").first()).toBeVisible();

  await credentials.locator("summary").click();
  await expect(credentials.locator(".credential-list li")).toHaveCount(2);
  await expect(
    credentials.getByText("Cloud Deployment Foundations (Demo)"),
  ).toBeVisible();
});
