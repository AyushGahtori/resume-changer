"use client";

import * as React from "react";
import { useId, useMemo, useState, type DragEvent } from "react";
import { FileText, Settings2 } from "lucide-react";
import { groupSkillsForReview } from "@/lib/generation/review-draft";
import {
  studioGroups,
  type StudioBullet,
  type StudioGroup,
} from "@/lib/generation/studio-document";
import type {
  AchievementPoint,
  ResumeLibrary,
} from "@/lib/schemas/resume-data";

export const MAX_IMAGINATION_CONTEXT_ITEMS = 10;
export const IMAGINATION_CONTEXT_TRANSFER_TYPE = "application/x-studio-context";

export type ImaginationContextAchievement = Pick<
  StudioBullet,
  "id" | "groupId" | "text"
> & {
  destinationTitle: string;
  destinationSection: StudioGroup["section"];
};

export type ImaginationContextAchievementGroup = StudioGroup & {
  achievements: ImaginationContextAchievement[];
};

export type ImaginationSkillGroup = ReturnType<
  typeof groupSkillsForReview
>[number];

export type ContextSelectionUpdate = {
  selectedIds: string[];
  changed: boolean;
  limitReached: boolean;
};

export function getDestinationAchievementGroups(
  library: ResumeLibrary,
): ImaginationContextAchievementGroup[] {
  const pointsByGroup = new Map<string, AchievementPoint[]>(
    [...library.jobs, ...library.projects].map((group) => [
      group.id,
      group.points,
    ]),
  );

  return studioGroups(library).map((destination) => ({
    ...destination,
    achievements: (pointsByGroup.get(destination.id) ?? [])
      .filter((point) => point.enabled)
      .map((point) => ({
        id: point.id,
        groupId: destination.id,
        text: point.text,
        destinationTitle: destination.title,
        destinationSection: destination.section,
      })),
  }));
}

export function filterAchievementContext(
  achievements: ImaginationContextAchievement[],
  query: string,
): ImaginationContextAchievement[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return achievements;

  return achievements.filter((achievement) =>
    achievement.text.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function filterSkillContextGroups(
  groups: ImaginationSkillGroup[],
  query: string,
): ImaginationSkillGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return groups;

  return groups.flatMap((group) => {
    const skills = group.skills.filter((skill) =>
      (group.category + " " + skill.name + " " + skill.aliases.join(" "))
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );

    return skills.length ? [{ ...group, skills }] : [];
  });
}

export function toggleContextSelection(
  selectedIds: string[],
  otherSelectedIds: string[],
  id: string,
): ContextSelectionUpdate {
  if (selectedIds.includes(id)) {
    return {
      selectedIds: selectedIds.filter((selectedId) => selectedId !== id),
      changed: true,
      limitReached: false,
    };
  }

  if (otherSelectedIds.includes(id)) {
    return { selectedIds, changed: false, limitReached: false };
  }

  if (
    selectedIds.length + otherSelectedIds.length >=
    MAX_IMAGINATION_CONTEXT_ITEMS
  ) {
    return { selectedIds, changed: false, limitReached: true };
  }

  return {
    selectedIds: [...selectedIds, id],
    changed: true,
    limitReached: false,
  };
}

export function isContextSelectionDisabled(
  id: string,
  selectedIds: string[],
  otherSelectedIds: string[],
): boolean {
  if (selectedIds.includes(id)) return false;

  return (
    otherSelectedIds.includes(id) ||
    selectedIds.length + otherSelectedIds.length >=
      MAX_IMAGINATION_CONTEXT_ITEMS
  );
}

export function updateExpandedSkillCategories(
  expandedCategories: string[],
  category: string,
  expanded: boolean,
): string[] {
  if (expanded) {
    return expandedCategories.includes(category)
      ? expandedCategories
      : [...expandedCategories, category];
  }

  return expandedCategories.filter(
    (expandedCategory) => expandedCategory !== category,
  );
}

export function shouldExpandSkillCategory(
  category: string,
  searchQuery: string,
  expandedCategories: string[],
  firstCategory: string | undefined,
): boolean {
  return (
    Boolean(searchQuery.trim()) ||
    expandedCategories.includes(category) ||
    category === firstCategory
  );
}

export function getAchievementContextEmptyMessage(
  destination: ImaginationContextAchievementGroup | undefined,
  query: string,
): string {
  if (!destination)
    return "Choose a resume destination to browse achievements.";
  if (destination.achievements.length === 0)
    return "No enabled achievements for this destination yet.";
  if (query.trim()) return "No achievements match your search.";
  return "No achievements are available for this destination.";
}

export function getSkillContextEmptyMessage(
  skillCount: number,
  query: string,
): string {
  if (skillCount === 0) return "No skills are available in this library.";
  return query.trim()
    ? "No skills match your search."
    : "No skills are available.";
}
export type ImaginationContextLibrariesProps = {
  library: ResumeLibrary;
  destinationGroupId: string;
  selectedAchievementIds: string[];
  selectedSkillIds: string[];
  onSelectedAchievementIdsChange: (ids: string[]) => void;
  onSelectedSkillIdsChange: (ids: string[]) => void;
};

export default function ImaginationContextLibraries({
  library,
  destinationGroupId,
  selectedAchievementIds,
  selectedSkillIds,
  onSelectedAchievementIdsChange,
  onSelectedSkillIdsChange,
}: ImaginationContextLibrariesProps) {
  const instanceId = useId();
  const [achievementSearch, setAchievementSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<string[]>(() => {
    const firstGroup = groupSkillsForReview(library.skills)[0];
    return firstGroup ? [firstGroup.category] : [];
  });

  const destinations = useMemo(
    () => getDestinationAchievementGroups(library),
    [library],
  );
  const destination = destinations.find(
    (group) => group.id === destinationGroupId,
  );
  const firstSkillCategory = groupSkillsForReview(library.skills)[0]?.category;
  const achievements = useMemo(
    () =>
      filterAchievementContext(
        destination?.achievements ?? [],
        achievementSearch,
      ),
    [destination, achievementSearch],
  );
  const skillGroups = useMemo(
    () =>
      filterSkillContextGroups(
        groupSkillsForReview(library.skills),
        skillSearch,
      ),
    [library.skills, skillSearch],
  );
  const atCapacity =
    selectedAchievementIds.length + selectedSkillIds.length >=
    MAX_IMAGINATION_CONTEXT_ITEMS;
  const limitMessageId = instanceId + "-context-limit";
  const achievementSearchId = instanceId + "-achievement-search";
  const skillSearchId = instanceId + "-skill-search";

  function changeAchievementSelection(id: string) {
    const next = toggleContextSelection(
      selectedAchievementIds,
      selectedSkillIds,
      id,
    );
    if (next.changed) onSelectedAchievementIdsChange(next.selectedIds);
  }

  function changeSkillSelection(id: string) {
    const next = toggleContextSelection(
      selectedSkillIds,
      selectedAchievementIds,
      id,
    );
    if (next.changed) onSelectedSkillIdsChange(next.selectedIds);
  }

  function startContextDrag(
    event: DragEvent<HTMLButtonElement>,
    kind: "achievement" | "skill",
    id: string,
  ) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      IMAGINATION_CONTEXT_TRANSFER_TYPE,
      kind + ":" + id,
    );
  }

  return (
    <>
      <div className="imagination-context-libraries">
        <section aria-labelledby={instanceId + "-achievements-heading"}>
          <div className="imagination-context-panel-heading">
            <FileText aria-hidden="true" size={18} />
            <h3 id={instanceId + "-achievements-heading"}>Achievements</h3>
          </div>
          <label
            className="studio-field imagination-context-search"
            htmlFor={achievementSearchId}
          >
            <span className="studio-visually-hidden">Search achievements</span>
            <input
              id={achievementSearchId}
              type="search"
              placeholder="Search achievements"
              value={achievementSearch}
              onChange={(event) => setAchievementSearch(event.target.value)}
            />
          </label>
          <div
            className="imagination-context-list"
            role="group"
            aria-label="Achievement evidence"
          >
            {achievements.map((achievement) => {
              const selected = selectedAchievementIds.includes(achievement.id);
              const disabled = isContextSelectionDisabled(
                achievement.id,
                selectedAchievementIds,
                selectedSkillIds,
              );

              return (
                <button
                  className="imagination-context-card"
                  type="button"
                  draggable={!disabled}
                  onDragStart={(event) =>
                    startContextDrag(event, "achievement", achievement.id)
                  }
                  aria-pressed={selected}
                  aria-describedby={
                    disabled && atCapacity ? limitMessageId : undefined
                  }
                  disabled={disabled}
                  title={
                    disabled
                      ? "Ten context items are connected. Disconnect one before adding another."
                      : undefined
                  }
                  key={achievement.id}
                  onClick={() => changeAchievementSelection(achievement.id)}
                >
                  {achievement.text}
                </button>
              );
            })}
            {!achievements.length && (
              <p className="studio-empty" role="status">
                {getAchievementContextEmptyMessage(
                  destination,
                  achievementSearch,
                )}
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby={instanceId + "-skills-heading"}>
          <div className="imagination-context-panel-heading">
            <Settings2 aria-hidden="true" size={18} />
            <h3 id={instanceId + "-skills-heading"}>Connected skills</h3>
          </div>
          <label
            className="studio-field imagination-context-search"
            htmlFor={skillSearchId}
          >
            <span className="studio-visually-hidden">
              Search declared skills
            </span>
            <input
              id={skillSearchId}
              type="search"
              placeholder="Search declared skills"
              value={skillSearch}
              onChange={(event) => setSkillSearch(event.target.value)}
            />
          </label>
          <div
            className="imagination-context-list"
            role="group"
            aria-label="Skill evidence by category"
          >
            {skillGroups.map(({ category, skills }) => {
              const open = shouldExpandSkillCategory(
                category,
                skillSearch,
                expandedCategories,
                firstSkillCategory,
              );

              return (
                <details
                  key={category}
                  open={open}
                  onToggle={(event) => {
                    const isOpen = event.currentTarget.open;
                    setExpandedCategories((current) =>
                      updateExpandedSkillCategories(current, category, isOpen),
                    );
                  }}
                >
                  <summary>{category}</summary>
                  <div
                    className="studio-chip-list"
                    role="group"
                    aria-label={category}
                  >
                    {skills.map((skill) => {
                      const selected = selectedSkillIds.includes(skill.id);
                      const disabled = isContextSelectionDisabled(
                        skill.id,
                        selectedSkillIds,
                        selectedAchievementIds,
                      );

                      return (
                        <button
                          type="button"
                          key={skill.id}
                          draggable={!disabled}
                          onDragStart={(event) =>
                            startContextDrag(event, "skill", skill.id)
                          }
                          aria-pressed={selected}
                          aria-describedby={
                            disabled && atCapacity ? limitMessageId : undefined
                          }
                          disabled={disabled}
                          title={
                            disabled
                              ? "Ten context items are connected. Disconnect one before adding another."
                              : undefined
                          }
                          onClick={() => changeSkillSelection(skill.id)}
                        >
                          {skill.name}
                        </button>
                      );
                    })}
                  </div>
                </details>
              );
            })}
            {!skillGroups.length && (
              <p className="studio-empty" role="status">
                {getSkillContextEmptyMessage(
                  library.skills.length,
                  skillSearch,
                )}
              </p>
            )}
          </div>
        </section>
      </div>

      {atCapacity && (
        <p
          className="studio-muted imagination-context-limit"
          id={limitMessageId}
          role="status"
          aria-live="polite"
        >
          Ten context items are connected. Disconnect one before adding another.
        </p>
      )}

      <style>
        {[
          ".imagination-context-panel-heading { display: flex; align-items: center; gap: var(--space-8); }",
          ".imagination-context-panel-heading svg { flex: 0 0 auto; color: var(--imagination); }",
          ".imagination-context-panel-heading h3 { margin: 0; }",
          ".imagination-context-search { margin-top: var(--space-8); }",
          ".imagination-context-list { min-width: 0; }",
          ".imagination-context-list > details { min-width: 0; }",
          ".imagination-context-list summary:focus-visible, .imagination-context-libraries button:focus-visible { outline: var(--focus-outline); outline-offset: 2px; }",
          ".imagination-context-libraries .imagination-context-card { display: block; width: 100%; min-height: 44px; padding: var(--space-8); border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-soft); color: var(--ink); font-size: var(--type-body-size); line-height: var(--type-body-line-height); text-align: left; cursor: pointer; }",
          ".imagination-context-libraries .imagination-context-card:hover:not(:disabled), .imagination-context-libraries .studio-chip-list button:hover:not(:disabled) { border-color: var(--imagination); background: var(--surface-hover); }",
          ".imagination-context-libraries button[aria-pressed=true] { border-color: var(--imagination); background: var(--imagination-soft); }",
          ".imagination-context-libraries button:disabled:not([aria-pressed=true]) { color: var(--quiet); cursor: not-allowed; opacity: 0.7; }",
          ".imagination-context-libraries .studio-chip-list button { border-radius: var(--radius-control); cursor: pointer; }",
          ".imagination-context-limit { margin: 0 0 var(--space-12); }",
        ].join("\n")}
      </style>
    </>
  );
}
