/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import sampleLibrary from "../../../examples/sample-resume-library.json";
import { JD_DRAFT_STORAGE_KEY } from "../../../src/lib/jd-draft";
import type { ManualGenerationResult } from "../../../src/lib/generation/manual-generation";
import type { ResumeLibrary } from "../../../src/lib/schemas/resume-data";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@/lib/cloud/api-fetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  setActiveAccountUid: () => undefined,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children?: ReactNode;
    href?: string;
  }) => createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const library = sampleLibrary as ResumeLibrary;
const savedDescription = "Build reliable services for the grid.";
const savedJob = {
  schemaVersion: 1 as const,
  id: "job-contoso",
  company: "Contoso Grid",
  roleTitle: "Senior Platform Engineer",
  jobUrl: "",
  jobDescription: savedDescription,
  fingerprint: "a".repeat(64),
  analysis: {
    targetTitle: "Platform Engineer",
    seniority: "Senior",
    requiredQualifications: ["TypeScript"],
    preferredQualifications: ["GraphQL"],
    responsibilities: ["Build services"],
    toolsAndPlatforms: ["Kubernetes"],
    domainConcepts: ["Reliability"],
    atsTerms: ["TypeScript"],
    inferredContext: [],
    terminology: [],
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const historyEntry = {
  id: "gen-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  company: "Contoso",
  role: "Engineer",
  selectedAchievementIds: ["achievement-1"],
  generatedBullets: [],
  provider: "none",
  status: "compiled" as const,
  pdfPath: "data/generations/gen-1-abcdefabcdef.pdf",
  repairAttemptCount: 0,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
  Element.prototype.scrollIntoView = () => {};
  URL.createObjectURL = () => "blob:preview";
  URL.revokeObjectURL = () => {};
  if (window.HTMLDialogElement) {
    window.HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    window.HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
});

beforeEach(() => {
  apiFetch.mockReset();
  localStorage.clear();
  window.confirm = vi.fn(() => false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function click(element: Element) {
  act(() => {
    (element as HTMLElement).click();
  });
}

function setControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function buttonNamed(label: string) {
  const button = [...document.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.replace(/\s+/g, " ").trim().includes(label),
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}

describe("launch audit source invariants", () => {
  it("keeps mutations on apiFetch and off window.confirm", () => {
    for (const file of [
      "src/components/resume-generator.tsx",
      "src/components/resume-studio.tsx",
      "src/components/generation-history.tsx",
      "src/components/library/skill-board.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source, file).toContain('from "@/lib/cloud/api-fetch"');
      expect(source, file).not.toMatch(/\bawait fetch\(/);
      expect(source, file).not.toContain("window.confirm");
    }
  });
});

describe("skill board", () => {
  it("saves through apiFetch and does not claim success for an empty body", async () => {
    const { default: SkillBoard } = await import(
      "../../../src/components/library/skill-board"
    );
    const onAdded = vi.fn();
    apiFetch.mockResolvedValue(new Response("", { status: 200 }));
    await act(async () => {
      root?.render(
        createElement(SkillBoard, {
          skills: [],
          activeSkillId: "",
          canEdit: true,
          libraryIsEmpty: true,
          onSkill: () => {},
          onAdded,
        }),
      );
    });
    const input = document.querySelector(
      "input[name='skillName']",
    ) as HTMLInputElement;
    setControlValue(input, "LightGBM");
    const form = document.querySelector("form");
    await act(async () => {
      form?.requestSubmit();
      await Promise.resolve();
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/library/skills",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onAdded).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("The skill could not be saved.");

    apiFetch.mockResolvedValue(
      Response.json({ skill: { name: "LightGBM" } }, { status: 201 }),
    );
    await act(async () => {
      form?.requestSubmit();
      await Promise.resolve();
    });
    expect(onAdded).toHaveBeenCalledWith("LightGBM");
  });
});

describe("generation history", () => {
  async function renderHistory() {
    const { default: GenerationHistory } = await import(
      "../../../src/components/generation-history"
    );
    await act(async () => {
      root?.render(createElement(GenerationHistory));
    });
    await settle();
  }

  it("shows the load error instead of an empty archive, and keeps rows when refresh fails", async () => {
    apiFetch.mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );
    await renderHistory();
    expect(document.body.textContent).toContain("History could not be loaded.");
    expect(document.body.textContent).not.toContain("Your archive starts here");
    expect(buttonNamed("Refresh")).toBeTruthy();

    apiFetch.mockResolvedValueOnce(
      Response.json({ entries: [historyEntry], nextCursor: null }),
    );
    click(buttonNamed("Refresh"));
    await settle();
    expect(document.body.textContent).toContain("Contoso");
    expect(document.body.textContent).toContain("1 achievement");
    expect(document.body.textContent).not.toContain("1 achievements");
    expect(document.querySelector(".history-provider")?.textContent).toBe(
      "Manual",
    );

    apiFetch.mockResolvedValueOnce(
      new Response("", { status: 200, headers: { "Content-Type": "text/plain" } }),
    );
    click(buttonNamed("Refresh"));
    await settle();
    expect(document.body.textContent).toContain("Contoso");
    expect(document.body.textContent).toContain("History could not be loaded.");
    expect(document.body.textContent).not.toContain("Your archive starts here");
  });

  it("asks with the app dialog before deleting", async () => {
    apiFetch.mockResolvedValueOnce(
      Response.json({ entries: [historyEntry], nextCursor: null }),
    );
    await renderHistory();
    click(document.querySelector(".history-delete") as HTMLButtonElement);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Delete the saved resume for Engineer at Contoso? This also deletes its saved LaTeX and PDF files.",
    );
    click(buttonNamed("Cancel"));
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/history/gen-1"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("shows an error and retry when a saved PDF response is not a PDF", async () => {
    apiFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pdf")) {
        return Response.json({ error: "<not a pdf>" }, { status: 502 });
      }
      if (url.endsWith("/gen-1")) {
        return Response.json({ entry: historyEntry, latex: "\\documentclass{x}" });
      }
      return Response.json({ entries: [historyEntry], nextCursor: null });
    });
    await renderHistory();
    click(document.querySelector(".history-entry-open") as HTMLButtonElement);
    await settle();
    await settle();
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.body.textContent).toContain(
      "The saved PDF could not be opened.",
    );
    expect(buttonNamed("Retry")).toBeTruthy();
    expect(document.body.textContent).not.toContain("<not a pdf>");
  });
});

describe("resume builder", () => {
  function installBuilderFetch(handlers?: {
    onGenerate?: (body: string) => Promise<Response> | Response;
    onSuggest?: (body: string) => void;
  }) {
    apiFetch.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/job-analyses") && method === "GET") {
          return Response.json({
            jobs: [
              {
                id: savedJob.id,
                company: savedJob.company,
                roleTitle: savedJob.roleTitle,
                createdAt: savedJob.createdAt,
                updatedAt: savedJob.updatedAt,
              },
            ],
          });
        }
        if (url.includes("/api/job-analyses/") && method === "GET") {
          return Response.json({ job: savedJob });
        }
        if (url.includes("/api/job-analyses/") && method === "DELETE") {
          return Response.json({ deleted: true });
        }
        if (url.includes("/api/ai/select-achievements")) {
          handlers?.onSuggest?.(String(init?.body ?? ""));
          return Response.json({ error: "stopped" }, { status: 500 });
        }
        if (url.endsWith("/api/generate")) {
          return handlers?.onGenerate?.(String(init?.body ?? ""));
        }
        if (url.endsWith("/api/history")) {
          return new Response("", { status: 200 });
        }
        if (url.includes("/api/resume/skills")) {
          return Response.json({ error: "unavailable" }, { status: 404 });
        }
        return Response.json({ error: "unexpected" }, { status: 500 });
      },
    );
  }

  async function renderBuilder(nextLibrary: ResumeLibrary = library) {
    const { default: ResumeGenerator } = await import(
      "../../../src/components/resume-generator"
    );
    await act(async () => {
      root?.render(
        createElement(ResumeGenerator, {
          library: nextLibrary,
          source: "personal",
        }),
      );
    });
    await settle();
    await settle();
  }

  it("puts the saved job ahead of achievement choices and warns when the draft differs", async () => {
    localStorage.setItem(
      JD_DRAFT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        company: savedJob.company,
        roleTitle: savedJob.roleTitle,
        jobUrl: "",
        jobDescription: `${savedDescription} EDITED WITHOUT REANALYZE`,
      }),
    );
    let suggested = "";
    installBuilderFetch({
      onSuggest: (body) => {
        suggested = body;
      },
    });
    await renderBuilder();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("Build for a saved job")).toBeGreaterThan(-1);
    expect(text.indexOf("Build for a saved job")).toBeLessThan(
      text.indexOf("Choose achievements"),
    );
    expect(text).toContain(
      "This draft differs from the saved analysis. Analyze again to update it, or choose the saved job to restore it.",
    );
    expect(text).not.toContain("The coverage below shows");
    expect(text).toContain(
      "Suggest points to see how selected evidence supports each one.",
    );
    click(buttonNamed("Suggest points"));
    await settle();
    expect(suggested).toContain(savedDescription);
    expect(suggested).not.toContain("EDITED WITHOUT REANALYZE");
  });

  it("says disabled points are turned off and links to the library", async () => {
    installBuilderFetch();
    const disabled = structuredClone(library);
    for (const group of [...disabled.jobs, ...disabled.projects]) {
      for (const point of group.points) point.enabled = false;
    }
    await renderBuilder(disabled);
    expect(document.body.textContent).toContain(
      "achievement points are turned off.",
    );
    expect(document.querySelector("a[href='/library']")).toBeTruthy();
    expect(document.body.textContent).not.toContain(
      "This library has no achievement points.",
    );
  });

  it("keeps a generated resume when the selection changes and ignores a stale generate", async () => {
    let releaseGenerate: ((response: Response) => void) | null = null;
    installBuilderFetch({
      onGenerate: () =>
        new Promise((resolve) => {
          releaseGenerate = resolve;
        }),
    });
    await renderBuilder();
    const boxes = [
      ...document.querySelectorAll<HTMLInputElement>(
        "input[type='checkbox'][aria-label^='Select achievement']",
      ),
    ];
    click(boxes[0]);
    click(boxes[1]);
    await act(async () => {
      document.querySelector("form")?.requestSubmit();
    });
    expect(boxes[0].disabled).toBe(true);
    expect(buttonNamed("Select all").hasAttribute("disabled")).toBe(true);
    expect(buttonNamed("Clear").hasAttribute("disabled")).toBe(true);
    click(boxes[0]);
    const generation = {
      latex: "GENERATED-LATEX-STAYS",
      metadata: {
        id: "gen-builder",
        generatedAt: "2026-01-01T00:00:00.000Z",
        dataSource: "personal",
        company: savedJob.company,
        roleTitle: savedJob.roleTitle,
        jobUrl: "",
        selectedAchievementIds: [boxes[0].getAttribute("aria-label"), boxes[1]],
        tailoringMode: "manual",
        aiProvider: null,
        sourceProvenance: [],
        renderedSkillIds: ["skill-aws"],
        selectedSkillIds: ["skill-aws"],
        visibleWordCount: 2,
        generatedBullets: [] as {
          achievementId: string;
          sourceAchievementIds: string[];
          text: string;
        }[],
      },
    };
    const submittedIds = JSON.parse(
      String(
        apiFetch.mock.calls.find((call) =>
          String(call[0]).endsWith("/api/generate"),
        )?.[1]?.body,
      ),
    ).selectedAchievementIds as string[];
    generation.metadata.selectedAchievementIds = submittedIds;
    generation.metadata.generatedBullets = submittedIds.map((id) => ({
      achievementId: id,
      sourceAchievementIds: [id],
      text: "Rendered bullet",
    }));
    await act(async () => {
      releaseGenerate?.(
        Response.json(generation),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("GENERATED-LATEX-STAYS");
    expect(document.body.textContent).toContain(
      "Resume output is ready, but it could not be saved to history.",
    );
    expect(document.body.textContent).not.toContain(
      "Saved to generation history on this device.",
    );
    click(buttonNamed("Generation settings"));
    await settle();
    const after = [
      ...document.querySelectorAll<HTMLInputElement>(
        "input[type='checkbox'][aria-label^='Select achievement']",
      ),
    ];
    const unticked = after.find((box) => !box.checked) ?? after[0];
    expect(unticked).toBeTruthy();
    click(unticked);
    expect(document.body.textContent).toContain("GENERATED-LATEX-STAYS");
    expect(document.body.textContent).toContain(
      "Selection changed. Generate LaTeX to rebuild.",
    );
  });

  it("confirms saved-job deletion in the app dialog", async () => {
    installBuilderFetch();
    await renderBuilder();
    click(document.querySelector(".saved-job-delete") as HTMLButtonElement);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Delete the saved analysis for Contoso Grid? Resumes already created stay in history.",
    );
    click(buttonNamed("Cancel"));
    expect(
      apiFetch.mock.calls.some(
        (call) =>
          String(call[0]).includes("/api/job-analyses/") &&
          call[1]?.method === "DELETE",
      ),
    ).toBe(false);
  });
});

describe("resume studio", () => {
  it("labels coverage, reports pending edits, and cancel leaves the draft", async () => {
    const { default: ResumeStudio } = await import(
      "../../../src/components/resume-studio"
    );
    const pending: number[] = [];
    let editSignal: AbortSignal | undefined;
    apiFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/resume/skills")) {
        return Response.json({ error: "unavailable" }, { status: 404 });
      }
      if (url.endsWith("/api/resume/edit")) {
        editSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          const abort = () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          };
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      return Response.json({});
    });
    const generation = {
      latex: "STUDIO-LATEX",
      metadata: {
        id: "gen-studio",
        generatedAt: "2026-01-01T00:00:00.000Z",
        dataSource: "personal",
        company: "Contoso",
        roleTitle: "Engineer",
        jobUrl: "",
        selectedAchievementIds: ["achievement-service-capacity-design"],
        tailoringMode: "manual",
        aiProvider: null,
        sourceProvenance: [],
        renderedSkillIds: ["skill-aws"],
        visibleWordCount: 4,
        generatedBullets: [
          {
            achievementId: "achievement-service-capacity-design",
            sourceAchievementIds: ["achievement-service-capacity-design"],
            text: "Redesigned service boundaries.",
          },
        ],
        finalCoverage: [
          {
            requirement: "Kubernetes",
            priority: "required",
            status: "evidence-not-selected",
            evidence: [],
            coveredByAchievementIds: [],
            reason: "Not in this resume.",
          },
        ],
      },
    } as unknown as ManualGenerationResult;
    await act(async () => {
      root?.render(
        createElement(ResumeStudio, {
          library,
          source: "personal",
          generation,
          hasPdf: true,
          analysis: savedJob.analysis,
          recommendedSkillIds: [],
          onApplied: () => {},
          onSetup: () => {},
          onPendingChange: (count) => pending.push(count),
        }),
      );
    });
    await settle();
    click(buttonNamed("Job match"));
    expect(document.body.textContent).toContain("Not selected");
    expect(document.body.textContent).not.toContain("evidence-not-selected");
    click(buttonNamed("Overview"));
    const summary = document.querySelector(
      "textarea[aria-label='Resume summary']",
    ) as HTMLTextAreaElement;
    setControlValue(summary, "One edited summary");
    expect(pending.some((count) => count > 0)).toBe(true);
    expect(document.body.textContent).toContain("1 change");
    expect(document.body.textContent).not.toContain("1 changes");
    click(buttonNamed("Apply changes"));
    await settle();
    click(buttonNamed("Cancel"));
    await settle();
    expect(editSignal?.aborted).toBe(true);
    expect(document.body.textContent).toContain("One edited summary");
    expect(document.body.textContent).toContain(
      "Apply cancelled. The draft is unchanged.",
    );
  });
});
