import { Briefcase, Building2, Link2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type RoleFieldName = "company" | "roleTitle" | "jobUrl";

export type RoleFieldDescriptor = {
  /** Draft key the field writes to. */
  readonly field: RoleFieldName;
  /** Visible label rendered above the control. */
  readonly label: string;
  /** Input `id` and the label's `htmlFor` target. */
  readonly id: string;
  /** Form `name` attribute. */
  readonly name: string;
  /** Placeholder copy shown while the field is empty. */
  readonly placeholder: string;
  /** Leading adornment icon. */
  readonly icon: LucideIcon;
  /** Browser autofill hint. */
  readonly autoComplete: string;
  /** Mobile keyboard hint, when the field benefits from one. */
  readonly inputMode?: "url";
};

/**
 * The three role details inputs, in the order they appear in the form.
 *
 * The icons are leading adornments only: they never replace the label, and
 * they are decorative so assistive technology still announces each field by
 * its visible label.
 */
export const ROLE_FIELDS: readonly RoleFieldDescriptor[] = [
  {
    field: "company",
    label: "Company",
    id: "company",
    name: "company",
    placeholder: "Company name",
    icon: Building2,
    autoComplete: "organization",
  },
  {
    field: "roleTitle",
    label: "Role title",
    id: "role-title",
    name: "roleTitle",
    placeholder: "e.g. Backend Engineer",
    icon: Briefcase,
    autoComplete: "organization-title",
  },
  {
    field: "jobUrl",
    label: "Job link",
    id: "job-url",
    name: "jobUrl",
    placeholder: "https://",
    icon: Link2,
    autoComplete: "url",
    inputMode: "url",
  },
];

export function getRoleField(name: RoleFieldName): RoleFieldDescriptor {
  const descriptor = ROLE_FIELDS.find((field) => field.field === name);
  if (!descriptor) {
    throw new Error(`Unknown role field: ${name}`);
  }
  return descriptor;
}
