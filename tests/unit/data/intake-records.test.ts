import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExperienceRecord } from "../../../src/lib/data/experience-records";
import { saveRoughNotes } from "../../../src/lib/data/intake-records";
import { LibraryWriteError } from "../../../src/lib/data/writers";

const temporaryRoots: string[] = [];

const emptyLibrary = {
  schemaVersion: 2,
  profile: {
    id: "profile-intake-test",
    fullName: "Intake Tester",
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
  const root = await mkdtemp(join(tmpdir(), "resume-changer-intake-test-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  const file = join(root, "data", "resume-library.json");
  await writeFile(file, `${JSON.stringify(emptyLibrary)}\n`, "utf8");
  return { root, file };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("rough note intake", () => {
  it("saves reviewed bullets and only the accepted skills", async () => {
    const { root, file } = await createRoot();
    const created = await createExperienceRecord(
      {
        kind: "project",
        name: "Reporting tools",
        role: "Builder",
      },
      { rootDir: root },
    );
    const projectId = created.record.id;

    const saved = await saveRoughNotes(
      {
        parentType: "project",
        parentId: projectId,
        notes: [
          "Built Python scripts to clean SQL exports and publish Power BI reports",
          "Reduced refresh time 40% in 2024",
        ],
        acceptSkillNames: ["Python", "SQL", "Power BI", "AWS"],
      },
      { rootDir: root },
    );

    expect(saved.points).toHaveLength(2);
    expect(saved.points[1]?.text).toContain("40%");
    expect(saved.createdSkills.map((skill) => skill.name).sort()).toEqual([
      "Power BI",
      "Python",
      "SQL",
    ]);
    const library = JSON.parse(await readFile(file, "utf8")) as {
      projects: Array<{ points: Array<{ text: string; skillIds: string[] }> }>;
      skills: Array<{
        id: string;
        name: string;
        evidenceAchievementIds: string[];
      }>;
      jobs: unknown[];
    };
    expect(library.jobs).toHaveLength(0);
    expect(library.projects[0]?.points).toHaveLength(2);
    expect(library.skills).toHaveLength(3);
    const python = library.skills.find((skill) => skill.name === "Python");
    expect(python?.evidenceAchievementIds).toEqual([saved.points[0]?.id]);
    expect(library.projects[0]?.points[0]?.skillIds).toContain(python?.id);
    expect(library.skills.some((skill) => skill.name === "AWS")).toBe(false);
  });

  it("does not create a skill the user left unchecked", async () => {
    const { root } = await createRoot();
    const created = await createExperienceRecord(
      {
        kind: "job",
        company: "Northwind",
        title: "Analyst",
        startDate: "2024-01",
        endDate: null,
        currentlyEmployed: true,
      },
      { rootDir: root },
    );
    const saved = await saveRoughNotes(
      {
        parentType: "job",
        parentId: created.record.id,
        notes: ["Wrote SQL extracts for the weekly finance pack"],
        acceptSkillNames: [],
      },
      { rootDir: root },
    );
    expect(saved.points).toHaveLength(1);
    expect(saved.createdSkills).toHaveLength(0);
  });

  it("does not create a second achievement for the same note", async () => {
    const { root, file } = await createRoot();
    const created = await createExperienceRecord(
      { kind: "project", name: "Reporting tools" },
      { rootDir: root },
    );
    const input = {
      parentType: "project" as const,
      parentId: created.record.id,
      notes: [
        "Built Python scripts to clean SQL exports",
        "Built Python scripts to clean SQL exports",
      ],
      acceptSkillNames: ["Python"],
    };
    const first = await saveRoughNotes(input, { rootDir: root });
    const second = await saveRoughNotes(input, { rootDir: root });
    const library = JSON.parse(await readFile(file, "utf8")) as {
      projects: Array<{ points: unknown[] }>;
      skills: Array<{ name: string }>;
    };

    expect(first.points).toHaveLength(1);
    expect(second.points).toHaveLength(0);
    expect(second.skippedDuplicates).toBe(2);
    expect(library.projects[0]?.points).toHaveLength(1);
    expect(
      library.skills.filter((skill) => skill.name === "Python"),
    ).toHaveLength(1);
  });

  it("rejects a missing parent", async () => {
    const { root } = await createRoot();
    await expect(
      saveRoughNotes(
        {
          parentType: "project",
          parentId: "project-missing",
          notes: ["Kept the lights on"],
          acceptSkillNames: [],
        },
        { rootDir: root },
      ),
    ).rejects.toBeInstanceOf(LibraryWriteError);
  });
});
