import { expect, test } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A new personal library, with no seeded jobs or demo records.
 * The suite's shared data folder is restored by the other specs' cleanup,
 * and this file puts the empty library back only for its own steps.
 */
const libraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");
const personalLibraryPath = join(libraryRoot, "data", "resume-library.json");

const emptyLibrary = {
  schemaVersion: 2,
  profile: {
    id: "profile-first-use",
    fullName: "New User",
    links: [],
    education: [],
  },
  jobs: [],
  projects: [],
  skills: [],
  credentials: [],
  preferences: {
    sectionOrder: [
      "experience",
      "projects",
      "education",
      "skills",
      "credentials",
    ],
    maxPages: 1,
  },
};

test("creates a personal library from an empty account and keeps it after reload", async ({
  page,
}) => {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await writeFile(
    personalLibraryPath,
    `${JSON.stringify(emptyLibrary)}\n`,
    "utf8",
  );
  await page.goto("/library");

  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Preferred name").fill("Ada Example");
  await page.getByLabel("Professional email").fill("ada@example.com");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Ada Example" }),
  ).toBeVisible();

  await page
    .locator("#library-first-parent")
    .getByRole("button", { name: "Add job" })
    .click();
  await page.getByLabel("Employer").fill("Harbor Labs");
  await page.getByLabel("Title").fill("Researcher");
  await page.getByLabel("Location").fill("Berlin");
  await page.getByLabel("Start date").fill("2024-02");
  await page.getByRole("checkbox", { name: "I currently work here" }).check();
  await page.getByRole("button", { name: "Save job" }).click();
  await expect(
    page.locator(".experience-subtitle", { hasText: "Harbor Labs" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add project" }).click();
  await page.getByLabel("Project name").fill("Field kit");
  await page.getByLabel("Role").fill("Builder");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(
    page.locator(".experience-title", { hasText: "Field kit" }),
  ).toBeVisible();

  const jobNotes = page.getByRole("region", { name: "Job: Researcher" });
  await jobNotes
    .getByLabel("Paste what you worked on")
    .fill(
      "- Built Python scripts to clean SQL exports\n- Led the go-live for billing",
    );
  await jobNotes.getByRole("button", { name: "Review bullets" }).click();
  await expect(jobNotes.locator(".note-review-list")).toContainText(
    "Led the go-live for billing",
  );
  await expect(jobNotes.locator(".note-skill-picks")).not.toContainText("Go");
  await jobNotes
    .locator(".note-skill-picks label")
    .filter({ hasText: "Python" })
    .locator("input")
    .uncheck();
  await jobNotes.getByRole("button", { name: "Save notes" }).click();
  await expect(
    page
      .getByRole("region", { name: "Job: Researcher" })
      .locator("article.library-point")
      .first(),
  ).toContainText("Built Python scripts to clean SQL exports");

  await page.getByRole("button", { name: "Add education" }).click();
  const degreeForm = page.getByRole("form", { name: "Add a degree" });
  await degreeForm.getByLabel("Institution").fill("State University");
  await degreeForm.getByLabel("Degree").fill("BSc");
  await degreeForm.getByLabel("Field of study").fill("Statistics");
  await degreeForm.getByRole("button", { name: "Save degree" }).click();
  await expect(page.getByText("BSc · Statistics")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Ada Example" }),
  ).toBeVisible();
  await expect(
    page.locator(".experience-subtitle", { hasText: "Harbor Labs" }),
  ).toBeVisible();
  await expect(
    page.locator(".experience-title", { hasText: "Field kit" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Job: Researcher" })
      .locator("article.library-point")
      .first(),
  ).toContainText("Built Python scripts to clean SQL exports");
  await expect(page.getByText("BSc · Statistics")).toBeVisible();

  const saved = JSON.parse(await readFile(personalLibraryPath, "utf8")) as {
    profile: { fullName: string; email?: string; education: unknown[] };
    jobs: Array<{ company: string; points: unknown[] }>;
    projects: Array<{ name: string }>;
    skills: Array<{ name: string }>;
  };
  expect(saved.profile.fullName).toBe("Ada Example");
  expect(saved.profile.email).toBe("ada@example.com");
  expect(saved.jobs.map((job) => job.company)).toContain("Harbor Labs");
  expect(saved.jobs[0]?.points).toHaveLength(2);
  expect(saved.projects.map((project) => project.name)).toContain("Field kit");
  expect(saved.skills.map((skill) => skill.name)).not.toContain("Python");
  expect(saved.skills.map((skill) => skill.name)).not.toContain("Go");
  expect(saved.profile.education).toHaveLength(1);
});

test.afterEach(async () => {
  await mkdir(join(libraryRoot, "data"), { recursive: true });
  await copyFile(
    join(process.cwd(), "examples", "sample-resume-library.json"),
    personalLibraryPath,
  );
});
