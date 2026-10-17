import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { validateResumeLatex } from "../latex/validate-resume-latex";

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
) => Promise<ProcessResult>;

type CompileOptions = {
  tempRoot?: string;
  tectonicPath?: string;
  pdfInfoPath?: string;
  timeoutMs?: number;
  allowPageOverflow?: boolean;
  runProcess?: RunProcess;
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
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, TECTONIC_UNTRUSTED_MODE: "1" },
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

  const directory = await mkdtemp(
    path.join(options.tempRoot ?? tmpdir(), "resume-changer-"),
  );
  const filename = `resume-${randomUUID()}.tex`;
  const texPath = path.join(directory, filename);
  const pdfPath = path.join(directory, filename.replace(/\.tex$/, ".pdf"));
  const run = options.runProcess ?? runProcess;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  try {
    await writeFile(texPath, parsed.data.latex, {
      encoding: "utf8",
      mode: 0o600,
    });
    const tectonicExecutable =
      options.tectonicPath ?? process.env.TECTONIC_BINARY ?? "tectonic";
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

    const pageCount = Number(pageCountMatch[1]);
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
