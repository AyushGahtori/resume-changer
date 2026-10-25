import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GenerationHistorySchema,
  ResumeLibrarySchema,
} from "../src/lib/schemas/resume-data.ts";

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const source = argument("--source");
const targetEmail = argument("--email");
if (!source || !targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail))
  throw new Error(
    "Pass --source <local project root> and --email <destination account email>.",
  );
const root = path.resolve(source);
const output = path.resolve(
  argument("--output") ?? ".runtime/account-migration.json",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const libraryBytes = await readFile(
  path.join(root, "data", "resume-library.json"),
);
const library = ResumeLibrarySchema.parse(
  JSON.parse(libraryBytes.toString("utf8")),
);
const historyBytes = await readFile(
  path.join(root, "data", "generation-history.json"),
);
const history = GenerationHistorySchema.parse(
  JSON.parse(historyBytes.toString("utf8")),
);
const artifactRoot = path.resolve(root, "data", "generations");
async function artifact(relative) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${artifactRoot}${path.sep}`))
    throw new Error(
      "A saved output references a file outside the generation directory.",
    );
  return readFile(absolute);
}
const outputs = [];
for (const entry of history.entries) {
  if (!entry.texPath)
    throw new Error("A saved generation has no LaTeX reference.");
  const latexBytes = await artifact(entry.texPath);
  const pdf = entry.pdfPath ? await artifact(entry.pdfPath) : undefined;
  if (
    !entry.texPath.endsWith(`-${hash(latexBytes).slice(0, 12)}.tex`) ||
    (pdf && !entry.pdfPath.endsWith(`-${hash(pdf).slice(0, 12)}.pdf`))
  )
    throw new Error("A source artifact failed its filename integrity check.");
  if (
    pdf &&
    (pdf.byteLength > 2 * 1024 * 1024 ||
      pdf.subarray(0, 5).toString("ascii") !== "%PDF-")
  )
    throw new Error(
      "A source PDF is invalid or exceeds the hosted file size limit.",
    );
  outputs.push({
    entry,
    latex: latexBytes.toString("utf8"),
    latexSha256: hash(latexBytes),
    ...(pdf ? { pdfBase64: pdf.toString("base64"), pdfSha256: hash(pdf) } : {}),
  });
}
const manifest = {
  librarySourceSha256: hash(libraryBytes),
  historySourceSha256: hash(historyBytes),
  libraryCanonicalSha256: hash(JSON.stringify(library)),
  jobs: library.jobs.length,
  projects: library.projects.length,
  skills: library.skills.length,
  credentials: library.credentials.length,
  achievementPoints: [...library.jobs, ...library.projects].reduce(
    (total, group) => total + group.points.length,
    0,
  ),
  generations: outputs.length,
  pdfFiles: outputs.filter((item) => item.pdfBase64).length,
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({
    schemaVersion: 1,
    targetEmail,
    library,
    history: outputs,
    manifest,
  }),
  { mode: 0o600 },
);
console.log(JSON.stringify({ output, ...manifest }));
