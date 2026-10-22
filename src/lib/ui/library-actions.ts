import { ListPlus, Pencil, Plus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Button and icon conventions for the Achievement Library surface.
 *
 * Every library action declares the same four things: the label assistive
 * technology announces, the decorative lucide icon that sits beside it, the
 * size of that icon, and the visual weight of the control. Keeping the
 * declarations in one place is what stops the surface from drifting into
 * one-off buttons, and it gives the browser suite a single contract to
 * assert against.
 *
 * The icons are always decorative. Callers render them with `aria-hidden`,
 * so the visible label stays the only accessible name and an icon can never
 * change what a control is announced as.
 */

export type LibraryActionName =
  | "add-achievement"
  | "detailed-entry"
  | "edit-point"
  | "add-metric"
  | "remove-metric"
  | "close-editor";

export type LibraryActionVariant = "primary" | "secondary" | "tertiary";

export type LibraryActionDescriptor = {
  /** Visible label, and the accessible name of the control. */
  readonly label: string;
  /** Decorative leading icon. */
  readonly icon: LucideIcon;
  /** Rendered icon size in pixels. */
  readonly iconSize: number;
  /**
   * Visual weight. `primary` is reserved for the single orange action on a
   * surface, `secondary` is a bordered neutral control, and `tertiary` is
   * the low-emphasis inline action.
   */
  readonly variant: LibraryActionVariant;
};

export const LIBRARY_ACTIONS: Readonly<
  Record<LibraryActionName, LibraryActionDescriptor>
> = {
  "add-achievement": {
    label: "Add achievement",
    icon: Plus,
    iconSize: 18,
    variant: "primary",
  },
  "detailed-entry": {
    label: "Detailed entry",
    icon: ListPlus,
    iconSize: 16,
    variant: "secondary",
  },
  "edit-point": {
    label: "Edit",
    icon: Pencil,
    iconSize: 16,
    variant: "tertiary",
  },
  "add-metric": {
    label: "Add metric",
    icon: Plus,
    iconSize: 14,
    variant: "tertiary",
  },
  "remove-metric": {
    label: "Remove metric",
    icon: X,
    iconSize: 14,
    variant: "tertiary",
  },
  "close-editor": {
    label: "Cancel editing",
    icon: X,
    iconSize: 18,
    variant: "tertiary",
  },
};

export function getLibraryAction(
  name: LibraryActionName,
): LibraryActionDescriptor {
  const descriptor = LIBRARY_ACTIONS[name];
  if (!descriptor) {
    throw new Error(`Unknown library action: ${name}`);
  }
  return descriptor;
}
