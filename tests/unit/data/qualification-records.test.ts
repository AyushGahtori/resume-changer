import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LibraryWriteError } from "../../../src/lib/data/writers";
import {
  createCredential,
  createEducation,
  createSkillsFromText,
  removeCredential,
  removeEducation,
  updateCredential,
  updateEducation,
} from "../../../src/lib/data/qualification-records";

const temporaryRoots: string[] = [];

const emptyLibrary = {
  schemaVersion: 2,
  profile: {
    id: "profile-qualification-test",
    fullName: "Qualification Tester",
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

async function createRoot(library: unknown = emptyLibrary) {
  const root = await mkdtemp(
    join(tmpdir(), "resume-changer-qualification-test-"),
  );
  temporaryRoots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  const file = join(root, "data", "resume-library.json");
  await writeFile(file, `${JSON.stringify(library)}\n`, "utf8");
  return { root, file };
}

async function readLibrary(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as {
    profile: {
      education: Array<{
        id: string;
        institutions: string[];
        degree: string;
        fieldOfStudy: string;
        endDate?: string | null;
      }>;
    };
    jobs: unknown[];
    projects: unknown[];
    skills: Array<{ id: string; name: string; aliases: string[] }>;
    credentials: Array<{
      id: string;
      kind: string;
      name: string;
      issuer: string;
      url?: string;
      credentialId?: string;
    }>;
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("qualification records", () => {
  it("creates skills from a paste and skips duplicates in that paste", async () => {
    const { root, file } = await createRoot();

    const result = await createSkillsFromText(
      { text: "Python, SQL\nPower BI, python" },
      { rootDir: root },
    );

    expect(result.created.map((skill) => skill.name)).toEqual([
      "Python",
      "SQL",
      "Power BI",
    ]);
    expect(result.skipped).toEqual(["python"]);
    expect(result.created).toEqual([
      expect.objectContaining({
        id: "skill-python",
        name: "Python",
        aliases: [],
        sources: ["direct-user"],
        isListedOnCurrentResume: false,
        evidenceAchievementIds: [],
      }),
      expect.objectContaining({ id: "skill-sql", name: "SQL" }),
      expect.objectContaining({ id: "skill-power-bi", name: "Power BI" }),
    ]);
    expect((await readLibrary(file)).skills.map((skill) => skill.name)).toEqual(
      ["Python", "SQL", "Power BI"],
    );
  });

  it("skips a skill that is already in the library", async () => {
    const { root, file } = await createRoot();
    await createSkillsFromText(
      { text: "Python, SQL\nPower BI, python" },
      { rootDir: root },
    );

    const second = await createSkillsFromText(
      { text: "SQL" },
      { rootDir: root },
    );

    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(["SQL"]);
    expect((await readLibrary(file)).skills).toHaveLength(3);
  });

  it("skips a pasted name that matches an existing alias", async () => {
    const library = {
      ...emptyLibrary,
      skills: [
        {
          id: "skill-python",
          name: "Python",
          aliases: ["py"],
          sources: ["direct-user"],
          isListedOnCurrentResume: false,
          evidenceAchievementIds: [],
        },
      ],
    };
    const { root } = await createRoot(library);

    const result = await createSkillsFromText(
      { text: "py, Go" },
      { rootDir: root },
    );

    expect(result.created.map((skill) => skill.name)).toEqual(["Go"]);
    expect(result.skipped).toEqual(["py"]);
  });

  it("creates a degree, corrects the name, and reloads it from disk", async () => {
    const { root, file } = await createRoot();
    const created = await createEducation(
      {
        institution: "Example State University",
        degree: "Bachelor of Science",
        fieldOfStudy: "Computer Science",
        programName: "Honors",
        startDate: "2017-09",
        endDate: "2021-05",
      },
      { rootDir: root },
    );
    const other = await createEducation(
      {
        institution: "Other College",
        degree: "Associate of Arts",
        fieldOfStudy: "Arts",
      },
      { rootDir: root },
    );

    const updated = await updateEducation(
      created.education.id,
      { degree: "Master of Science" },
      { rootDir: root },
    );
    const library = await readLibrary(file);

    expect(created.education.id).toMatch(/^education-[a-z0-9-]+$/);
    expect(updated.education).toMatchObject({
      id: created.education.id,
      institutions: ["Example State University"],
      degree: "Master of Science",
      fieldOfStudy: "Computer Science",
      programName: "Honors",
      startDate: "2017-09",
      endDate: "2021-05",
    });
    expect(library.profile.education.map((item) => item.degree)).toEqual([
      "Master of Science",
      "Associate of Arts",
    ]);
    expect(library.profile.education[1].id).toBe(other.education.id);
    expect(library.jobs).toEqual([]);
    expect(library.projects).toEqual([]);
    expect(library.skills).toEqual([]);
  });

  it("keeps the other institutions when a joint degree is edited", async () => {
    const { root, file } = await createRoot();
    const created = await createEducation(
      {
        institutions: ["University of Milan", "University of Pavia"],
        degree: "Joint doctorate",
        fieldOfStudy: "History",
      },
      { rootDir: root },
    );

    const updated = await updateEducation(
      created.education.id,
      { institution: "University of Milan", degree: "Joint PhD" },
      { rootDir: root },
    );

    expect(updated.education.institutions).toEqual([
      "University of Milan",
      "University of Pavia",
    ]);
    expect(updated.education.degree).toBe("Joint PhD");
    expect((await readLibrary(file)).profile.education[0].institutions).toEqual(
      ["University of Milan", "University of Pavia"],
    );
  });

  it("stores current study with no end date", async () => {
    const { root, file } = await createRoot();

    const created = await createEducation(
      {
        institution: "Example State University",
        degree: "Bachelor of Science",
        fieldOfStudy: "Computer Science",
        startDate: "2024-09",
        endDate: "2025-05",
        currentlyStudying: true,
      },
      { rootDir: root },
    );

    expect(created.education.endDate).toBeNull();
    expect((await readLibrary(file)).profile.education[0].endDate).toBeNull();
  });

  it("creates two certificates, edits one url, and removes the other", async () => {
    const { root, file } = await createRoot();
    const first = await createCredential(
      {
        name: "Cloud Deployment Foundations",
        issuer: "Example Cloud Academy",
        issuedDate: "2024-05-15",
        credentialId: "DEMO-15",
      },
      { rootDir: root },
    );
    const second = await createCredential(
      {
        name: "Data Handling Practitioner",
        issuer: "Example Standards Board",
        url: "https://example.com/old",
      },
      { rootDir: root },
    );

    const edited = await updateCredential(
      second.credential.id,
      { url: "https://example.com/verify" },
      { rootDir: root },
    );
    await removeCredential(first.credential.id, { rootDir: root });
    const library = await readLibrary(file);

    expect(first.credential.kind).toBe("certificate");
    expect(second.credential.kind).toBe("certificate");
    expect(first.credential.id).toMatch(/^credential-/);
    expect(second.credential.id).toMatch(/^credential-/);
    expect(edited.credential).toMatchObject({
      id: second.credential.id,
      name: "Data Handling Practitioner",
      issuer: "Example Standards Board",
      url: "https://example.com/verify",
    });
    expect(library.credentials).toHaveLength(1);
    expect(library.credentials[0]).toMatchObject({
      id: second.credential.id,
      url: "https://example.com/verify",
    });
    expect(library.profile.education).toEqual([]);
  });

  it("throws for empty skill text and does not write a file change", async () => {
    const { root, file } = await createRoot();
    const original = await readFile(file, "utf8");

    await expect(
      createSkillsFromText({ text: "" }, { rootDir: root }),
    ).rejects.toMatchObject({
      name: "LibraryWriteError",
      code: "invalid-input",
    });
    await expect(
      createSkillsFromText({ text: " \n, " }, { rootDir: root }),
    ).rejects.toBeInstanceOf(LibraryWriteError);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("throws when an end date is before the start date", async () => {
    const { root, file } = await createRoot();

    await expect(
      createEducation(
        {
          institution: "Example State University",
          degree: "Bachelor of Science",
          fieldOfStudy: "Computer Science",
          startDate: "2021-05",
          endDate: "2017-09",
        },
        { rootDir: root },
      ),
    ).rejects.toThrow(/End date must be the same as or later than start date/);
    expect((await readLibrary(file)).profile.education).toEqual([]);

    const created = await createEducation(
      {
        institution: "Example State University",
        degree: "Bachelor of Science",
        fieldOfStudy: "Computer Science",
        startDate: "2020-01",
        endDate: "2021-05",
      },
      { rootDir: root },
    );
    await expect(
      updateEducation(
        created.education.id,
        { endDate: "2019-01" },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect((await readLibrary(file)).profile.education[0].endDate).toBe(
      "2021-05",
    );
  });

  it("reports a missing degree or credential without removing the other records", async () => {
    const { root, file } = await createRoot();
    const education = await createEducation(
      {
        institution: "Example State University",
        degree: "Bachelor of Science",
        fieldOfStudy: "Computer Science",
      },
      { rootDir: root },
    );
    const credential = await createCredential(
      { name: "Cloud Deployment Foundations", issuer: "Example Cloud Academy" },
      { rootDir: root },
    );

    await expect(
      updateEducation(
        "education-missing",
        { degree: "Doctor of Philosophy" },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      removeCredential("credential-missing", { rootDir: root }),
    ).rejects.toMatchObject({ code: "not-found" });
    await removeEducation(education.education.id, { rootDir: root });

    const library = await readLibrary(file);
    expect(library.profile.education).toEqual([]);
    expect(library.credentials).toEqual([
      expect.objectContaining({ id: credential.credential.id }),
    ]);
  });
});
