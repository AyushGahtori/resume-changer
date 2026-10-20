import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { selectSkillsForResume } from "../../../src/lib/latex/render-resume";
import { studioGroups } from "../../../src/lib/generation/studio-document";
import type {
  ResumeLibrary,
  Skill,
} from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;

function skill(id: string): Skill {
  const found = library.skills.find((item) => item.id === id);
  if (!found) throw new Error(`Missing fixture skill: ${id}`);
  return found;
}

describe("selectSkillsForResume", () => {
  it("keeps the skills that fit the two-row budget", () => {
    const selected = selectSkillsForResume(library.skills, []);

    // The template gives each row a fixed character budget, so a large library
    // is trimmed rather than allowed to overflow the page.
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThanOrEqual(library.skills.length);
    for (const item of selected) {
      expect(library.skills.map((skill) => skill.id)).toContain(item.id);
    }
  });

  it("drops the lowest-ranked skills that do not fit the row budget", () => {
    const selected = selectSkillsForResume(library.skills, []);
    const kept = new Set(selected.map((item) => item.id));

    // The demo library is larger than the two skill rows can hold.
    expect(kept.size).toBeLessThan(library.skills.length);
    expect(kept.has("skill-aws")).toBe(true);
  });

  it("places a job-relevant skill in the first row", () => {
    const selected = selectSkillsForResume(
      library.skills,
      [],
      "Deploy services to Amazon Web Services with Docker.",
    );

    expect(selected[0].id).toBe("skill-aws");
    expect(selected[0].category).toBe("Relevant Skills");
  });

  it("puts a skill that is not relevant into the second row", () => {
    const selected = selectSkillsForResume(
      library.skills,
      [],
      "Deploy services to Amazon Web Services with Docker.",
    );

    const additional = selected.filter(
      (item) => item.category === "Additional Skills",
    );
    expect(additional.length).toBeGreaterThan(0);
    for (const item of additional) {
      expect(item.id).not.toBe("skill-aws");
    }
  });

  it("ranks a required qualification above a preferred one", () => {
    const selected = selectSkillsForResume(library.skills, [], "", {
      targetTitle: "Platform Engineer",
      seniority: "Entry level",
      requiredQualifications: ["Docker"],
      preferredQualifications: ["React"],
      responsibilities: [],
      toolsAndPlatforms: [],
      domainConcepts: [],
      atsTerms: [],
      inferredContext: [],
      terminology: [],
    });

    expect(
      selected.findIndex((item) => item.id === "skill-docker"),
    ).toBeLessThan(selected.findIndex((item) => item.id === "skill-react"));
  });

  it("ranks a skill that a selected achievement uses above one it does not", () => {
    const point = library.jobs[0].points.find((item) =>
      item.skillIds.includes("skill-aws"),
    )!;

    const selected = selectSkillsForResume(
      [skill("skill-react"), skill("skill-aws")],
      [point],
    );

    expect(selected[0].id).toBe("skill-aws");
  });

  it("returns no more skills than it was given", () => {
    const selected = selectSkillsForResume(
      library.skills,
      [],
      "Python and AWS",
    );

    expect(selected.length).toBeLessThanOrEqual(library.skills.length);
    expect(new Set(selected.map((item) => item.id)).size).toBe(selected.length);
  });

  it("matches a skill through its alias", () => {
    const selected = selectSkillsForResume(
      library.skills,
      [],
      "Work with infrastructure as code and GitHub Actions.",
    );

    const relevant = selected.filter(
      (item) => item.category === "Relevant Skills",
    );
    expect(relevant.map((item) => item.id)).toContain(
      "skill-infrastructure-as-code",
    );
  });
});

describe("studioGroups", () => {
  it("lists every job and project as an editable destination", () => {
    const groups = studioGroups(library);

    expect(groups).toHaveLength(library.jobs.length + library.projects.length);
    expect(groups.map((group) => group.id)).toEqual([
      ...library.jobs.map((job) => job.id),
      ...library.projects.map((project) => project.id),
    ]);
  });

  it("describes a job with its title and company", () => {
    const groups = studioGroups(library);

    expect(groups[0]).toEqual({
      id: library.jobs[0].id,
      title: library.jobs[0].title,
      subtitle: library.jobs[0].company,
      section: "experience",
    });
  });

  it("describes a project with its name and role", () => {
    const groups = studioGroups(library);
    const project = groups.find(
      (group) => group.id === library.projects[0].id,
    )!;

    expect(project).toEqual({
      id: library.projects[0].id,
      title: library.projects[0].name,
      subtitle: library.projects[0].role ?? "",
      section: "projects",
    });
  });

  it("uses an empty subtitle for a project with no role", () => {
    const withoutRole = structuredClone(library);
    delete withoutRole.projects[0].role;

    const groups = studioGroups(withoutRole);
    const project = groups.find(
      (group) => group.id === withoutRole.projects[0].id,
    )!;

    expect(project.subtitle).toBe("");
  });
});
