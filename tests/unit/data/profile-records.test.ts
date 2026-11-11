import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateResumeProfile } from "../../../src/lib/data/profile-records";
import { LibraryWriteError } from "../../../src/lib/data/writers";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const demoLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);
const temporaryRoots: string[] = [];

async function createRoot() {
  const root = await mkdtemp(join(tmpdir(), "resume-changer-profile-test-"));
  temporaryRoots.push(root);
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
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("resume profile writer", () => {
  it("updates the name and email, replaces links, and clears an empty phone", async () => {
    const { root, file } = await createRoot();
    const before = await readLibrary(file);

    await updateResumeProfile(
      {
        fullName: before.profile.fullName,
        phone: "555-0100",
        links: before.profile.links,
      },
      { rootDir: root },
    );
    expect((await readLibrary(file)).profile.phone).toBe("555-0100");

    const result = await updateResumeProfile(
      {
        fullName: "Avery Example",
        email: "  avery@example.com  ",
        phone: "",
        links: [
          {
            label: " LinkedIn ",
            url: " https://example.com/linkedin ",
          },
          { label: "GitHub", url: "https://example.com/github" },
          { label: "Portfolio", url: "https://example.com/portfolio" },
        ],
      },
      { rootDir: root },
    );

    const saved = await readLibrary(file);
    expect(result.profile.fullName).toBe("Avery Example");
    expect(saved.profile.fullName).toBe("Avery Example");
    expect(saved.profile.email).toBe("avery@example.com");
    expect(saved.profile.links).toEqual([
      { label: "LinkedIn", url: "https://example.com/linkedin" },
      { label: "GitHub", url: "https://example.com/github" },
      { label: "Portfolio", url: "https://example.com/portfolio" },
    ]);
    expect(saved.profile.phone).toBeUndefined();
    expect(saved.profile).not.toHaveProperty("phone");
    expect(saved.profile.education).toHaveLength(
      before.profile.education.length,
    );
    expect(saved.profile.education).toEqual(before.profile.education);
    expect(saved.profile.id).toBe(before.profile.id);
    expect(result.profile.id).toBe(before.profile.id);
    expect(saved.jobs).toHaveLength(before.jobs.length);
    expect(saved.projects).toHaveLength(before.projects.length);
    expect(saved.skills).toHaveLength(before.skills.length);
    expect(saved.credentials).toHaveLength(before.credentials.length);
    expect(saved.preferences).toEqual(before.preferences);
    expect(saved.profile.headline).toBe(before.profile.headline);
    expect(saved.profile.location).toBe(before.profile.location);
    expect(saved.profile.summary).toBe(before.profile.summary);
  });

  it("rejects an invalid email", async () => {
    const { root, file, original } = await createRoot();

    await expect(
      updateResumeProfile(
        {
          fullName: "Jordan Example",
          email: "not-an-email",
          links: [],
        },
        { rootDir: root },
      ),
    ).rejects.toBeInstanceOf(LibraryWriteError);

    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("rejects more than 12 links", async () => {
    const { root, file, original } = await createRoot();

    await expect(
      updateResumeProfile(
        {
          fullName: "Jordan Example",
          links: Array.from({ length: 13 }, (_, index) => ({
            label: `Link ${index + 1}`,
            url: `https://example.com/link-${index + 1}`,
          })),
        },
        { rootDir: root },
      ),
    ).rejects.toMatchObject({
      name: "LibraryWriteError",
      code: "invalid-input",
    });

    expect(await readFile(file, "utf8")).toBe(original);
  });
});
