import { describe, expect, it } from "vitest";
import example from "../../../examples/sample-resume-library.json";
import {
  emptyAccountLibrary,
  validateCloudLibrary,
} from "../../../src/lib/cloud/library-contract";

describe("account library imports", () => {
  it("creates a valid empty account without sample achievements or another identity", () => {
    const library = validateCloudLibrary(
      emptyAccountLibrary({
        email: "alice@example.test",
        displayName: "Alice",
      }),
    );
    expect(library.profile.fullName).toBe("Alice");
    expect(library.profile.email).toBe("alice@example.test");
    expect(library.jobs).toEqual([]);
    expect(library.projects).toEqual([]);
    expect(library.skills).toEqual([]);
  });
  it("retains all valid source facts and rejects corrupted links and unknown fields", () => {
    expect(validateCloudLibrary(example)).toEqual(example);
    expect(() => validateCloudLibrary({ ...example, isAdmin: true })).toThrow(
      /format/,
    );
    const corrupted = structuredClone(example);
    corrupted.jobs[0].points[0].skillIds = ["skill-does-not-exist"];
    expect(() => validateCloudLibrary(corrupted)).toThrow(/format/);
  });
  it("rejects executable and local-file resume links", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,bad",
      "file:///private/file",
    ]) {
      const library = structuredClone(example);
      library.profile.links = [{ label: "Portfolio", url }];
      expect(() => validateCloudLibrary(library)).toThrow(/HTTP/);
    }
  });
  it("rejects oversized, deeply nested and excessive collections before full validation", () => {
    expect(() =>
      validateCloudLibrary({ data: Array.from({ length: 1001 }, () => "x") }),
    ).toThrow(/large/);
    let deep: unknown = "leaf";
    for (let index = 0; index < 20; index += 1) deep = { nested: deep };
    expect(() => validateCloudLibrary(deep)).toThrow(/nested/);
    expect(() =>
      validateCloudLibrary({
        ...example,
        profile: { ...example.profile, summary: "x".repeat(30_001) },
      }),
    ).toThrow(/long/);
  });
});
