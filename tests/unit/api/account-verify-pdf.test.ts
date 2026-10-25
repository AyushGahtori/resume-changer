import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ compile: vi.fn() }));
vi.mock("../../../src/lib/pdf/compile-service", async (original) => ({
  ...(await original<typeof import("../../../src/lib/pdf/compile-service")>()),
  compileLatexToPdf: mocks.compile,
}));
import { POST } from "../../../src/app/api/compile/route";
import { PdfCompileError } from "../../../src/lib/pdf/compile-service";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.compile.mockResolvedValue({
    pdf: Buffer.from("%PDF-fictional"),
    pageCount: 1,
  });
});
describe("authenticated PDF service diagnostic", () => {
  it("compiles fictional evidence and returns only readiness metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkService: true }),
      }),
    );
    expect(await response.json()).toEqual({ ready: true, pageCount: 1 });
    expect(mocks.compile.mock.calls[0][0]).toContain("Fictional sample");
  });
  it("reports a controlled compiler failure without exposing diagnostics", async () => {
    mocks.compile.mockRejectedValue(
      new PdfCompileError(
        "The PDF compiler is unavailable.",
        "COMPILER_NOT_FOUND",
        "private server details",
        503,
      ),
    );
    const response = await POST(
      new Request("http://localhost/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkService: true }),
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ready: false,
      error: "The PDF compiler is unavailable.",
      code: "COMPILER_NOT_FOUND",
    });
  });
});
