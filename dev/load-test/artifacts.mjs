import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function assertRunId(runId) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(runId)) {
    throw new Error("The run id is invalid.");
  }
  return runId;
}

export function resolveRunDirectory(workspace, runId) {
  const id = assertRunId(runId);
  const base = path.resolve(workspace, ".runtime", "load-test");
  const target = path.resolve(base, id);
  const relative = path.relative(base, target);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Refusing a cleanup path outside the load-test runtime directory.",
    );
  }
  return target;
}

export async function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, contents);
  await rename(temporary, file);
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export function replayEvents(lines) {
  const users = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (event.type === "checkpoint" && Number.isInteger(event.user)) {
      users.set(event.user, {
        step: event.step,
        status: event.status,
        recordIds: event.recordIds ?? {},
      });
    }
  }
  return users;
}

export async function removeRunDirectory(workspace, runId) {
  const target = resolveRunDirectory(workspace, runId);
  const manifestPath = path.join(target, "manifest.json");
  const manifest = await readJson(manifestPath);
  if (manifest.runId !== runId) {
    throw new Error("The manifest does not belong to this run.");
  }
  if (!Array.isArray(manifest.users)) {
    throw new Error("The manifest has no user list.");
  }
  await rm(target, { recursive: true, force: false });
  return target;
}
