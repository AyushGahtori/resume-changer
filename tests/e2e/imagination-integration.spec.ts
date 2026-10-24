import { expect, test, type Page } from "@playwright/test";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ResumeLibrary } from "../../src/lib/schemas/resume-data";

const libraryPath = () =>
  join(process.env.RESUME_LIBRARY_ROOT!, "data", "resume-library.json");
let library: ResumeLibrary;

test.beforeEach(async ({ page }) => {
  await copyFile(
    join(process.cwd(), "examples/sample-resume-library.json"),
    libraryPath(),
  );
  library = JSON.parse(await readFile(libraryPath(), "utf8"));
  await page.goto("/library/imagination");
  await expect(
    page.getByRole("heading", { name: "Imagination Canvas", exact: true }),
  ).toBeVisible();
});

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "New achievement", exact: true });
const evidence = (page: Page) =>
  page.getByRole("region", { name: "Achievements", exact: true });
const connections = (page: Page) =>
  page.getByRole("region", { name: "Evidence connection canvas" });

test("all six modes reach generation without replacing the custom instruction", async ({
  page,
}) => {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/ai/achievement", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: { text: "Built reliable platform services.", measuredLines: 2 },
    });
  });
  await editor(page).fill("Built reliable platform services.");
  const instruction = page.getByRole("textbox", { name: "Your instruction" });
  await instruction.fill(
    "Preserve my platform work and keep the wording clear.",
  );
  const modes = [
    ["Make shorter", "make_shorter"],
    ["More technical", "more_technical"],
    ["Improve clarity", "improve_clarity"],
    ["Emphasize engineering impact", "emphasize_engineering_impact"],
    ["Improve action verbs", "improve_action_verbs"],
    ["Reduce repetition", "reduce_repetition"],
  ];
  for (const [label, mode] of modes) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(instruction).toHaveValue(
      "Preserve my platform work and keep the wording clear.",
    );
    await page
      .getByRole("button", { name: "Ask Imagination", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Suggestion text" }),
    ).toHaveValue("Built reliable platform services.");
    expect(requests.at(-1)).toMatchObject({
      writingMode: mode,
      instruction: "Preserve my platform work and keep the wording clear.",
      targetLines: 2,
      operation: "create",
    });
  }
});

test("reviews the suggestion, saves only editor text and retains source/skill attribution", async ({
  page,
  request,
}) => {
  const historyBefore = await (await request.get("/api/history")).json();
  const point = library.jobs[0].points.find((point) => point.enabled)!;
  const skill = library.skills[0];
  await evidence(page)
    .getByRole("button", { name: point.text, exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Search declared skills" })
    .fill(skill.name);
  await page
    .getByRole("region", { name: "Connected skills", exact: true })
    .getByRole("button", { name: skill.name, exact: true })
    .click();
  let generatedBody: Record<string, unknown> = {};
  await page.route("**/api/ai/achievement", async (route) => {
    generatedBody = route.request().postDataJSON();
    await route.fulfill({
      json: {
        text: "Built reliable platform services from connected evidence.",
        measuredLines: 2,
      },
    });
  });
  await page
    .getByRole("button", { name: "Ask Imagination", exact: true })
    .click();
  const suggestion = page.getByRole("textbox", { name: "Suggestion text" });
  await expect(suggestion).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save achievement", exact: true }),
  ).toBeDisabled();
  expect(generatedBody).toMatchObject({
    skillIds: [skill.id],
    sources: [
      { id: point.id, text: point.text, sourceAchievementIds: [point.id] },
    ],
  });
  await expect(
    page.getByLabel("Measured by LaTeX: 2 lines", { exact: true }),
  ).toBeVisible();
  await suggestion.fill("Reviewed platform services wording.");
  await expect(
    page.getByLabel("Measured by LaTeX: 2 lines", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Use suggestion in editor", exact: true })
    .click();
  await expect(editor(page)).toBeFocused();
  await editor(page).fill("The reviewed achievement actually being saved.");
  await page
    .getByRole("button", { name: "Save achievement", exact: true })
    .click();
  await expect(page).toHaveURL(/\/library$/);
  const saved: ResumeLibrary = JSON.parse(
    await readFile(libraryPath(), "utf8"),
  );
  const added = saved.jobs[0].points.find(
    (item) => item.text === "The reviewed achievement actually being saved.",
  )!;
  expect(added).toBeTruthy();
  expect(added.skillIds).toEqual([skill.id]);
  expect(JSON.parse(added.source.reference!)).toMatchObject({
    sourceAchievementIds: [point.id],
    skillIds: [skill.id],
  });
  expect(await (await request.get("/api/history")).json()).toEqual(
    historyBefore,
  );
  await page.goto("/library/imagination");
  await expect(
    page.getByRole("button", { name: "Restore writing draft" }),
  ).toHaveCount(0);
});

test("restores the draft/mode and reconciles destination context without losing skills", async ({
  page,
}) => {
  await editor(page).fill("My unfinished draft.");
  await page
    .getByRole("button", { name: "More technical", exact: true })
    .click();
  await evidence(page).getByRole("button").first().click();
  const skill = library.skills[0];
  await page
    .getByRole("searchbox", { name: "Search declared skills" })
    .fill(skill.name);
  await page
    .getByRole("region", { name: "Connected skills", exact: true })
    .getByRole("button", { name: skill.name, exact: true })
    .click();
  await page.reload();
  await page.getByRole("button", { name: "Restore writing draft" }).click();
  await expect(editor(page)).toHaveValue("My unfinished draft.");
  await expect(
    page.getByRole("button", { name: "More technical", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(connections(page)).toContainText("2 / 10 connected");
  await page
    .getByLabel("Resume destination", { exact: true })
    .selectOption(library.jobs[1].id);
  await expect(connections(page)).toContainText("1 / 10 connected");
  await expect(connections(page)).toContainText(skill.name);
  await expect(
    evidence(page).getByRole("button", { pressed: true }),
  ).toHaveCount(0);
});

test("drag/drop, duplicates, maximum selection, and live paths share the same state", async ({
  page,
}) => {
  const first = evidence(page).getByRole("button").first();
  await first.dragTo(connections(page));
  await expect(connections(page)).toContainText("1 / 10 connected");
  await first.dragTo(connections(page));
  await expect(connections(page)).toContainText("1 / 10 connected");
  const remaining = library.skills.slice(0, 9);
  for (const skill of remaining) {
    await page
      .getByRole("searchbox", { name: "Search declared skills" })
      .fill(skill.name);
    await page
      .getByRole("region", { name: "Connected skills", exact: true })
      .getByRole("button", { name: skill.name, exact: true })
      .click();
  }
  await expect(connections(page)).toContainText("10 / 10 connected");
  await expect(connections(page).locator("svg > g > path")).toHaveCount(10);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(connections(page).locator("svg > g > circle")).toHaveCount(10);
  const aligned = await connections(page).evaluate((element) => {
    const svg = element.querySelector("svg > g")?.parentElement;
    if (!svg) return false;
    const box = svg.getBoundingClientRect();
    const circles = Array.from(svg.querySelectorAll("circle"));
    const chips = Array.from(
      element.querySelectorAll('button[aria-label^="Remove connected"]'),
    ).map((button) => button.parentElement!.getBoundingClientRect());
    return circles.every(
      (circle, index) =>
        Math.abs(
          Number(circle.getAttribute("cx")) -
            (chips[index].left + chips[index].width / 2 - box.left),
        ) < 2 &&
        Math.abs(
          Number(circle.getAttribute("cy")) - (chips[index].top - box.top),
        ) < 2,
    );
  });
  expect(aligned).toBe(true);
  await connections(page).getByRole("button").first().click();
  await expect(connections(page)).toContainText("9 / 10 connected");
});

test("generation error, cancellation and unmeasured results preserve the editor", async ({
  page,
}) => {
  await editor(page).fill("A draft I must not lose.");
  let attempt = 0;
  await page.route("**/api/ai/achievement", async (route) => {
    if (++attempt === 1)
      await route.fulfill({
        status: 503,
        json: { error: "Temporary test outage." },
      });
    else
      await route.fulfill({
        json: { text: "A reviewed suggestion.", measuredLines: null },
      });
  });
  await page
    .getByRole("button", { name: "Ask Imagination", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Imagined version" }).getByRole("alert"),
  ).toContainText("Temporary test outage.");
  await expect(editor(page)).toHaveValue("A draft I must not lose.");
  await page.getByRole("button", { name: "Regenerate", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Suggestion text" }),
  ).toHaveValue("A reviewed suggestion.");
  await expect(
    page.getByText(
      "Estimated until compiled. Final fit will be checked on Apply.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel(/Measured by LaTeX/)).toHaveCount(0);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText(/Clipboard unavailable/)).toBeVisible();
});
