import { describe, expect, it } from "vitest";
import {
  estimateBulletLines,
  placeSkills,
} from "../../../src/lib/generation/skill-layout";
import { studioMeasurements } from "../../helpers/studio-fixtures";
describe("measured two-row skill placement", () => {
  it("uses glyph widths and retains every selected skill", () => {
    const measurements = {
      ...studioMeasurements,
      widths: { narrow: 12, wide: 60 },
      lineWidth: 50,
      labelWidths: [0, 0] as [number, number],
    };
    expect(placeSkills(["narrow"], measurements)?.rows.flat()).toEqual([
      "narrow",
    ]);
    expect(placeSkills(["wide"], measurements)).toBeNull();
    expect(
      estimateBulletLines("W".repeat(70), studioMeasurements),
    ).toBeGreaterThan(estimateBulletLines("i".repeat(70), studioMeasurements)!);
  });
  it("finds a two-bin arrangement when greedy placement cannot fit", () => {
    const measurements = {
      ...studioMeasurements,
      widths: { a: 6, b: 5, c: 3, d: 2, e: 2, f: 2 },
      labelWidths: [0, 0] as [number, number],
      separatorWidth: 0,
      lineWidth: 10,
    };
    const placement = placeSkills(["a", "b", "c", "d", "e", "f"], measurements);
    expect(placement?.rows.flat().sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
    ]);
    expect(placement?.used).toEqual([10, 10]);
  });
  it("accounts for labels and separators, frees capacity on removal, and rejects duplicates", () => {
    const measurements = {
      ...studioMeasurements,
      widths: { a: 35, b: 35, c: 35 },
      labelWidths: [10, 10] as [number, number],
      separatorWidth: 10,
      lineWidth: 80,
    };
    expect(placeSkills(["a", "b", "c"], measurements)).toBeNull();
    expect(placeSkills(["a", "c"], measurements)?.rows.flat()).toHaveLength(2);
    expect(placeSkills(["a", "a"], measurements)).toBeNull();
    expect(placeSkills(["missing"], measurements)).toBeNull();
    expect(placeSkills([], measurements)?.used).toEqual([0, 0]);
  });
});
