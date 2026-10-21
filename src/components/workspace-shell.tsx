"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const THEME_STORAGE_KEY = "resume-changer.theme.v1";

const navigation = [
  { href: "/", label: "Job description", icon: "description" },
  { href: "/library", label: "Achievement library", icon: "library" },
  { href: "/generate", label: "Resume builder", icon: "resume" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

type SidebarIconName = (typeof navigation)[number]["icon"];

function SidebarIcon({ name }: { name: SidebarIconName }) {
  switch (name) {
    case "description":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6.5 3.75h7l4 4v12.5h-11z" />
          <path d="M13.5 3.75v4h4M9 12h6M9 15.5h6" />
        </svg>
      );
    case "library":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 8.5c-2.25-1.7-4.75-2.1-8-1.25v10.5c3.25-.85 5.75-.45 8 1.25z" />
          <path d="M12 8.5c2.25-1.7 4.75-2.1 8-1.25v10.5c-3.25-.85-5.75-.45-8 1.25zM12 8.5v10.5" />
        </svg>
      );
    case "resume":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M6.5 3.75h7l4 4v12.5h-11z" />
          <path d="M13.5 3.75v4h4M9 12h6M9 15.5h4" />
        </svg>
      );
    case "history":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 7v5l3.25 2" />
        </svg>
      );
    case "settings":
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path
            d="m19.2 13.9 1.05.8-1.5 2.6-1.25-.5a7.7 7.7 0 0 1-1.5.9l-.2 1.35h-3l-.25-1.35a7.7 7.7 0 0 1-1.5-.9l-1.25.5-1.5-2.6 1.05-.8a7.8 7.8 0 0 1 0-1.75L8.3 11.3l1.5-2.6 1.25.5a7.7 7.7 0 0 1 1.5-.9l.25-1.35h3l.2 1.35a7.7 7.7 0 0 1 1.5.9l1.25-.5 1.5 2.6-1.05.85a7.8 7.8 0 0 1 0 1.75Z"
            transform="translate(-1.3 0.65) scale(0.94)"
          />
        </svg>
      );
  }
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
  const [isMobile, setIsMobile] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(
    null,
  );
  const isSidebarCollapsed = sidebarPreference ?? isCompact;
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const currentPage = navigation.find((item) => item.href === pathname);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const previousPathname = useRef(pathname);
  const wasMobileNavigationOpen = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 700px)");
    const compactQuery = window.matchMedia(
      "(min-width: 701px) and (max-width: 1023px)",
    );
    const updateMobileState = () => {
      const mobile = mediaQuery.matches;
      setIsMobile(mobile);
      setIsCompact(compactQuery.matches);
      if (!mobile) setIsMobileNavigationOpen(false);
    };

    updateMobileState();
    document.documentElement.dataset.shellHydrated = "true";
    mediaQuery.addEventListener("change", updateMobileState);
    compactQuery.addEventListener("change", updateMobileState);

    return () => {
      mediaQuery.removeEventListener("change", updateMobileState);
      compactQuery.removeEventListener("change", updateMobileState);
      delete document.documentElement.dataset.shellHydrated;
    };
  }, []);

  useEffect(() => {
    const savedTheme = readTheme();
    setTheme(savedTheme);
    document.documentElement.dataset.theme = savedTheme;
  }, []);

  useEffect(() => {
    if (previousPathname.current === pathname) return;

    previousPathname.current = pathname;
    setIsMobileNavigationOpen(false);
  }, [pathname]);

  useLayoutEffect(() => {
    if (!isMobile || !isMobileNavigationOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      mobileCloseButtonRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(focusFrame);
  }, [isMobile, isMobileNavigationOpen]);

  useEffect(() => {
    if (!isMobile || !isMobileNavigationOpen) return;

    const sidebar = sidebarRef.current;
    if (!sidebar) return;

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function getFocusableElements() {
      return Array.from(
        sidebar!.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMobileNavigationOpen(false);
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements();
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (!firstElement || !lastElement) {
        event.preventDefault();
        mobileCloseButtonRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    function keepFocusInSidebar(event: FocusEvent) {
      if (!sidebar!.contains(event.target as Node)) {
        mobileCloseButtonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", keepFocusInSidebar);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", keepFocusInSidebar);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [isMobile, isMobileNavigationOpen]);

  useEffect(() => {
    if (wasMobileNavigationOpen.current && !isMobileNavigationOpen) {
      sidebarToggleRef.current?.focus();
    }

    wasMobileNavigationOpen.current = isMobileNavigationOpen;
  }, [isMobileNavigationOpen]);

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

  function closeMobileNavigation() {
    setIsMobileNavigationOpen(false);
  }

  function toggleNavigation() {
    if (isMobile) {
      if (isMobileNavigationOpen) {
        closeMobileNavigation();
      } else {
        setIsMobileNavigationOpen(true);
      }
      return;
    }

    setSidebarPreference(!isSidebarCollapsed);
  }

  const navigationLabel = isMobile
    ? isMobileNavigationOpen
      ? "Close navigation"
      : "Open navigation"
    : isSidebarCollapsed
      ? "Expand sidebar"
      : "Collapse sidebar";
  const frameClassName = [
    "app-frame",
    pathname === "/" && "jd-workspace-frame",
    !isMobile && isSidebarCollapsed && "is-sidebar-collapsed",
    isMobile && isMobileNavigationOpen && "is-mobile-nav-open",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={frameClassName}>
      <button
        aria-hidden="true"
        className="nav-scrim"
        onClick={closeMobileNavigation}
        tabIndex={-1}
        type="button"
      />

      <aside
        aria-hidden={isMobile && !isMobileNavigationOpen ? true : undefined}
        aria-label={
          isMobile && isMobileNavigationOpen ? "Navigation menu" : undefined
        }
        aria-modal={isMobile && isMobileNavigationOpen ? true : undefined}
        className="sidebar"
        id="workspace-sidebar"
        ref={sidebarRef}
        role={isMobile && isMobileNavigationOpen ? "dialog" : undefined}
      >
        <div className="sidebar-header">
          <Link
            aria-label="Resume Changer home"
            className="brand"
            href="/"
            onClick={() => {
              if (isMobile) closeMobileNavigation();
            }}
          >
            <span aria-hidden="true" className="brand-mark">
              ✳
            </span>
            <span className="brand-name">Resume Changer</span>
          </Link>
          <button
            aria-label="Close navigation"
            className="sidebar-close"
            onClick={closeMobileNavigation}
            ref={mobileCloseButtonRef}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Main navigation" className="main-navigation">
          {navigation.map((item) => (
            <Link
              aria-current={pathname === item.href ? "page" : undefined}
              aria-label={item.label}
              className={`nav-link${pathname === item.href ? " is-active" : ""}`}
              data-label={item.label}
              href={item.href}
              key={item.href}
              onClick={() => {
                if (isMobile) closeMobileNavigation();
              }}
              title={isSidebarCollapsed && !isMobile ? item.label : undefined}
            >
              <span aria-hidden="true" className="nav-icon">
                <SidebarIcon name={item.icon} />
              </span>
              <span className="nav-link-label">{item.label}</span>
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

      <div
        aria-hidden={isMobile && isMobileNavigationOpen ? true : undefined}
        className="main-column"
        id="workspace-main"
        inert={isMobile && isMobileNavigationOpen}
      >
        <header className="topbar">
          <div className="topbar-leading">
            <button
              aria-controls="workspace-sidebar"
              aria-expanded={
                isMobile ? isMobileNavigationOpen : !isSidebarCollapsed
              }
              aria-label={navigationLabel}
              className="sidebar-toggle"
              onClick={toggleNavigation}
              ref={sidebarToggleRef}
              title={navigationLabel}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                {isMobile ? (
                  isMobileNavigationOpen ? (
                    <path d="m6 6 12 12M18 6 6 18" />
                  ) : (
                    <path d="M4 6h16M4 12h16M4 18h16" />
                  )
                ) : isSidebarCollapsed ? (
                  <path d="m9 18 6-6-6-6" />
                ) : (
                  <path d="m15 18-6-6 6-6" />
                )}
              </svg>
            </button>
            <nav aria-label="Breadcrumb" className="breadcrumbs">
              <span>Workspace</span>
              <span aria-hidden="true">/</span>
              <strong aria-current="page">
                {currentPage?.label ?? "Workspace"}
              </strong>
            </nav>
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
              <svg
                aria-hidden="true"
                className="theme-icon"
                fill="none"
                viewBox="0 0 24 24"
              >
                {theme === "light" ? (
                  <>
                    <circle cx="12" cy="12" r="3.5" />
                    <path d="M12 2.75v2M12 19.25v2M21.25 12h-2M4.75 12h-2M18.54 5.46l-1.42 1.42M6.88 17.12l-1.42 1.42M18.54 18.54l-1.42-1.42M6.88 6.88 5.46 5.46" />
                  </>
                ) : (
                  <path d="M20.25 15.1A8.35 8.35 0 0 1 8.9 3.75 8.5 8.5 0 1 0 20.25 15.1Z" />
                )}
              </svg>
            </button>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
