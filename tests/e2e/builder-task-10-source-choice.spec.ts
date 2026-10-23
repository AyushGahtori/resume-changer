import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Task 10 covers the source choice in the resume builder: the segmented
 * control that decides which library the builder actually loads.
 *
 * The personal library and the demo library hold the same sample data in the
 * browser suite, so the source is proven by what the page says it is using
 * and by a personal library that is deliberately different. The personal file
 * is put back after every test, so the shared fixture stays clean.
 */
const dataRoot = process.env.RESUME_LIBRARY_ROOT ?? "";
const libraryFile = join(dataRoot, "data", "resume-library.json");
const sampleLibraryFile = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);

const EXTRA_POINT = {
  id: "achievement-personal-only-marker",
  text: "Maintained a personal-only library fixture that the demo library does not carry.",
  tags: ["fixture"],
  skillIds: ["skill-system-design"],
  metrics: [],
  source: { type: "user-notes", label: "Synthetic fixture" },
  enabled: true,
};

/*
 * A synthetic saved job description, so the job context card shows a real row
 * without loading anybody's own draft.
 */
const DRAFT = {
  schemaVersion: 1,
  jobDescription: "Build reliable AWS platform services.",
  company: "Example Cloud",
  roleTitle: "Platform Engineer",
  jobUrl: "",
};

function sourceSwitch(page: Page) {
  return page.getByRole("navigation", { name: "Resume data source" });
}

function personalLink(page: Page) {
  return sourceSwitch(page).getByRole("link", { name: "My data", exact: true });
}

function demoLink(page: Page) {
  return sourceSwitch(page).getByRole("link", {
    name: "Demo data",
    exact: true,
  });
}

async function seedDraft(page: Page) {
  await page.addInitScript((draft) => {
    try {
      window.localStorage.setItem(
        "resume-changer.jd-draft.v1",
        JSON.stringify(draft),
      );
    } catch {
      // The page still renders the empty job context.
    }
  }, DRAFT);
}

async function writePersonalLibraryWithAnExtraPoint() {
  const library = JSON.parse(await readFile(sampleLibraryFile, "utf8"));
  library.jobs[0].points.push(EXTRA_POINT);
  await mkdir(join(dataRoot, "data"), { recursive: true });
  await writeFile(libraryFile, JSON.stringify(library, null, 2), "utf8");
}

async function restoreSampleLibrary() {
  await mkdir(join(dataRoot, "data"), { recursive: true });
  await copyFile(sampleLibraryFile, libraryFile);
}

test.describe("the resume builder source choice", () => {
  test("marks the loaded source as the current one on a direct load", async ({
    page,
  }) => {
    await page.goto("/generate");
    await expect(personalLink(page)).toHaveAttribute("aria-current", "page");
    await expect(demoLink(page)).not.toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Using your local resume data")).toBeVisible();

    await page.goto("/generate?source=demo");
    await expect(demoLink(page)).toHaveAttribute("aria-current", "page");
    await expect(personalLink(page)).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByText("Using fictional demo data")).toBeVisible();
  });

  test("loads the other source when the other segment is chosen", async ({
    page,
  }) => {
    await page.goto("/generate?source=demo");
    await Promise.all([
      page.waitForURL("**/generate"),
      personalLink(page).click(),
    ]);
    await expect(page).toHaveURL(/\/generate$/);
    await expect(page.getByText("Using your local resume data")).toBeVisible();
    await expect(personalLink(page)).toHaveAttribute("aria-current", "page");
    await expect(demoLink(page)).not.toHaveAttribute("aria-current", "page");
  });

  test("keeps the chosen source after a refresh", async ({ page }) => {
    await page.goto("/generate?source=demo");
    await page.reload();
    await expect(demoLink(page)).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Using fictional demo data")).toBeVisible();
  });

  test("returns to the source that was loaded when the history moves", async ({
    page,
  }) => {
    await page.goto("/generate");
    await Promise.all([
      page.waitForURL("**/generate?source=demo"),
      demoLink(page).click(),
    ]);
    await expect(demoLink(page)).toHaveAttribute("aria-current", "page");

    await page.goBack();
    await expect(page).toHaveURL(/\/generate$/);
    await expect(personalLink(page)).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Using your local resume data")).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/generate\?source=demo$/);
    await expect(demoLink(page)).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Using fictional demo data")).toBeVisible();
  });

  test("activates a source from the keyboard", async ({ page }) => {
    await page.goto("/generate");
    await personalLink(page).focus();
    await page.keyboard.press("Tab");
    await expect(demoLink(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/generate?source=demo");
    await expect(demoLink(page)).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Using fictional demo data")).toBeVisible();
  });

  test("shows a visible focus ring on the focused segment", async ({
    page,
  }) => {
    await page.goto("/generate");
    await personalLink(page).focus();
    await page.keyboard.press("Tab");
    await expect(demoLink(page)).toBeFocused();
    const outlineWidth = await demoLink(page).evaluate(
      (element) => getComputedStyle(element).outlineWidth,
    );
    expect(Number.parseFloat(outlineWidth)).toBeGreaterThan(0);
  });

  test("marks the segment under the pointer and the one being pressed", async ({
    page,
  }) => {
    await page.goto("/generate");
    const demo = demoLink(page);
    const resting = await demo.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await demo.hover();
    await expect
      .poll(async () =>
        demo.evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .not.toBe(resting);
    const hovered = await demo.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );

    await page.mouse.down();
    const pressed = await demo.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await page.mouse.up();
    expect(pressed).not.toBe(hovered);
  });

  test("keeps the choice beside the job context", async ({ page }) => {
    await seedDraft(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/generate?source=demo");
    const jobContext = page.locator(".generation-draft");
    await expect(
      jobContext.getByRole("navigation", { name: "Resume data source" }),
    ).toBeVisible();

    const jobText = await jobContext
      .locator(".generation-draft-role")
      .boundingBox();
    const choice = await sourceSwitch(page).boundingBox();
    expect(jobText).not.toBeNull();
    expect(choice).not.toBeNull();
    /*
     * The choice sits to the right of the job description on the same band,
     * instead of floating in a distant corner of the page heading.
     */
    expect(choice!.x).toBeGreaterThan(jobText!.x + jobText!.width);
    expect(
      Math.abs(
        choice!.y + choice!.height / 2 - (jobText!.y + jobText!.height / 2),
      ),
    ).toBeLessThan(48);
  });

  test("stacks the choice under the job context on a narrow screen", async ({
    page,
  }) => {
    await seedDraft(page);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/generate?source=demo");
    const jobText = await page.locator(".generation-draft-role").boundingBox();
    const choice = await sourceSwitch(page).boundingBox();
    expect(jobText).not.toBeNull();
    expect(choice).not.toBeNull();
    /* The choice drops below the job description instead of squeezing it. */
    expect(choice!.y).toBeGreaterThan(jobText!.y + jobText!.height);
  });
});

test.describe("a source choice that changes the loaded library", () => {
  test.beforeEach(async () => {
    await writePersonalLibraryWithAnExtraPoint();
  });

  test.afterEach(async () => {
    await restoreSampleLibrary();
  });

  test("swaps the loaded library when the other segment is chosen", async ({
    page,
  }) => {
    await page.goto("/generate?source=demo");
    await expect(page.getByText("13 enabled")).toBeVisible();

    await Promise.all([
      page.waitForURL("**/generate"),
      personalLink(page).click(),
    ]);
    await expect(page.getByText("14 enabled")).toBeVisible();
  });

  test("keeps a saved session with the source that produced it", async ({
    page,
  }) => {
    await seedDraft(page);
    /*
     * The builder stores a finished session under the source it was
     * generated from, and refuses to restore it under the other one.
     */
    await page.addInitScript((draft) => {
      const session = {
        jobSignature: JSON.stringify([
          draft.company,
          draft.roleTitle,
          draft.jobDescription,
        ]),
        pdfBase64: null,
        generation: {
          latex:
            "\\documentclass{article}\\begin{document}Example\\end{document}",
          metadata: {
            id: "generation-source-fixture",
            generatedAt: "2026-01-01T00:00:00.000Z",
            dataSource: "demo",
            company: draft.company,
            roleTitle: draft.roleTitle,
            jobUrl: draft.jobUrl,
            tailoringMode: "manual",
            selectedAchievementIds: [],
            renderedSkillIds: [],
            generatedBullets: [],
            sourceProvenance: [],
            visibleWordCount: 1,
          },
        },
      };
      try {
        window.localStorage.setItem(
          "resume-changer.resume-session.v1.demo",
          JSON.stringify(session),
        );
      } catch {
        // The page still renders without a saved session.
      }
    }, DRAFT);

    await page.goto("/generate?source=demo");
    await expect(
      page.getByRole("button", { name: "Restore editing session" }),
    ).toBeVisible();

    /*
     * The personal source is a different library, so the session that the
     * demo source produced is not offered there.
     */
    await page.goto("/generate");
    await expect(
      page.getByRole("button", { name: "Restore editing session" }),
    ).toHaveCount(0);

    await page.goto("/generate?source=demo");
    await expect(
      page.getByRole("button", { name: "Restore editing session" }),
    ).toBeVisible();
  });
});
