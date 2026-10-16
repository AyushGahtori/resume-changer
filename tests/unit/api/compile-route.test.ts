import { beforeEach, describe, expect, it, vi } from "vitest";

const { compileMock } = vi.hoisted(() => ({ compileMock: vi.fn() }));

vi.mock("@/lib/pdf/compile-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/pdf/compile-service")>();
  return { ...actual, compileLatexToPdf: compileMock };
});

import { POST } from "@/app/api/compile/route";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { renderResumeLatex } from "@/lib/latex/render-resume";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";
import { PdfCompileError } from "@/lib/pdf/compile-service";

const validLatex = renderResumeLatex({
  library: sampleLibrary as ResumeLibrary,
  selectedAchievementIds: [],
});

describe("POST /api/compile", () => {
  beforeEach(() => compileMock.mockReset());

  it("returns the compiled PDF with page metadata", async () => {
    compileMock.mockResolvedValue({
      pdf: Buffer.from("%PDF-1.7"),
      pageCount: 1,
    });
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: validLatex }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("X-PDF-Pages")).toBe("1");
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
      "%PDF-1.7",
    );
  });

  it("rejects invalid requests before invoking a compiler", async () => {
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: "", compilerArgs: ["-Zshell-escape"] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(compileMock).not.toHaveBeenCalled();
  });

  it("returns validation diagnostics from the compile service", async () => {
    compileMock.mockRejectedValueOnce(
      new PdfCompileError(
        "LaTeX validation failed. Fix the reported issues and regenerate the resume.",
        "LATEX_VALIDATION_ERROR",
        String.raw`Unsupported command: \input`,
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: validLatex }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "LATEX_VALIDATION_ERROR",
      diagnostics: expect.stringContaining(String.raw`\input`),
    });
    expect(compileMock).toHaveBeenCalledOnce();
  });

  it("returns a structured error when the request body is not valid JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Request body must be valid JSON.",
    });
    expect(compileMock).not.toHaveBeenCalled();
  });

  it("preserves compiler diagnostics and status in structured failures", async () => {
    compileMock.mockImplementationOnce(async () => {
      throw new PdfCompileError(
        "This resume must fit on one page; the compiled document has 2 pages.",
        "PAGE_LIMIT_EXCEEDED",
        "Compiled page count: 2.",
      );
    });
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: validLatex }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error:
        "This resume must fit on one page; the compiled document has 2 pages.",
      code: "PAGE_LIMIT_EXCEEDED",
      diagnostics: "Compiled page count: 2.",
    });
  });

  it("hides unexpected internal errors behind a generic response", async () => {
    compileMock.mockImplementationOnce(async () => {
      throw new Error("private filesystem detail");
    });
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: validLatex }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The resume PDF could not be compiled.",
      code: "COMPILE_FAILED",
    });
  });
});
