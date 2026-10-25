import { remainingRequestTime } from "../cloud/request-budget";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { validateResumeLatex } from "../latex/validate-resume-latex";
import { validateHostedLatex } from "../latex/validate-hosted-latex";
import {
  compilerEnvironment,
  getBundledPdfRuntime,
} from "./serverless-runtime";
import { readPdfPageCount } from "./page-count";
import { CompilerBusyError, withCompilerSlot } from "./compiler-pool";

export const CompileRequestSchema = z
  .object({
    latex: z
      .string()
      .min(1)
      .max(150_000)
      .refine((value) => value.trim().length > 0, "LaTeX source is required."),
  })
  .strict();

export type CompileErrorCode =
  | "COMPILER_NOT_FOUND"
  | "PDF_INFO_NOT_FOUND"
  | "COMPILE_TIMEOUT"
  | "LATEX_ERROR"
  | "LATEX_VALIDATION_ERROR"
  | "INVALID_PDF"
  | "PAGE_LIMIT_EXCEEDED"
  | "COMPILE_FAILED";

export class PdfCompileError extends Error {
  constructor(
    message: string,
    readonly code: CompileErrorCode,
    readonly diagnostics = "",
    readonly status = 422,
  ) {
    super(message);
    this.name = "PdfCompileError";
  }
}

type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
  timedOut?: boolean;
};

type RunProcess = (
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  environment?: NodeJS.ProcessEnv,
) => Promise<ProcessResult>;

type CompileOptions = {
  tempRoot?: string;
  tectonicPath?: string;
  pdfInfoPath?: string;
  timeoutMs?: number;
  allowPageOverflow?: boolean;
  runProcess?: RunProcess;
  countPages?: (pdf: Uint8Array) => Promise<number>;
};

const MAX_DIAGNOSTIC_LENGTH = 12_000;
const DEFAULT_TIMEOUT_MS = 30_000;

function trimDiagnostics(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_DIAGNOSTIC_LENGTH
    ? trimmed.slice(-MAX_DIAGNOSTIC_LENGTH)
    : trimmed;
}

function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  environment?: NodeJS.ProcessEnv,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(executable, args, {
      cwd,
      env: environment ?? compilerEnvironment(process.env, cwd),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    function finish(result: ProcessResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = (stdout + chunk.toString()).slice(-MAX_DIAGNOSTIC_LENGTH);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_DIAGNOSTIC_LENGTH);
    });
    child.once("error", (error: NodeJS.ErrnoException) =>
      finish({ code: null, stdout, stderr, error, timedOut }),
    );
    child.once("close", (code) => finish({ code, stdout, stderr, timedOut }));
  });
}

function diagnosticsOf(result: ProcessResult, directory: string): string {
  const normalizedDirectory = directory.replace(/\\/g, "/");
  return trimDiagnostics(`${result.stderr}\n${result.stdout}`)
    .replaceAll(directory, "[temporary directory]")
    .replaceAll(normalizedDirectory, "[temporary directory]");
}

export async function compileLatexToPdf(
  latex: string,
  options: CompileOptions = {},
): Promise<{ pdf: Buffer; pageCount: number }> {
  if (
    process.env.VERCEL !== "1" &&
    process.env.RESUME_PDF_RUNTIME !== "bundled"
  )
    return compileInSlot(latex, options);
  try {
    return await withCompilerSlot(
      () => compileInSlot(latex, options),
      remainingRequestTime(10_000),
    );
  } catch (error) {
    if (error instanceof CompilerBusyError)
      throw new PdfCompileError(error.message, "COMPILE_TIMEOUT", "", 503);
    throw error;
  }
}

async function compileInSlot(
  latex: string,
  options: CompileOptions,
): Promise<{ pdf: Buffer; pageCount: number }> {
  const parsed = CompileRequestSchema.safeParse({ latex });
  if (!parsed.success) {
    throw new PdfCompileError(
      "Provide valid LaTeX source to compile.",
      "LATEX_ERROR",
    );
  }

  const validation = validateResumeLatex(parsed.data.latex);
  if (!validation.valid) {
    throw new PdfCompileError(
      "LaTeX validation failed. Fix the reported issues and regenerate the resume.",
      "LATEX_VALIDATION_ERROR",
      validation.errors.join("\n"),
    );
  }

  let bundled;
  if (
    (process.env.VERCEL === "1" ||
      process.env.RESUME_PDF_RUNTIME === "bundled") &&
    !validateHostedLatex(parsed.data.latex)
  ) {
    throw new PdfCompileError(
      "Hosted LaTeX edits may use resume formatting commands only. Regenerate this document or remove unsupported commands.",
      "LATEX_VALIDATION_ERROR",
      "Unsupported hosted LaTeX command or environment.",
    );
  }
  try {
    bundled = await getBundledPdfRuntime();
  } catch {
    throw new PdfCompileError(
      "The hosted PDF compiler is unavailable. Please try again later.",
      "COMPILER_NOT_FOUND",
      "",
      503,
    );
  }
  const directory = await mkdtemp(
    path.join(options.tempRoot ?? tmpdir(), "resume-changer-"),
  );
  const filename = `resume-${randomUUID()}.tex`;
  const texPath = path.join(directory, filename);
  const pdfPath = path.join(directory, filename.replace(/\.tex$/, ".pdf"));
  const run = options.runProcess ?? runProcess;
  const timeoutMs = remainingRequestTime(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (timeoutMs < 1_000)
    throw new PdfCompileError(
      "The request reached its processing limit. Please try again.",
      "COMPILE_TIMEOUT",
      "",
      408,
    );
  const deadline = Date.now() + timeoutMs;
  try {
    await writeFile(texPath, parsed.data.latex, {
      encoding: "utf8",
      mode: 0o600,
    });
    const tectonicExecutable =
      bundled?.binary ??
      options.tectonicPath ??
      process.env.TECTONIC_BINARY ??
      "tectonic";
    const tectonicArgs = [
      "--untrusted",
      "--only-cached",
      "--keep-logs",
      "--outdir",
      directory,
      texPath,
    ];
    const compiler = await run(
      tectonicExecutable,
      tectonicArgs,
      directory,
      timeoutMs,
      compilerEnvironment(process.env, directory, bundled?.cacheDirectory),
    );
    if (compiler.error?.code === "ENOENT") {
      throw new PdfCompileError(
        "Tectonic was not found. Install Tectonic or set TECTONIC_BINARY to its executable path.",
        "COMPILER_NOT_FOUND",
        "",
        503,
      );
    }
    if (compiler.timedOut) {
      throw new PdfCompileError(
        "LaTeX compilation exceeded the time limit.",
        "COMPILE_TIMEOUT",
        diagnosticsOf(compiler, directory),
        408,
      );
    }
    if (compiler.code !== 0) {
      throw new PdfCompileError(
        "Tectonic could not compile this LaTeX source. Check the LaTeX and required packages.",
        "LATEX_ERROR",
        diagnosticsOf(compiler, directory),
      );
    }

    let pdf: Buffer;
    try {
      pdf = await readFile(pdfPath);
    } catch {
      throw new PdfCompileError(
        "Tectonic finished without producing a PDF.",
        "INVALID_PDF",
        diagnosticsOf(compiler, directory),
      );
    }
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new PdfCompileError(
        "The compiler output is not a valid PDF.",
        "INVALID_PDF",
      );
    }

    let pageCount: number;
    if (
      bundled ||
      options.countPages ||
      process.env.PDF_PAGE_COUNTER === "pdfjs"
    ) {
      try {
        pageCount = await (options.countPages ?? readPdfPageCount)(pdf);
      } catch {
        throw new PdfCompileError(
          "The PDF page count could not be verified.",
          "INVALID_PDF",
        );
      }
    } else {
      const pdfInfoExecutable =
        options.pdfInfoPath ?? process.env.PDFINFO_BINARY ?? "pdfinfo";
      const pdfInfo = await run(
        pdfInfoExecutable,
        ["-f", "1", "-l", "2", pdfPath],
        directory,
        Math.max(1, deadline - Date.now()),
      );
      if (pdfInfo.error?.code === "ENOENT") {
        throw new PdfCompileError(
          "pdfinfo was not found. Install Poppler or set PDFINFO_BINARY to its executable path.",
          "PDF_INFO_NOT_FOUND",
          "",
          503,
        );
      }
      if (pdfInfo.timedOut || pdfInfo.code !== 0) {
        throw new PdfCompileError(
          "The PDF page count could not be verified.",
          pdfInfo.timedOut ? "COMPILE_TIMEOUT" : "INVALID_PDF",
          diagnosticsOf(pdfInfo, directory),
          pdfInfo.timedOut ? 408 : 422,
        );
      }

      const pageCountMatch = `${pdfInfo.stdout}\n${pdfInfo.stderr}`.match(
        /^Pages:\s*(\d+)\s*$/m,
      );
      if (!pageCountMatch) {
        throw new PdfCompileError(
          "The PDF page count could not be read from pdfinfo.",
          "INVALID_PDF",
          diagnosticsOf(pdfInfo, directory),
        );
      }

      pageCount = Number(pageCountMatch[1]);
    }
    if (pageCount !== 1 && !options.allowPageOverflow) {
      throw new PdfCompileError(
        `This resume must fit on one page; the compiled document has ${pageCount} pages.`,
        "PAGE_LIMIT_EXCEEDED",
        `Compiled page count: ${pageCount}. Reduce or reprioritize content; template typography and spacing are fixed.`,
      );
    }

    return { pdf, pageCount };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
