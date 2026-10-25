import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("owner backup preparation", () => {
  it("preserves source bytes and exports verified artifacts only for the chosen destination", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "resume-backup-test-"));
    roots.push(root);
    await mkdir(path.join(root, "data/generations"), { recursive: true });
    await copyFile(
      "examples/sample-resume-library.json",
      path.join(root, "data/resume-library.json"),
    );
    const latex = "Fictional resume with source evidence";
    const hash = createHash("sha256").update(latex).digest("hex");
    const entry = {
      id: "generation-fixture",
      createdAt: "2026-10-19T12:00:00.000Z",
      role: "Engineer",
      selectedAchievementIds: ["achievement-api-reliability"],
      generatedBullets: [],
      provider: "none",
      status: "drafted",
      repairAttemptCount: 0,
      texPath: `data/generations/generation-fixture-${hash.slice(0, 12)}.tex`,
    };
    await writeFile(path.join(root, entry.texPath), latex);
    await writeFile(
      path.join(root, "data/generation-history.json"),
      JSON.stringify({ schemaVersion: 1, entries: [entry] }),
    );
    const before = await readFile(path.join(root, "data/resume-library.json"));
    const output = path.join(root, "backup.json");
    const args = [
      "--import",
      "tsx",
      "scripts/build-account-backup.mjs",
      "--source",
      root,
      "--email",
      "owner@example.test",
      "--output",
      output,
    ];
    execFileSync(process.execPath, args, { stdio: "pipe", windowsHide: true });
    const saved = JSON.parse(await readFile(output, "utf8"));
    expect(saved.targetEmail).toBe("owner@example.test");
    expect(saved.history[0].latexSha256).toBe(hash);
    expect(saved.manifest.generations).toBe(1);
    expect(await readFile(path.join(root, "data/resume-library.json"))).toEqual(
      before,
    );
    await writeFile(path.join(root, entry.texPath), "Tampered output");
    expect(() =>
      execFileSync(process.execPath, args, {
        stdio: "pipe",
        windowsHide: true,
      }),
    ).toThrow();
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(saved);
  }, 30_000);
});
