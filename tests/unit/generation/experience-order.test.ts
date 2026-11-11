import { describe, expect, it } from "vitest";
import { orderExperiencesForResume } from "../../../src/lib/generation/experience-order";

describe("orderExperiencesForResume", () => {
  it("puts a current role ahead of an earlier job stored first in the library", () => {
    const ordered = orderExperiencesForResume([
      {
        id: "job-one",
        title: "Software Developer",
        startDate: "2022-01",
        endDate: "2023-06",
      },
      {
        id: "job-two",
        title: "AI/ML Intern",
        startDate: "2024-06",
        endDate: null,
      },
    ]);

    expect(ordered.map((job) => job.id)).toEqual(["job-two", "job-one"]);
  });

  it("keeps the later start first when both roles have ended", () => {
    const ordered = orderExperiencesForResume([
      { id: "older", startDate: "2020-01", endDate: "2021-01" },
      { id: "newer", startDate: "2023-04", endDate: "2024-01" },
    ]);

    expect(ordered.map((job) => job.id)).toEqual(["newer", "older"]);
  });
});
