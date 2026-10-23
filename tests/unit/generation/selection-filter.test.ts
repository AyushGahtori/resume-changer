import { describe, expect, it } from "vitest";
import {
  countSelectionPoints,
  filterSelectionGroups,
  matchesSelectionQuery,
} from "../../../src/lib/generation/selection-filter";

const groups = [
  {
    id: "job-example-cloud-labs",
    kind: "JOB" as const,
    title: "Platform Engineer",
    subtitle: "Example Cloud Labs",
    points: [
      {
        id: "achievement-service-capacity-design",
        text: "Redesigned service boundaries",
      },
      {
        id: "achievement-cloud-deployment-platform",
        text: "Standardized AWS provisioning",
      },
    ],
  },
  {
    id: "project-queueboard",
    kind: "PROJECT" as const,
    title: "QueueBoard",
    subtitle: "Backend and platform developer",
    points: [
      {
        id: "achievement-queueboard-worker-model",
        text: "Implemented a worker model",
      },
    ],
  },
];

const noFilter = { query: "", experienceId: "" };

describe("achievement search and experience filter", () => {
  it("keeps every group when nothing is searched", () => {
    expect(filterSelectionGroups(groups, noFilter)).toHaveLength(2);
    expect(countSelectionPoints(filterSelectionGroups(groups, noFilter))).toBe(
      3,
    );
  });

  it("matches the achievement text regardless of case", () => {
    const filtered = filterSelectionGroups(groups, {
      ...noFilter,
      query: "aws provisioning",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].points.map((point) => point.id)).toEqual([
      "achievement-cloud-deployment-platform",
    ]);
  });

  it("matches the experience the achievement belongs to", () => {
    const filtered = filterSelectionGroups(groups, {
      ...noFilter,
      query: "Example Cloud Labs",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("job-example-cloud-labs");
    expect(filtered[0].points).toHaveLength(2);
  });

  it("needs every searched term to match", () => {
    const filtered = filterSelectionGroups(groups, {
      ...noFilter,
      query: "aws queueboard",
    });
    expect(filtered).toEqual([]);
  });

  it("keeps only the chosen experience", () => {
    const filtered = filterSelectionGroups(groups, {
      ...noFilter,
      experienceId: "project-queueboard",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].points.map((point) => point.id)).toEqual([
      "achievement-queueboard-worker-model",
    ]);
  });

  it("combines the search and the experience filter", () => {
    const filtered = filterSelectionGroups(groups, {
      query: "worker",
      experienceId: "job-example-cloud-labs",
    });
    expect(filtered).toEqual([]);
  });

  it("leaves out a group without a matching achievement", () => {
    const filtered = filterSelectionGroups(groups, {
      ...noFilter,
      query: "worker",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("project-queueboard");
  });

  it("ignores punctuation and repeated spaces in the query", () => {
    expect(
      matchesSelectionQuery(
        { title: "Platform Engineer", subtitle: "Example Cloud Labs" },
        { id: "achievement-1", text: "Standardized AWS, CI/CD provisioning!" },
        "  aws   provisioning  ",
      ),
    ).toBe(true);
  });

  it("treats an empty query as a match for everything", () => {
    expect(
      matchesSelectionQuery(
        { title: "Platform Engineer", subtitle: "Example Cloud Labs" },
        { id: "achievement-1", text: "Anything" },
        "   ",
      ),
    ).toBe(true);
  });

  it("does not change the selected evidence while filtering", () => {
    const selected = ["achievement-service-capacity-design"];
    const filtered = filterSelectionGroups(groups, {
      ...noFilter,
      query: "queueboard",
    });
    expect(selected).toEqual(["achievement-service-capacity-design"]);
    expect(filtered[0].points[0].id).toBe(
      "achievement-queueboard-worker-model",
    );
  });
});
