import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ImaginationWritingControls, {
  DEFAULT_IMAGINATION_INSTRUCTION,
  IMAGINATION_WRITING_PRESETS,
  MAX_IMAGINATION_INSTRUCTION_LENGTH,
  type ImaginationWritingControlsProps,
} from "@/components/imagination-writing-controls";

type TestProps = { children?: ReactNode; [key: string]: unknown };
type TestElement = ReactElement<TestProps>;

function collectElements(node: ReactNode, tagName: string): TestElement[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectElements(child, tagName));
  }
  if (!isValidElement(node)) return [];

  const element = node as TestElement;
  const matching = element.type === tagName ? [element] : [];
  return [...matching, ...collectElements(element.props.children, tagName)];
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  return textContent((node as TestElement).props.children);
}

function findButton(tree: ReactNode, label: string): TestElement {
  const button = collectElements(tree, "button").find(
    (element) => textContent(element) === label,
  );
  if (!button) throw new Error('Could not find button "' + label + '".');
  return button;
}

function makeProps(
  overrides: Partial<ImaginationWritingControlsProps> = {},
): ImaginationWritingControlsProps {
  return {
    selectedMode: null,
    onModeChange: vi.fn(),
    instruction: DEFAULT_IMAGINATION_INSTRUCTION,
    onInstructionChange: vi.fn(),
    targetLines: 2,
    onTargetLinesChange: vi.fn(),
    canSubmit: true,
    isLoading: false,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function renderTree(props: ImaginationWritingControlsProps): ReactNode {
  return ImaginationWritingControls(props);
}

describe("ImaginationWritingControls", () => {
  it("renders the six named presets in order and marks the selected mode", () => {
    const tree = renderTree(
      makeProps({ selectedMode: "emphasize-engineering-impact" }),
    );
    const presetButtons = collectElements(tree, "button").filter((button) =>
      IMAGINATION_WRITING_PRESETS.some(
        (preset) => textContent(button) === preset.label,
      ),
    );

    expect(presetButtons.map(textContent)).toEqual([
      "Make shorter",
      "More technical",
      "Improve clarity",
      "Emphasize engineering impact",
      "Improve action verbs",
      "Reduce repetition",
    ]);
    expect(presetButtons.map((button) => button.props["aria-pressed"])).toEqual(
      [false, false, false, true, false, false],
    );
  });

  it("selects a preset without replacing the user's custom instruction", () => {
    const instruction = "Keep my custom wording and specific context.";
    for (const preset of IMAGINATION_WRITING_PRESETS) {
      const onModeChange = vi.fn();
      const onInstructionChange = vi.fn();
      const tree = renderTree(
        makeProps({ instruction, onModeChange, onInstructionChange }),
      );
      const button = findButton(tree, preset.label);
      const onClick = button.props.onClick as
        ((event: unknown) => void) | undefined;

      expect(onClick).toBeTypeOf("function");
      onClick?.({});

      expect(onModeChange).toHaveBeenCalledWith(preset.mode);
      expect(onInstructionChange).not.toHaveBeenCalled();

      const textarea = collectElements(tree, "textarea")[0];
      expect(textarea.props.value).toBe(instruction);
    }
  });

  it("enforces and reports the 500-character instruction limit", () => {
    const onInstructionChange = vi.fn();
    const tree = renderTree(
      makeProps({ instruction: "Count me", onInstructionChange }),
    );
    const textarea = collectElements(tree, "textarea")[0];
    const onChange = textarea.props.onChange as
      ((event: { currentTarget: { value: string } }) => void) | undefined;

    expect(textarea.props.maxLength).toBe(MAX_IMAGINATION_INSTRUCTION_LENGTH);
    expect(textContent(tree)).toContain("8/500");
    expect(textContent(tree)).toContain("Your instruction");
    onChange?.({
      currentTarget: {
        value: "x".repeat(MAX_IMAGINATION_INSTRUCTION_LENGTH + 1),
      },
    });
    expect(onInstructionChange).toHaveBeenCalledWith(
      "x".repeat(MAX_IMAGINATION_INSTRUCTION_LENGTH),
    );

    const overLimitInstruction = "x".repeat(
      MAX_IMAGINATION_INSTRUCTION_LENGTH + 1,
    );
    const overLimitTree = renderTree(
      makeProps({ instruction: overLimitInstruction }),
    );
    const overLimitTextarea = collectElements(overLimitTree, "textarea")[0];
    const submitButton = findButton(overLimitTree, "Ask Imagination");

    expect(overLimitTextarea.props["aria-invalid"]).toBe(true);
    expect(textContent(overLimitTree)).toContain("501/500");
    expect(submitButton.props.disabled).toBe(true);
  });

  it("keeps target-line options controlled and reports measurement truthfully", () => {
    const onTargetLinesChange = vi.fn();
    const tree = renderTree(makeProps({ onTargetLinesChange }));
    const select = collectElements(tree, "select")[0];
    const onChange = select.props.onChange as
      ((event: { currentTarget: { value: string } }) => void) | undefined;
    const options = collectElements(tree, "option");

    expect(options.map((option) => textContent(option))).toEqual([
      "1 line",
      "2 lines",
      "3 lines",
      "4 lines",
    ]);
    expect(textContent(tree)).toContain("Estimated until compiled");
    onChange?.({ currentTarget: { value: "3" } });
    expect(onTargetLinesChange).toHaveBeenCalledWith(3);

    const measuredTree = renderTree(
      makeProps({ targetLineFeedback: { status: "measured", lineCount: 2 } }),
    );
    expect(textContent(measuredTree)).toContain("Measured: 2 lines");
    expect(textContent(measuredTree)).not.toContain("Estimated until compiled");

    const unavailableTree = renderTree(
      makeProps({ targetLineFeedback: { status: "unavailable" } }),
    );
    expect(textContent(unavailableTree)).toContain("Line count unavailable");
  });

  it("submits through the parent handler and exposes cancel/loading states", () => {
    const onSubmit = vi.fn();
    const formTree = renderTree(makeProps({ onSubmit }));
    const form = collectElements(formTree, "form")[0];
    const onFormSubmit = form.props.onSubmit as
      ((event: { preventDefault: () => void }) => void) | undefined;
    const preventDefault = vi.fn();

    onFormSubmit?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();

    const onCancel = vi.fn();
    const loadingTree = renderTree(
      makeProps({ isLoading: true, onSubmit, onCancel }),
    );
    const loadingButton = findButton(loadingTree, "Imagining…");
    const cancelButton = findButton(loadingTree, "Cancel request");
    const cancelClick = cancelButton.props.onClick as
      ((event: unknown) => void) | undefined;

    expect(loadingButton.props.disabled).toBe(true);
    expect(textContent(loadingTree)).toContain("Imagining…");
    cancelClick?.({});
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not submit when the parent marks the request unavailable", () => {
    const onSubmit = vi.fn();
    const tree = renderTree(makeProps({ canSubmit: false, onSubmit }));
    const form = collectElements(tree, "form")[0];
    const onFormSubmit = form.props.onSubmit as
      ((event: { preventDefault: () => void }) => void) | undefined;
    const askButton = findButton(tree, "Ask Imagination");

    onFormSubmit?.({ preventDefault: vi.fn() });

    expect(askButton.props.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
