import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACHIEVEMENT_WRITING_MODES } from "@/lib/ai/achievement-writing";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  lines: vi.fn(),
  write: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: Response.json },
}));
vi.mock("@/lib/data/loaders", () => ({ loadResumeLibrary: mocks.load }));
vi.mock("@/lib/pdf/skill-measurements", () => ({
  measureAchievementLines: mocks.lines,
}));
vi.mock("@/lib/ai/provider-factory", () => ({
  createAiProvider: () => ({ name: "gemini", writeAchievement: mocks.write }),
}));

import { POST as writeAchievement } from "@/app/api/ai/achievement/route";
import { studioLibrary } from "../../helpers/studio-fixtures";

const destination = studioLibrary.jobs[0];
const firstPoint = destination.points[0];
const secondPoint = destination.points[1];
const baseInput = {
  dataSource: "demo",
  operation: "create",
  destinationGroupId: destination.id,
  sources: [
    {
      id: firstPoint.id,
      text: firstPoint.text,
      sourceAchievementIds: [firstPoint.id],
    },
  ],
  skillIds: [],
  draftText: "",
  instruction: "Create a concise, factual achievement from connected context.",
  targetLines: 2,
};

const request = (body: unknown) =>
  new Request("http://localhost/api/ai/achievement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const post = (body: unknown) => writeAchievement(request(body));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(structuredClone(studioLibrary));
  mocks.lines.mockResolvedValue(2);
  mocks.write.mockImplementation(async (_operation, input) => ({
    text: input.sources
      .map((source: { text: string }) => source.text)
      .join(" "),
  }));
});

describe("achievement writing mode API", () => {
  it("passes each typed mode to the provider without replacing the user's instruction", async () => {
    for (const writingMode of ACHIEVEMENT_WRITING_MODES) {
      const instruction = `Keep the factual context for ${writingMode}.`;
      const response = await post({ ...baseInput, writingMode, instruction });

      expect(response.status).toBe(200);
      expect(mocks.write).toHaveBeenLastCalledWith(
        "create",
        expect.objectContaining({ writingMode, instruction }),
      );
    }
    expect(mocks.write).toHaveBeenCalledTimes(6);
  });

  it("rejects invalid modes and create instructions longer than 500 characters", async () => {
    const invalidMode = await post({
      ...baseInput,
      writingMode: "make_it_pop",
    });
    expect(invalidMode.status).toBe(400);

    const overLimit = await post({
      ...baseInput,
      instruction: "x".repeat(501),
    });
    expect(overLimit.status).toBe(400);
    expect(await overLimit.json()).toMatchObject({
      error: expect.stringContaining("500 characters"),
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("accepts a 500-character create instruction", async () => {
    const response = await post({
      ...baseInput,
      instruction: "x".repeat(500),
      writingMode: "improve_clarity",
    });

    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(
      "create",
      expect.objectContaining({ instruction: "x".repeat(500) }),
    );
  });

  it("keeps existing create callers valid when no writing mode is supplied", async () => {
    const response = await post(baseInput);

    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith("create", expect.any(Object));
    expect(mocks.write.mock.calls[0][1]).not.toHaveProperty("writingMode");
  });

  it.each(["edit", "merge"] as const)(
    "keeps the 2,000-character instruction allowance for %s",
    async (operation) => {
      const sources =
        operation === "merge"
          ? [firstPoint, secondPoint].map((point) => ({
              id: point.id,
              text: point.text,
              sourceAchievementIds: [point.id],
            }))
          : baseInput.sources;
      const response = await post({
        ...baseInput,
        operation,
        sources,
        instruction: "x".repeat(2000),
      });

      expect(response.status).toBe(200);
      expect(mocks.write).toHaveBeenCalledWith(
        operation,
        expect.objectContaining({ instruction: "x".repeat(2000) }),
      );
    },
  );

  it("keeps server validation authoritative for context and unsupported numbers", async () => {
    const noContext = await post({ ...baseInput, sources: [] });
    expect(noContext.status).toBe(400);

    const wrongDestination = await post({
      ...baseInput,
      destinationGroupId: studioLibrary.projects[0].id,
    });
    expect(wrongDestination.status).toBe(400);

    mocks.write.mockResolvedValueOnce({ text: "Improved latency by 99%." });
    const unsupportedNumber = await post({
      ...baseInput,
      writingMode: "make_shorter",
    });
    expect(unsupportedNumber.status).toBe(422);
  });

  it("reports an unavailable line measurement without claiming a count", async () => {
    mocks.lines.mockResolvedValueOnce(null);

    const response = await post({
      ...baseInput,
      writingMode: "improve_clarity",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ measuredLines: null });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
