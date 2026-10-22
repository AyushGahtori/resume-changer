import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const libraryRoot =
  process.env.RESUME_LIBRARY_ROOT ??
  join(tmpdir(), "resume-changer-playwright-data-3010");

export const personalLibraryPath = join(
  libraryRoot,
  "data",
  "resume-library.json",
);

export const exampleLibraryPath = join(
  process.cwd(),
  "examples",
  "sample-resume-library.json",
);

/**
 * Keeps the shared personal library intact for the rest of the suite.
 *
 * Every spec runs against one data root, so a spec that writes a fixture has
 * to put the file back exactly as it found it. Otherwise the next spec reads
 * the fixture instead of the library the test server seeded, and a test that
 * expects the seeded data fails for a reason that has nothing to do with it.
 */
export function createPersonalLibraryGuard() {
  let original: string | null = null;

  return {
    async capture() {
      original = await readFile(personalLibraryPath, "utf8").catch(() => null);
    },
    async restore() {
      if (original === null) {
        await rm(personalLibraryPath, { force: true });
        return;
      }
      await writeFile(personalLibraryPath, original, "utf8");
    },
  };
}
