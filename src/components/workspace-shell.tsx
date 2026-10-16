"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  clearRunEvents,
  getActiveRunId,
  getRunEvents,
  recordRunEvent,
  startNewRun,
} from "@/lib/diagnostics/run-log";

const THEME_STORAGE_KEY = "resume-changer.theme.v1";

const navigation = [
  { href: "/", label: "Job description", icon: "JD" },
  { href: "/library", label: "Achievement library", icon: "AP" },
  { href: "/generate", label: "Resume builder", icon: "R" },
  { href: "/history", label: "History", icon: "H" },
  { href: "/settings", label: "Settings", icon: "S" },
];

function readTheme(): "light" | "dark" {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export default function WorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [logCount, setLogCount] = useState(0);
  const [logMessage, setLogMessage] = useState("");
  const currentPage = navigation.find((item) => item.href === pathname);

  useEffect(() => {
    const savedTheme = readTheme();
    setTheme(savedTheme);
    document.documentElement.dataset.theme = savedTheme;
  }, []);

  useEffect(() => {
    const runId = getActiveRunId();
    const refreshCount = () => {
      void getRunEvents(runId).then((events) => setLogCount(events.length));
    };
    window.addEventListener("resume-changer-run-log-updated", refreshCount);
    void recordRunEvent({
      runId,
      stage: "navigation.page-opened",
      message: "Opened app page.",
      data: { path: pathname, title: currentPage?.label ?? "Workspace" },
    });
    refreshCount();
    return () =>
      window.removeEventListener(
        "resume-changer-run-log-updated",
        refreshCount,
      );
  }, [pathname, currentPage?.label]);

  async function exportRunLog() {
    const runId = getActiveRunId();
    const events = await getRunEvents(runId);
    const contents = [
      "Resume Changer local diagnostic run",
      `Run ID: ${runId}`,
      `Exported: ${new Date().toISOString()}`,
      "All content below is stored locally in this browser. It may include the job description and resume data sent to the AI provider.",
      "",
      ...events.map((event) => JSON.stringify(event, null, 2)),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([contents], { type: "text/plain" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "task16 logs.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    setLogCount(events.length);
    setLogMessage(`Exported ${events.length} events`);
  }

  async function clearRunLog() {
    const runId = getActiveRunId();
    await clearRunEvents(runId);
    setLogCount(0);
    setLogMessage("Local run log cleared");
  }

  function beginNewRun() {
    const runId = startNewRun();
    setLogCount(0);
    setLogMessage("Started a new local run");
    void recordRunEvent({
      runId,
      stage: "run.started",
      message: "Started a new local diagnostic run.",
      data: { path: pathname },
    });
  }

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The current page can still use the selected theme without storage.
    }
  }

  return (
    <div
      className={`app-frame${pathname === "/" ? " jd-workspace-frame" : ""}`}
    >
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Resume Changer home">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <span>Resume Changer</span>
        </Link>

        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation" className="main-navigation">
          {navigation.map((item) => (
            <Link
              aria-current={pathname === item.href ? "page" : undefined}
              className={`nav-link${pathname === item.href ? " is-active" : ""}`}
              href={item.href}
              key={item.href}
            >
              <span aria-hidden="true" className="nav-icon">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <span className="local-indicator" aria-hidden="true" />
          <div>
            <p className="sidebar-bottom-title">Private workspace</p>
            <p className="sidebar-bottom-copy">Saved on this device</p>
          </div>
        </div>
        <div className="run-log-controls" aria-label="Local run diagnostics">
          <div className="run-log-heading">Run diagnostics · {logCount}</div>
          <div className="run-log-buttons">
            <button onClick={beginNewRun} type="button">
              New run
            </button>
            <button onClick={exportRunLog} type="button">
              Export log
            </button>
            <button onClick={clearRunLog} type="button">
              Clear
            </button>
          </div>
          <p>
            Full request/response data stays in this browser. Logs can contain
            your JD and resume details.
          </p>
          <span aria-live="polite">{logMessage}</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs" aria-label="Current location">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>{currentPage?.label ?? "Workspace"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <span aria-hidden="true" /> Local mode
            </span>
            <button
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              className="theme-toggle"
              onClick={toggleTheme}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              type="button"
            >
              <span aria-hidden="true">{theme === "light" ? "☾" : "☼"}</span>
            </button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
