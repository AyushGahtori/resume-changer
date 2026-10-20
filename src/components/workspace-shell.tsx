"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const THEME_STORAGE_KEY = "resume-changer.theme.v1";

const navigation = [
  { href: "/", label: "Job description", icon: "file-text" },
  { href: "/library", label: "Achievement library", icon: "book-open" },
  { href: "/generate", label: "Resume builder", icon: "file" },
  { href: "/history", label: "History", icon: "clock" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

type NavigationIconName = (typeof navigation)[number]["icon"];

const navigationIconPaths: Record<NavigationIconName, ReactNode> = {
  "file-text": (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </>
  ),
  "book-open": (
    <>
      <path d="M12 7v14" />
      <path d="M3 18V5a2 2 0 0 1 2-2h2.5A4.5 4.5 0 0 1 12 7.5V21A4.5 4.5 0 0 0 7.5 18H5a2 2 0 0 1-2-2Z" />
      <path d="M21 18V5a2 2 0 0 0-2-2h-2.5A4.5 4.5 0 0 0 12 7.5" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  settings: (
    <>
      <path d="M10 2.9h4l.6 2.2c.5.2 1 .5 1.4.8l2.2-.5 2 3.5-1.6 1.6a8 8 0 0 1 0 1.8l1.6 1.6-2 3.5-2.2-.5c-.4.3-.9.6-1.4.8l-.6 2.2h-4l-.6-2.2c-.5-.2-1-.5-1.4-.8l-2.2.5-2-3.5 1.6-1.6a8 8 0 0 1 0-1.8L3.8 9l2-3.5 2.2.5c.4-.3.9-.6 1.4-.8L10 2.9Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};

function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <svg
      aria-hidden="true"
      className="nav-icon"
      fill="none"
      viewBox="0 0 24 24"
    >
      {navigationIconPaths[name]}
    </svg>
  );
}

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
  const currentPage = navigation.find((item) => item.href === pathname);

  useEffect(() => {
    const savedTheme = readTheme();
    setTheme(savedTheme);
    document.documentElement.dataset.theme = savedTheme;
  }, []);

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
              <NavigationIcon name={item.icon} />
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
