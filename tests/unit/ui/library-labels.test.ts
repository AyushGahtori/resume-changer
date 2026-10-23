import { describe, expect, it } from "vitest";
import { countLabel } from "../../../src/lib/ui/library-labels";

describe("countLabel", () => {
  it("uses the singular label for exactly one record", () => {
    expect(countLabel(1, "achievement", "achievements")).toBe("1 achievement");
    expect(countLabel(1, "skill", "skills")).toBe("1 skill");
    expect(countLabel(1, "credential", "credentials")).toBe("1 credential");
  });

  it("uses the plural label for every other count", () => {
    expect(countLabel(0, "achievement", "achievements")).toBe("0 achievements");
    expect(countLabel(2, "skill", "skills")).toBe("2 skills");
    expect(countLabel(14, "credential", "credentials")).toBe("14 credentials");
  });
});
