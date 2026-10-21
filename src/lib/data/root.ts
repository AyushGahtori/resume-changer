import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

function hasLibrary(rootDir: string) {
  try {
    lstatSync(join(rootDir, "data", "resume-library.json"));
    return true;
  } catch (error) {
    // An inaccessible or invalid local file must still report its own error.
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

export function getPersonalDataRoot(rootDir?: string): string {
  const configuredRoot = rootDir ?? process.env.RESUME_LIBRARY_ROOT;
  if (configuredRoot !== undefined) return resolve(configuredRoot);

  const workingRoot = process.cwd();
  if (hasLibrary(workingRoot)) return workingRoot;

  try {
    // Linked worktrees share Git metadata, but do not copy ignored user data.
    const gitFile = readFileSync(join(workingRoot, ".git"), "utf8");
    const gitDirPath = /^gitdir: (.+)\s*$/m.exec(gitFile)?.[1]?.trim();
    if (!gitDirPath) return workingRoot;
    const gitDir = resolve(workingRoot, gitDirPath);
    const commonDirPath = readFileSync(
      join(gitDir, "commondir"),
      "utf8",
    ).trim();
    if (!commonDirPath) return workingRoot;
    const commonDir = resolve(gitDir, commonDirPath);
    const primaryRoot = dirname(commonDir);
    if (basename(commonDir) === ".git" && hasLibrary(primaryRoot)) {
      return primaryRoot;
    }
  } catch {
    // Ordinary checkouts and non-Git installs keep using their own data folder.
  }

  return workingRoot;
}
