"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { createImportClient } from "@/lib/github/client";
import type {
  DomainError,
  ImportRecord,
  ImportReviewState,
  Notification,
  Result,
} from "@/lib/github/contracts";

const NOTIFICATION_CHANNEL = "resume-changer.github-import-notifications.v1";
const NOTIFICATION_STORAGE_KEY = "resume-changer.github-import-refresh.v1";

export type ImportNotificationItem = Omit<Notification, "destination"> & {
  destination: string | null;
};

export type ImportNotificationPage = {
  notifications: ImportNotificationItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ImportProgressItem = {
  importId: string;
  projectId: string;
  lifecycle: ImportRecord["lifecycle"];
  updatedAt: string;
};

export type ImportStatusClient = {
  listNotifications?: (input?: {
    cursor?: string | null;
    limit?: number;
  }) => Promise<Result<ImportNotificationPage>>;
  markNotificationRead?: (
    notificationId: string,
  ) => Promise<Result<ImportNotificationItem>>;
  subscribeStatus?: (
    listener: (state: ImportReviewState) => void,
    onError?: (error: DomainError) => void,
    cursor?: string | null,
  ) => Result<{ close(): void; cursor?: string | null }>;
};

export type ImportStatusLoadState =
  "loading" | "ready" | "unavailable" | "error";

type ImportStatusContextValue = {
  notifications: ImportNotificationItem[];
  runningImports: ImportProgressItem[];
  unreadCount: number;
  loadState: ImportStatusLoadState;
  errorMessage: string | null;
  actionError: string | null;
  watchImport(
    importId: string,
    listener: (state: ImportReviewState) => void,
  ): () => void;
  refresh(): void;
  markRead(notificationId: string): void;
  review(notificationId: string): void;
};

const ImportStatusContext = createContext<ImportStatusContextValue | null>(
  null,
);

function newestFirst(items: ImportNotificationItem[]) {
  return [...items].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function mergeNotifications(
  current: ImportNotificationItem[],
  incoming: ImportNotificationItem[],
) {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return newestFirst(Array.from(byId.values()));
}

function createDefaultClient(): ImportStatusClient {
  return createImportClient();
}

export function ImportStatusProvider({
  children,
  client: injectedClient,
}: {
  children?: ReactNode;
  client?: ImportStatusClient;
}) {
  const [client] = useState(() => injectedClient ?? createDefaultClient());
  const [notifications, setNotifications] = useState<ImportNotificationItem[]>(
    [],
  );
  const [runningByImportId, setRunningByImportId] = useState<
    Map<string, ImportProgressItem>
  >(() => new Map());
  const [loadState, setLoadState] = useState<ImportStatusLoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const listeners = useRef(
    new Map<string, Set<(state: ImportReviewState) => void>>(),
  );
  const watchImport = useCallback(
    (importId: string, listener: (state: ImportReviewState) => void) => {
      const set = listeners.current.get(importId) ?? new Set();
      set.add(listener);
      listeners.current.set(importId, set);
      return () => {
        set.delete(listener);
        if (!set.size) listeners.current.delete(importId);
      };
    },
    [],
  );
  const refreshSequence = useRef(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const storageSyncRef = useRef(false);
  const storageRevision = useRef(0);

  const refreshNotifications = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!client.listNotifications) {
      setLoadState("unavailable");
      setErrorMessage(null);
      return;
    }

    setLoadState((current) => (current === "ready" ? current : "loading"));
    setErrorMessage(null);
    try {
      const result = await client.listNotifications({ limit: 100 });
      if (sequence !== refreshSequence.current) return;
      if (!result.ok) {
        setLoadState(
          result.error.code === "unavailable" ? "unavailable" : "error",
        );
        setErrorMessage("We could not load GitHub import activity.");
        return;
      }
      setNotifications((current) =>
        mergeNotifications(current, result.value.notifications),
      );
      setLoadState("ready");
    } catch {
      if (sequence !== refreshSequence.current) return;
      setLoadState("error");
      setErrorMessage("We could not load GitHub import activity.");
    }
  }, [client]);

  const updateRunningImport = useCallback(
    (state: ImportReviewState) => {
      const record = state.import;
      if (record.source !== "personal") return;

      if (["preparing", "queued", "analyzing"].includes(record.lifecycle)) {
        const nextItem: ImportProgressItem = {
          importId: record.id,
          projectId: record.destinationProjectId,
          lifecycle: record.lifecycle,
          updatedAt: record.updatedAt,
        };
        setRunningByImportId((current) => {
          const previous = current.get(record.id);
          if (
            previous &&
            previous.updatedAt.localeCompare(nextItem.updatedAt) > 0
          ) {
            return current;
          }
          const next = new Map(current);
          next.set(record.id, nextItem);
          return next;
        });
        return;
      }

      setRunningByImportId((current) => {
        if (!current.has(record.id)) return current;
        const next = new Map(current);
        next.delete(record.id);
        return next;
      });

      if (
        [
          "ready-to-review",
          "needs-input",
          "partial",
          "failed",
          "expired",
        ].includes(record.lifecycle)
      ) {
        void refreshNotifications();
      }
    },
    [refreshNotifications],
  );

  const publishRefresh = useCallback(() => {
    if (channelRef.current) {
      try {
        channelRef.current.postMessage({ type: "refresh" });
        return;
      } catch {
        // Fall back to the storage event when a channel is unavailable.
      }
    }
    if (!storageSyncRef.current) return;
    try {
      storageRevision.current += 1;
      window.localStorage.setItem(
        NOTIFICATION_STORAGE_KEY,
        `${Date.now()}:${storageRevision.current}`,
      );
    } catch {
      // The current tab already has the server response; other tabs can retry.
    }
  }, []);

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!client.markNotificationRead) {
        setActionError("Notification updates are unavailable right now.");
        return;
      }
      setActionError(null);
      try {
        const result = await client.markNotificationRead(notificationId);
        if (!result.ok) {
          setActionError("We could not update this notification.");
          return;
        }
        setNotifications((current) =>
          mergeNotifications(current, [result.value]),
        );
        publishRefresh();
      } catch {
        setActionError("We could not update this notification.");
      }
    },
    [client, publishRefresh],
  );

  const review = useCallback(
    (notificationId: string) => {
      void markRead(notificationId);
    },
    [markRead],
  );

  useEffect(() => {
    let active = true;
    void refreshNotifications();

    const subscription = client.subscribeStatus?.(
      (state) => {
        if (active) {
          updateRunningImport(state);
          for (const listener of listeners.current.get(state.import.id) ?? [])
            listener(state);
        }
      },
      () => {
        if (active) {
          setErrorMessage("Live GitHub import updates are unavailable.");
        }
      },
    );

    if (subscription && !subscription.ok && client.listNotifications) {
      setErrorMessage("Live GitHub import updates are unavailable.");
    }

    return () => {
      active = false;
      refreshSequence.current += 1;
      if (subscription?.ok) subscription.value.close();
    };
  }, [client, refreshNotifications, updateRunningImport]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATION_STORAGE_KEY) void refreshNotifications();
    };

    if (typeof BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel(NOTIFICATION_CHANNEL);
        channelRef.current = channel;
        channel.onmessage = (event: MessageEvent<unknown>) => {
          if (
            event.data &&
            typeof event.data === "object" &&
            "type" in event.data &&
            event.data.type === "refresh"
          ) {
            void refreshNotifications();
          }
        };
        return () => {
          channel.close();
          if (channelRef.current === channel) channelRef.current = null;
        };
      } catch {
        // Storage events provide the same lightweight refresh signal.
      }
    }

    storageSyncRef.current = true;
    window.addEventListener("storage", onStorage);
    return () => {
      storageSyncRef.current = false;
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshNotifications]);

  const runningImports = useMemo(
    () =>
      Array.from(runningByImportId.values()).sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      ),
    [runningByImportId],
  );
  const unreadCount = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          notification.readAt === null && notification.dismissedAt === null,
      ).length,
    [notifications],
  );

  const value = useMemo<ImportStatusContextValue>(
    () => ({
      notifications,
      runningImports,
      unreadCount,
      loadState,
      errorMessage,
      actionError,
      watchImport,
      refresh: () => void refreshNotifications(),
      markRead: (id) => void markRead(id),
      review,
    }),
    [
      notifications,
      runningImports,
      unreadCount,
      loadState,
      errorMessage,
      actionError,
      refreshNotifications,
      markRead,
      review,
      watchImport,
    ],
  );

  return (
    <ImportStatusContext.Provider value={value}>
      {children}
    </ImportStatusContext.Provider>
  );
}

export function useImportStatus() {
  const context = useContext(ImportStatusContext);
  if (!context) {
    throw new Error(
      "useImportStatus must be used inside ImportStatusProvider.",
    );
  }
  return context;
}

export function useOptionalImportStatus() {
  return useContext(ImportStatusContext);
}
