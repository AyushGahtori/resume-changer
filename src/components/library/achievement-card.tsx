import { Briefcase, Check, CircleSlash, Folder } from "lucide-react";
import PointMetrics from "@/components/library/point-metrics";
import type { AchievementPoint, Skill } from "@/lib/schemas/resume-data";

type Props = {
  point: AchievementPoint;
  /**
   * The experience the achievement belongs to. It selects the card's category
   * icon and its accent.
   */
  kind: "job" | "project";
  /**
   * The linked skills, resolved from the library so a card can name them.
   * A skill that no longer exists in the library is skipped rather than
   * rendered as an empty chip.
   */
  skills: Skill[];
  /**
   * The experience context, shown above the achievement text. A card that
   * already sits under a titled experience group leaves this empty, because
   * the group heading carries the same context.
   */
  context?: string;
  onTag?: (tag: string) => void;
  onSkill?: (skillId: string) => void;
  onEdit?: () => void;
};

const CATEGORY_ICON = {
  job: Briefcase,
  project: Folder,
} as const;

/**
 * One achievement, as a single card.
 *
 * The card keeps the order the board uses: the experience context, the
 * achievement text, the quantified metrics, the tags and linked skills, and
 * the provenance. Every field is real data. A card with no metrics, no tags,
 * or no source reference simply leaves that row out instead of reserving
 * space for it.
 */
export default function AchievementCard({
  point,
  kind,
  skills,
  context,
  onTag,
  onSkill,
  onEdit,
}: Props) {
  const Icon = CATEGORY_ICON[kind];
  const StatusIcon = point.enabled ? Check : CircleSlash;
  const headingId = `achievement-${point.id}`;
  const linkedSkills = point.skillIds
    .map((skillId) => skills.find((skill) => skill.id === skillId))
    .filter((skill): skill is Skill => Boolean(skill));

  return (
    <article className="library-point" aria-labelledby={headingId}>
      <header className="library-point-header">
        <span
          className="library-point-icon"
          data-kind={kind}
          aria-hidden="true"
        >
          <Icon size={18} strokeWidth={2} />
        </span>
        <div className="library-point-intro">
          {context ? <p className="library-point-context">{context}</p> : null}
          <h4 className="library-point-text" id={headingId}>
            {point.text}
          </h4>
          <code className="library-point-id">{point.id}</code>
        </div>
        <div className="point-row-actions">
          <span
            className={`point-status ${point.enabled ? "is-enabled" : "is-disabled"}`}
          >
            <StatusIcon aria-hidden="true" size={12} strokeWidth={2.5} />
            {point.enabled ? "Enabled" : "Disabled"}
          </span>
          {onEdit ? (
            <button className="text-action" onClick={onEdit} type="button">
              Edit
            </button>
          ) : null}
        </div>
      </header>

      {point.metrics.length > 0 ? (
        <PointMetrics metrics={point.metrics} />
      ) : null}

      {point.tags.length > 0 || linkedSkills.length > 0 ? (
        <div className="point-facets">
          {point.tags.map((tag) => (
            <button
              className="facet-chip"
              key={tag}
              onClick={() => onTag?.(tag)}
              type="button"
            >
              #{tag}
            </button>
          ))}
          {linkedSkills.map((skill) => (
            <button
              className="facet-chip is-skill"
              key={skill.id}
              onClick={() => onSkill?.(skill.id)}
              type="button"
            >
              {skill.name}
            </button>
          ))}
        </div>
      ) : null}

      <p className="point-provenance">
        Source: <strong>{point.source.type}</strong>
        {point.source.label ? ` · ${point.source.label}` : ""}
        {point.source.reference ? ` · ${point.source.reference}` : ""}
      </p>
    </article>
  );
}
