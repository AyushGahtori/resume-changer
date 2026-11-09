import { describe, expect, it } from "vitest";
import {
  buildImaginationLibraryPoint,
  decideImaginationAcceptance,
  getDefaultImaginationSaveDestination,
  getImaginationSaveDestinations,
  getImaginationTextToAccept,
  imaginationSaveCopy,
  readImaginationPayload,
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

  it("accepts an AI proposal only when an achievement is connected", () => {
    const base = {
      operation: "create" as const,
      editorText: "Rough notes.",
      proposedText: "Imagined bullet.",
      source: "personal" as const,
      hasLibraryDestination: true,
      allowResume: true,
      groupId: "job-example",
      saveDestination: "both" as const,
    };

    expect(
      decideImaginationAcceptance({
        ...base,
        sourceAchievementIds: ["achievement-one"],
        connectedSkillCount: 1,
      }),
    ).toMatchObject({
      ok: true,
      text: "Imagined bullet.",
      saveToLibrary: true,
      resumeSourceIds: ["achievement-one"],
    });

    expect(
      decideImaginationAcceptance({
        ...base,
        editorText: "",
        sourceAchievementIds: [],
        connectedSkillCount: 2,
      }),
    ).toEqual({ ok: false, error: imaginationSaveCopy.skillOnly });

    expect(
      decideImaginationAcceptance({
        ...base,
        proposedText: "",
        sourceAchievementIds: [],
        connectedSkillCount: 0,
        saveDestination: "library",
      }),
    ).toMatchObject({
      ok: true,
      text: "Rough notes.",
      saveToLibrary: true,
      resumeSourceIds: null,
    });

    expect(
      decideImaginationAcceptance({
        ...base,
        proposedText: "",
        sourceAchievementIds: [],
        connectedSkillCount: 0,
        saveDestination: "resume",
      }),
    ).toEqual({
      ok: false,
      error: imaginationSaveCopy.resumeNeedsAchievement,
    });
  });

  it("names an empty personal library separately from read-only demo data", () => {
    expect(
      decideImaginationAcceptance({
        operation: "create",
        editorText: "First point.",
        proposedText: "",
        sourceAchievementIds: [],
        connectedSkillCount: 0,
        saveDestination: null,
        source: "personal",
        hasLibraryDestination: false,
        allowResume: true,
        groupId: "",
      }),
    ).toEqual({ ok: false, error: imaginationSaveCopy.jobRequired });

    expect(
      decideImaginationAcceptance({
        operation: "create",
        editorText: "Demo point.",
        proposedText: "",
        sourceAchievementIds: [],
        connectedSkillCount: 0,
        saveDestination: null,
        source: "demo",
        hasLibraryDestination: false,
        allowResume: false,
        groupId: "",
      }),
    ).toEqual({ ok: false, error: imaginationSaveCopy.sourceUnavailable });
  });

  it("replaces a JSON parse failure with a product sentence", async () => {
    await expect(
      readImaginationPayload(
        {
          json: async () => {
            throw new SyntaxError("Unexpected token '<'");
          },
        },
        imaginationSaveCopy.unreadableResponse,
      ),
    ).rejects.toThrow(imaginationSaveCopy.unreadableResponse);

    await expect(
      readImaginationPayload(
        {
          json: async () => {
            throw new Error("Failed to execute 'json' on 'Response'");
          },
        },
        imaginationSaveCopy.unreadableSave,
      ),
    ).rejects.toThrow(imaginationSaveCopy.unreadableSave);

    await expect(
      readImaginationPayload(
        {
          json: async () => ({ error: "Temporary test outage." }),
        },
        imaginationSaveCopy.unreadableResponse,
      ),
    ).resolves.toMatchObject({ error: "Temporary test outage." });
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
