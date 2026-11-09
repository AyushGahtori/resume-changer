"use client";

import { useState, type FormEvent } from "react";
import { groupSkills } from "@/lib/skills/group-skills";
import type { Skill } from "@/lib/schemas/resume-data";

export default function SkillBoard({
  skills,
  activeSkillId,
  canEdit,
  libraryIsEmpty,
  onSkill,
  onAdded,
}: {
  skills: Skill[];
  activeSkillId: string;
  canEdit: boolean;
  libraryIsEmpty: boolean;
  onSkill: (skillId: string) => void;
  onAdded: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const groups = groupSkills(skills);

  async function addSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/library/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "The skill could not be saved.");
        return;
      }
      setName("");
      onAdded(trimmed);
    } catch {
      setError("Could not reach the local save service. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="skill-board">
      {canEdit ? (
        <form className="skill-add" onSubmit={addSkill}>
          <label className="editor-field">
            <span>Add a skill</span>
            <input
              aria-describedby={error ? "skill-add-error" : undefined}
              maxLength={80}
              name="skillName"
              onChange={(event) => setName(event.target.value)}
              placeholder="Any skill, for example LightGBM"
              value={name}
            />
          </label>
          <button
            className="ui-button ui-button--secondary"
            disabled={saving || name.trim().length === 0}
            type="submit"
          >
            {saving ? "Adding…" : "Add skill"}
          </button>
          {error ? (
            <p className="skill-add-error" id="skill-add-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {groups.length ? (
        <div className="skill-groups">
          {groups.map((group) => (
            <div
              aria-label={group.label}
              className="skill-group"
              key={group.id}
              role="group"
            >
              <p className="skill-group-label">
                {group.label}
                <span>{group.skills.length}</span>
              </p>
              <ul className="skill-chip-list">
                {group.skills.map((skill) => {
                  const listed = skill.isListedOnCurrentResume;
                  const selected = activeSkillId === skill.id;
                  return (
                    <li key={skill.id}>
                      <button
                        aria-pressed={selected}
                        className={
                          listed
                            ? "skill-chip is-listed"
                            : "skill-chip is-unlisted"
                        }
                        onClick={() => onSkill(selected ? "" : skill.id)}
                        type="button"
                      >
                        <span className="skill-chip-name">{skill.name}</span>
                        <span
                          className={
                            listed
                              ? "skill-listed visually-hidden"
                              : "skill-unlisted visually-hidden"
                          }
                        >
                          {listed ? "On current resume" : "Library only"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="secondary-empty">
          {libraryIsEmpty
            ? "No skills saved in this library."
            : "No skills match this search."}
        </p>
      )}
    </div>
  );
}
