"use client";

import { useState } from "react";
import {
  achievementDrafts,
  mergeNotes,
  splitNote,
  splitRoughNotes,
} from "@/lib/intake/rough-notes";
import { detectSkillCandidates } from "@/lib/intake/skill-candidates";
import type { SkillCandidate } from "@/lib/intake/skill-candidates";

export function RoughNotesIntake({
  parentLabel,
  existingSkills,
  usedIds,
  onSave,
}: {
  parentLabel: string;
  existingSkills: Array<{ name: string; aliases: string[] }>;
  usedIds: string[];
  onSave: (
    drafts: ReturnType<typeof achievementDrafts>,
    candidates: SkillCandidate[],
  ) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState<string[] | null>(null);
  const [declined, setDeclined] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const candidates =
    notes === null ? [] : detectSkillCandidates(notes, existingSkills);
  const accepted = candidates.filter(
    (candidate) => !declined.includes(candidate.name),
  );

  function review() {
    setNotes(splitRoughNotes(text));
    setDeclined([]);
    setError(null);
  }

  async function save() {
    if (!notes || notes.length === 0 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(achievementDrafts(notes, new Set(usedIds)), accepted);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rough-notes-intake">
      <p>{parentLabel}</p>
      <label className="editor-field">
        <span>Paste what you worked on</span>
        <textarea
          onChange={(event) => setText(event.target.value)}
          rows={6}
          value={text}
        />
      </label>
      <button
        className="ui-button ui-button--secondary"
        disabled={saving}
        onClick={review}
        type="button"
      >
        Review bullets
      </button>
      {notes && notes.length > 0 ? (
        <ul>
          {notes.map((note, index) => (
            <li key={`${index}-${note}`}>
              <p>{note}</p>
              <button
                className="ui-button ui-button--secondary"
                disabled={saving || index === notes.length - 1}
                onClick={() => {
                  setNotes(mergeNotes(notes, index));
                  setDeclined([]);
                  setError(null);
                }}
                type="button"
              >
                Merge with next
              </button>
              <button
                className="ui-button ui-button--secondary"
                disabled={saving || splitNote(notes, index) === notes}
                onClick={() => {
                  setNotes(splitNote(notes, index));
                  setDeclined([]);
                  setError(null);
                }}
                type="button"
              >
                Split
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {notes && notes.length === 0 ? <p>No bullets to review.</p> : null}
      {candidates.length > 0 ? (
        <fieldset>
          <legend>Skills found in these notes</legend>
          {candidates.map((candidate) => (
            <label key={candidate.name}>
              <input
                checked={!declined.includes(candidate.name)}
                onChange={(event) => {
                  setDeclined((current) =>
                    event.target.checked
                      ? current.filter((name) => name !== candidate.name)
                      : [...current, candidate.name],
                  );
                }}
                type="checkbox"
              />
              {candidate.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="ui-button ui-button--primary"
        disabled={saving || notes === null || notes.length === 0}
        onClick={() => void save()}
        type="button"
      >
        Save
      </button>
    </section>
  );
}

function messageFrom(caught: unknown): string {
  if (typeof caught === "string" && caught.trim()) return caught;
  if (caught instanceof Error && caught.message.trim()) return caught.message;
  return "The notes could not be saved.";
}
