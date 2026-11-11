import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExperienceRecord,
  removeExperienceRecord,
  updateExperienceRecord,
} from "../../../src/lib/data/experience-records";
import {
  LibraryWriteError,
  collectEntityIds,
  commitLibraryMutation,
  currentYearMonth,
  parentIdForName,
} from "../../../src/lib/data/writers";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const demoLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);
const temporaryRoots: string[] = [];

const emptyLibrary = {
  schemaVersion: 2,
  profile: {
    id: "profile-empty-library",
    fullName: "Empty Library",
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

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-changer-experience-test-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  const file = join(root, "data", "resume-library.json");
  await copyFile(demoLibraryPath, file);
  return { root, file, original: await readFile(file, "utf8") };
}

async function createEmptyRoot() {
  const root = await mkdtemp(
    join(tmpdir(), "resume-changer-experience-empty-"),
  );
  temporaryRoots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  const file = join(root, "data", "resume-library.json");
  await writeFile(file, `${JSON.stringify(emptyLibrary)}\n`, "utf8");
  return { root, file, original: await readFile(file, "utf8") };
}

async function readLibrary(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as ResumeLibrary;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("experience records", () => {
  it("creates a job and keeps the saved record intact", async () => {
    const { root, file } = await createEmptyRoot();
    const used = new Set(collectEntityIds(emptyLibrary));

    const created = await createExperienceRecord(
      {
        kind: "job",
        id: "job-client-picked",
        company: "Northwind Labs",
        title: "Data Engineer",
        employmentType: "contract",
        location: "Remote",
        startDate: "2019-03",
        endDate: "2021-11",
        description: "Built the data platform.",
        currentlyEmployed: false,
        points: [{ id: "achievement-should-not-stick" }],
      },
      { rootDir: root },
    );

    const saved = await readLibrary(file);
    const job = saved.jobs[0];
    expect(created.record.id).toBe(
      parentIdForName("job", "Northwind Labs", used),
    );
    expect(job).toMatchObject({
      id: "job-northwind-labs",
      company: "Northwind Labs",
      title: "Data Engineer",
      employmentType: "contract",
      location: "Remote",
      startDate: "2019-03",
      endDate: "2021-11",
      description: "Built the data platform.",
      points: [],
    });
    expect(saved.schemaVersion).toBe(2);
    expect(saved.projects).toEqual([]);
  });

  it("creates a second job and a project in an empty library", async () => {
    const { root, file } = await createEmptyRoot();

    await createExperienceRecord(
      {
        kind: "job",
        company: "Northwind Labs",
        title: "Data Engineer",
        startDate: "2019-03",
        endDate: "2021-11",
        currentlyEmployed: false,
      },
      { rootDir: root },
    );
    await createExperienceRecord(
      {
        kind: "job",
        company: "Contoso Studio",
        title: "Software Engineer",
        employmentType: "full-time",
        location: "Example City",
        startDate: "2021-12",
        endDate: "2023-08",
        currentlyEmployed: false,
      },
      { rootDir: root },
    );
    await createExperienceRecord(
      {
        kind: "project",
        name: "Field Kit",
        role: "Maintainer",
        url: "https://example.com/field-kit",
        description: "Notes from the field.",
        startDate: "2022-02",
        endDate: "2022-10",
      },
      { rootDir: root },
    );

    const saved = await readLibrary(file);
    expect(saved.jobs.map((job) => job.company)).toEqual([
      "Northwind Labs",
      "Contoso Studio",
    ]);
    expect(saved.jobs.map((job) => job.id)).toEqual([
      "job-northwind-labs",
      "job-contoso-studio",
    ]);
    expect(saved.projects).toHaveLength(1);
    expect(saved.projects[0]).toMatchObject({
      id: "project-field-kit",
      name: "Field Kit",
      role: "Maintainer",
      url: "https://example.com/field-kit",
      description: "Notes from the field.",
      startDate: "2022-02",
      endDate: "2022-10",
      points: [],
      repositoryAttachments: [],
    });
  });

  it("keeps a project-only library free of invented jobs", async () => {
    const { root, file } = await createEmptyRoot();

    const created = await createExperienceRecord(
      { kind: "project", name: "Only Project" },
      { rootDir: root },
    );

    const saved = await readLibrary(file);
    expect(created.record).toMatchObject({
      id: "project-only-project",
      name: "Only Project",
      points: [],
      repositoryAttachments: [],
    });
    expect(saved.jobs).toEqual([]);
    expect(saved.projects).toHaveLength(1);
    expect(saved.projects[0]).not.toHaveProperty("company");
    expect(saved.projects[0]).not.toHaveProperty("startDate");
    expect(saved.projects[0]).not.toHaveProperty("endDate");
  });

  it("stores a null end date when the job is current", async () => {
    const { root, file } = await createEmptyRoot();
    const startDate = currentYearMonth();

    const created = await createExperienceRecord(
      {
        kind: "job",
        company: "Current Co",
        title: "Engineer",
        location: "Austin",
        startDate,
        endDate: "2000-01",
        currentlyEmployed: true,
      },
      { rootDir: root },
    );

    const saved = await readLibrary(file);
    expect(created.record).toMatchObject({
      company: "Current Co",
      title: "Engineer",
      employmentType: "full-time",
      location: "Austin",
      startDate,
      endDate: null,
    });
    expect(saved.jobs[0].endDate).toBeNull();
    expect(saved.jobs[0].employmentType).toBe("full-time");
  });

  it("updates a job title and company without dropping its points", async () => {
    const { root, file } = await createRoot();
    const before = await readLibrary(file);
    const job = before.jobs[0];

    const updated = await updateExperienceRecord(
      job.id,
      {
        id: "job-should-not-change",
        company: "Example Cloud Labs International",
        title: "Staff Platform Engineer",
        points: [],
      },
      { rootDir: root },
    );

    const saved = await readLibrary(file);
    expect(updated.record.id).toBe(job.id);
    expect(saved.jobs[0]).toMatchObject({
      id: job.id,
      company: "Example Cloud Labs International",
      title: "Staff Platform Engineer",
      employmentType: job.employmentType,
      location: job.location,
      startDate: job.startDate,
      endDate: job.endDate,
    });
    expect(saved.jobs[0].points.map((point) => point.id)).toEqual(
      job.points.map((point) => point.id),
    );
    expect(saved.jobs[0].points.map((point) => point.text)).toEqual(
      job.points.map((point) => point.text),
    );
    expect(
      saved.jobs[0].points.map((point) =>
        point.metrics.map((metric) => metric.id),
      ),
    ).toEqual(
      job.points.map((point) => point.metrics.map((metric) => metric.id)),
    );
    expect(saved.jobs[1].id).toBe(before.jobs[1].id);
    expect(saved.jobs[1].points).toHaveLength(before.jobs[1].points.length);
  });

  it("removes a job, its achievements, and skill links to those achievements", async () => {
    const { root, file } = await createRoot();
    let before = await readLibrary(file);
    const job = before.jobs[0];
    const pointIds = new Set(job.points.map((point) => point.id));
    const linked = before.skills.some((skill) =>
      skill.evidenceAchievementIds.some((achievementId) =>
        pointIds.has(achievementId),
      ),
    );
    if (!linked) {
      await commitLibraryMutation(
        (library) => {
          const skills = library.skills.map((skill, index) =>
            index === 0
              ? {
                  ...skill,
                  evidenceAchievementIds: [
                    ...skill.evidenceAchievementIds,
                    job.points[0].id,
                  ],
                }
              : skill,
          );
          return {
            library: { ...library, skills },
            value: null,
            persist: true,
          };
        },
        { rootDir: root },
      );
      before = await readLibrary(file);
    }

    const removed = await removeExperienceRecord(job.id, { rootDir: root });
    const saved = await readLibrary(file);
    const remainingPointIds = [
      ...saved.jobs.flatMap((item) => item.points.map((point) => point.id)),
      ...saved.projects.flatMap((item) => item.points.map((point) => point.id)),
    ];

    expect(removed).toEqual({
      kind: "job",
      id: job.id,
      removedPointCount: job.points.length,
    });
    expect(saved.jobs.map((item) => item.id)).toEqual(
      before.jobs.filter((item) => item.id !== job.id).map((item) => item.id),
    );
    for (const pointId of pointIds) {
      expect(remainingPointIds).not.toContain(pointId);
    }
    for (const skill of saved.skills) {
      const original = before.skills.find((item) => item.id === skill.id);
      expect(skill.evidenceAchievementIds).toEqual(
        original?.evidenceAchievementIds.filter(
          (achievementId) => !pointIds.has(achievementId),
        ),
      );
    }
    expect(saved.projects.map((project) => project.id)).toEqual(
      before.projects.map((project) => project.id),
    );
  });

  it("rejects an end date that falls before the start date", async () => {
    const { root, file, original } = await createEmptyRoot();

    await expect(
      createExperienceRecord(
        {
          kind: "job",
          company: "Acme",
          title: "Engineer",
          startDate: "2024-06",
          endDate: "2024-01",
          currentlyEmployed: false,
        },
        { rootDir: root },
      ),
    ).rejects.toBeInstanceOf(LibraryWriteError);
    await expect(
      createExperienceRecord(
        {
          kind: "project",
          name: "Early End",
          startDate: "2024-06",
          endDate: "2024-01",
        },
        { rootDir: root },
      ),
    ).rejects.toBeInstanceOf(LibraryWriteError);
    expect(await readFile(file, "utf8")).toBe(original);

    await createExperienceRecord(
      {
        kind: "job",
        company: "Acme",
        title: "Engineer",
        startDate: "2020-01",
        endDate: "2022-01",
        currentlyEmployed: false,
      },
      { rootDir: root },
    );
    const saved = await readLibrary(file);
    const beforeUpdate = await readFile(file, "utf8");
    await expect(
      updateExperienceRecord(
        saved.jobs[0].id,
        { endDate: "2019-05" },
        { rootDir: root },
      ),
    ).rejects.toBeInstanceOf(LibraryWriteError);
    expect(await readFile(file, "utf8")).toBe(beforeUpdate);
  });

  it("clears optional project dates and can mark a project ongoing", async () => {
    const { root, file } = await createEmptyRoot();
    const created = await createExperienceRecord(
      {
        kind: "project",
        name: "Dated Project",
        role: "Builder",
        startDate: "2020-01",
        endDate: "2021-06",
      },
      { rootDir: root },
    );

    await updateExperienceRecord(
      created.record.id,
      { startDate: null, endDate: null, role: null },
      { rootDir: root },
    );
    const cleared = await readLibrary(file);
    expect(cleared.projects[0].name).toBe("Dated Project");
    expect(cleared.projects[0]).not.toHaveProperty("startDate");
    expect(cleared.projects[0]).not.toHaveProperty("endDate");
    expect(cleared.projects[0]).not.toHaveProperty("role");
    expect(cleared.jobs).toEqual([]);

    const ongoing = await createExperienceRecord(
      {
        kind: "project",
        name: "Open Project",
        startDate: "2023-04",
        endDate: "2023-08",
        ongoing: true,
      },
      { rootDir: root },
    );
    expect(ongoing.record).toMatchObject({
      name: "Open Project",
      startDate: "2023-04",
      endDate: null,
    });
    const saved = await readLibrary(file);
    expect(saved.projects[1].endDate).toBeNull();
    expect(saved.jobs).toEqual([]);
  });

  it("reports a missing record without changing the library", async () => {
    const { root, file, original } = await createRoot();

    await expect(
      updateExperienceRecord(
        "job-missing",
        { title: "Nope" },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      removeExperienceRecord("project-missing", { rootDir: root }),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(await readFile(file, "utf8")).toBe(original);
  });
});
