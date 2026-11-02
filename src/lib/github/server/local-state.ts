import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

/** Local worker storage only. Hosted composition must supply a durable cloud adapter. */
export async function assertLocalStatePath(root: string, target: string) {
  if (process.env.VERCEL === "1")
    throw new Error("Local GitHub state is unavailable on Vercel.");
  if (!isAbsolute(root) || resolve(root) !== root)
    throw new Error("An absolute resolved root is required.");
  const rel = relative(root, target);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new Error("Unsafe state path.");
  if (resolve(await realpath(root)) !== root)
    throw new Error("The state root must not be a symbolic link.");
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink())
        throw new Error("Symbolic state paths are forbidden.");
      if (current !== target && !info.isDirectory())
        throw new Error("Invalid state directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export async function readLocalState(
  root: string,
  target: string,
  maxBytes: number,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readLocalStateOnce(root, target, maxBytes);
    } catch (error) {
      if (!isTransientSharingError(error) || attempt >= 7) throw error;
      await sharingBackoff(attempt);
    }
  }
}

function isTransientSharingError(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    process.platform === "win32" &&
    (code === "EPERM" || code === "EACCES" || code === "EBUSY")
  );
}

const sharingBackoff = (attempt: number) =>
  new Promise((done) => setTimeout(done, 10 * 2 ** attempt));

async function readLocalStateOnce(
  root: string,
  target: string,
  maxBytes: number,
) {
  await assertLocalStatePath(root, target);
  const handle = await open(
    target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes)
      throw new Error("State file exceeds its limit.");
    const data = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(
        data,
        offset,
        data.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error("State changed during read.");
    return data.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function writeLocalState(
  root: string,
  target: string,
  text: string,
  renameFile = rename,
) {
  await assertLocalStatePath(root, target);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await assertLocalStatePath(root, target);
  const temporary = join(dirname(target), `.state-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    // Windows can briefly deny replacement while another process closes a reader.
    // Retry only the atomic rename; never unlink the existing state to make room.
    for (let attempt = 0; ; attempt++) {
      try {
        await renameFile(temporary, target);
        break;
      } catch (error) {
        if (!isTransientSharingError(error) || attempt >= 7) throw error;
        await sharingBackoff(attempt);
      }
    }
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

export async function withLocalStateLock<T>(
  root: string,
  target: string,
  work: () => Promise<T>,
  maxWaitMs = 5_000,
) {
  await assertLocalStatePath(root, target);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const lock = `${target}.lock`;
  const token = randomUUID();
  const start = Date.now();
  for (;;) {
    await assertLocalStatePath(root, lock);
    let handle;
    try {
      handle = await open(lock, "wx", 0o600);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        Date.now() - start > maxWaitMs
      )
        throw error;
      await reclaimDeadWriter(root, lock);
      // Never steal a live writer's lease based on elapsed time.
      await new Promise((done) => setTimeout(done, 10));
      continue;
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      await handle.sync();
      return await work();
    } finally {
      await handle.close();
      await rm(lock, { force: true });
    }
  }
}

async function reclaimDeadWriter(root: string, lock: string) {
  const guardPath = `${lock}.reclaim`;
  await assertLocalStatePath(root, guardPath);
  let guard;
  try {
    guard = await open(guardPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return;
    throw error;
  }
  try {
    let owner: { pid?: unknown };
    try {
      owner = JSON.parse(await readLocalState(root, lock, 4_096));
    } catch {
      return;
    }
    if (!Number.isSafeInteger(owner.pid) || Number(owner.pid) <= 0) return;
    try {
      process.kill(Number(owner.pid), 0);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
    }
    const stale = `${lock}.${randomUUID()}.stale`;
    await rename(lock, stale);
    await rm(stale, { force: true });
  } finally {
    await guard.close();
    await rm(guardPath, { force: true });
  }
}
