"use client";

import type { SavedJobSummary } from "@/lib/jobs/saved-job";

function analyzedOn(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SavedJobList({
  jobs,
  selectedId,
  onSelect,
  onDelete,
  title = "Saved analyses",
  description = "Choose a job to read its analysis again.",
  titleId = "saved-jobs-title",
}: {
  jobs: SavedJobSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (job: SavedJobSummary) => void;
  title?: string;
  description?: string;
  titleId?: string;
}) {
  return (
    <section className="saved-jobs" aria-labelledby={titleId}>
      <div className="saved-jobs-heading">
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
      </div>
      {jobs.length === 0 ? (
        <p className="saved-jobs-empty">No analyzed jobs yet.</p>
      ) : (
        <ul className="saved-jobs-list">
          {jobs.map((job) => {
            const selected = job.id === selectedId;
            const label = `${job.company}, ${job.roleTitle || "role not specified"}`;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  className="saved-job-open"
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(job.id)}
                >
                  <span className="saved-job-company">{job.company}</span>
                  <span className="saved-job-role">
                    {job.roleTitle || "Role not specified"}
                  </span>
                  <time dateTime={job.updatedAt}>
                    {analyzedOn(job.updatedAt)}
                  </time>
                </button>
                <button
                  type="button"
                  className="saved-job-delete"
                  aria-label={`Delete saved analysis for ${label}`}
                  onClick={() => onDelete(job)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
