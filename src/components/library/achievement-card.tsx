import { useMemo, useState } from "react";
import { Briefcase, Check, CircleSlash, Folder } from "lucide-react";
import PointMetrics from "@/components/library/point-metrics";
import {
  buildPointChips,
  getVisiblePointChips,
  MAX_VISIBLE_POINT_CHIPS,
} from "@/lib/ui/point-chips";
import {
  buildProvenanceSegments,
  PROVENANCE_SEPARATOR,
} from "@/lib/ui/point-provenance";
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
  activeTag: string;
  activeSkillId: string;
  onEdit?: () => void;
};

const CATEGORY_ICON = {
  job: Briefcase,
  project: Folder,
} as const;

function PointProvenance({ source }: { source: AchievementPoint["source"] }) {
  const [type, ...details] = buildProvenanceSegments(source);

  return (
    <p className="point-provenance">
      <span className="point-provenance-prefix">Source:</span>{" "}
      <strong className="point-provenance-type">{type.text}</strong>
      {details.map((segment) => (
        <span className="point-provenance-detail" key={segment.kind}>
          {` ${PROVENANCE_SEPARATOR} ${segment.text}`}
        </span>
      ))}
    </p>
  );
}

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
  activeTag,
  activeSkillId,
  onEdit,
}: Props) {
  const Icon = CATEGORY_ICON[kind];
  const StatusIcon = point.enabled ? Check : CircleSlash;
  const headingId = `achievement-${point.id}`;
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const chips = useMemo(() => buildPointChips(point, skills), [point, skills]);
  const activeChipIds = new Set(
    chips
      .filter(
        (chip) =>
          (chip.kind === "tag" && chip.value === activeTag) ||
          (chip.kind === "skill" && chip.value === activeSkillId),
      )
      .map((chip) => chip.id),
  );
  const { visible: visibleChips, hiddenCount } = getVisiblePointChips(
    chips,
    chipsExpanded,
    activeChipIds,
  );

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

      {chips.length > 0 ? (
        <div className="point-facets">
          {visibleChips.map((chip) => (
            <button
              aria-label={
                chip.kind === "tag"
                  ? `Filter by #${chip.label}`
                  : `Filter by skill ${chip.label}`
              }
              aria-pressed={activeChipIds.has(chip.id)}
              className={`facet-chip is-${chip.kind}`}
              key={chip.id}
              onClick={() =>
                chip.kind === "tag"
                  ? onTag?.(chip.value)
                  : onSkill?.(chip.value)
              }
              type="button"
            >
              {chip.kind === "tag" ? `#${chip.label}` : chip.label}
            </button>
          ))}
          {hiddenCount > 0 ? (
            <button
              aria-expanded={false}
              aria-label={`+${hiddenCount} more filters`}
              className="facet-chip is-more"
              onClick={() => setChipsExpanded(true)}
              type="button"
            >
              +{hiddenCount}
            </button>
          ) : null}
          {chipsExpanded && chips.length > MAX_VISIBLE_POINT_CHIPS ? (
            <button
              aria-expanded={true}
              className="facet-chip is-more"
              onClick={() => setChipsExpanded(false)}
              type="button"
            >
              Show less
            </button>
          ) : null}
        </div>
      ) : null}

      <PointProvenance source={point.source} />
    </article>
  );
}
