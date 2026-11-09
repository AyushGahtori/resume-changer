import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CategoryNavigation from "@/components/library/category-navigation";
import SearchWorkbench from "@/components/library/search-workbench";
import {
  EMPTY_LIBRARY_FILTERS,
  filterAchievementLibrary,
  sortFilteredLibrary,
} from "@/lib/data/achievement-search";
import { studioLibrary } from "../../helpers/studio-fixtures";

const counts = {
  all: 13,
  jobs: 2,
  projects: 2,
  skills: 14,
  credentials: 2,
};

describe("library category counts", () => {
  it("uses achievement points for All and labels credentials that ignore a skill filter", () => {
    const plain = renderToStaticMarkup(
      createElement(CategoryNavigation, { counts }),
    );
    expect(plain).toContain('aria-label="All, 13 achievement points"');
    expect(plain).toContain('aria-label="Credentials, 2 credentials"');
    expect(plain).not.toContain("unfiltered");

    const marked = renderToStaticMarkup(
      createElement(CategoryNavigation, {
        counts,
        credentialsUnfiltered: true,
      }),
    );
    expect(marked).toContain(
      'aria-label="Credentials, 2 credentials, unfiltered"',
    );
    expect(marked).toContain(">unfiltered<");
  });

  it("marks credentials unfiltered when a skill filter is active", () => {
    const filters = { ...EMPTY_LIBRARY_FILTERS, skillId: "skill-python" };
    const result = sortFilteredLibrary(
      filterAchievementLibrary(studioLibrary, filters),
      "most-recent",
    );
    const markup = renderToStaticMarkup(
      createElement(SearchWorkbench, {
        filters,
        hasFilters: true,
        library: studioLibrary,
        onFilterChange: () => undefined,
        onReset: () => undefined,
        onSortChange: () => undefined,
        options: { skills: studioLibrary.skills, tags: [] },
        result,
        sort: "most-recent",
      }),
    );

    expect(markup).toContain("unfiltered");
    expect(markup).toContain(
      `${result.visiblePointCount} achievement points`,
    );
    expect(markup).not.toContain("No save destination is available");
  });
});
