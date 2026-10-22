"use client";

import Link from "next/link";
import {
  Asterisk,
  BookOpen,
  FileText,
  History,
  Settings,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const THEME_STORAGE_KEY = "resume-changer.theme.v1";

const LIBRARY_ROUTE = "/library";

const navigation = [
  { href: "/", label: "Job description", icon: "description" },
  { href: LIBRARY_ROUTE, label: "Achievement library", icon: "library" },
  { href: "/generate", label: "Resume builder", icon: "resume" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

type SidebarIconName = (typeof navigation)[number]["icon"];

const sidebarIcons = {
  description: FileText,
  library: BookOpen,
  resume: FileText,
  history: History,
  settings: Settings,
};

function SidebarIcon({ name }: { name: SidebarIconName }) {
  const Icon = sidebarIcons[name];
  return <Icon aria-hidden="true" size={20} />;
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

    let recoveryFrame: number | null = null;
    function focusDrawerWhenVisible() {
      if (!sidebar?.isConnected || sidebar.contains(document.activeElement))
        return;
      mobileCloseButtonRef.current?.focus({ preventScroll: true });
      // Focus can be rejected while a reopened drawer is still being painted.
      // Keep checking the rendered state until focus enters, or cleanup closes it.
      if (!sidebar.contains(document.activeElement)) {
        recoveryFrame = window.requestAnimationFrame(focusDrawerWhenVisible);
      }
    }

    function recoverFocusAfterBlur() {
      if (recoveryFrame !== null) window.cancelAnimationFrame(recoveryFrame);
      recoveryFrame = window.requestAnimationFrame(focusDrawerWhenVisible);
    }

    function keepFocusInSidebar(event: FocusEvent) {
      if (!sidebar!.contains(event.target as Node)) recoverFocusAfterBlur();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", keepFocusInSidebar);
    document.addEventListener("focusout", recoverFocusAfterBlur);
    sidebar.scrollTop = 0;
    recoverFocusAfterBlur();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", keepFocusInSidebar);
      document.removeEventListener("focusout", recoverFocusAfterBlur);
      if (recoveryFrame !== null) window.cancelAnimationFrame(recoveryFrame);
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
    pathname === LIBRARY_ROUTE && "library-workspace-frame",
    pathname === LIBRARY_ROUTE && "is-library-route",
    !isMobile && isSidebarCollapsed && "is-sidebar-collapsed",
    isMobile && isMobileNavigationOpen && "is-mobile-nav-open",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={frameClassName}>
      <a className="workspace-skip-link" href="#workspace-content">
        Skip to main content
      </a>
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
              <Asterisk aria-hidden="true" size={24} />
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
            <X aria-hidden="true" size={20} />
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
              {isMobile ? (
                isMobileNavigationOpen ? (
                  <X aria-hidden="true" />
                ) : (
                  <Menu aria-hidden="true" />
                )
              ) : isSidebarCollapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
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
              {theme === "light" ? (
                <Sun aria-hidden="true" className="theme-icon" />
              ) : (
                <Moon aria-hidden="true" className="theme-icon" />
              )}
            </button>
          </div>
        </header>
        <main className="page-content" id="workspace-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
