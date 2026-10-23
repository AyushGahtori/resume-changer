import type { ReactNode } from "react";

export type LibrarySectionTone = "jobs" | "projects" | "skills" | "credentials";

type Props = {
  count: number;
  icon: ReactNode;
  title: string;
  titleId: string;
  tone: LibrarySectionTone;
};

/**
 * The shared header of a library category section. It names the category,
 * marks it with the colour token of that category, and states how many
 * items the section currently holds.
 *
 * The component only renders the three header parts, so the same header
 * can sit inside a section heading or inside a disclosure summary.
 */
export default function LibrarySectionHeader({
  count,
  icon,
  title,
  titleId,
  tone,
}: Props) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`library-section-icon library-section-icon--${tone}`}
      >
        {icon}
      </span>
      <h2 className="library-section-title" id={titleId}>
        {title}
      </h2>
      <span className="library-section-count">{count}</span>
    </>
  );
}
