import { beforeEach, describe, expect, it, vi } from "vitest";

const { compileMock } = vi.hoisted(() => ({ compileMock: vi.fn() }));

vi.mock("@/lib/pdf/compile-service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/pdf/compile-service")>();
  return { ...actual, compileLatexToPdf: compileMock };
});

import { POST } from "@/app/api/compile/route";

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
        body: JSON.stringify({ latex: "\\documentclass{article}" }),
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
});
