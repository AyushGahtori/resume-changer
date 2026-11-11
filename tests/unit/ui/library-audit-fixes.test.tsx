// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import demoLibrary from "../../../examples/sample-resume-library.json";
import AchievementLibrary from "../../../src/components/achievement-library";
import AchievementPointEditor from "../../../src/components/achievement-point-editor";
import CategoryNavigation, {
  libraryHeadingScrollTop,
} from "../../../src/components/library/category-navigation";
import { LibraryEmptyState } from "../../../src/components/library/library-states";
import LibrarySelect, {
  libraryMenuPlacement,
} from "../../../src/components/library/library-select";
import SearchWorkbench from "../../../src/components/library/search-workbench";
import SkillBoard from "../../../src/components/library/skill-board";
import { ImportStatusProvider } from "../../../src/components/library/import-status-provider";
import {
  EMPTY_LIBRARY_FILTERS,
  filterAchievementLibrary,
} from "../../../src/lib/data/achievement-search";
import type {
  ResumeLibrary,
  Skill,
} from "../../../src/lib/schemas/resume-data";
import { apiFetch } from "../../../src/lib/cloud/api-fetch";

vi.mock("../../../src/lib/cloud/api-fetch", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children?: ReactNode;
  }) => createElement("a", { href, ...props }, children),
}));

const fetchMock = vi.mocked(apiFetch);
const library = demoLibrary as ResumeLibrary;

const skill = (listed: boolean): Skill => ({
  id: listed ? "skill-listed" : "skill-library",
  name: listed ? "Python" : "LightGBM",
  aliases: [],
  sources: ["direct-user"],
  isListedOnCurrentResume: listed,
  evidenceAchievementIds: [],
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false;
    },
  }));
  window.scrollTo = () => {};
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  fetchMock.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("library menu placement", () => {
  it("opens above only when that side has more room and stays inside the viewport", () => {
    expect(libraryMenuPlacement({ top: 300, bottom: 340 }, 400)).toEqual({
      above: true,
      maxHeight: 286,
    });
    expect(libraryMenuPlacement({ top: 40, bottom: 80 }, 400)).toEqual({
      above: false,
      maxHeight: 300,
    });
    expect(libraryMenuPlacement({ top: 100, bottom: 200 }, 300).above).toBe(
      false,
    );
  });

  it("applies the measured height and flips the open menu", () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains("library-select-trigger")) {
        return {
          x: 0,
          y: 300,
          top: 300,
          bottom: 340,
          left: 0,
          right: 120,
          width: 120,
          height: 40,
          toJSON() {
            return {};
          },
        } as DOMRect;
      }
      return original.call(this);
    };
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 400,
    });

    render(
      createElement(LibrarySelect, {
        "aria-label": "Tag",
        onChange: () => {},
        options: [
          { label: "All tags", value: "" },
          { label: "Python", value: "python" },
        ],
        value: "",
      }),
    );

    act(() => {
      container.querySelector("button")?.click();
    });

    const menu = container.querySelector(".library-select-menu");
    expect(menu?.getAttribute("data-placement")).toBe("above");
    expect(menu?.getAttribute("style")).toContain("max-height: 286px");
    expect(menu?.getAttribute("style")).toContain("overflow: auto");
    HTMLElement.prototype.getBoundingClientRect = original;
  });
});

describe("library category counts", () => {
  it("gives All the achievement-point count and labels each chip", () => {
    const filtered = filterAchievementLibrary(library, {
      ...EMPTY_LIBRARY_FILTERS,
      skillId: "skill-python",
    });
    const html = renderToStaticMarkup(
      createElement(SearchWorkbench, {
        library,
        filters: { ...EMPTY_LIBRARY_FILTERS, skillId: "skill-python" },
        result: filtered,
        options: { skills: library.skills, tags: [] },
        hasFilters: true,
        onFilterChange: () => {},
        sort: "most-recent",
        onSortChange: () => {},
        onReset: () => {},
      }),
    );

    expect(html).toContain(
      `aria-label="All, ${filtered.visiblePointCount} achievement points"`,
    );
    expect(html).toContain('aria-label="Credentials, 0 credentials"');
    expect(html).not.toContain("unfiltered");
    const unfiltered = filterAchievementLibrary(library, EMPTY_LIBRARY_FILTERS);
    expect(unfiltered.visiblePointCount).toBe(13);
    expect(
      unfiltered.jobs.length +
        unfiltered.projects.length +
        unfiltered.skills.length +
        unfiltered.credentials.length,
    ).toBe(20);
  });

  it("scrolls a heading to just below the sticky stack", () => {
    expect(libraryHeadingScrollTop(480, 200, 160)).toBe(508);
    expect(libraryHeadingScrollTop(0, 0, 40)).toBe(0);
  });

  it("opens skills and credentials from the chips without filtering", () => {
    const onRevealSection = vi.fn();
    render(
      createElement(CategoryNavigation, {
        counts: { all: 13, jobs: 2, projects: 2, skills: 14, credentials: 2 },
        onRevealSection,
      }),
    );

    const skills = container.querySelector(
      '[data-section="skills"]',
    ) as HTMLAnchorElement;
    const credentials = container.querySelector(
      '[data-section="credentials"]',
    ) as HTMLAnchorElement;
    const jobs = container.querySelector(
      '[data-section="jobs"]',
    ) as HTMLAnchorElement;

    expect(skills.getAttribute("href")).toBe("#library-skills");
    act(() => skills.click());
    act(() => credentials.click());
    act(() => jobs.click());

    expect(onRevealSection.mock.calls).toEqual([["skills"], ["credentials"]]);
  });
});

describe("skill board", () => {
  it("shows whether a skill is on the current resume", () => {
    render(
      createElement(SkillBoard, {
        skills: [skill(true), skill(false)],
        activeSkillId: "",
        canEdit: false,
        libraryIsEmpty: false,
        onSkill: () => {},
        onAdded: () => {},
      }),
    );

    const listed = container.querySelector(".skill-listed");
    const unlisted = container.querySelector(".skill-unlisted");
    expect(listed?.textContent).toBe("On current resume");
    expect(unlisted?.textContent).toBe("Library only");
    expect(listed?.className).not.toContain("visually-hidden");
    expect(unlisted?.className).not.toContain("visually-hidden");
  });

  it("posts through apiFetch and does not throw on a bad body", async () => {
    const onAdded = vi.fn();
    fetchMock.mockResolvedValue(
      new Response("<not-json>", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    render(
      createElement(SkillBoard, {
        skills: [],
        activeSkillId: "",
        canEdit: true,
        libraryIsEmpty: true,
        onSkill: () => {},
        onAdded,
      }),
    );

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => setInputValue(input, "LightGBM"));
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/library/skills",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onAdded).not.toHaveBeenCalled();
    expect(container.textContent).toContain("The skill could not be saved.");
    expect(container.textContent).not.toContain("Unexpected token");
  });

  it("keeps the local sentence when the network fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      createElement(SkillBoard, {
        skills: [],
        activeSkillId: "",
        canEdit: true,
        libraryIsEmpty: true,
        onSkill: () => {},
        onAdded: () => {},
      }),
    );

    const input = container.querySelector("input") as HTMLInputElement;
    act(() => setInputValue(input, "LightGBM"));
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });

    expect(container.textContent).toContain(
      "Could not reach the local save service. Try again.",
    );
  });
});

describe("achievement point editor", () => {
  const parents = [
    { id: "project-one", label: "Field Notes", type: "project" as const },
  ];

  function editor(canWrite = true) {
    return createElement(AchievementPointEditor, {
      canWrite,
      focusFirstField: false,
      onCancel: () => {},
      onSaved: () => {},
      parents,
      skills: [skill(true), skill(false)],
    });
  }

  it("replaces native selects, the skill list, and the checkbox", () => {
    render(editor());

    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(
      container.querySelector('[aria-label="Provenance type"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="Job or project for this achievement"]',
      ),
    ).not.toBeNull();

    const python = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Python",
    );
    expect(python?.getAttribute("aria-pressed")).toBe("false");
    act(() => python?.click());
    expect(python?.getAttribute("aria-pressed")).toBe("true");

    const enabled = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Enabled",
    );
    expect(enabled?.getAttribute("aria-pressed")).toBe("true");
    act(() => enabled?.click());
    expect(
      [...container.querySelectorAll("button")].some(
        (button) =>
          button.textContent === "Disabled" &&
          button.getAttribute("aria-pressed") === "false",
      ),
    ).toBe(true);
  });

  it("does not write while the page is demo data or writing is closed", async () => {
    window.history.replaceState({}, "", "/library?source=demo");
    render(editor(true));
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(fetchMock).not.toHaveBeenCalled();

    window.history.replaceState({}, "", "/library");
    render(editor(false));
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("empty library parent", () => {
  it("collects a job or project name instead of an unfinished achievement form", () => {
    const html = renderToStaticMarkup(
      createElement(LibraryEmptyState, {
        variant: "no-data",
        totalPointCount: 0,
        needsParent: true,
        onCreateParent: async () => {},
      }),
    );

    expect(html).toContain("Project name");
    expect(html).toContain("library-first-parent-name");
    expect(html).not.toContain(">Add achievement<");
    expect(html).toContain("no job or project yet");
  });
});

const tinyLibrary = {
  schemaVersion: 1,
  profile: {
    id: "profile-tiny",
    fullName: "Jordan Example",
    links: [],
    education: [],
  },
  jobs: [
    {
      id: "job-one",
      company: "Example Co",
      title: "Engineer",
      employmentType: "full-time",
      startDate: "2024-01",
      endDate: null,
      points: [
        {
          id: "achievement-one",
          text: "Shipped a synthetic service.",
          tags: [],
          skillIds: [],
          metrics: [],
          source: { type: "direct-user" },
          enabled: true,
        },
      ],
    },
  ],
  projects: [],
  skills: [],
  credentials: [],
  preferences: {
    sectionOrder: ["experience", "projects", "skills", "credentials"],
    maxPages: 1,
  },
} as ResumeLibrary;

describe("demo library editing", () => {
  function page(source: "personal" | "demo") {
    return createElement(
      ImportStatusProvider,
      { enabled: false },
      createElement(AchievementLibrary, { library: tinyLibrary, source }),
    );
  }

  it("closes an open editor when the source becomes demo and does not restore it", () => {
    render(page("personal"));
    const edit = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Edit",
    );
    act(() => edit?.click());
    expect(container.textContent).toContain("Save achievement");

    render(page("demo"));
    expect(container.textContent).not.toContain("Save achievement");
    expect(container.textContent).toContain("Demo data is read-only.");

    render(page("personal"));
    expect(container.textContent).not.toContain("Save achievement");
    expect(container.textContent).not.toContain("Demo data is read-only.");
  });

  it("opens the skills section from its chip and lets a later collapse stick", () => {
    render(page("personal"));
    const skills = container.querySelector(
      "#library-skills",
    ) as HTMLDetailsElement;
    expect(skills.open).toBe(false);

    act(() => {
      container
        .querySelector<HTMLAnchorElement>('[data-section="skills"]')
        ?.click();
    });
    expect(skills.open).toBe(true);

    act(() => {
      skills.open = false;
      skills.dispatchEvent(new Event("toggle", { bubbles: true }));
    });
    expect(skills.open).toBe(false);
  });
});
