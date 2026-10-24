import { describe, expect, it } from "vitest";
import {
  buildImaginationLibraryPoint,
  getDefaultImaginationSaveDestination,
  getImaginationSaveDestinations,
  getImaginationTextToAccept,
} from "@/lib/generation/imagination-save";

describe("Imagination Canvas save contract", () => {
  it("offers only destinations allowed by source and resume availability", () => {
    expect(getImaginationSaveDestinations("personal", true)).toEqual([
      "resume",
      "library",
      "both",
    ]);
    expect(getImaginationSaveDestinations("demo", true)).toEqual(["resume"]);
    expect(getImaginationSaveDestinations("personal", false)).toEqual([
      "library",
    ]);
    expect(getImaginationSaveDestinations("demo", false)).toEqual([]);
    expect(getImaginationSaveDestinations("personal", true, false)).toEqual([
      "resume",
    ]);
  });

  it("chooses a valid default or reports that no destination is available", () => {
    expect(getDefaultImaginationSaveDestination("personal", true)).toBe(
      "resume",
    );
    expect(getDefaultImaginationSaveDestination("personal", false)).toBe(
      "library",
    );
    expect(getDefaultImaginationSaveDestination("demo", false)).toBeNull();
    expect(
      getDefaultImaginationSaveDestination("personal", false, false),
    ).toBeNull();
  });

  it("saves only the reviewed editor text in create mode", () => {
    expect(
      getImaginationTextToAccept(
        "create",
        "  Reviewed composer wording.  ",
        "Unreviewed generated suggestion.",
      ),
    ).toBe("Reviewed composer wording.");
  });

  it("keeps the established proposal text for edit and merge operations", () => {
    expect(
      getImaginationTextToAccept(
        "edit",
        "Original editor text",
        "  Reviewed edit proposal  ",
      ),
    ).toBe("Reviewed edit proposal");
    expect(
      getImaginationTextToAccept(
        "merge",
        "Original editor text",
        "  Reviewed merged proposal  ",
      ),
    ).toBe("Reviewed merged proposal");
  });

  it("builds a library write with deduplicated skill and evidence attribution", () => {
    const request = buildImaginationLibraryPoint({
      parentType: "job",
      parentId: "job-example-cloud-labs",
      pointId: "achievement-reviewed-canvas-point",
      reviewedText: "  Reviewed achievement wording.  ",
      skillIds: ["skill-automation", "skill-automation"],
      sourceAchievementIds: [
        "achievement-cloud-deployment-platform",
        "achievement-cloud-deployment-platform",
      ],
    });

    expect(request).toMatchObject({
      parentType: "job",
      parentId: "job-example-cloud-labs",
      point: {
        id: "achievement-reviewed-canvas-point",
        text: "Reviewed achievement wording.",
        skillIds: ["skill-automation"],
        source: {
          type: "direct-user",
          label: "Reviewed in Imagination Canvas",
        },
        enabled: true,
      },
    });
    expect(JSON.parse(request.point.source?.reference ?? "{}")).toEqual({
      sourceAchievementIds: ["achievement-cloud-deployment-platform"],
      skillIds: ["skill-automation"],
    });
  });

  it("rejects empty reviewed text before making a library request", () => {
    expect(() =>
      buildImaginationLibraryPoint({
        parentType: "job",
        parentId: "job-example-cloud-labs",
        pointId: "achievement-empty-canvas-point",
        reviewedText: "  ",
        skillIds: [],
        sourceAchievementIds: [],
      }),
    ).toThrow("Write or accept an achievement before saving.");
  });
});
