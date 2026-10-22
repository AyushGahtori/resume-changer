import { expect, test } from "@playwright/test";
import { copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const libraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");
const personalLibraryPath = join(libraryRoot, "data", "resume-library.json");

test.beforeEach(async ({ page }) => {
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    personalLibraryPath,
  );
  await page.goto("/library");
});

test("keeps every experience group with its own context and points", async ({
  page,
}) => {
  const job = page.getByRole("region", { name: "Job: Platform Engineer" });
  await expect(
    job.getByRole("heading", { name: "Platform Engineer" }),
  ).toBeVisible();
  await expect(job.getByText("Example Cloud Labs")).toBeVisible();
  await expect(job.getByText("01/2023 – Present")).toBeVisible();
  await expect(job.locator(".library-point")).toHaveCount(4);
  await expect(job.locator(".library-point-heading code").first()).toHaveText(
    "achievement-service-capacity-design",
  );

  const project = page.getByRole("region", { name: "Project: QueueBoard" });
  await expect(
    project.getByText("Backend and platform developer"),
  ).toBeVisible();
  await expect(project.getByText("02/2024 – 08/2024")).toBeVisible();
  await expect(project.locator(".library-point")).toHaveCount(3);
});

test("reveals the whole detail set of an achievement in its card", async ({
  page,
}) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });

  await expect(point.locator(".library-point-text")).toHaveText(
    "Redesigned service boundaries and capacity planning for a multi-tenant processing platform.",
  );
  await expect(point.locator(".point-provenance")).toContainText(
    "Source: project-document",
  );

  const metric = point.locator(".point-metrics li");
  await expect(metric).toHaveCount(1);
  await expect(metric.locator("strong")).toHaveText(
    "Throughput improvement: 28 %",
  );
  await expect(metric).toContainText(
    "The fictional demo benchmark records 28% higher throughput after the service-boundary redesign.",
  );
  await expect(metric).toContainText("Synthetic benchmark scenario");

  await expect(
    point.getByRole("button", { name: "#system-design" }),
  ).toBeVisible();
  await expect(
    point.getByRole("button", { name: "#scalability" }),
  ).toBeVisible();
  await expect(
    point.getByRole("button", { name: "System Design" }),
  ).toBeVisible();
  await expect(
    point.getByRole("button", { name: "Amazon Web Services" }),
  ).toBeVisible();
  await expect(point.locator(".point-status")).toHaveText("Enabled");
});

test("opens the editor inside the card it belongs to", async ({ page }) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });

  await point.getByRole("button", { name: "Edit" }).click();

  const editor = point.locator(".point-editor");
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("heading", { name: "Edit achievement" }),
  ).toBeVisible();
  await expect(page.locator(".library-point .point-editor")).toHaveCount(1);
  await expect(editor.getByLabel("Achievement ID")).toHaveCount(0);
  await expect(editor.getByLabel("Achievement text")).toHaveValue(
    "Redesigned service boundaries and capacity planning for a multi-tenant processing platform.",
  );
});

test("keeps the editor on the same card surface without a second card", async ({
  page,
}) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-service-capacity-design" });
  await point.getByRole("button", { name: "Edit" }).click();

  const styles = await point.locator(".point-editor").evaluate((element) => {
    const editor = getComputedStyle(element);
    const card = getComputedStyle(element.closest(".library-point")!);
    return {
      editorBackground: editor.backgroundColor,
      editorShadow: editor.boxShadow,
      editorBorderTop: editor.borderTopWidth,
      cardBackground: card.backgroundColor,
    };
  });

  expect(styles.editorBackground).toBe("rgba(0, 0, 0, 0)");
  expect(styles.editorShadow).toBe("none");
  expect(styles.editorBorderTop).toBe("1px");
  expect(styles.cardBackground).toBe(styles.editorBackground);
});

test("opens the editor from the keyboard and returns focus to its control", async ({
  page,
}) => {
  const point = page
    .locator(".library-point")
    .filter({ hasText: "achievement-ci-cd-pipeline" });
  const edit = point.getByRole("button", { name: "Edit" });

  await edit.focus();
  await expect(edit).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(point.locator(".point-editor")).toBeVisible();
  await expect(page.getByLabel("Achievement text")).toBeFocused();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(point.locator(".point-editor")).toHaveCount(0);
  await expect(edit).toBeFocused();
});

test("keeps the demo source read-only and labelled fictional", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  await expect(page.locator(".source-indicator")).toHaveText(
    "Fictional demo data",
  );
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add achievement", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Detailed entry" }),
  ).toHaveCount(0);
  await expect(page.locator(".point-editor")).toHaveCount(0);

  // The read-only source still shows every detail of each achievement.
  await expect(page.locator(".library-point")).toHaveCount(13);
  await expect(page.locator(".point-provenance").first()).toContainText(
    "Source: project-document",
  );
});
