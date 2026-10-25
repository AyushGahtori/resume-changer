"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowUpRight,
  Check,
  CircleAlert,
  Clock3,
  FileCode2,
  FileText,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { GenerationHistoryEntry } from "@/lib/schemas/resume-data";

type HistoryDetail = {
  entry: GenerationHistoryEntry;
  latex: string;
};

type HistoryFilter = "all" | "pdf" | "latex" | "attention";

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
  const [filter, setFilter] = useState<HistoryFilter>("all");
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

  const statusCounts = useMemo(
    () => ({
      all: entries.length,
      pdf: entries.filter((entry) => entry.status === "compiled").length,
      latex: entries.filter((entry) => entry.status === "drafted").length,
      attention: entries.filter((entry) => entry.status === "failed").length,
    }),
    [entries],
  );

  const filteredEntries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "pdf" && entry.status === "compiled") ||
        (filter === "latex" && entry.status === "drafted") ||
        (filter === "attention" && entry.status === "failed");
      const matchesSearch =
        !needle ||
        [entry.company, entry.role, entry.provider, entry.status]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle);
      return matchesFilter && matchesSearch;
    });
  }, [entries, filter, query]);

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
      <div aria-hidden="true" className="history-atmosphere">
        <span className="history-orb history-orb-one" />
        <span className="history-orb history-orb-two" />
        <span className="history-orb history-orb-three" />
      </div>

      <header className="history-heading">
        <div>
          <p className="eyebrow">PREVIOUS WORK</p>
          <h1 id="history-title">Generation history</h1>
          <p className="page-intro">
            Your resume work, ready to pick up where you left off.
          </p>
        </div>
        <div className="history-header-summary">
          <span className="history-header-icon" aria-hidden="true">
            <Archive size={19} />
          </span>
          <span>
            <strong role="status">{entries.length}</strong>
            <span>saved {entries.length === 1 ? "resume" : "resumes"}</span>
          </span>
        </div>
      </header>

      <div className="history-toolbar">
        <div className="history-search-group">
          <label className="history-search-label" htmlFor="history-search">
            Find a saved resume
          </label>
          <div className="history-search-field">
            <Search aria-hidden="true" size={18} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              id="history-search"
              placeholder="Search company, role, or provider…"
              type="search"
              value={query}
            />
            {query && (
              <button
                aria-label="Clear search"
                className="history-search-clear"
                onClick={() => setQuery("")}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            )}
          </div>
        </div>
        <button
          aria-label="Refresh generation history"
          className="history-refresh"
          disabled={loading}
          onClick={() => void refreshEntries()}
          type="button"
        >
          <RefreshCw
            aria-hidden="true"
            className={loading ? "is-spinning" : ""}
            size={16}
          />
          <span>{loading ? "Refreshing" : "Refresh"}</span>
        </button>
      </div>

      <nav aria-label="Filter saved generations" className="history-filters">
        {(
          [
            { id: "all", label: "All resumes", icon: Archive },
            { id: "pdf", label: "PDF ready", icon: Check },
            { id: "latex", label: "LaTeX only", icon: FileCode2 },
            { id: "attention", label: "Needs attention", icon: CircleAlert },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            aria-pressed={filter === id}
            className="history-filter"
            key={id}
            onClick={() => setFilter(id)}
            type="button"
          >
            <Icon aria-hidden="true" size={15} />
            <span>{label}</span>
            <span className="history-filter-count">{statusCounts[id]}</span>
          </button>
        ))}
        <p className="history-results-count" aria-live="polite">
          {loading
            ? "Loading your archive…"
            : `Showing ${filteredEntries.length} of ${entries.length}`}
        </p>
      </nav>

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
            <div
              className="history-loading"
              role="status"
              aria-label="Loading saved generations"
            >
              <span />
              <span />
              <span />
            </div>
          ) : filteredEntries.length ? (
            filteredEntries.map((entry) => (
              <article
                className={`history-entry${selectedId === entry.id ? " is-selected" : ""}`}
                key={entry.id}
              >
                <button
                  aria-current={selectedId === entry.id ? "true" : undefined}
                  className="history-entry-open"
                  onClick={() => void openEntry(entry.id)}
                  type="button"
                >
                  <span className="history-entry-title">
                    <strong>{entry.role || "Untitled resume"}</strong>
                    <span className={`history-status is-${entry.status}`}>
                      {entry.status === "compiled" ? (
                        <Check aria-hidden="true" size={12} />
                      ) : entry.status === "failed" ? (
                        <CircleAlert aria-hidden="true" size={12} />
                      ) : (
                        <FileCode2 aria-hidden="true" size={12} />
                      )}
                      {statusLabel(entry.status)}
                    </span>
                  </span>
                  <span className="history-entry-subtitle">
                    <span>{entry.company || "Personal resume"}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(entry.createdAt)}</span>
                  </span>
                  <span className="history-entry-meta">
                    <span>
                      <FileText aria-hidden="true" size={13} />
                      {entry.selectedAchievementIds.length} achievements
                    </span>
                    <span className="history-provider">{entry.provider}</span>
                  </span>
                </button>
                <button
                  aria-label={`Delete ${entry.role} generation`}
                  className="history-delete"
                  onClick={() => void deleteEntry(entry)}
                  title="Delete saved generation"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </article>
            ))
          ) : (
            <div className="history-empty" role="status">
              <span className="history-empty-icon" aria-hidden="true">
                {query || filter !== "all" ? (
                  <Search size={21} />
                ) : (
                  <Archive size={21} />
                )}
              </span>
              <strong>
                {query || filter !== "all"
                  ? "No matching resumes"
                  : "Your archive starts here"}
              </strong>
              <p>
                {query || filter !== "all"
                  ? "Try another search or switch to a different filter."
                  : "Resume generations you save will be easy to find and reopen here."}
              </p>
              {!query && filter === "all" && (
                <Link href="/generate">
                  Create a resume <ArrowUpRight aria-hidden="true" size={15} />
                </Link>
              )}
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
            <div className="history-preview-empty">
              <span className="history-preview-icon" aria-hidden="true">
                <Sparkles size={23} />
              </span>
              <p className="source-indicator">YOUR RESUME ARCHIVE</p>
              <strong>
                {entries.length
                  ? "Pick up where you left off"
                  : "A home for every version"}
              </strong>
              <p>
                {entries.length
                  ? "Select a saved resume to preview its PDF, review the LaTeX, or download a copy."
                  : "When you save a generated resume, its files and details will be ready to revisit here."}
              </p>
              <div className="history-preview-hint">
                <Clock3 aria-hidden="true" size={15} />
                <span>Saved locally on this device</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
