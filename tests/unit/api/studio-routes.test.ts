import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  measure: vi.fn(),
  lines: vi.fn(),
  compile: vi.fn(),
  analyze: vi.fn(),
  write: vi.fn(),
}));
vi.mock("@/lib/data/loaders", async (original) => ({
  ...(await original<typeof import("@/lib/data/loaders")>()),
  loadResumeLibrary: mocks.load,
}));
vi.mock("@/lib/pdf/skill-measurements", () => ({
  measureSkillWidths: mocks.measure,
  measureAchievementLines: mocks.lines,
}));
vi.mock("@/lib/pdf/compile-service", async (original) => ({
  ...(await original<typeof import("@/lib/pdf/compile-service")>()),
  compileLatexToPdf: mocks.compile,
}));
vi.mock("@/lib/pdf/layout-analysis", async (original) => ({
  ...(await original<typeof import("@/lib/pdf/layout-analysis")>()),
  analyzePdfLayout: mocks.analyze,
}));
vi.mock("@/lib/ai/provider-factory", () => ({
  createAiProvider: () => ({ name: "gemini", writeAchievement: mocks.write }),
}));
import { POST as apply } from "@/app/api/resume/edit/handler";
import { GET as skills } from "@/app/api/resume/skills/handler";
import { POST as write } from "@/app/api/ai/achievement/handler";
import { PdfCompileError } from "@/lib/pdf/compile-service";
import {
  studioApplyInput,
  studioLibrary,
  studioMeasurements,
} from "../../helpers/studio-fixtures";

const request = (body: unknown) =>
  new Request("http://localhost/api/resume/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const layout = {
  pageCount: 1,
  pageWidth: 612,
  pageHeight: 792,
  contentTop: 36,
  contentBottom: 730,
  usableHeight: 727,
  bottomGap: 30,
  utilization: 0.94,
  visibleWordCount: 400,
  clipped: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(structuredClone(studioLibrary));
  mocks.measure.mockResolvedValue(studioMeasurements);
  mocks.compile.mockResolvedValue({
    pdf: Buffer.from("%PDF-1.7 studio"),
    pageCount: 1,
  });
  mocks.analyze.mockResolvedValue({ layout, text: "Readable resume" });
  mocks.write.mockResolvedValue({ text: "Improved service latency by 25%." });
  mocks.lines.mockResolvedValue(2);
});

describe("atomic resume editing API", () => {
  it("returns a revision and PDF together only after validation", async () => {
    const response = await apply(request(studioApplyInput));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.generation.metadata.studioDocument).toEqual(
      studioApplyInput.document,
    );
    expect(Buffer.from(result.pdfBase64, "base64").toString()).toBe(
      "%PDF-1.7 studio",
    );
    expect(result.generation.metadata.layout).toEqual(layout);
  });
  it("rejects overflow and clipping without returning a replacement", async () => {
    mocks.compile.mockRejectedValueOnce(
      new PdfCompileError("This resume has 2 pages.", "PAGE_LIMIT_EXCEEDED"),
    );
    const overflow = await apply(request(studioApplyInput));
    expect(overflow.status).toBe(422);
    expect(await overflow.json()).toMatchObject({
      error: expect.stringContaining("preserved"),
    });
    mocks.analyze.mockResolvedValueOnce({
      layout: { ...layout, clipped: true },
    });
    const clipped = await apply(request(studioApplyInput));
    expect(clipped.status).toBe(422);
    expect(await clipped.json()).not.toHaveProperty("pdfBase64");
  });
  it("rejects malformed drafts before any compilation", async () => {
    const response = await apply(
      request({ ...studioApplyInput, unexpected: true }),
    );
    expect(response.status).toBe(400);
    expect(mocks.compile).not.toHaveBeenCalled();
    const badJson = await apply(
      new Request("http://localhost/api/resume/edit", {
        method: "POST",
        body: "{",
      }),
    );
    expect(badJson.status).toBe(400);
  });
  it("provides measured widths and reports measurement failures", async () => {
    expect(
      (
        await skills(
          new Request("http://localhost/api/resume/skills?source=demo"),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await skills(
          new Request("http://localhost/api/resume/skills?source=invalid"),
        )
      ).status,
    ).toBe(400);
    mocks.measure.mockRejectedValueOnce(new Error("Compiler missing"));
    expect(
      (
        await skills(
          new Request("http://localhost/api/resume/skills?source=demo"),
        )
      ).status,
    ).toBe(503);
  });
});

describe("focused achievement writing API", () => {
  const input = {
    dataSource: "demo",
    operation: "edit",
    destinationGroupId: studioLibrary.jobs[0].id,
    sources: [
      {
        id: studioLibrary.jobs[0].points[0].id,
        sourceAchievementIds: [studioLibrary.jobs[0].points[0].id],
        text: "Improved service latency by 25%.",
      },
    ],
    skillIds: [],
    draftText: "",
    instruction: "Make shorter while retaining the metric.",
    targetLines: 2,
  };
  it("sends only selected source context and returns an uncommitted suggestion", async () => {
    const response = await write(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: "Improved service latency by 25%.",
    });
    const payload = mocks.write.mock.calls[0][1];
    expect(payload.sources).toHaveLength(1);
    expect(payload.sources[0].factualConstraints[0]).toContain(
      studioLibrary.jobs[0].points[0].metrics[0].evidence,
    );
    expect(payload).not.toHaveProperty("jobDescription");
    expect(payload).not.toHaveProperty("latex");
    expect(mocks.compile).not.toHaveBeenCalled();
  });
  it("rejects invented metrics, missing metrics, and malformed output", async () => {
    mocks.write.mockResolvedValueOnce({ text: "Improved latency by 99%." });
    expect((await write(request(input))).status).toBe(422);
    mocks.write.mockResolvedValueOnce({ text: "Improved latency." });
    expect((await write(request(input))).status).toBe(422);
    mocks.write.mockResolvedValueOnce({
      text: "Valid text",
      secret: "unexpected",
    });
    expect((await write(request(input))).status).toBe(422);
  });
  it("enforces source destinations and the ten-item context boundary", async () => {
    expect(
      (
        await write(
          request({
            ...input,
            destinationGroupId: studioLibrary.projects[0].id,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await write(
          request({ ...input, sources: [...input.sources, ...input.sources] }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await write(
          request({
            ...input,
            operation: "create",
            skillIds: studioLibrary.skills
              .slice(0, 10)
              .map((skill) => skill.id),
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("retries an overlong result once and reports the compiled line count", async () => {
    mocks.lines.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    const response = await write(request(input));
    expect(await response.json()).toMatchObject({ measuredLines: 2 });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.write.mock.calls[1][1].instruction).toContain("compiled to 3");
  });
});
