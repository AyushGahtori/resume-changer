import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAchievementEvidence } from "../../../src/lib/ai/evidence";
import {
  LibraryWriteError,
  mergeSkills,
  updateProfile,
  upsertJobMetadata,
  upsertProjectMetadata,
} from "../../../src/lib/data/writers";
import { orderExperiencesForResume } from "../../../src/lib/generation/experience-order";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import {
  JobSchema,
  ProjectSchema,
  ResumeLibrarySchema,
  type ResumeLibrary,
} from "../../../src/lib/schemas/resume-data";

const demoLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);
const roots: string[] = [];

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-metadata-"));
  roots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  const file = join(root, "data", "resume-library.json");
  await copyFile(demoLibraryPath, file);
  return { root, file, original: await readFile(file, "utf8") };
}

async function readLibrary(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as ResumeLibrary;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("optional library metadata", () => {
  it("accepts omitted profile, job, and project labels and known date errors", () => {
    const blank = ResumeLibrarySchema.safeParse({
      schemaVersion: 1,
      profile: { id: "profile", links: [], education: [] },
      jobs: [{ id: "job-open", points: [] }],
      projects: [{ id: "project-open", points: [] }],
      skills: [],
      credentials: [],
      preferences: { sectionOrder: ["experience"], maxPages: 1 },
    });
    expect(blank.success).toBe(true);
    if (blank.success) {
      expect(blank.data.profile.fullName).toBe("");
      expect(blank.data.jobs[0].company).toBe("");
      expect(blank.data.jobs[0].title).toBe("");
      expect(blank.data.projects[0].name).toBe("");
      expect(blank.data.jobs[0].employmentType).toBeUndefined();
      expect(blank.data.jobs[0].endDate).toBeUndefined();
    }

    expect(
      JobSchema.safeParse({
        id: "job-bad",
        startDate: "2024-05",
        endDate: "2024-04",
        points: [],
      }).success,
    ).toBe(false);
    expect(
      JobSchema.safeParse({ id: "job-now", endDate: null, points: [] }).success,
    ).toBe(true);
    expect(
      ProjectSchema.safeParse({ id: "project-now", endDate: null, points: [] })
        .success,
    ).toBe(true);
    expect(
      JobSchema.safeParse({
        id: "job-month",
        startDate: "2024-13",
        points: [],
      }).success,
    ).toBe(false);
  });

  it("sorts explicit current roles first and unknown dates last", () => {
    const ordered = orderExperiencesForResume([
      { id: "unknown", startDate: undefined, endDate: undefined },
      { id: "dated", startDate: "2020-01", endDate: "2021-01" },
      { id: "current", startDate: undefined, endDate: null },
      { id: "later", startDate: "2022-01", endDate: "2023-01" },
    ]);
    expect(ordered.map((item) => item.id)).toEqual([
      "current",
      "later",
      "dated",
      "unknown",
    ]);
  });

  it("omits blank labels from evidence and does not invent resume headings", () => {
    const library = ResumeLibrarySchema.parse({
      schemaVersion: 1,
      profile: { id: "profile", fullName: "   ", links: [], education: [] },
      jobs: [
        {
          id: "job-open",
          points: [
            {
              id: "point-open",
              text: "Kept a fictional service available.",
              tags: [],
              skillIds: [],
              metrics: [],
              source: { type: "direct-user" },
              enabled: true,
            },
          ],
        },
      ],
      projects: [],
      skills: [],
      credentials: [],
      preferences: { sectionOrder: ["experience"], maxPages: 1 },
    });
    const evidence = buildAchievementEvidence(library);
    expect(evidence[0].groupTitle).toBeUndefined();
    expect(evidence[0].groupSubtitle).toBeUndefined();
    const latex = renderResumeLatex({
      library,
      selectedAchievementIds: ["point-open"],
    });
    expect(latex).not.toContain("Untitled");
    expect(latex).not.toContain("undefined");
    expect(latex).toContain("Kept a fictional service available.");
  });
});

describe("metadata writers", () => {
  it("keeps an empty or identical save from rewriting the library", async () => {
    const { root, file, original } = await createRoot();
    const before = await readLibrary(file);

    const profile = await updateProfile(
      { changes: { fullName: before.profile.fullName } },
      { rootDir: root },
    );
    expect(profile.changed).toBe(false);
    expect(await readFile(file, "utf8")).toBe(original);

    const emptyJob = await upsertJobMetadata(
      "job-empty-save",
      { changes: {} },
      { rootDir: root },
    );
    expect(emptyJob).toEqual({ job: null, changed: false, created: false });
    const emptySkills = await mergeSkills({ items: [] }, { rootDir: root });
    expect(emptySkills.changed).toBe(false);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("saves partial metadata without dropping child records", async () => {
    const { root, file } = await createRoot();
    const before = await readLibrary(file);
    const job = before.jobs[0];
    const pointIds = job.points.map((point) => point.id);

    const updated = await upsertJobMetadata(
      job.id,
      {
        changes: {
          title: "",
          location: "",
          endDate: "",
        },
      },
      { rootDir: root },
    );
    expect(updated.changed).toBe(true);
    expect(updated.created).toBe(false);
    expect(updated.job?.title).toBe("");
    expect(updated.job?.company).toBe(job.company);
    expect(updated.job?.points.map((point) => point.id)).toEqual(pointIds);
    expect(updated.job?.endDate).toBeUndefined();

    const created = await upsertProjectMetadata(
      "project-partial-metadata",
      { changes: { role: "Advisor" } },
      { rootDir: root },
    );
    expect(created.created).toBe(true);
    expect(created.project?.name).toBe("");
    expect(created.project?.role).toBe("Advisor");
    expect(created.project?.points).toEqual([]);

    const skills = await mergeSkills(
      {
        items: [
          { id: "skill-batch-lattice", name: " Fictional Lattice " },
          { id: "skill-batch-lattice-again", name: "fictional lattice" },
          { id: "skill-batch-blank", name: "   " },
        ],
      },
      { rootDir: root },
    );
    expect(skills.changed).toBe(true);
    expect(
      skills.skills.filter(
        (skill) => skill.name.toLowerCase() === "fictional lattice",
      ),
    ).toHaveLength(1);
    const saved = await readLibrary(file);
    expect(saved.credentials).toEqual(before.credentials);
    expect(saved.profile.education).toEqual(before.profile.education);
  });

  it("rejects a stable id that belongs to a different record", async () => {
    const { root, file } = await createRoot();
    const projectId = (await readLibrary(file)).projects[0].id;
    await expect(
      upsertJobMetadata(
        projectId,
        { changes: { company: "Other" } },
        { rootDir: root },
      ),
    ).rejects.toBeInstanceOf(LibraryWriteError);
  });

  it("reuses an existing skill id when only the letter case differs", async () => {
    const { root, file, original } = await createRoot();
    const existing = (await readLibrary(file)).skills[0];
    const merged = await mergeSkills(
      {
        items: [
          { id: "skill-should-not-replace", name: existing.name.toUpperCase() },
        ],
      },
      { rootDir: root },
    );
    expect(merged.changed).toBe(false);
    expect(merged.skills.some((skill) => skill.id === existing.id)).toBe(true);
    expect(await readFile(file, "utf8")).toBe(original);
  });
});
