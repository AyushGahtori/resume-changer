import { JSDOM } from "jsdom";
import { act, createElement, useEffect } from "react";
import type { Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  ImportReviewState,
  Notification,
  Result,
} from "@/lib/github/contracts";
import type {
  ImportNotificationItem,
  ImportNotificationPage,
  ImportStatusClient,
} from "@/components/library/import-status-provider";

vi.mock("next/link", async () => {
  const React = await import("react");
  type LinkProps = import("react").AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };
  return {
    default: ({ href, children, ...props }: LinkProps) =>
      React.createElement("a", { ...props, href }, children),
  };
});

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/library",
});
const mountedRoots: Array<{ root: Root; host: HTMLDivElement }> = [];
let createRoot: typeof import("react-dom/client").createRoot;
let ImportNotifications: typeof import("@/components/library/import-notifications").ImportNotifications;
let ImportStatusProvider: typeof import("@/components/library/import-status-provider").ImportStatusProvider;
let useImportStatus: typeof import("@/components/library/import-status-provider").useImportStatus;

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(async () => {
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    Element: { configurable: true, value: dom.window.Element },
    Node: { configurable: true, value: dom.window.Node },
    Event: { configurable: true, value: dom.window.Event },
  });
  ({ createRoot } = await import("react-dom/client"));
  ({ ImportNotifications } =
    await import("@/components/library/import-notifications"));
  ({ ImportStatusProvider, useImportStatus } =
    await import("@/components/library/import-status-provider"));
});

afterAll(() => dom.window.close());

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", undefined);
});

afterEach(() => {
  for (const { root, host } of mountedRoots.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

function notification(
  overrides: Partial<ImportNotificationItem> = {},
): ImportNotificationItem {
  const value: Notification = {
    id: "notification-ready-1",
    importId: "import-1",
    projectId: "project-1",
    jobId: "job-1",
    type: "ready",
    createdAt: "2026-10-27T10:00:00.000Z",
    destination: "/library/github/import-1",
    readAt: null,
    dismissedAt: null,
  };
  return { ...value, ...overrides };
}

function reviewState(
  lifecycle: "analyzing" | "ready-to-review",
): ImportReviewState {
  return {
    import: {
      id: "import-1",
      source: "personal",
      destinationProjectId: "project-1",
      lifecycle,
      updatedAt:
        lifecycle === "analyzing"
          ? "2026-10-27T10:01:00.000Z"
          : "2026-10-27T10:02:00.000Z",
    },
  } as unknown as ImportReviewState;
}

function fakeClient(initial: ImportNotificationItem[] = []) {
  let serverNotifications = [...initial];
  let statusListener: ((state: ImportReviewState) => void) | undefined;
  const listNotifications = vi.fn(async () =>
    success<ImportNotificationPage>({
      notifications: [...serverNotifications],
      nextCursor: null,
      hasMore: false,
    }),
  );
  const markNotificationRead = vi.fn(async (id: string) => {
    const current = serverNotifications.find((item) => item.id === id);
    if (!current) {
      return {
        ok: false as const,
        error: {
          code: "not-found" as const,
          message: "Notification not found.",
          retryable: false,
        },
      };
    }
    const updated = { ...current, readAt: "2026-10-27T10:03:00.000Z" };
    serverNotifications = serverNotifications.map((item) =>
      item.id === id ? updated : item,
    );
    return success(updated);
  });
  const close = vi.fn();
  const subscribeStatus = vi.fn(
    (listener: (state: ImportReviewState) => void) => {
      statusListener = listener;
      return success({ close });
    },
  );
  const client: ImportStatusClient = {
    listNotifications,
    markNotificationRead,
    subscribeStatus,
  };

  return {
    client,
    listNotifications,
    markNotificationRead,
    subscribeStatus,
    close,
    emit(state: ImportReviewState) {
      statusListener?.(state);
    },
    setServerNotifications(items: ImportNotificationItem[]) {
      serverNotifications = [...items];
    },
  };
}

function ActivityConsumer() {
  const status = useImportStatus();
  return createElement(
    "div",
    null,
    createElement(
      "output",
      { "data-testid": "unread-count" },
      status.unreadCount,
    ),
    createElement(
      "output",
      { "data-testid": "running-count" },
      status.runningImports.length,
    ),
    createElement("input", { "aria-label": "Unsaved resume text" }),
    createElement(ImportNotifications, {
      items: status.notifications,
      unreadCount: status.unreadCount,
      runningImports: status.runningImports,
      projectNames: { "project-1": "Long Example Platform Project" },
      loadState: status.loadState,
      errorMessage: status.errorMessage,
      actionError: status.actionError,
      onRead: status.markRead,
      onReview: status.review,
      onRetry: status.refresh,
    }),
  );
}

function mountWithClient(client: ImportStatusClient) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      createElement(
        ImportStatusProvider,
        { client },
        createElement(ActivityConsumer),
      ),
    );
  });
  mountedRoots.push({ root, host });
  return host;
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function buttonNamed(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.replace(/\s+/g, " ").trim() === label,
  );
  if (!button) throw new Error("Missing button: " + label);
  return button;
}

describe("GitHub import notifications", () => {
  it("keeps one shared subscription and preserves focus as analysis finishes elsewhere", async () => {
    const client = fakeClient();
    const host = mountWithClient(client.client);
    await flushEffects();
    expect(client.subscribeStatus).toHaveBeenCalledTimes(1);

    const resumeEditor = host.querySelector<HTMLInputElement>(
      '[aria-label="Unsaved resume text"]',
    );
    if (!resumeEditor) throw new Error("Resume editor is unavailable.");
    resumeEditor.focus();

    act(() => client.emit(reviewState("analyzing")));
    expect(
      host.querySelector('[data-testid="running-count"]')?.textContent,
    ).toBe("1");
    expect(host.textContent).toContain("Project analysis in progress");
    expect(document.activeElement).toBe(resumeEditor);

    client.setServerNotifications([notification()]);
    await act(async () => {
      client.emit(reviewState("ready-to-review"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      host.querySelector('[data-testid="running-count"]')?.textContent,
    ).toBe("0");
    expect(
      host.querySelectorAll('[data-notification-id="notification-ready-1"]'),
    ).toHaveLength(1);
    expect(host.textContent).toContain("Long Example Platform Project");
    expect(host.textContent).toContain(
      "Draft achievements are ready for your review. They have not been saved.",
    );
    expect(document.activeElement).toBe(resumeEditor);

    act(() => buttonNamed(host, "Mark as read").click());
    await flushEffects();
    expect(client.markNotificationRead).toHaveBeenCalledWith(
      "notification-ready-1",
    );
    expect(
      host.querySelector('[data-testid="unread-count"]')?.textContent,
    ).toBe("0");
    expect(
      (client.client as ImportStatusClient & { approve?: unknown }).approve,
    ).toBe(undefined);
    expect(client.close).not.toHaveBeenCalled();
  });

  it("makes no activity requests when the server says imports are unavailable and reconnects when enabled", async () => {
    const client = fakeClient([notification()]);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push({ root, host });
    const render = (enabled: boolean) =>
      act(() => {
        root.render(
          createElement(
            ImportStatusProvider,
            { client: client.client, enabled },
            createElement(ActivityConsumer),
          ),
        );
      });
    render(false);
    await flushEffects();
    expect(client.listNotifications).not.toHaveBeenCalled();
    expect(client.subscribeStatus).not.toHaveBeenCalled();
    render(true);
    await flushEffects();
    expect(client.subscribeStatus).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector('[data-testid="unread-count"]')?.textContent,
    ).toBe("1");
    render(false);
    await flushEffects();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector('[data-testid="unread-count"]')?.textContent,
    ).toBe("0");
    expect(host.textContent).not.toContain("Long Example Platform Project");
  });

  it("fans one app stream out to the active import and removes route listeners on navigation", async () => {
    const client = fakeClient();
    const observed = vi.fn();
    function PageConsumer() {
      const { watchImport } = useImportStatus();
      useEffect(() => watchImport("import-1", observed), [watchImport]);
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mountedRoots.push({ root, host });
    await act(async () => {
      root.render(
        createElement(
          ImportStatusProvider,
          { client: client.client },
          createElement(PageConsumer),
        ),
      );
    });
    act(() => client.emit(reviewState("analyzing")));
    expect(observed).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(
        createElement(
          ImportStatusProvider,
          { client: client.client },
          createElement(ActivityConsumer),
        ),
      );
    });
    act(() => client.emit(reviewState("ready-to-review")));
    expect(observed).toHaveBeenCalledTimes(1);
    expect(client.subscribeStatus).toHaveBeenCalledTimes(1);
    expect(client.close).not.toHaveBeenCalled();
  });

  it("reconciles read state from another tab using server notification IDs", async () => {
    const unread = notification();
    const client = fakeClient([unread]);
    const host = mountWithClient(client.client);
    await flushEffects();
    expect(
      host.querySelector('[data-testid="unread-count"]')?.textContent,
    ).toBe("1");

    client.setServerNotifications([
      notification({ readAt: "2026-10-27T10:05:00.000Z" }),
    ]);
    await act(async () => {
      window.dispatchEvent(
        new window.StorageEvent("storage", {
          key: "resume-changer.github-import-refresh.v1",
          newValue: "other-tab-read",
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(client.listNotifications).toHaveBeenCalledTimes(2);
    expect(
      host.querySelector('[data-testid="unread-count"]')?.textContent,
    ).toBe("0");
    expect(host.textContent).toContain("Read");
  });

  it("offers an explicit restart for an expired result with no broken review link", () => {
    const expired = notification({
      id: "notification-expired-1",
      type: "expired",
      destination: null,
      readAt: null,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(ImportNotifications, {
          items: [expired],
          unreadCount: 1,
          onRead: vi.fn(),
          onReview: vi.fn(),
          projectNames: { "project-1": "Platform migration" },
        }),
      );
    });
    mountedRoots.push({ root, host });

    const startAgain = [...host.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Start again"),
    );
    expect(startAgain?.getAttribute("href")).toBe(
      "/library/github/new?projectId=project-1&restart=1",
    );
    expect(host.textContent).toContain("Platform migration");
    expect(host.textContent).toContain("The staged result expired.");
  });
});
