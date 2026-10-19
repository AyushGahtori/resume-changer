import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ compile: vi.fn(), boxes: vi.fn() }));
vi.mock("../../../src/lib/pdf/compile-service", () => ({
  compileLatexToPdf: mocks.compile,
}));
vi.mock("../../../src/lib/pdf/layout-analysis", () => ({
  readPdfTextBoxes: mocks.boxes,
}));
import {
  measureSkillWidths,
  measureAchievementLines,
} from "../../../src/lib/pdf/skill-measurements";
import { studioLibrary } from "../../helpers/studio-fixtures";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.compile.mockResolvedValue({ pdf: Buffer.from("%PDF-1.7") });
});
describe("LaTeX skill measurement", () => {
  it("measures escaped template text, separators, labels, and glyph widths and caches the result", async () => {
    const skill = {
      ...studioLibrary.skills[0],
      id: "measured-skill",
      name: "C++ & C#",
    };
    mocks.boxes.mockImplementation(async () => {
      const latex = mocks.compile.mock.calls[0][0] as string;
      const markers = [...latex.matchAll(/m(\d{3})/g)];
      return [
        markers.flatMap((marker, index) => [
          {
            text: `m${marker[1]}`,
            x: 40,
            y: 700 - index * 12,
            width: 20,
            height: 9,
          },
          {
            text: index === 4 ? skill.name : "measurement",
            x: 40 + 34 * (72 / 72.27),
            y: 700 - index * 12,
            width:
              index === 0
                ? 3
                : index === 1
                  ? 10
                  : index === 2
                    ? 75
                    : index === 3
                      ? 85
                      : index === 4
                        ? 45
                        : index === 5
                          ? 12
                          : 18,
            height: 9,
          },
        ]),
      ];
    });
    const measured = await measureSkillWidths([skill]);
    expect(measured.widths[skill.id]).toBeCloseTo(45);
    expect(measured.separatorWidth).toBe(4);
    expect(measured.labelWidths).toEqual([72, 82]);
    expect(measured.glyphWidths?.W).toBe(6);
    expect(mocks.compile.mock.calls[0][0]).toContain("C++ \\& C\\#");
    expect(await measureSkillWidths([skill])).toBe(measured);
    expect(mocks.compile).toHaveBeenCalledOnce();
  });
  it("does not cache failed measurements", async () => {
    const skill = { ...studioLibrary.skills[0], id: "failed-measurement" };
    mocks.compile.mockRejectedValueOnce(new Error("Missing compiler"));
    await expect(measureSkillWidths([skill])).rejects.toThrow(
      "Missing compiler",
    );
    mocks.boxes.mockResolvedValueOnce([]);
    await expect(measureSkillWidths([skill])).rejects.toThrow(
      /could not be read/,
    );
    expect(mocks.compile).toHaveBeenCalledTimes(2);
  });
  it("reports an unsupported skill without discarding valid measurements", async () => {
    const skill = {
      ...studioLibrary.skills[0],
      id: "unsupported-font-skill",
      name: "Unsupported",
    };
    mocks.boxes.mockImplementationOnce(async () => {
      const latex = mocks.compile.mock.calls[0][0] as string;
      return [
        [...latex.matchAll(/m(\d{3})/g)].flatMap((marker, index) => [
          {
            text: `m${marker[1]}`,
            x: 40,
            y: 700 - index * 12,
            width: 20,
            height: 9,
          },
          ...(index === 4
            ? []
            : [
                {
                  text: "supported",
                  x: 40 + 34 * (72 / 72.27),
                  y: 700 - index * 12,
                  width: 40,
                  height: 9,
                },
              ]),
        ]),
      ];
    });
    const measured = await measureSkillWidths([skill]);
    expect(measured.unsupportedSkillIds).toEqual([skill.id]);
    expect(measured.widths).not.toHaveProperty(skill.id);
    expect(measured.source).toBe("latex");
  });
  it("counts actual bullet baselines between compiled markers", async () => {
    mocks.boxes.mockResolvedValueOnce([
      [
        { text: "measurementstart", x: 40, y: 700, width: 80, height: 10 },
        { text: "First line", x: 50, y: 680, width: 90, height: 10 },
        { text: "continuation", x: 50, y: 668, width: 80, height: 10 },
        { text: "measurementend", x: 40, y: 650, width: 80, height: 10 },
      ],
    ]);
    expect(await measureAchievementLines("First line continuation")).toBe(2);
    mocks.boxes.mockResolvedValueOnce([]);
    await expect(measureAchievementLines("Missing markers")).rejects.toThrow(
      /could not be verified/,
    );
  });
});
