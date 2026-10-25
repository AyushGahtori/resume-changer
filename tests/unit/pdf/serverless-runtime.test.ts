import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import sample from "../../../examples/sample-resume-library.json";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import { compileLatexToPdf } from "../../../src/lib/pdf/compile-service";
import { readPdfPageCount } from "../../../src/lib/pdf/page-count";
import {
  compilerEnvironment,
  loadBundledPdfRuntime,
} from "../../../src/lib/pdf/serverless-runtime";
import { createOnePagePdf } from "../../helpers/pdf-fixture";

const roots: string[] = [];
async function root() {
  const directory = await mkdtemp(path.join(tmpdir(), "resume-runtime-test-"));
  roots.push(directory);
  return directory;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("serverless PDF runtime", () => {
  it("copies only shared compiler resources into writable temporary storage and verifies the binary", async () => {
    const directory = await root();
    const assets = path.join(directory, "assets");
    const temp = path.join(directory, "temp");
    await mkdir(path.join(assets, "cache", "Tectonic"), { recursive: true });
    await mkdir(temp);
    await writeFile(
      path.join(assets, "cache", "Tectonic", "font.fixture"),
      "fictional font resource",
    );
    const binary = Buffer.from("fictional compiler binary");
    await writeFile(path.join(assets, "tectonic"), binary);
    await writeFile(
      path.join(assets, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        version: "0.14.1",
        archiveSha256:
          "d669160999adbb3fea19055cac1124df20882194745052ae31d6eebc1309a845",
        binarySha256: createHash("sha256").update(binary).digest("hex"),
        totalBytes: 100,
      }),
    );
    const runtime = await loadBundledPdfRuntime(assets, temp);
    expect(runtime.binary).toBe(path.join(assets, "tectonic"));
    expect(
      await readFile(
        path.join(runtime.cacheDirectory, "Tectonic", "font.fixture"),
        "utf8",
      ),
    ).toBe("fictional font resource");
    await writeFile(
      path.join(runtime.cacheDirectory, "Tectonic", "font.fixture"),
      "temporary cache changes",
    );
    expect(
      await readFile(
        path.join(assets, "cache", "Tectonic", "font.fixture"),
        "utf8",
      ),
    ).toBe("fictional font resource");
    await writeFile(path.join(assets, "tectonic"), "tampered compiler");
    await expect(loadBundledPdfRuntime(assets, temp)).rejects.toThrow(
      /integrity/,
    );
  });

  it("never supplies AI, database, file-store or deployment credentials to the compiler", () => {
    const environment = compilerEnvironment(
      {
        PATH: "/tools",
        HOME: "/home/test",
        GEMINI_API_KEY: "fictional-secret",
        VERCEL_OIDC_TOKEN: "fictional-token",
        BLOB_READ_WRITE_TOKEN: "fictional-blob-secret",
        GOOGLE_APPLICATION_CREDENTIALS: "/private/key.json",
      },
      "/tmp/compile",
      "/tmp/cached-resources",
    );
    expect(environment).toMatchObject({
      PATH: "/tools",
      TEMP: "/tmp/compile",
      XDG_CACHE_HOME: "/tmp/cached-resources",
      TECTONIC_UNTRUSTED_MODE: "1",
    });
    for (const name of [
      "GEMINI_API_KEY",
      "VERCEL_OIDC_TOKEN",
      "BLOB_READ_WRITE_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
    ])
      expect(environment).not.toHaveProperty(name);
  });

  it("uses the real PDF parser to count pages without Poppler", async () => {
    await expect(readPdfPageCount(createOnePagePdf())).resolves.toBe(1);
    await expect(readPdfPageCount(Buffer.from("not a PDF"))).rejects.toThrow();
  });

  it("compiles and enforces the one-page limit using PDF.js without spawning pdfinfo", async () => {
    const tempRoot = await root();
    const pdf = createOnePagePdf();
    const latex = renderResumeLatex({
      library: sample as ResumeLibrary,
      selectedAchievementIds: [],
    });
    const runProcess = vi.fn(
      async (
        _executable: string,
        args: string[],
        _cwd: string,
        _timeout: number,
        environment?: NodeJS.ProcessEnv,
      ) => {
        expect(args).toContain("--only-cached");
        expect(environment).not.toHaveProperty("GEMINI_API_KEY");
        const source = args.at(-1)!;
        await writeFile(source.replace(/\.tex$/, ".pdf"), pdf);
        return { code: 0, stdout: "compiled", stderr: "" };
      },
    );
    vi.stubEnv("GEMINI_API_KEY", "fictional-secret");
    const result = await compileLatexToPdf(latex, {
      tempRoot,
      runProcess,
      countPages: readPdfPageCount,
    });
    expect(result.pageCount).toBe(1);
    expect(result.pdf).toEqual(pdf);
    expect(runProcess).toHaveBeenCalledTimes(1);
    await expect(
      compileLatexToPdf(latex, {
        tempRoot,
        runProcess,
        countPages: async () => 2,
      }),
    ).rejects.toMatchObject({ code: "PAGE_LIMIT_EXCEEDED" });
  });
});
