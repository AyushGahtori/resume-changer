import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.literal("0.14.1"),
  archiveSha256: z.literal(
    "d669160999adbb3fea19055cac1124df20882194745052ae31d6eebc1309a845",
  ),
  binarySha256: z.string().regex(/^[a-f0-9]{64}$/),
  totalBytes: z.number().positive().max(120_000_000),
});
export type BundledPdfRuntime = { binary: string; cacheDirectory: string };

export async function loadBundledPdfRuntime(
  assetRoot: string,
  temporaryRoot = tmpdir(),
): Promise<BundledPdfRuntime> {
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(path.join(assetRoot, "manifest.json"), "utf8")),
  );
  const binary = path.join(assetRoot, "tectonic");
  if (
    createHash("sha256")
      .update(await readFile(binary))
      .digest("hex") !== manifest.binarySha256
  )
    throw new Error("The bundled compiler failed its integrity check.");
  const directory = await mkdtemp(
    path.join(temporaryRoot, "resume-pdf-cache-"),
  );
  try {
    const cacheDirectory = path.join(directory, "cache");
    await cp(path.join(assetRoot, "cache"), cacheDirectory, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    return { binary, cacheDirectory };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

let runtime: Promise<BundledPdfRuntime> | undefined;
export function getBundledPdfRuntime(): Promise<BundledPdfRuntime | undefined> {
  if (
    process.env.VERCEL !== "1" &&
    process.env.RESUME_PDF_RUNTIME !== "bundled"
  )
    return Promise.resolve(undefined);
  runtime ??= loadBundledPdfRuntime(path.resolve(".runtime/pdf")).catch(
    (error) => {
      runtime = undefined;
      throw error;
    },
  );
  return runtime;
}

/** Child compilers receive tool paths/cache settings, never application credentials. */
export function compilerEnvironment(
  environment: Record<string, string | undefined>,
  workingDirectory: string,
  cacheDirectory?: string,
): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    TECTONIC_UNTRUSTED_MODE: "1",
    TEMP: workingDirectory,
    TMP: workingDirectory,
    TMPDIR: workingDirectory,
  };
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "LANG",
    "LC_ALL",
  ])
    if (environment[key] !== undefined) allowed[key] = environment[key];
  if (!allowed.PATH && environment.Path) allowed.PATH = environment.Path;
  if (cacheDirectory ?? environment.XDG_CACHE_HOME)
    allowed.XDG_CACHE_HOME = cacheDirectory ?? environment.XDG_CACHE_HOME;
  return allowed;
}
