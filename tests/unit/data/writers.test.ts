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
import type {
  AchievementPoint,
  ResumeLibrary,
} from "../../../src/lib/schemas/resume-data";
import {
  LibraryWriteError,
  createAchievementPoint,
  updateAchievementPoint,
} from "../../../src/lib/data/writers";

const demoLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);
const temporaryRoots: string[] = [];

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-changer-writer-test-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "data"), { recursive: true });
  const file = join(root, "data", "resume-library.json");
  await copyFile(demoLibraryPath, file);
  return { root, file, original: await readFile(file, "utf8") };
}

function newPoint(id = "achievement-new-test-entry"): AchievementPoint {
  return {
    id,
    text: "Added a synthetic test achievement for reliable service releases.",
    tags: ["testing"],
    skillIds: ["skill-automation"],
    metrics: [],
    source: { type: "direct-user", label: "Synthetic unit test" },
    enabled: true,
  };
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

describe("local achievement writer", () => {
  it("creates a point, persists it, and keeps a copy of the prior library", async () => {
    const { root, file, original } = await createRoot();

    const result = await createAchievementPoint(
      {
        parentType: "job",
        parentId: "job-example-cloud-labs",
        point: newPoint(),
      },
      { rootDir: root },
    );

    expect(result.point.id).toBe("achievement-new-test-entry");
    expect(result.library.jobs[0].points.at(-1)?.id).toBe(result.point.id);
    expect(await readFile(`${file}.bak`, "utf8")).toBe(original);
    expect((await readLibrary(file)).jobs[0].points.at(-1)?.text).toBe(
      result.point.text,
    );
  });

  it("updates editable fields without changing the achievement ID", async () => {
    const { root, file } = await createRoot();
    const updatedText = "Revised synthetic achievement wording.";
    const result = await updateAchievementPoint(
      "achievement-service-capacity-design",
      {
        changes: {
          text: updatedText,
          tags: ["architecture", "capacity"],
          skillIds: ["skill-system-design"],
          source: { type: "direct-user", label: "Synthetic edit" },
          enabled: false,
          metrics: [
            {
              id: "metric-synthetic-throughput",
              label: "Throughput improvement",
              value: "28",
              unit: "%",
              evidence: "Synthetic test evidence only.",
            },
          ],
        },
      },
      { rootDir: root },
    );

    expect(result.point).toMatchObject({
      id: "achievement-service-capacity-design",
      text: updatedText,
      tags: ["architecture", "capacity"],
      enabled: false,
      source: { type: "direct-user", label: "Synthetic edit" },
    });
    expect(
      (await readLibrary(file)).jobs[0].points[0].metrics[0].evidence,
    ).toBe("Synthetic test evidence only.");
  });

  it("rejects duplicate IDs and leaves the original file unchanged", async () => {
    const { root, file, original } = await createRoot();

    await expect(
      createAchievementPoint(
        {
          parentType: "job",
          parentId: "job-example-cloud-labs",
          point: newPoint("achievement-ci-cd-pipeline"),
        },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "invalid-library" });

    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects unknown skills and does not write invalid data", async () => {
    const { root, file, original } = await createRoot();

    await expect(
      updateAchievementPoint(
        "achievement-service-capacity-design",
        { changes: { skillIds: ["skill-not-in-library"] } },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "invalid-library" });

    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("reports missing parents and points without modifying the library", async () => {
    const { root, file, original } = await createRoot();

    await expect(
      createAchievementPoint(
        {
          parentType: "project",
          parentId: "project-missing",
          point: newPoint(),
        },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      updateAchievementPoint(
        "achievement-not-found",
        { changes: { enabled: false } },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects a concurrent save lock without touching the current file", async () => {
    const { root, file, original } = await createRoot();
    await writeFile(`${file}.lock`, "locked by synthetic test", "utf8");

    await expect(
      updateAchievementPoint(
        "achievement-service-capacity-design",
        { changes: { enabled: false } },
        { rootDir: root },
      ),
    ).rejects.toBeInstanceOf(LibraryWriteError);
    await expect(
      updateAchievementPoint(
        "achievement-service-capacity-design",
        { changes: { enabled: false } },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "locked" });
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("leaves the current library intact when backup preparation fails", async () => {
    const { root, file, original } = await createRoot();
    await mkdir(`${file}.bak`);

    await expect(
      updateAchievementPoint(
        "achievement-service-capacity-design",
        { changes: { enabled: false } },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({ code: "io-error" });

    expect(await readFile(file, "utf8")).toBe(original);
  });
});
