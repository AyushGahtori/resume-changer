import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ImaginationComposer, {
  MAX_ACHIEVEMENT_TEXT_LENGTH,
  reconcileDestinationAchievementIds,
  type ImaginationComposerProps,
} from "../../../src/components/imagination-composer";
import { parseImaginationDraft } from "../../../src/lib/generation/imagination-draft";
import type { ImaginationDraft } from "../../../src/lib/generation/imagination-draft";
import { studioGroups } from "../../../src/lib/generation/studio-document";
import { studioLibrary } from "../../helpers/studio-fixtures";

const libraryGroups = [...studioLibrary.jobs, ...studioLibrary.projects];
const allDestinations = studioGroups(studioLibrary);
const firstDestination = libraryGroups[0];
const secondDestination = libraryGroups.find(
  (destination) => destination.id !== firstDestination.id,
)!;
const firstAchievement = firstDestination.points.find(
  (point) => point.enabled,
)!;
const secondAchievement = secondDestination.points.find(
  (point) => point.enabled,
)!;

function makeProps(
  overrides: Partial<ImaginationComposerProps> = {},
): ImaginationComposerProps {
  return {
    library: studioLibrary,
    destinationGroupId: firstDestination.id,
    connectedAchievementIds: [],
    onDestinationChange: vi.fn(),
    value: "",
    onTextChange: vi.fn(),
    createNotice: null,
    restoreDraft: null,
    onRestoreDraft: vi.fn(),
    onDismissRestoreDraft: vi.fn(),
    ...overrides,
  };
}

function renderMarkup(overrides: Partial<ImaginationComposerProps> = {}) {
  return renderToStaticMarkup(
    createElement(ImaginationComposer, makeProps(overrides)),
  );
}

type ElementWithProps = ReactElement<Record<string, unknown>>;

function findElement(
  node: ReactNode,
  predicate: (element: ElementWithProps) => boolean,
): ElementWithProps | null {
  if (!isValidElement(node)) return null;
  const element = node as ElementWithProps;
  if (predicate(element)) return element;

  const children = element.props.children as ReactNode;
  for (const child of Array.isArray(children) ? children : [children]) {
    const result = findElement(child, predicate);
    if (result) return result;
  }
  return null;
}

function renderedText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join("");
  if (!isValidElement(node)) return "";
  return renderedText((node as ElementWithProps).props.children as ReactNode);
}

describe("Imagination Canvas composer", () => {
  it("renders the page heading and destinations from the loaded library", () => {
    const html = renderMarkup();

    expect(html).toContain("<h1");
    expect(html).toContain("Imagination Canvas");
    expect(html).toContain(
      "Turn rough notes and connected evidence into a factual achievement statement.",
    );
    expect(html).toContain('for="imagination-resume-destination"');
    expect(html).toContain("Resume destination");

    for (const destination of allDestinations) {
      expect(html).toContain('value="' + destination.id + '"');
      expect(html).toContain(destination.title);
      if (destination.subtitle)
        expect(html).toContain(
          destination.title + " · " + destination.subtitle,
        );
    }
    expect(html).not.toContain("Software Developer · JoyArc");
    expect(html).toContain('value="' + firstDestination.id + '" selected=""');
  });

  it("reconciles connected achievements against the selected destination", () => {
    const connected = [
      firstAchievement.id,
      secondAchievement.id,
      firstAchievement.id,
      "missing-achievement",
    ];

    expect(
      reconcileDestinationAchievementIds(
        studioLibrary,
        secondDestination.id,
        connected,
      ),
    ).toEqual([secondAchievement.id]);
    expect(
      reconcileDestinationAchievementIds(
        studioLibrary,
        "missing-destination",
        connected,
      ),
    ).toEqual([]);
  });

  it("passes the destination and compatible evidence to the controlled parent", () => {
    const onDestinationChange = vi.fn();
    const props = makeProps({
      connectedAchievementIds: [
        firstAchievement.id,
        secondAchievement.id,
        "missing-achievement",
      ],
      onDestinationChange,
    });
    const tree = ImaginationComposer(props);
    const select = findElement(tree, (element) => element.type === "select");

    expect(select).not.toBeNull();
    (select!.props.onChange as (event: unknown) => void)({
      currentTarget: { value: secondDestination.id },
    });

    expect(onDestinationChange).toHaveBeenCalledWith(secondDestination.id, [
      secondAchievement.id,
    ]);
  });

  it("renders the editable New achievement composer with the target placeholder", () => {
    const html = renderMarkup({ value: "A restored editable draft." });

    expect(html).toContain("New achievement");
    expect(html).toContain("Start with a draft");
    expect(html).toContain(
      'placeholder="Write what you built, improved, or accomplished…"',
    );
    expect(html).toContain("A restored editable draft.");
    expect(html).toContain('id="imagination-achievement-text"');
    expect(html).toContain('maxLength="8000"');
  });

  it("passes author edits through the controlled change handler", () => {
    const onTextChange = vi.fn();
    const tree = ImaginationComposer(makeProps({ onTextChange }));
    const textarea = findElement(
      tree,
      (element) => element.type === "textarea",
    );

    expect(textarea).not.toBeNull();
    (textarea!.props.onChange as (event: unknown) => void)({
      currentTarget: { value: "A revised achievement draft." },
    });

    expect(onTextChange).toHaveBeenCalledWith("A revised achievement draft.");
  });

  it("keeps the editor limit at 8,000 characters", () => {
    const maximumDraft = "a".repeat(MAX_ACHIEVEMENT_TEXT_LENGTH);
    const html = renderMarkup({ value: maximumDraft });
    const value = html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1];

    expect(MAX_ACHIEVEMENT_TEXT_LENGTH).toBe(8_000);
    expect(value).toHaveLength(8_000);
  });

  it("shows only the create notice that the parent confirms is accurate", () => {
    const libraryHtml = renderMarkup({ createNotice: "library" });
    const resumeHtml = renderMarkup({ createNotice: "resume" });
    const bothHtml = renderMarkup({ createNotice: "both" });

    expect(libraryHtml).toContain("Create mode");
    expect(libraryHtml).toContain(
      "saves to your Achievement Library. It does not update your PDF yet.",
    );
    expect(resumeHtml).toContain(
      "adds the reviewed achievement to your resume draft.",
    );
    expect(bothHtml).toContain(
      "saves the new achievement to your Achievement Library and adds it to your resume draft.",
    );
    expect(renderMarkup({ createNotice: null })).not.toContain("Create mode");
  });

  it("offers restore-ready values and renders the restored destination and text", () => {
    const candidate = {
      groupId: firstDestination.id,
      text: "An unfinished achievement to restore.",
      instruction: "Keep the supported facts.",
      selectedIds: [firstAchievement.id],
      skillIds: [],
      targetLines: 2,
    };
    const draft = parseImaginationDraft(
      JSON.stringify(candidate),
      studioLibrary,
    );
    const onRestoreDraft = vi.fn((value: ImaginationDraft) => value);
    const pendingTree = ImaginationComposer(
      makeProps({ restoreDraft: draft, onRestoreDraft }),
    );
    const restoreButton = findElement(
      pendingTree,
      (element) =>
        element.type === "button" &&
        renderedText(element.props.children as ReactNode) ===
          "Restore writing draft",
    );

    expect(draft).toEqual(candidate);
    expect(renderedText(restoreButton?.props.children as ReactNode)).toBe(
      "Restore writing draft",
    );
    (restoreButton!.props.onClick as () => void)();
    expect(onRestoreDraft).toHaveBeenCalledWith(draft);

    const restoredHtml = renderMarkup({
      destinationGroupId: draft!.groupId,
      connectedAchievementIds: draft!.selectedIds,
      value: draft!.text,
    });
    expect(restoredHtml).toContain(
      'value="' + draft!.groupId + '" selected=""',
    );
    expect(restoredHtml).toContain(draft!.text);
  });
});
