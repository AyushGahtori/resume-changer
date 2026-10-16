import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { renderResumeLatex } from "../../../src/lib/latex/render-resume";
import { validateResumeLatex } from "../../../src/lib/latex/validate-resume-latex";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";
import {
  compileLatexToPdf,
  CompileRequestSchema,
  PdfCompileError,
} from "../../../src/lib/pdf/compile-service";

const roots: string[] = [];
const latex = renderResumeLatex({
  library: sampleLibrary as ResumeLibrary,
  selectedAchievementIds: [],
});
const pdf = Buffer.from("%PDF-1.7\nsynthetic test pdf");

async function createRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "resume-compile-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("CompileRequestSchema", () => {
  it("requires non-empty LaTeX within the request limit", () => {
    expect(CompileRequestSchema.safeParse({ latex }).success).toBe(true);
    expect(CompileRequestSchema.safeParse({ latex: " " }).success).toBe(false);
    expect(CompileRequestSchema.parse({ latex }).latex).toBe(latex);
    expect(
      CompileRequestSchema.safeParse({ latex: "x".repeat(150_001) }).success,
    ).toBe(false);
    expect(
      CompileRequestSchema.safeParse({
        latex,
        compilerArgs: ["-Zshell-escape"],
      }).success,
    ).toBe(false);
  });
});

describe("compileLatexToPdf", () => {
  it("returns a one-page PDF, uses fixed untrusted offline flags, and cleans temporary files", async () => {
    expect(validateResumeLatex(latex)).toEqual({ valid: true, errors: [] });
    const tempRoot = await createRoot();
    const calls: string[][] = [];
    const events: Array<{ stage: string; data?: unknown }> = [];
    const result = await compileLatexToPdf(latex, {
      tempRoot,
      onDiagnostic: (event) => events.push(event),
      runProcess: async (_executable, args, cwd) => {
        calls.push(args);
        if (calls.length === 1) {
          const input = args.at(-1)!;
          const source = await readFile(input, "utf8");
          expect(source).toBe(latex);
          const outputDirectory = args[args.indexOf("--outdir") + 1];
          await writeFile(
            path.join(
              outputDirectory,
              path.basename(input).replace(/\.tex$/, ".pdf"),
            ),
            pdf,
          );
          return { code: 0, stdout: "compiled", stderr: "" };
        }
        expect(cwd).toBe(path.dirname(args.at(-1)!));
        return { code: 0, stdout: "Pages:           1\n", stderr: "" };
      },
    });

    expect(result).toEqual({ pdf, pageCount: 1 });
    expect(calls[0]).toContain("--untrusted");
    expect(calls[0]).toContain("--only-cached");
    expect(calls[0]).not.toContain("-Zshell-escape");
    expect(events.map((event) => event.stage)).toEqual([
      "pdf.temp-workspace",
      "pdf.source-written",
      "pdf.tectonic-started",
      "pdf.tectonic-finished",
      "pdf.page-count-started",
      "pdf.page-count-result",
      "pdf.verified",
    ]);
    expect(events[2].data).toMatchObject({
      executable: expect.stringMatching(/^tectonic(\.exe)?$/),
      args: expect.arrayContaining(["--untrusted", "--only-cached"]),
    });
    expect(events[6].data).toMatchObject({ pageCount: 1, signature: "%PDF-" });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("rejects documents that exceed the one-page limit and still cleans up", async () => {
    const tempRoot = await createRoot();
    await expect(
      compileLatexToPdf(latex, {
        tempRoot,
        runProcess: async (_executable, args) => {
          if (args.includes("--outdir")) {
            const input = args.at(-1)!;
            await writeFile(
              path.join(
                args[args.indexOf("--outdir") + 1],
                path.basename(input).replace(/\.tex$/, ".pdf"),
              ),
              pdf,
            );
            return { code: 0, stdout: "", stderr: "" };
          }
          return { code: 0, stdout: "Pages: 2\n", stderr: "" };
        },
      }),
    ).rejects.toMatchObject({ code: "PAGE_LIMIT_EXCEEDED", status: 422 });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("reports invalid LaTeX from a compiler diagnostic and cleans up", async () => {
    const tempRoot = await createRoot();
    await expect(
      compileLatexToPdf(latex, {
        tempRoot,
        runProcess: async () => ({
          code: 1,
          stdout: "",
          stderr: "! Undefined control sequence.",
        }),
      }),
    ).rejects.toMatchObject({
      code: "LATEX_ERROR",
      diagnostics: "! Undefined control sequence.",
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("rejects malformed or unsafe LaTeX before creating compiler files or spawning a process", async () => {
    const tempRoot = await createRoot();
    const runProcess = async () => {
      throw new Error("Compiler must not run for rejected LaTeX");
    };

    await expect(
      compileLatexToPdf(
        latex.replace("Jordan Example", String.raw`\input{secret}`),
        {
          tempRoot,
          runProcess,
        },
      ),
    ).rejects.toMatchObject({
      code: "LATEX_VALIDATION_ERROR",
      status: 422,
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("reports timeouts and missing compiler installations", async () => {
    const timeoutRoot = await createRoot();
    await expect(
      compileLatexToPdf(latex, {
        tempRoot: timeoutRoot,
        runProcess: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          timedOut: true,
        }),
      }),
    ).rejects.toBeInstanceOf(PdfCompileError);
    expect(await readdir(timeoutRoot)).toEqual([]);

    const missingRoot = await createRoot();
    await expect(
      compileLatexToPdf(latex, {
        tempRoot: missingRoot,
        runProcess: async () => ({
          code: null,
          stdout: "",
          stderr: "",
          error: Object.assign(new Error("not found"), { code: "ENOENT" }),
        }),
      }),
    ).rejects.toMatchObject({ code: "COMPILER_NOT_FOUND", status: 503 });
    expect(await readdir(missingRoot)).toEqual([]);
  });

  it("rejects invalid compiler output and reports missing page-count tooling", async () => {
    const invalidRoot = await createRoot();
    await expect(
      compileLatexToPdf(latex, {
        tempRoot: invalidRoot,
        runProcess: async (_executable, args) => {
          if (args.includes("--outdir")) {
            const input = args.at(-1)!;
            await writeFile(
              path.join(
                args[args.indexOf("--outdir") + 1],
                path.basename(input).replace(/\.tex$/, ".pdf"),
              ),
              "not pdf",
            );
            return { code: 0, stdout: "", stderr: "" };
          }
          return { code: 0, stdout: "Pages: 1", stderr: "" };
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_PDF" });
    expect(await readdir(invalidRoot)).toEqual([]);

    const missingPdfInfoRoot = await createRoot();
    await expect(
      compileLatexToPdf(latex, {
        tempRoot: missingPdfInfoRoot,
        runProcess: async (_executable, args) => {
          if (args.includes("--outdir")) {
            const input = args.at(-1)!;
            await writeFile(
              path.join(
                args[args.indexOf("--outdir") + 1],
                path.basename(input).replace(/\.tex$/, ".pdf"),
              ),
              pdf,
            );
            return { code: 0, stdout: "", stderr: "" };
          }
          return {
            code: null,
            stdout: "",
            stderr: "",
            error: Object.assign(new Error("not found"), { code: "ENOENT" }),
          };
        },
      }),
    ).rejects.toMatchObject({ code: "PDF_INFO_NOT_FOUND", status: 503 });
    expect(await readdir(missingPdfInfoRoot)).toEqual([]);
  });
});
