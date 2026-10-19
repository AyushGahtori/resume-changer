"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GenerationHistoryEntry } from "@/lib/schemas/resume-data";

type HistoryDetail = {
  entry: GenerationHistoryEntry;
  latex: string;
};

function statusLabel(status: GenerationHistoryEntry["status"]) {
  if (status === "compiled") return "PDF saved";
  if (status === "failed") return "PDF unavailable";
  return "LaTeX saved";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function GenerationHistory() {
  const [entries, setEntries] = useState<GenerationHistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [view, setView] = useState<"latex" | "pdf">("latex");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/history", { cache: "no-store" });
      const payload = (await response.json()) as {
        entries?: GenerationHistoryEntry[];
        error?: string;
      };
      if (!response.ok || !payload.entries)
        throw new Error(payload.error ?? "History could not be loaded.");
      setEntries(payload.entries);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "History could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshEntries();
  }, [refreshEntries]);

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) =>
      [entry.company, entry.role, entry.provider, entry.status]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [entries, query]);

  async function openEntry(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as HistoryDetail & {
        error?: string;
      };
      if (!response.ok || !payload.entry || typeof payload.latex !== "string")
        throw new Error(
          payload.error ?? "This saved generation could not be opened.",
        );
      setDetail(payload);
      setView(payload.entry.pdfPath ? "pdf" : "latex");
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "This saved generation could not be opened.",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function deleteEntry(entry: GenerationHistoryEntry) {
    if (
      !window.confirm(
        `Delete the saved resume for ${entry.role}${entry.company ? ` at ${entry.company}` : ""}? This also deletes its saved LaTeX and PDF files.`,
      )
    )
      return;
    setError("");
    try {
      const response = await fetch(
        `/api/history/${encodeURIComponent(entry.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          payload.error ?? "This generation could not be deleted.",
        );
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      if (selectedId === entry.id) {
        setSelectedId(null);
        setDetail(null);
      }
      setNotice("Saved generation and its files deleted.");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "This generation could not be deleted.",
      );
    }
  }

  function downloadLatex() {
    if (!detail) return;
    const blob = new Blob([detail.latex], { type: "application/x-tex" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `resume-${detail.entry.id}.tex`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="history-page" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <p className="eyebrow">PREVIOUS WORK</p>
          <h1 id="history-title">Generation history</h1>
          <p className="page-intro">
            Reopen or remove resume outputs saved on this device.
          </p>
        </div>
        <p className="history-count" role="status">
          {entries.length} saved generation{entries.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="history-toolbar">
        <label>
          <span>Search by company, role, provider, or status</span>
          <input
            aria-label="Search generation history"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search history"
            type="search"
            value={query}
          />
        </label>
        <button
          aria-label="Refresh generation history"
          onClick={() => void refreshEntries()}
          type="button"
        >
          Refresh
        </button>
      </div>

      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="history-notice" role="status">
          {notice}
        </p>
      )}

      <div className="history-layout">
        <section aria-label="Saved generations" className="history-list">
          {loading ? (
            <p className="history-empty" role="status">
              Loading saved generations…
            </p>
          ) : filteredEntries.length ? (
            filteredEntries.map((entry) => (
              <article className="history-entry" key={entry.id}>
                <button
                  aria-current={selectedId === entry.id ? "true" : undefined}
                  className="history-entry-open"
                  onClick={() => void openEntry(entry.id)}
                  type="button"
                >
                  <span className="history-entry-title">
                    <strong>{entry.role}</strong>
                    <span className={`history-status is-${entry.status}`}>
                      {statusLabel(entry.status)}
                    </span>
                  </span>
                  <span className="history-entry-subtitle">
                    {entry.company || "No company"} ·{" "}
                    {formatDate(entry.createdAt)}
                  </span>
                  <span className="history-entry-meta">
                    {entry.selectedAchievementIds.length} achievements ·{" "}
                    {entry.provider}
                  </span>
                </button>
                <button
                  aria-label={`Delete ${entry.role} generation`}
                  className="history-delete"
                  onClick={() => void deleteEntry(entry)}
                  title="Delete saved generation"
                  type="button"
                >
                  Delete
                </button>
              </article>
            ))
          ) : (
            <div className="history-empty" role="status">
              <strong>
                {query ? "No matching generations" : "No saved generations yet"}
              </strong>
              <p>
                {query
                  ? "Try a different search."
                  : "Generated LaTeX and verified PDFs will appear here."}
              </p>
            </div>
          )}
        </section>

        <section aria-label="Saved resume output" className="history-detail">
          {detailLoading ? (
            <p className="history-empty" role="status">
              Opening saved generation…
            </p>
          ) : detail ? (
            <>
              <div className="history-detail-heading">
                <div>
                  <p className="source-indicator">SAVED OUTPUT</p>
                  <h2>{detail.entry.role}</h2>
                  <p>
                    {[detail.entry.company, formatDate(detail.entry.createdAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="history-detail-actions">
                  <button
                    aria-pressed={view === "latex"}
                    onClick={() => setView("latex")}
                    type="button"
                  >
                    LaTeX
                  </button>
                  {detail.entry.pdfPath && (
                    <button
                      aria-pressed={view === "pdf"}
                      onClick={() => setView("pdf")}
                      type="button"
                    >
                      PDF
                    </button>
                  )}
                  {view === "latex" ? (
                    <button onClick={downloadLatex} type="button">
                      Download .tex
                    </button>
                  ) : (
                    <a
                      download={`resume-${detail.entry.id}.pdf`}
                      href={`/api/history/${encodeURIComponent(detail.entry.id)}/pdf?download=1`}
                    >
                      Download PDF
                    </a>
                  )}
                </div>
              </div>
              <dl className="history-facts">
                <div>
                  <dt>Provider</dt>
                  <dd>{detail.entry.provider}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{statusLabel(detail.entry.status)}</dd>
                </div>
                <div>
                  <dt>Selected achievements</dt>
                  <dd>{detail.entry.selectedAchievementIds.length}</dd>
                </div>
                <div>
                  <dt>Wording repairs</dt>
                  <dd>{detail.entry.repairAttemptCount}</dd>
                </div>
              </dl>
              {view === "latex" ? (
                <pre className="history-latex">{detail.latex}</pre>
              ) : (
                <iframe
                  className="history-pdf"
                  src={`/api/history/${encodeURIComponent(detail.entry.id)}/pdf`}
                  title={`Saved PDF for ${detail.entry.role}`}
                />
              )}
            </>
          ) : (
            <div className="history-empty">
              <strong>Choose a saved generation</strong>
              <p>Its LaTeX or PDF and generation details will open here.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
