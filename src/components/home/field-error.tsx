export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p className="field-error" id={id} role="alert">
      <svg
        aria-hidden="true"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5v4" />
        <circle cx="8" cy="11" r=".6" fill="currentColor" stroke="none" />
      </svg>
      <span>{message}</span>
    </p>
  );
}
