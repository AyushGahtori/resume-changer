import { describe, expect, it } from "vitest";
import {
  getLibraryAction,
  LIBRARY_ACTIONS,
  type LibraryActionName,
} from "../../../src/lib/ui/library-actions";

describe("library action descriptors", () => {
  it("covers every library action with a label, icon, size, and variant", () => {
    expect(Object.keys(LIBRARY_ACTIONS).sort()).toEqual([
      "add-achievement",
      "add-metric",
      "close-editor",
      "detailed-entry",
      "edit-point",
      "remove-metric",
    ]);

    for (const [name, action] of Object.entries(LIBRARY_ACTIONS)) {
      expect(action.label, name).not.toBe("");
      expect(action.icon, name).toBeTruthy();
      expect(action.iconSize, name).toBeGreaterThanOrEqual(14);
      expect(action.iconSize, name).toBeLessThanOrEqual(20);
      expect(["primary", "secondary", "tertiary"], name).toContain(
        action.variant,
      );
    }
  });

  it("keeps the visible labels the current library already announces", () => {
    expect(getLibraryAction("add-achievement").label).toBe("Add achievement");
    expect(getLibraryAction("detailed-entry").label).toBe("Detailed entry");
    expect(getLibraryAction("edit-point").label).toBe("Edit");
    expect(getLibraryAction("add-metric").label).toBe("Add metric");
    expect(getLibraryAction("remove-metric").label).toBe("Remove metric");
    expect(getLibraryAction("close-editor").label).toBe("Cancel editing");
  });

  it("gives the surface one primary action and a neutral hierarchy below it", () => {
    expect(getLibraryAction("add-achievement").variant).toBe("primary");
    expect(getLibraryAction("detailed-entry").variant).toBe("secondary");
    expect(getLibraryAction("edit-point").variant).toBe("tertiary");
    expect(getLibraryAction("add-metric").variant).toBe("tertiary");
    expect(getLibraryAction("remove-metric").variant).toBe("tertiary");
    expect(getLibraryAction("close-editor").variant).toBe("tertiary");

    const primary = Object.values(LIBRARY_ACTIONS).filter(
      (action) => action.variant === "primary",
    );
    expect(primary).toHaveLength(1);
  });

  it("reuses one icon only where the meaning is the same", () => {
    const icons = Object.values(LIBRARY_ACTIONS).map((action) => action.icon);

    expect(new Set(icons).size).toBe(4);
    expect(getLibraryAction("add-achievement").icon).toBe(
      getLibraryAction("add-metric").icon,
    );
    expect(getLibraryAction("close-editor").icon).toBe(
      getLibraryAction("remove-metric").icon,
    );
    expect(getLibraryAction("edit-point").icon).not.toBe(
      getLibraryAction("add-achievement").icon,
    );
    expect(getLibraryAction("detailed-entry").icon).not.toBe(
      getLibraryAction("add-achievement").icon,
    );
  });

  it("does not declare favorite or delete actions", () => {
    const names = Object.keys(LIBRARY_ACTIONS);
    expect(
      names.filter((name) => /favorite|heart|delete|trash/i.test(name)),
    ).toEqual([]);
  });

  it("rejects an unknown action name", () => {
    expect(() => getLibraryAction("delete-point" as LibraryActionName)).toThrow(
      /Unknown library action/,
    );
  });
});
