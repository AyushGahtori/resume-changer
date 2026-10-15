import { describe, expect, it } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import {
  renderResumeLatex,
  escapeLatexText,
  ResumeRenderError,
} from "../../../src/lib/latex/render-resume";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const library = sampleLibrary as ResumeLibrary;
const allPointIds = [
  ...library.jobs.flatMap((job) => job.points.map((point) => point.id)),
  ...library.projects.flatMap((project) =>
    project.points.map((point) => point.id),
  ),
];

function render(
  overrides: Partial<Parameters<typeof renderResumeLatex>[0]> = {},
): string {
  return renderResumeLatex({
    library,
    selectedAchievementIds: allPointIds,
    ...overrides,
  });
}

describe("resume LaTeX renderer", () => {
  it("renders the Jake-style document with selected experience, projects, education, skills, and credentials", () => {
    const output = render();

    expect(output).toContain("\\documentclass[letterpaper,10pt]{article}");
    expect(output).not.toContain("\\pdfgentounicode");
    expect(output).not.toContain("\\input{glyphtounicode}");
    expect(output).toContain("\\ResumeHeader{Jordan Example}");
    expect(output).toContain("\\section*{Experience}");
    expect(output).toContain("\\section*{Projects}");
    expect(output).toContain("\\section*{Education}");
    expect(output).toContain("\\section*{Technical Skills}");
    expect(output).toContain("\\section*{Licenses and Certifications}");
    expect(output).toContain(
      "Redesigned service boundaries and capacity planning",
    );
    expect(output).toContain("\\ResumeSkillGroup{Cloud}{Amazon Web Services}");
    expect(output).toContain(
      "\\ResumeProfileSummary{Software Engineer | Cloud Platforms}{Fictional software engineer focused on reliable services and developer tooling.}",
    );
    expect(output).toContain("\\href{mailto:jordan@example.com}");
    expect(output).toContain("\\href{https://example.com/jordan}{Portfolio}");
    expect(output).toContain(
      "\\ResumeCredential{Cloud Deployment Foundations (Demo)}{Example Cloud Academy}",
    );
  });

  it("keeps long education details and descriptions in separate flowing blocks", () => {
    const copy = structuredClone(library);
    copy.profile.education[0] = {
      ...copy.profile.education[0],
      degree: "Bachelor's degree",
      fieldOfStudy: "Artificial Intelligence",
      programName: "Joint Bachelor's Program in Artificial Intelligence",
      description:
        "Research-based bachelor's program jointly delivered by several universities.",
    };

    const output = render({ library: copy });

    expect(output).toContain(
      "\\ResumeEducationEntry{Example State University}{Sep 2017 -- May 2021}{Bachelor's degree in Artificial Intelligence --- Joint Bachelor's Program in Artificial Intelligence}{Research-based bachelor's program jointly delivered by several universities.}",
    );
    expect(output).not.toContain("\\ResumeEntry{Example State University}");
  });

  it("escapes LaTeX-special characters in user-controlled text", () => {
    const copy = structuredClone(library);
    copy.profile.fullName = "A&B_100%";
    copy.jobs[0].points[0].text = "Improved 10% in R&D #1_job {v2} ~ 3^2 \\";

    const output = render({ library: copy });

    expect(output).toContain("\\ResumeHeader{A\\&B\\_100\\%}");
    expect(output).toContain(
      "Improved 10\\% in R\\&D \\#1\\_job \\{v2\\} \\textasciitilde{} 3\\textasciicircum{}2 \\textbackslash{}",
    );
    expect(escapeLatexText("one – two — three")).toBe("one -- two --- three");
  });

  it("omits empty optional sections and renders an empty selection safely", () => {
    const copy = structuredClone(library);
    copy.jobs = [];
    copy.projects = [];
    copy.profile.education = [];
    copy.skills = [];
    copy.credentials = [];

    const output = render({ library: copy, selectedAchievementIds: [] });

    expect(output).toContain("\\ResumeHeader{Jordan Example}");
    expect(output).not.toContain("\\section*{");
    expect(output).toContain("\\end{document}");
  });

  it("rejects unknown and disabled achievement IDs", () => {
    expect(() =>
      render({ selectedAchievementIds: ["achievement-missing"] }),
    ).toThrow(ResumeRenderError);

    const copy = structuredClone(library);
    copy.jobs[0].points[0].enabled = false;
    expect(() =>
      render({ library: copy, selectedAchievementIds: [allPointIds[0]] }),
    ).toThrow(/disabled/);
  });

  it("renders only explicitly supplied tailored wording and escapes it", () => {
    const selectedId = allPointIds[0];
    const tailoredText =
      "Built an AWS & cloud platform with 20% lower latency.";
    const output = render({
      selectedAchievementIds: [selectedId],
      achievementTextOverrides: [
        { achievementId: selectedId, text: tailoredText },
      ],
    });

    expect(output).toContain(
      "Built an AWS \\& cloud platform with 20\\% lower latency.",
    );
    expect(output).not.toContain(library.jobs[0].points[0].text);
  });

  it("rejects duplicate or unselected tailored wording overrides", () => {
    const selectedId = allPointIds[0];
    const override = { achievementId: selectedId, text: "Updated wording." };

    expect(() =>
      render({
        selectedAchievementIds: [selectedId],
        achievementTextOverrides: [override, override],
      }),
    ).toThrow(/only once/);
    expect(() =>
      render({
        selectedAchievementIds: [selectedId],
        achievementTextOverrides: [
          { achievementId: allPointIds[1], text: "Updated wording." },
        ],
      }),
    ).toThrow(/must be selected/);
  });

  it("rejects unknown or duplicate skills and duplicate sections", () => {
    expect(() => render({ selectedSkillIds: ["skill-missing"] })).toThrow(
      /Unknown skill ID/,
    );
    expect(() =>
      render({ selectedSkillIds: ["skill-aws", "skill-aws"] }),
    ).toThrow(/only once/);
    expect(() => render({ sectionOrder: ["skills", "skills"] })).toThrow(
      /section may appear only once/,
    );
  });

  it("follows a supplied section order and remains deterministic", () => {
    const sectionOrder = ["skills", "education", "experience"] as const;
    const first = render({ sectionOrder: [...sectionOrder] });
    const second = render({ sectionOrder: [...sectionOrder] });

    expect(first).toBe(second);
    expect(first.indexOf("\\section*{Technical Skills}")).toBeLessThan(
      first.indexOf("\\section*{Education}"),
    );
    expect(first.indexOf("\\section*{Education}")).toBeLessThan(
      first.indexOf("\\section*{Experience}"),
    );
    expect(first).not.toContain("\\section*{Projects}");
    expect(first).not.toContain("\\section*{Licenses and Certifications}");
  });

  it("rejects links with unsupported protocols", () => {
    const copy = structuredClone(library);
    copy.profile.links[0].url = "ftp://example.com/jordan";

    expect(() => render({ library: copy })).toThrow(
      /Unsupported link protocol/,
    );
  });
});
