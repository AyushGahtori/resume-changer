import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPersonalDataRoot } from "../../../src/lib/data/root";
import {
  loadGenerationHistory,
  loadResumeLibrary,
} from "../../../src/lib/data/loaders";
import { updateAchievementPoint } from "../../../src/lib/data/writers";
import {
  getGenerationHistoryItem,
  listGenerationHistory,
  saveGenerationHistoryItem,
} from "../../../src/lib/generation/history-store";

const samplePath = join(process.cwd(), "examples/sample-resume-library.json");
let fixtureRoot: string;
let primary: string;
let worktree: string;
let gitDir: string;

async function writeLibrary(root: string) {
  await mkdir(join(root, "data"), { recursive: true });
  await copyFile(samplePath, join(root, "data/resume-library.json"));
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "resume-worktree-test-"));
  primary = join(fixtureRoot, "primary checkout");
  worktree = join(fixtureRoot, "linked worktree");
  gitDir = join(primary, ".git/worktrees/linked");
  await mkdir(worktree, { recursive: true });
  await mkdir(gitDir, { recursive: true });
  await writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  await writeFile(join(gitDir, "commondir"), "../..\n");
  await writeLibrary(primary);
  vi.stubEnv("RESUME_LIBRARY_ROOT", undefined);
  vi.spyOn(process, "cwd").mockReturnValue(worktree);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("personal data in linked Git worktrees", () => {
  it("loads the primary checkout library when ignored data is absent", async () => {
    expect(getPersonalDataRoot()).toBe(primary);
    await expect(loadResumeLibrary()).resolves.toMatchObject({
      profile: { fullName: "Jordan Example" },
    });
  });

  it("resolves relative gitdir and absolute commondir paths", async () => {
    await writeFile(
      join(worktree, ".git"),
      `gitdir: ${relative(worktree, gitDir)}\r\n`,
    );
    await writeFile(join(gitDir, "commondir"), `${join(primary, ".git")}\r\n`);
    expect(getPersonalDataRoot()).toBe(primary);
  });

  it("prefers a library in the current worktree", async () => {
    await writeLibrary(worktree);
    expect(getPersonalDataRoot()).toBe(worktree);
  });

  it("reports invalid local data instead of falling back to the primary checkout", async () => {
    await writeLibrary(worktree);
    await writeFile(join(worktree, "data/resume-library.json"), "invalid JSON");
    await expect(loadResumeLibrary()).rejects.toMatchObject({
      code: "invalid-json",
    });
  });

  it("reports an unreadable local library instead of falling back", async () => {
    await mkdir(join(worktree, "data/resume-library.json"), {
      recursive: true,
    });
    await expect(loadResumeLibrary()).rejects.toMatchObject({
      code: "unreadable-file",
    });
  });

  it("honors an explicit root before environment configuration and discovery", async () => {
    vi.stubEnv("RESUME_LIBRARY_ROOT", primary);
    expect(getPersonalDataRoot(worktree)).toBe(worktree);
    await expect(
      loadResumeLibrary({ rootDir: worktree }),
    ).rejects.toMatchObject({ code: "missing-file" });
  });

  it("honors an environment root even when its library is absent", async () => {
    vi.stubEnv("RESUME_LIBRARY_ROOT", worktree);
    expect(getPersonalDataRoot()).toBe(worktree);
    await expect(loadResumeLibrary()).rejects.toMatchObject({
      code: "missing-file",
    });
  });

  it("uses environment configuration before a worktree's own library", async () => {
    await writeLibrary(worktree);
    vi.stubEnv("RESUME_LIBRARY_ROOT", primary);
    expect(getPersonalDataRoot()).toBe(primary);
  });

  it("keeps demo data in the current checkout regardless of personal data root", async () => {
    vi.stubEnv("RESUME_LIBRARY_ROOT", primary);
    await mkdir(join(worktree, "examples"));
    await copyFile(
      samplePath,
      join(worktree, "examples/sample-resume-library.json"),
    );
    await expect(loadResumeLibrary({ source: "demo" })).resolves.toMatchObject({
      profile: { fullName: "Jordan Example" },
    });
    await rm(join(worktree, "examples/sample-resume-library.json"));
    await expect(loadResumeLibrary({ source: "demo" })).rejects.toMatchObject({
      code: "missing-file",
      dataPath: "examples/sample-resume-library.json",
    });
  });

  it.each(["missing", "malformed", "ordinary-checkout", "submodule"])(
    "retains the current root for %s Git metadata",
    async (kind) => {
      await rm(join(worktree, ".git"));
      if (kind === "malformed")
        await writeFile(join(worktree, ".git"), "not a gitdir");
      if (kind === "ordinary-checkout") await mkdir(join(worktree, ".git"));
      if (kind === "submodule") {
        await writeFile(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
        await rm(join(gitDir, "commondir"));
      }
      expect(getPersonalDataRoot()).toBe(worktree);
      await expect(loadResumeLibrary()).rejects.toMatchObject({
        code: "missing-file",
      });
    },
  );

  it("reports a missing personal file if neither checkout has one", async () => {
    await rm(join(primary, "data/resume-library.json"));
    expect(getPersonalDataRoot()).toBe(worktree);
    await expect(loadResumeLibrary()).rejects.toMatchObject({
      code: "missing-file",
    });
  });

  it("saves edits and backups to the same primary library used for reading", async () => {
    const original = await readFile(
      join(primary, "data/resume-library.json"),
      "utf8",
    );
    await updateAchievementPoint("achievement-service-capacity-design", {
      changes: {
        text: "Updated synthetic achievement from a linked worktree.",
      },
    });
    const library = await loadResumeLibrary();
    expect(
      library.jobs
        .flatMap((job) => job.points)
        .find((point) => point.id === "achievement-service-capacity-design")
        ?.text,
    ).toBe("Updated synthetic achievement from a linked worktree.");
    expect(
      await readFile(join(primary, "data/resume-library.json.bak"), "utf8"),
    ).toBe(original);
    await expect(
      readFile(join(worktree, "data/resume-library.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("shares history metadata and artifacts with the resolved personal data root", async () => {
    const saved = await saveGenerationHistoryItem({
      id: "generation-worktree-test",
      createdAt: "2026-10-19T12:00:00.000Z",
      company: "Example Systems",
      role: "Platform Engineer",
      selectedAchievementIds: ["achievement-service-capacity-design"],
      generatedBullets: [],
      provider: "manual",
      status: "drafted",
      repairAttemptCount: 0,
      latex: "\\documentclass{article}\\begin{document}Resume\\end{document}",
    });
    expect(await listGenerationHistory()).toEqual([saved]);
    expect((await loadGenerationHistory()).entries).toEqual([saved]);
    expect((await getGenerationHistoryItem(saved.id)).latex).toContain(
      "Resume",
    );
    expect(dirname(join(primary, saved.texPath!))).toBe(
      join(primary, "data/generations"),
    );
    await expect(
      readFile(join(primary, saved.texPath!), "utf8"),
    ).resolves.toContain("Resume");
    await expect(
      readFile(join(worktree, "data/generation-history.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
