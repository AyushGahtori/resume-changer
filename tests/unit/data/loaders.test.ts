import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DataLoadError,
  formatDataLoadError,
  loadAchievementData,
  loadGenerationHistory,
  loadProfileData,
  loadResumeLibrary,
  loadTemplateMetadata,
} from "../../../src/lib/data/loaders";

const demoLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);
const temporaryRoots: string[] = [];

async function createTemporaryRoot() {
  const rootDir = await mkdtemp(join(tmpdir(), "resume-changer-test-"));
  temporaryRoots.push(rootDir);
  return rootDir;
}

async function writeDemoLibrary(rootDir: string, relativePath: string) {
  const target = join(rootDir, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(demoLibraryPath, target);
  return target;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
});

describe("resume data loaders", () => {
  it("loads and validates a library from the selected local file", async () => {
    const rootDir = await createTemporaryRoot();
    await writeDemoLibrary(rootDir, "data/resume-library.json");

    const library = await loadResumeLibrary({ rootDir });

    expect(library.profile.fullName).toBe("Jordan Example");
  });

  it("loads the fictional demo library only when demo mode is explicit", async () => {
    const library = await loadResumeLibrary({ source: "demo" });

    expect(library.profile.fullName).toBe("Jordan Example");
  });

  it("does not silently fall back when the personal file is missing", async () => {
    const rootDir = await createTemporaryRoot();
    await writeDemoLibrary(rootDir, "examples/sample-resume-library.json");

    await expect(loadResumeLibrary({ rootDir })).rejects.toMatchObject({
      code: "missing-file",
      dataPath: "data/resume-library.json",
    });
    await expect(
      loadResumeLibrary({ source: "demo", rootDir }),
    ).resolves.toBeDefined();
  });

  it("rejects unsupported source values instead of selecting demo data", async () => {
    await expect(
      loadResumeLibrary({ source: "unexpected" as "personal" }),
    ).rejects.toThrow("Unsupported resume data source.");
  });

  it("returns profile and grouped achievement data through typed loaders", async () => {
    const profile = await loadProfileData({ source: "demo" });
    const achievements = await loadAchievementData({ source: "demo" });

    expect(profile.fullName).toBe("Jordan Example");
    expect(achievements.jobs).toHaveLength(2);
    expect(achievements.projects).toHaveLength(2);
    expect(achievements.skills.length).toBeGreaterThan(0);
    expect(achievements.credentials.length).toBeGreaterThan(0);
  });

  it("reports malformed JSON without leaking file contents", async () => {
    const rootDir = await createTemporaryRoot();
    const filePath = join(rootDir, "data", "resume-library.json");
    await mkdir(join(rootDir, "data"), { recursive: true });
    await writeFile(filePath, "private candidate value: {", "utf8");

    let caught: unknown;
    try {
      await loadResumeLibrary({ rootDir });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DataLoadError);
    expect(caught).toMatchObject({
      code: "invalid-json",
      dataPath: "data/resume-library.json",
    });
    expect((caught as Error).message).not.toContain("private candidate value");
  });

  it("formats schema errors with field paths but without personal values", async () => {
    const rootDir = await createTemporaryRoot();
    const filePath = join(rootDir, "data", "resume-library.json");
    await mkdir(join(rootDir, "data"), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ profile: { fullName: "Private Candidate Name" } }),
      "utf8",
    );

    let caught: unknown;
    try {
      await loadResumeLibrary({ rootDir });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DataLoadError);
    expect(formatDataLoadError(caught as DataLoadError)).toContain(
      "schemaVersion",
    );
    expect(formatDataLoadError(caught as DataLoadError)).not.toContain(
      "Private Candidate Name",
    );
  });

  it("rejects duplicate IDs and reports the schema path", async () => {
    const rootDir = await createTemporaryRoot();
    const filePath = await writeDemoLibrary(
      rootDir,
      "data/resume-library.json",
    );
    const library = JSON.parse(await readFile(filePath, "utf8"));
    library.projects[0].id = library.jobs[0].id;
    await writeFile(filePath, JSON.stringify(library), "utf8");

    await expect(loadResumeLibrary({ rootDir })).rejects.toMatchObject({
      code: "invalid-schema",
    });
  });

  it("reports unreadable files without exposing operating-system details", async () => {
    const rootDir = await createTemporaryRoot();
    await mkdir(join(rootDir, "templates", "metadata.json"), {
      recursive: true,
    });

    await expect(loadTemplateMetadata({ rootDir })).rejects.toMatchObject({
      code: "unreadable-file",
      dataPath: "templates/metadata.json",
      message: expect.not.stringContaining(rootDir),
    });
  });

  it("loads generation history and validates template metadata", async () => {
    const rootDir = await createTemporaryRoot();
    const historyPath = join(rootDir, "data", "generation-history.json");
    const templatePath = join(rootDir, "templates", "metadata.json");
    await mkdir(join(rootDir, "data"), { recursive: true });
    await mkdir(join(rootDir, "templates"), { recursive: true });
    await writeFile(
      historyPath,
      JSON.stringify({ schemaVersion: 1, entries: [] }),
      "utf8",
    );
    await writeFile(
      templatePath,
      JSON.stringify({
        schemaVersion: 1,
        id: "template-jake-one-page",
        name: "Jake-style one-page resume",
        templateFile: "templates/jake-resume.tex",
        preferences: {
          sectionOrder: ["experience", "projects", "education", "skills"],
          maxPages: 1,
        },
      }),
      "utf8",
    );

    await expect(loadGenerationHistory({ rootDir })).resolves.toEqual({
      schemaVersion: 1,
      entries: [],
    });
    await expect(loadTemplateMetadata({ rootDir })).resolves.toMatchObject({
      id: "template-jake-one-page",
      name: "Jake-style one-page resume",
    });
  });

  it("distinguishes missing, unreadable, invalid JSON, and schema failures", async () => {
    expect(
      formatDataLoadError({
        code: "missing-file",
        dataPath: "data/resume-library.json",
      }),
    ).toContain("explicitly choose demo mode");
    expect(
      formatDataLoadError({
        code: "unreadable-file",
        dataPath: "templates/metadata.json",
      }),
    ).toContain("Check that the file exists");
    expect(
      formatDataLoadError({
        code: "invalid-json",
        dataPath: "data/generation-history.json",
      }),
    ).toContain("not valid JSON");
  });
});
