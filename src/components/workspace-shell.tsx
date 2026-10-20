"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

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
      </aside>

      <div className="main-column">
        <header className="topbar">
          <nav aria-label="Breadcrumb" className="breadcrumbs">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong aria-current="page">
              {currentPage?.label ?? "Workspace"}
            </strong>
          </nav>
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
