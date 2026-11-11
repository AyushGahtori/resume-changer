import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExperienceRecord } from "../../../src/lib/data/experience-records";
import { saveRoughNotes } from "../../../src/lib/data/intake-records";
import { updateResumeProfile } from "../../../src/lib/data/profile-records";
import {
  createCredential,
  createEducation,
} from "../../../src/lib/data/qualification-records";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const temporaryRoots: string[] = [];

const emptyLibrary = {
  schemaVersion: 2,
  profile: {
    id: "profile-output-test",
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

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-changer-output-test-"));
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

describe("first-use facts in rendered output", () => {
  it("prints the authored identity, job, notes, degree, and credential", async () => {
    const { root, file } = await createRoot();
    await updateResumeProfile(
      {
        fullName: "Ada Example",
        email: "ada@example.com",
        links: [],
      },
      { rootDir: root },
    );
    const job = await createExperienceRecord(
      {
        kind: "job",
        company: "Harbor Labs",
        title: "Researcher",
        location: "Berlin",
        startDate: "2024-02",
        currentlyEmployed: true,
      },
      { rootDir: root },
    );
    const notes = await saveRoughNotes(
      {
        parentType: "job",
        parentId: job.record.id,
        notes: ["Built Python scripts to clean SQL exports"],
        acceptSkillNames: ["Python"],
      },
      { rootDir: root },
    );
    await createEducation(
      {
        institutions: ["State University", "City College"],
        degree: "BSc",
        fieldOfStudy: "Statistics",
      },
      { rootDir: root },
    );
    await createCredential(
      {
        name: "Analytics Certificate",
        issuer: "Example Institute",
      },
      { rootDir: root },
    );

    const library = JSON.parse(await readFile(file, "utf8")) as ResumeLibrary;
    const latex = renderResumeLatex({
      library,
      selectedAchievementIds: notes.points.map((point) => point.id),
      selectedSkillIds: notes.createdSkills.map((skill) => skill.id),
    });

    expect(latex).toContain("Ada Example");
    expect(latex).toContain("ada@example.com");
    expect(latex).toContain("Harbor Labs");
    expect(latex).toContain("Researcher");
    expect(latex).toContain("Built Python scripts to clean SQL exports");
    expect(latex).toContain("State University");
    expect(latex).toContain("City College");
    expect(latex).toContain("Analytics Certificate");
    expect(latex).toContain("Python");
  });
});
