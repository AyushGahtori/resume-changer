import { expect, test } from "@playwright/test";
import { openStudio } from "../helpers/studio-browser";
import { studioLibrary } from "../helpers/studio-fixtures";
import { studioMeasurements } from "../helpers/studio-fixtures";
import { studioGeneration } from "../helpers/studio-fixtures";

const pointId = studioLibrary.jobs[0].points[0].id;
const secondId = studioLibrary.jobs[0].points[1].id;

test("disables additions that cannot fit and re-enables them when space is freed", async ({
  page,
}) => {
  await openStudio(page);
  const measurements = {
    ...studioMeasurements,
    widths: Object.fromEntries(
      studioLibrary.skills.map((skill) => [skill.id, 40]),
    ),
    labelWidths: [0, 0],
    lineWidth: 100,
  };
  await page.route("**/api/resume/skills?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(measurements),
    }),
  );
  // Restore the applied resume into a fresh studio so its measurement request uses the constrained fixture.
  await page.reload();
  await page.getByRole("button", { name: "Restore editing session" }).click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByLabel("Search skills").fill("Python");
  const python = page.getByRole("button", {
    name: "Add Python to resume skills",
  });
  await expect(python).toBeDisabled();
  for (let index = 0; index < 12 && (await python.isDisabled()); index++) {
    await page.getByLabel("Search skills").fill("");
    await page.getByRole("button", { name: "Included", exact: true }).click();
    await page
      .locator('.studio-chip-list button[aria-pressed="true"]')
      .first()
      .click();
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByLabel("Search skills").fill("Python");
  }
  await expect(python).toBeEnabled();
  await python.click();
  await expect(
    page.getByRole("button", { name: "Remove Python from resume skills" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("applies skills independently and commits a new PDF only after success", async ({
  page,
}) => {
  await openStudio(page);
  const oldPdf = await page
    .getByTitle("Generated resume PDF")
    .getAttribute("src");
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    page.getByText("Measured using the LaTeX template.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Search skills").fill("Python");
  await page
    .getByRole("button", { name: "Add Python to resume skills" })
    .click();
  await expect(page.getByTitle("Generated resume PDF")).toHaveAttribute(
    "src",
    oldPdf!,
  );
  const pending = page.waitForRequest((request) =>
    request.url().endsWith("/api/resume/edit"),
  );
  await page.getByRole("button", { name: "Apply changes →" }).click();
  const request = await pending;
  expect(
    request
      .postDataJSON()
      .document.bullets.map((bullet: { id: string }) => bullet.id),
  ).toEqual([pointId, secondId]);
  expect(request.postDataJSON().document.skillIds).toContain("skill-python");
  await expect(
    page.getByText("Changes applied.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).not.toHaveAttribute(
    "src",
    oldPdf!,
  );
});

test("manual edits can be cancelled, staged, undone, redone, and retained after a failed apply", async ({
  page,
}) => {
  await openStudio(page);
  const oldPdf = await page
    .getByTitle("Generated resume PDF")
    .getAttribute("src");
  await page
    .getByRole("button", { name: `Edit achievement ${pointId}`, exact: true })
    .click();
  await page.getByLabel("Achievement text").fill("Cancelled wording.");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Cancelled wording.")).toHaveCount(0);
  await page
    .getByRole("button", { name: `Edit achievement ${pointId}`, exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("Reviewed manual achievement retained during compiler failure.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByText(
      "Reviewed manual achievement retained during compiler failure.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.route("**/api/resume/edit", (route) =>
    route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          "This draft has 2 pages. Your previous PDF and working draft are preserved.",
      }),
    }),
  );
  await page.getByRole("button", { name: "Apply changes →" }).click();
  await expect(
    page.locator('.resume-studio .studio-error[role="alert"]'),
  ).toContainText("2 pages");
  await expect(
    page.getByText(
      "Reviewed manual achievement retained during compiler failure.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toHaveAttribute(
    "src",
    oldPdf!,
  );
});

test("AI edits remain suggestions until accepted and expose service failures", async ({
  page,
}) => {
  await openStudio(page);
  await page.route("**/api/ai/achievement", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "A reviewed, concise platform achievement.",
        measuredLines: 1,
      }),
    }),
  );
  await page
    .getByRole("button", { name: `Edit achievement ${pointId} with AI` })
    .click();
  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith("/api/ai/achievement"),
  );
  await page.getByRole("button", { name: "✦ Ask Imagination" }).click();
  const body = (await requestPromise).postDataJSON();
  expect(body.sources).toHaveLength(1);
  expect(body).not.toHaveProperty("latex");
  expect(body).not.toHaveProperty("jobDescription");
  await expect(
    page.getByText("1 line confirmed by LaTeX.", { exact: false }),
  ).toBeVisible();
  await expect(
    page
      .locator(".studio-achievement-card")
      .filter({ hasText: "A reviewed, concise platform achievement." }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Accept draft" }).click();
  await expect(
    page
      .locator(".studio-achievement-card")
      .filter({ hasText: "A reviewed, concise platform achievement." }),
  ).toBeVisible();
  await page.route("**/api/ai/achievement", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Imagination is temporarily unavailable.",
      }),
    }),
  );
  await page
    .getByRole("button", { name: `Edit achievement ${pointId} with AI` })
    .click();
  await page.getByRole("button", { name: "✦ Ask Imagination" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page
      .locator(".studio-achievement-card")
      .filter({ hasText: "A reviewed, concise platform achievement." }),
  ).toBeVisible();
});

test("connects achievements by drag, preserves merge provenance, and supports undo", async ({
  page,
}) => {
  await openStudio(page);
  await page.route("**/api/ai/achievement", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "Combined verified platform evidence.",
        measuredLines: 1,
      }),
    }),
  );
  await page
    .getByLabel(`Connect achievement ${pointId} for merging`)
    .dragTo(page.getByLabel(`Connect achievement ${secondId} for merging`));
  await expect(page.locator(".studio-merge-svg path")).toHaveCount(2);
  await page.getByRole("button", { name: "Merge with Imagination ✦" }).click();
  await page.getByRole("button", { name: "✦ Ask Imagination" }).click();
  await page.getByRole("button", { name: "Accept draft" }).click();
  await expect(page.locator(".studio-achievement-card")).toHaveCount(1);
  await expect(page.locator(".studio-evidence")).toContainText(pointId);
  await expect(page.locator(".studio-evidence")).toContainText(secondId);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".studio-achievement-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".studio-achievement-card")).toHaveCount(1);
});

test("adds unused achievements and stages section choices", async ({
  page,
}) => {
  await openStudio(page);
  await page
    .getByRole("button", { name: "Available achievements", exact: true })
    .click();
  await page
    .getByLabel("Search available achievements")
    .fill(studioLibrary.jobs[0].points[2].text.slice(0, 35));
  await page.getByRole("button", { name: "+ Add to resume" }).click();
  await expect(page.locator(".studio-achievement-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Education & credentials", exact: true })
    .click();
  await page.getByLabel("Include Projects section").uncheck();
  await page.getByLabel("Include credentials").uncheck();
  const requestPromise = page.waitForRequest((request) =>
    request.url().endsWith("/api/resume/edit"),
  );
  await page.getByRole("button", { name: "Apply changes →" }).click();
  const body = (await requestPromise).postDataJSON();
  expect(body.document.sectionOrder).not.toContain("projects");
  expect(body.document.sectionOrder).not.toContain("credentials");
  expect(body.document.bullets).toHaveLength(3);
  await expect(
    page.getByText("Changes applied.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(
    page.getByText("Projects are hidden in the PDF.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Education & credentials", exact: true })
    .click();
  await page.getByLabel("Include skills", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    page.getByText("Skills are hidden in the PDF.", { exact: false }),
  ).toBeVisible();
});

test("restores pending edits after refresh without overwriting the saved PDF", async ({
  page,
}) => {
  await openStudio(page);
  await page
    .getByRole("button", { name: `Edit achievement ${pointId}`, exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("A recoverable draft after refresh.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(localStorage).some(
          (key) =>
            key.includes("studio-draft") &&
            localStorage
              .getItem(key)
              ?.includes("A recoverable draft after refresh."),
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Restore editing session" }).click();
  await page
    .getByRole("button", { name: "Restore draft", exact: true })
    .click();
  await expect(
    page.getByText("A recoverable draft after refresh.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTitle("Generated resume PDF")).toBeVisible();
});

test("drags unused achievements into compatible destinations and rejects wrong attribution", async ({
  page,
}) => {
  await openStudio(page);
  await page
    .getByRole("button", { name: "Available achievements", exact: true })
    .click();
  const point = studioLibrary.jobs[0].points[2];
  await page
    .getByLabel("Search available achievements")
    .fill(point.text.slice(0, 35));
  const card = page
    .locator(".studio-available-list article")
    .filter({ hasText: point.text });
  await card.dragTo(
    page.getByRole("region", {
      name: `Drop achievement into ${studioLibrary.jobs[1].title}`,
      exact: true,
    }),
  );
  await expect(page.locator(".resume-studio .studio-error")).toContainText(
    "original company or project",
  );
  await card.dragTo(page.locator(".studio-drop-destinations > div").first());
  await expect(page.locator(".studio-achievement-card")).toHaveCount(3);
});

test("reorders skill priority and moves a user-authored point without changing source attribution", async ({
  page,
}) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByText("Skill priority order", { exact: true }).click();
  const firstName = await page
    .locator(".studio-skill-order li span")
    .first()
    .innerText();
  await page
    .getByRole("button", {
      name: `Lower skill priority: ${firstName}`,
      exact: true,
    })
    .click();
  await expect(page.locator(".studio-skill-order li span").nth(1)).toHaveText(
    firstName,
  );
  await expect(
    page.getByRole("button", { name: "Apply changes →", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Achievements", exact: true }).click();
  await page
    .getByRole("button", { name: `Edit achievement ${pointId}`, exact: true })
    .click();
  await expect(page.getByLabel("Achievement destination")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "+ Add achievement", exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("User-authored work without connected source claims.");
  await page
    .getByRole("button", { name: "Save achievement", exact: true })
    .click();
  const authored = page
    .locator(".studio-achievement-card")
    .filter({ hasText: "User-authored work without connected source claims." });
  await authored
    .getByRole("button", { name: /^Edit achievement .*$/, exact: true })
    .first()
    .click();
  await page
    .getByLabel("Achievement destination")
    .selectOption(studioLibrary.jobs[1].id);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    page.locator(".studio-destination").filter({ has: authored }),
  ).toContainText(studioLibrary.jobs[1].company);
});

test("creates an achievement from selected context with a ten-item limit", async ({
  page,
}) => {
  await openStudio(page);
  await page
    .getByRole("button", { name: "+ Add achievement", exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("User-verified platform implementation.");
  for (const skill of studioLibrary.skills.slice(0, 10)) {
    await page.getByLabel("Search skill context").fill(skill.name);
    await page.getByRole("button", { name: skill.name, exact: true }).click();
  }
  await expect(page.getByText("10 / 10 connected")).toBeVisible();
  await page
    .getByLabel("Search skill context")
    .fill(studioLibrary.skills[10].name);
  await expect(
    page.getByRole("button", {
      name: studioLibrary.skills[10].name,
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByLabel("Search skill context")
    .fill(studioLibrary.skills[0].name);
  await page
    .getByRole("button", { name: studioLibrary.skills[0].name, exact: true })
    .click();
  await page
    .getByRole("button", {
      name: studioLibrary.jobs[0].points[0].text,
      exact: true,
    })
    .click();
  let context: Record<string, unknown> | undefined;
  await page.route("**/api/ai/achievement", (route) => {
    context = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "Reviewed contextual platform contribution.",
        measuredLines: 1,
      }),
    });
  });
  await page.getByRole("button", { name: "✦ Ask Imagination" }).click();
  await page.getByRole("button", { name: "Use suggestion in editor" }).click();
  await page.getByRole("button", { name: "Save achievement" }).click();
  expect(context?.skillIds).toHaveLength(9);
  expect(context?.sources).toHaveLength(1);
  await expect(
    page
      .getByText("Reviewed contextual platform contribution.", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.locator(".studio-achievement-card")).toHaveCount(3);
});

test("recovers unfinished creation and invalidates suggestions after context changes", async ({
  page,
}) => {
  await openStudio(page);
  await page
    .getByRole("button", { name: "+ Add achievement", exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("A recoverable unfinished writing draft.");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "+ Add achievement", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore writing draft", exact: true })
    .click();
  await expect(page.getByLabel("Achievement text")).toHaveValue(
    "A recoverable unfinished writing draft.",
  );
  await page.route("**/api/ai/achievement", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "Reviewed original context.",
        measuredLines: 1,
      }),
    }),
  );
  await page
    .getByRole("button", { name: "✦ Ask Imagination", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use suggestion in editor" }),
  ).toBeVisible();
  await page
    .getByLabel("Search skill context")
    .fill(studioLibrary.skills[0].name);
  await page
    .getByRole("button", { name: studioLibrary.skills[0].name, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use suggestion in editor" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("starts a fresh studio when generation is run again", async ({ page }) => {
  await openStudio(page);
  await page
    .getByRole("button", { name: `Edit achievement ${pointId}`, exact: true })
    .click();
  await page
    .getByLabel("Achievement text")
    .fill("Previous session pending wording.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...studioGeneration,
        latex: studioGeneration.latex + "\n% new generation",
        metadata: {
          ...studioGeneration.metadata,
          id: "regenerated-session",
          generatedBullets: studioGeneration.metadata.generatedBullets.map(
            (bullet, index) =>
              index
                ? bullet
                : { ...bullet, text: "Freshly generated achievement." },
          ),
        },
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Generation settings ↗", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate LaTeX", exact: true })
    .click();
  await expect(
    page
      .locator(".studio-achievement-card")
      .filter({ hasText: "Freshly generated achievement." }),
  ).toBeVisible();
  await expect(
    page.getByText("Previous session pending wording.", { exact: true }),
  ).toHaveCount(0);
});

test("keeps the studio and creation sheet usable on mobile and supports keyboard resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await openStudio(page);
  const resizer = page.getByRole("slider", { name: "Resize resume preview" });
  await resizer.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(resizer).toHaveAttribute("aria-valuenow", "45");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page
    .locator(".resume-studio")
    .screenshot({ path: test.info().outputPath("studio-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "+ Add achievement", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Imagination Canvas" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
  await page
    .getByRole("dialog")
    .screenshot({ path: test.info().outputPath("studio-mobile-canvas.png") });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
