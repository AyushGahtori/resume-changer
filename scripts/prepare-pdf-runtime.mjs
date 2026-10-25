import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("The deployment PDF runtime must be prepared on Linux x64.");
const version = "0.14.1";
const archiveSha256 =
  "d669160999adbb3fea19055cac1124df20882194745052ae31d6eebc1309a845";
const root = path.resolve(".runtime/pdf");
const cache = path.join(root, "cache");
const downloads = path.resolve(".runtime/downloads");
const archive = path.join(downloads, `tectonic-${version}-linux-musl.tar.gz`);
const hash = (value) => createHash("sha256").update(value).digest("hex");
await mkdir(root, { recursive: true });
await mkdir(cache, { recursive: true });
await mkdir(downloads, { recursive: true });
let archiveBytes = await readFile(archive).catch(() => null);
if (!archiveBytes || hash(archiveBytes) !== archiveSha256) {
  const response = await fetch(
    `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${version}/tectonic-${version}-x86_64-unknown-linux-musl.tar.gz`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok)
    throw new Error("The pinned PDF compiler could not be downloaded.");
  archiveBytes = Buffer.from(await response.arrayBuffer());
  if (archiveBytes.length > 25_000_000 || hash(archiveBytes) !== archiveSha256)
    throw new Error("The PDF compiler download failed its pinned checksum.");
  await writeFile(archive, archiveBytes);
}
function run(command, args, environment = process.env, timeout = 120_000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout,
    env: environment,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `PDF runtime preparation failed: ${result.error?.message ?? result.stderr ?? "tool failed"}`,
    );
}
run("tar", [
  "--extract",
  "--gzip",
  "--file",
  archive,
  "--directory",
  root,
  "tectonic",
]);
const binary = path.join(root, "tectonic");
await chmod(binary, 0o755);
const warm = await mkdtemp(path.join(tmpdir(), "resume-deploy-warm-"));
try {
  const tex = path.join(warm, "warm.tex");
  run(process.execPath, [
    "--import",
    "tsx",
    "scripts/warm-tectonic-cache.mjs",
    tex,
  ]);
  const environment = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "C.UTF-8",
    XDG_CACHE_HOME: cache,
    TECTONIC_UNTRUSTED_MODE: "1",
  };
  run(binary, ["--untrusted", "--outdir", warm, tex], environment, 900_000);
  run(
    binary,
    ["--untrusted", "--only-cached", "--outdir", warm, tex],
    environment,
  );
} finally {
  await rm(warm, { recursive: true, force: true });
}
async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("PDF runtime assets may not contain symlinks.");
    bytes += entry.isDirectory()
      ? await directoryBytes(filename)
      : (await stat(filename)).size;
  }
  return bytes;
}
const totalBytes = await directoryBytes(root);
if (totalBytes > 120_000_000)
  throw new Error(
    `The compiler assets exceed the deployment budget (${totalBytes} bytes).`,
  );
const manifest = {
  schemaVersion: 1,
  version,
  archiveSha256,
  binarySha256: hash(await readFile(binary)),
  totalBytes,
};
await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
console.log(
  `Prepared verified offline Tectonic ${version} runtime: ${(totalBytes / 1024 / 1024).toFixed(1)} MB.`,
);
