import { describe, expect, it, vi } from "vitest";
import {
  ACHIEVEMENT_WRITING_MODES,
  ACHIEVEMENT_WRITING_MODE_DIRECTIVES,
  AchievementWritingInputSchema,
  numericClaims,
  validateWritingFacts,
  type AchievementWritingInput,
} from "../../../src/lib/ai/achievement-writing";
import { buildAiPrompt } from "../../../src/lib/ai/prompt-builder";
import { createGeminiProvider } from "../../../src/lib/ai/gemini-provider";
const input: AchievementWritingInput = {
  sources: [
    {
      id: "point-a",
      text: "Reduced API latency by 25% for 1,000 users.",
      factualConstraints: [],
    },
  ],
  skills: ["Python"],
  draftText: "",
  instruction: "Make this concise.",
  destination: "Developer · Example",
  targetLines: 2,
};
describe("focused achievement prompts and response contracts", () => {
  it("uses dedicated tasks with bounded context and no resume template", async () => {
    const prompts = [
      "achievementEdit",
      "achievementMerge",
      "achievementCreate",
    ].map((task) => buildAiPrompt(task as "achievementEdit", input).prompt);
    expect(new Set(prompts).size).toBe(3);
    for (const prompt of prompts) {
      expect(prompt).not.toContain("documentclass");
      expect(prompt).toContain("1,000 users");
      expect(prompt).toContain("do not");
    }
    const request = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ text: "Reduced API latency by 25% for 1,000 users." }),
      );
    const provider = createGeminiProvider({ request });
    expect(await provider.writeAchievement!("edit", input)).toMatchObject({
      text: expect.stringContaining("25%"),
    });
    expect(request.mock.calls[0][0].prompt).toContain(
      "Rewrite one achievement",
    );
  });
  it("rejects new numbers, loss of metrics, and presentation wrappers", () => {
    expect(numericClaims("25% for 1,000 users")).toEqual(["25%", "1000"]);
    expect(numericClaims("25 percent for 1k users.")).toEqual(["25%", "1000"]);
    expect(
      validateWritingFacts(input, {
        text: "Reduced API latency by 25% for 1,000 users.",
      }),
    ).toBeNull();
    expect(
      validateWritingFacts(input, { text: "Reduced API latency by 90%." }),
    ).toContain("unsupported");
    expect(
      validateWritingFacts(input, { text: "Reduced API latency." }),
    ).toContain("omitted");
    expect(
      validateWritingFacts(input, { text: "```25% for 1,000 users```" }),
    ).toContain("formatting");
  });

  it("maps each allowlisted create mode to a distinct server directive", () => {
    const prompts = ACHIEVEMENT_WRITING_MODES.map(
      (writingMode) =>
        buildAiPrompt("achievementCreate", {
          ...input,
          instruction: "Keep the supported facts.",
          writingMode,
        }).prompt,
    );
    const directives = ACHIEVEMENT_WRITING_MODES.map(
      (writingMode) => ACHIEVEMENT_WRITING_MODE_DIRECTIVES[writingMode],
    );

    expect(new Set(directives).size).toBe(6);
    expect(new Set(prompts).size).toBe(6);
    for (const [index, writingMode] of ACHIEVEMENT_WRITING_MODES.entries()) {
      expect(prompts[index]).toContain(
        ACHIEVEMENT_WRITING_MODE_DIRECTIVES[writingMode],
      );
      expect(prompts[index]).toContain(
        '"instruction":"Keep the supported facts."',
      );
      expect(prompts[index]).not.toContain(`"writingMode":"${writingMode}"`);
    }
  });

  it("rejects unrecognized modes while preserving the shared edit/merge instruction limit", () => {
    expect(
      AchievementWritingInputSchema.safeParse({
        ...input,
        writingMode: "invent-a-mode",
      }).success,
    ).toBe(false);
    expect(
      AchievementWritingInputSchema.safeParse({
        ...input,
        instruction: "x".repeat(501),
      }).success,
    ).toBe(true);
  });
});
