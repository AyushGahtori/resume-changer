import { expect, test } from "@playwright/test";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sampleLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);

const personalLibraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");

const personalLibraryPath = join(
  personalLibraryRoot,
  "data",
  "resume-library.json",
);

async function writePersonalLibrary(library: unknown) {
  await mkdir(join(personalLibraryRoot, "data"), { recursive: true });
  await writeFile(personalLibraryPath, `${JSON.stringify(library, null, 2)}\n`);
}

function sectionDetails(page: import("@playwright/test").Page, title: string) {
  return page
    .getByRole("heading", { name: title, exact: true })
    .locator("xpath=ancestor::details");
}

test.afterEach(async () => {
  // The personal library root is shared by the whole browser suite, so the
  // sample file is put back after a test replaces it.
  await copyFile(sampleLibraryPath, personalLibraryPath);
});

test("organises the library into Jobs, Projects, Skills, and Credentials", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const jobs = page.getByRole("region", { name: "Jobs", exact: true });
  const projects = page.getByRole("region", { name: "Projects", exact: true });

  await expect(jobs).toBeVisible();
  await expect(projects).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Skills", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Credentials", exact: true }),
  ).toBeVisible();

  // The four categories keep the order of the page map.
  await expect(page.locator(".library-section-title")).toHaveText([
    "Jobs",
    "Projects",
    "Skills",
    "Credentials",
  ]);

  // Every experience group stays inside the region of its own category.
  await expect(
    jobs.getByRole("heading", { name: "Platform Engineer" }),
  ).toBeVisible();
  await expect(
    jobs.getByRole("heading", { name: "Software Engineer" }),
  ).toBeVisible();
  await expect(
    projects.getByRole("heading", { name: "QueueBoard" }),
  ).toBeVisible();
  await expect(
    projects.getByRole("heading", { name: "FieldNotes" }),
  ).toBeVisible();
});

test("states the number of records that each section holds", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const jobs = page.getByRole("region", { name: "Jobs", exact: true });
  const projects = page.getByRole("region", { name: "Projects", exact: true });

  await expect(jobs.locator(".library-section-count")).toHaveText("2");
  await expect(jobs.locator(".experience-group")).toHaveCount(2);
  await expect(projects.locator(".library-section-count")).toHaveText("2");
  await expect(projects.locator(".experience-group")).toHaveCount(2);

  const skills = sectionDetails(page, "Skills");
  const credentials = sectionDetails(page, "Credentials");

  await expect(skills.locator(".library-section-count")).toHaveText("14");
  await expect(credentials.locator(".library-section-count")).toHaveText("2");

  // The secondary sections stay usable as disclosures.
  await skills.locator("summary").click();
  await credentials.locator("summary").click();
  await expect(skills.locator(".skill-list li")).toHaveCount(14);
  await expect(credentials.locator(".credential-list li")).toHaveCount(2);
});

test("drops a parent section when none of its points match", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  await page
    .getByLabel("Job or project")
    .selectOption("job:job-example-cloud-labs");

  const jobs = page.getByRole("region", { name: "Jobs", exact: true });
  await expect(jobs.locator(".library-section-count")).toHaveText("1");
  await expect(jobs.locator(".experience-group")).toHaveCount(1);
  await expect(
    jobs.getByRole("heading", { name: "Software Engineer" }),
  ).toHaveCount(0);

  // The project section has no matching point, so it is not rendered.
  await expect(
    page.getByRole("region", { name: "Projects", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("keeps the secondary sections in step with the query", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  await page
    .getByRole("searchbox", { name: "Search library" })
    .fill("Cloud Deployment Foundations");

  const credentials = sectionDetails(page, "Credentials");
  const skills = sectionDetails(page, "Skills");

  await expect(credentials.locator(".library-section-count")).toHaveText("1");
  await expect(
    credentials.getByText("Cloud Deployment Foundations (Demo)"),
  ).toBeVisible();
  await expect(skills.locator(".library-section-count")).toHaveText("0");
  await expect(skills.getByText("No skills match this search.")).toBeVisible();

  // No point matches the query, so the experience sections are not rendered.
  await expect(
    page.getByRole("region", { name: "Jobs", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Projects", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText(
    "No achievement points match these filters.",
  );
});

test("does not file education under one of the four categories", async ({
  page,
}) => {
  await page.goto("/library?source=demo");

  const credentials = sectionDetails(page, "Credentials");
  await credentials.locator("summary").click();
  await expect(credentials.locator(".credential-list li")).toHaveCount(2);

  // Education belongs to the profile record, so it never appears as a
  // credential or as any other category of the library.
  await expect(page.locator(".library-sections")).not.toContainText(
    "Example State University",
  );
  await expect(page.locator(".library-sections")).not.toContainText(
    "Bachelor of Science",
  );
});

test("rebuilds the sections when the data source changes", async ({ page }) => {
  const library = JSON.parse(await readFile(sampleLibraryPath, "utf8"));
  const jobs = library.jobs.slice(0, 1);
  const keptPointIds = new Set(
    jobs.flatMap((job: { points: Array<{ id: string }> }) =>
      job.points.map((point) => point.id),
    ),
  );
  // A skill may only point at an achievement that the library still holds.
  const skills = library.skills.map(
    (skill: { evidenceAchievementIds: string[] }) => ({
      ...skill,
      evidenceAchievementIds: skill.evidenceAchievementIds.filter((id) =>
        keptPointIds.has(id),
      ),
    }),
  );
  await writePersonalLibrary({ ...library, jobs, projects: [], skills });

  await page.goto("/library");

  const jobsSection = page.getByRole("region", { name: "Jobs", exact: true });
  await expect(jobsSection.locator(".library-section-count")).toHaveText("1");
  await expect(
    page.getByRole("region", { name: "Projects", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("My resume data")).toBeVisible();

  // The demo source keeps its own records.
  await page.goto("/library?source=demo");
  await expect(
    page.getByRole("region", { name: "Projects", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Jobs", exact: true })
      .locator(".library-section-count"),
  ).toHaveText("2");
});

test("keeps the sections readable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/library?source=demo");

  await expect(
    page.getByRole("heading", { name: "Jobs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Credentials", exact: true }),
  ).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
});
