import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ResumeLibrarySchema } from "../../../src/lib/schemas/resume-data";

const samplePath = resolve(
  process.cwd(),
  "examples/sample-resume-library.json",
);

describe("sample resume library", () => {
  it("parses the committed demo data with the resume library schema", () => {
    const raw = readFileSync(samplePath, "utf8");
    const result = ResumeLibrarySchema.safeParse(JSON.parse(raw));

    expect(result.success).toBe(true);
  });

  it("provides multiple supported points across jobs and projects", () => {
    const library = ResumeLibrarySchema.parse(
      JSON.parse(readFileSync(samplePath, "utf8")),
    );

    expect(library.jobs).toHaveLength(2);
    expect(library.jobs.every((job) => job.points.length >= 2)).toBe(true);
    expect(library.projects.length).toBeGreaterThanOrEqual(2);
    expect(
      library.projects.every((project) => project.points.length >= 2),
    ).toBe(true);
    expect(library.credentials.length).toBeGreaterThanOrEqual(1);
    expect(library.skills.some((skill) => skill.isListedOnCurrentResume)).toBe(
      true,
    );
    expect(library.skills.some((skill) => !skill.isListedOnCurrentResume)).toBe(
      true,
    );
  });

  it("uses unmistakably fictional identity and source labels", () => {
    const library = ResumeLibrarySchema.parse(
      JSON.parse(readFileSync(samplePath, "utf8")),
    );
    const sources = [
      ...library.jobs.flatMap((job) => job.points.map((point) => point.source)),
      ...library.projects.flatMap((project) =>
        project.points.map((point) => point.source),
      ),
    ];

    expect(library.profile.fullName).toBe("Jordan Example");
    expect(library.profile.email).toMatch(/@example\.com$/);
    expect(sources.every((source) => source.label?.includes("Synthetic"))).toBe(
      true,
    );
  });
});
