"use client";
import { useMemo, useState } from "react";
import { groupSkillsForReview } from "@/lib/generation/review-draft";
import {
  placeSkills,
  type SkillMeasurements,
} from "@/lib/generation/skill-layout";
import type { ResumeLibrary } from "@/lib/schemas/resume-data";

export default function StudioSkills({
  library,
  selectedIds,
  currentIds,
  onChange,
  measurements,
  measureError,
  recommendedIds = [],
}: {
  library: ResumeLibrary;
  selectedIds: string[];
  currentIds: string[];
  onChange: (ids: string[]) => void;
  measurements: SkillMeasurements | null;
  measureError: string;
  recommendedIds?: string[];
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [copied, setCopied] = useState(false);
  const placement = measurements
    ? placeSkills(selectedIds, measurements)
    : null;
  const fitsById = useMemo(
    () =>
      new Map(
        library.skills.map((skill) => [
          skill.id,
          selectedIds.includes(skill.id) ||
            !measurements ||
            Boolean(placeSkills([...selectedIds, skill.id], measurements)),
        ]),
      ),
    [library.skills, selectedIds, measurements],
  );
  const taxonomy = useMemo(
    () => groupSkillsForReview(library.skills),
    [library.skills],
  );
  const groups = taxonomy.flatMap(({ category, skills }) => {
    const matching = skills.filter((skill) => {
      const selected = selectedIds.includes(skill.id);
      const fits = fitsById.get(skill.id);
      return (
        `${skill.name} ${category} ${skill.aliases.join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (filter === "all" ||
          (filter === "included" && selected) ||
          (filter === "available" && !selected && fits) ||
          (filter === "recommended" && recommendedIds.includes(skill.id)) ||
          (filter === "cannot-fit" && !selected && !fits))
      );
    });
    return matching.length ? [{ category, skills: matching }] : [];
  });
  return (
    <section className="studio-skills" aria-label="Skills manager">
      <div className="studio-panel-heading">
        <div>
          <h3>Skills manager</h3>
          <p>Changes stay in your draft until you apply them.</p>
        </div>
        <span className="studio-badge">{selectedIds.length} selected</span>
      </div>
      <div className="studio-capacity">
        <div className="studio-capacity-title">
          <strong>Resume skill capacity</strong>
          <span>Two-line limit · Latin Modern Roman</span>
        </div>
        {[0, 1].map((line) => (
          <div className="studio-capacity-row" key={line}>
            <span>Line {line + 1}</span>
            <progress
              aria-label={`Skill line ${line + 1} capacity`}
              max={100}
              value={
                placement
                  ? Math.min(
                      100,
                      (placement.used[line] / placement.capacity[line]) * 100,
                    )
                  : 0
              }
            />
            <span>
              {placement
                ? `${Math.round((placement.used[line] / placement.capacity[line]) * 100)}%`
                : "—"}
            </span>
          </div>
        ))}
        <p>
          {measureError ||
            (measurements
              ? placement
                ? "Measured using the LaTeX template. Final compilation confirms fit."
                : "The selected skills exceed two rows. Remove a skill to free space."
              : "Measuring skill widths with the resume template…")}
        </p>
      </div>
      <label className="studio-field">
        <span>Search skills</span>
        <input
          type="search"
          placeholder="Search by skill or category"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="studio-filters" aria-label="Skill filters">
        {[
          ["all", "All"],
          ["included", "Included"],
          ["available", "Available"],
          ["recommended", "Recommended"],
          ["cannot-fit", "Cannot fit"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            disabled={
              (value === "recommended" && !recommendedIds.length) ||
              (value === "cannot-fit" && !measurements)
            }
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="studio-skill-groups">
        {groups.map(({ category, skills }, index) => (
          <details
            key={`${category}-${search ? "search" : filter}`}
            open={Boolean(search) || filter !== "all" || index === 0}
          >
            <summary>
              <span>{category}</span>
              <small>
                {
                  skills.filter((skill) => selectedIds.includes(skill.id))
                    .length
                }{" "}
                / {skills.length}
              </small>
            </summary>
            <div className="studio-chip-list">
              {skills.map((skill) => {
                const selected = selectedIds.includes(skill.id);
                const included = currentIds.includes(skill.id);
                const fits = fitsById.get(skill.id);
                const unsupported = measurements?.unsupportedSkillIds?.includes(
                  skill.id,
                );
                const status = selected
                  ? included
                    ? "Included"
                    : "+ Add"
                  : included
                    ? "− Remove"
                    : unsupported
                      ? "Unavailable"
                      : fits
                        ? "Available"
                        : "Cannot fit";
                const title = unsupported
                  ? "This skill could not be measured with the resume font. Try again after checking its supported characters."
                  : !fits && measurements
                    ? `${skill.name} needs about ${Math.ceil(measurements.widths[skill.id])} pt plus a separator. Neither row can accommodate it while retaining all selected skills. Remove a skill to free space.`
                    : `${selected ? "Remove" : "Add"} ${skill.name} ${selected ? "from" : "to"} the working draft`;
                return (
                  <button
                    type="button"
                    key={skill.id}
                    aria-label={`${selected ? "Remove" : "Add"} ${skill.name} ${selected ? "from" : "to"} resume skills`}
                    aria-pressed={selected}
                    disabled={!fits}
                    title={title}
                    className={included ? "is-current" : ""}
                    onClick={() =>
                      onChange(
                        selected
                          ? selectedIds.filter((id) => id !== skill.id)
                          : [...selectedIds, skill.id],
                      )
                    }
                  >
                    <span>
                      {selected ? "✓ " : ""}
                      {skill.name}
                    </span>
                    <small>
                      {recommendedIds.includes(skill.id) ? "✦ " : ""}
                      {status}
                    </small>
                  </button>
                );
              })}
            </div>
          </details>
        ))}
      </div>
      {!groups.length && (
        <p className="studio-empty">
          No skills match this filter. Change the search or choose All.
        </p>
      )}
      {selectedIds.length > 1 && (
        <details className="studio-skill-order">
          <summary>Skill priority order</summary>
          <p>The layout preserves this order where space permits.</p>
          <ol>
            {selectedIds.map((id, index) => {
              const name =
                library.skills.find((skill) => skill.id === id)?.name ?? id;
              const reorder = (direction: -1 | 1) => {
                const next = [...selectedIds];
                [next[index], next[index + direction]] = [
                  next[index + direction],
                  next[index],
                ];
                onChange(next);
              };
              return (
                <li key={id}>
                  <span>{name}</span>
                  <button
                    type="button"
                    aria-label={`Raise skill priority: ${name}`}
                    disabled={index === 0}
                    onClick={() => reorder(-1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Lower skill priority: ${name}`}
                    disabled={index === selectedIds.length - 1}
                    onClick={() => reorder(1)}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ol>
        </details>
      )}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              selectedIds
                .map(
                  (id) => library.skills.find((skill) => skill.id === id)?.name,
                )
                .filter(Boolean)
                .join(", "),
            );
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied selected skills" : "Copy selected skills"}
      </button>
    </section>
  );
}
