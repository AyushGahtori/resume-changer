import { describe, expect, it } from "vitest";
import { detectSkillCandidates } from "../../../src/lib/intake/skill-candidates";

const PYTHON_SQL_POWER_BI = [
  "Built Python scripts to clean SQL exports and publish Power BI reports",
];

describe("detectSkillCandidates", () => {
  it("returns Python, SQL, and Power BI from the sample note", () => {
    expect(detectSkillCandidates(PYTHON_SQL_POWER_BI, [])).toEqual([
      {
        name: "Python",
        aliases: ["py"],
        sourceIndexes: [0],
        reason: "Named in your notes",
      },
      {
        name: "SQL",
        aliases: [],
        sourceIndexes: [0],
        reason: "Named in your notes",
      },
      {
        name: "Power BI",
        aliases: ["powerbi", "power-bi"],
        sourceIndexes: [0],
        reason: "Named in your notes",
      },
    ]);
  });

  it("uses the existing canonical name when an alias matches", () => {
    expect(
      detectSkillCandidates(
        ["py scripts"],
        [{ name: "Python", aliases: ["py"] }],
      ),
    ).toEqual([
      {
        name: "Python",
        aliases: ["py"],
        sourceIndexes: [0],
        reason: "Matches your existing skill",
      },
    ]);
  });

  it("does not treat javascript as Java", () => {
    expect(
      detectSkillCandidates(["Wrote javascript services"], []).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["JavaScript"]);
    expect(
      detectSkillCandidates(["Java services"], []).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["Java"]);
  });

  it("returns no candidates for leadership that is not a named skill", () => {
    expect(detectSkillCandidates(["Led the team"], [])).toEqual([]);
    expect(detectSkillCandidates(["team leadership"], [])).toEqual([]);
  });

  it("proposes AWS only when AWS or Amazon Web Services is written", () => {
    expect(
      detectSkillCandidates(["Moved the service to the cloud"], []),
    ).toEqual([]);
    expect(
      detectSkillCandidates(["Deployed on AWS"], []).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["AWS"]);
    expect(
      detectSkillCandidates(["Deployed on Amazon Web Services"], []).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["AWS"]);
  });

  it("matches aliases and symbols without borrowing shorter names", () => {
    expect(
      detectSkillCandidates(["Ran k8s beside Node.js, C++, and C#"], []).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["Kubernetes", "Node.js", "C++", "C#"]);
  });

  it("orders skills by first appearance and records each note index once", () => {
    const found = detectSkillCandidates(
      ["Python scripts and Python tools", "More Python and SQL"],
      [],
    );
    expect(found.map((candidate) => candidate.name)).toEqual(["Python", "SQL"]);
    expect(found[0]?.sourceIndexes).toEqual([0, 1]);
    expect(found[1]?.sourceIndexes).toEqual([1]);
  });

  it("does not take a job description argument", () => {
    expect(detectSkillCandidates.length).toBe(2);
  });

  it("does not treat a go-live as the Go language", () => {
    expect(
      detectSkillCandidates(["Led the go-live for the billing cutover"], []),
    ).toEqual([]);
    expect(
      detectSkillCandidates(
        ["Wrote Go services for the billing cutover"],
        [],
      ).map((candidate) => candidate.name),
    ).toEqual(["Go"]);
  });

  it("does not match a skill inside a longer word", () => {
    expect(detectSkillCandidates(["GitHub made it excellent"], [])).toEqual([]);
    expect(
      detectSkillCandidates(["POWER-BI and postgres"], []).map(
        (candidate) => candidate.name,
      ),
    ).toEqual(["Power BI", "PostgreSQL"]);
  });
});
