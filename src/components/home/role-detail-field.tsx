"use client";

import { CircleAlert } from "lucide-react";
import type { RoleFieldDescriptor } from "@/lib/ui/role-fields";

type RoleDetailFieldProps = {
  descriptor: RoleFieldDescriptor;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

/**
 * A single role details input with a decorative leading icon.
 *
 * The icon is `aria-hidden` so the input keeps announcing its visible label
 * alone. The error message is linked with `aria-describedby` and the control
 * is marked `aria-invalid`, so assistive technology reports the failure next
 * to the field it belongs to instead of at the end of the form.
 */
export default function RoleDetailField({
  descriptor,
  value,
  error,
  disabled = false,
  onChange,
}: RoleDetailFieldProps) {
  const {
    autoComplete,
    icon: Icon,
    id,
    inputMode,
    label,
    name,
    placeholder,
  } = descriptor;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <div className="field-control">
        <span aria-hidden="true" className="field-icon">
          <Icon size={17} strokeWidth={1.8} />
        </span>
        <input
          aria-describedby={errorId}
          aria-invalid={error ? true : undefined}
          autoComplete={autoComplete}
          disabled={disabled}
          id={id}
          inputMode={inputMode}
          name={name}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type="text"
          value={value}
        />
      </div>
      {error && (
        <p className="role-field-error" id={errorId} role="alert">
          <CircleAlert aria-hidden="true" size={14} strokeWidth={2} />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
