import { describe, expect, it } from "vitest";
import {
  buildProvenanceSegments,
  formatProvenance,
  PROVENANCE_SEPARATOR,
} from "../../../src/lib/ui/point-provenance";

describe("achievement point provenance", () => {
  it("always leads with the source type", () => {
    expect(buildProvenanceSegments({ type: "resume" })).toEqual([
      { kind: "type", text: "resume" },
    ]);
  });

  it("keeps the label and the reference in the order they are shown", () => {
    expect(
      buildProvenanceSegments({
        type: "resume",
        label: "Ayush resume PDF",
        reference: "Page 1, Bullet 1",
      }),
    ).toEqual([
      { kind: "type", text: "resume" },
      { kind: "label", text: "Ayush resume PDF" },
      { kind: "reference", text: "Page 1, Bullet 1" },
    ]);
  });

  it("leaves out a label the library does not have", () => {
    expect(
      buildProvenanceSegments({
        type: "linkedin",
        reference: "Profile activity",
      }),
    ).toEqual([
      { kind: "type", text: "linkedin" },
      { kind: "reference", text: "Profile activity" },
    ]);
  });

  it("leaves out a reference the library does not have", () => {
    expect(
      buildProvenanceSegments({
        type: "user-notes",
        label: "Weekly notes",
      }),
    ).toEqual([
      { kind: "type", text: "user-notes" },
      { kind: "label", text: "Weekly notes" },
    ]);
  });

  it("leaves out a blank optional segment instead of showing an empty one", () => {
    expect(
      buildProvenanceSegments({
        type: "direct-user",
        label: "   ",
        reference: "",
      }),
    ).toEqual([{ kind: "type", text: "direct-user" }]);
  });

  it("trims the optional segments but keeps their content", () => {
    expect(
      buildProvenanceSegments({
        type: "project-document",
        label: "  Quarterly plan  ",
        reference: "  Section 3  ",
      }),
    ).toEqual([
      { kind: "type", text: "project-document" },
      { kind: "label", text: "Quarterly plan" },
      { kind: "reference", text: "Section 3" },
    ]);
  });

  it("separates the segments it shows and nothing else", () => {
    expect(
      formatProvenance({
        type: "resume",
        label: "Ayush resume PDF",
        reference: "Page 1, Bullet 1",
      }),
    ).toBe(
      `resume ${PROVENANCE_SEPARATOR} Ayush resume PDF ${PROVENANCE_SEPARATOR} Page 1, Bullet 1`,
    );
    expect(formatProvenance({ type: "direct-user" })).toBe("direct-user");
  });

  it("does not leave a dangling separator when a segment is missing", () => {
    const text = formatProvenance({
      type: "user-notes",
      reference: "Weekly notes",
    });
    expect(text).toBe(`user-notes ${PROVENANCE_SEPARATOR} Weekly notes`);
    expect(text.endsWith(PROVENANCE_SEPARATOR)).toBe(false);
    expect(text.startsWith(PROVENANCE_SEPARATOR)).toBe(false);
  });

  it("never invents a location for a source that has none", () => {
    const text = formatProvenance({ type: "project-document" });
    expect(text).toBe("project-document");
    expect(text).not.toMatch(/page|bullet|line|section/i);
  });
});
