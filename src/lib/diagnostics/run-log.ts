"use client";

export type RunLogEvent = {
  id?: number;
  runId: string;
  timestamp: string;
  stage: string;
  message: string;
  data?: unknown;
};

const DATABASE_NAME = "resume-changer-diagnostics";
const DATABASE_VERSION = 1;
const STORE_NAME = "events";
const ACTIVE_RUN_KEY = "resume-changer.diagnostics.active-run.v1";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("runId", "runId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getActiveRunId(): string {
  try {
    const existing = window.localStorage.getItem(ACTIVE_RUN_KEY);
    if (existing) return existing;
    const id =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(ACTIVE_RUN_KEY, id);
    return id;
  } catch {
    return `ephemeral-${Date.now()}`;
  }
}

export function startNewRun(): string {
  try {
    window.localStorage.removeItem(ACTIVE_RUN_KEY);
  } catch {
    // Logging remains available for the current page without localStorage.
  }
  return getActiveRunId();
}

export async function recordRunEvent(
  event: Omit<RunLogEvent, "timestamp"> & { timestamp?: string },
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).add({
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    window.dispatchEvent(new Event("resume-changer-run-log-updated"));
  } catch {
    // A blocked/private browser may disable IndexedDB; app behavior must continue.
  }
}

export async function getRunEvents(runId: string): Promise<RunLogEvent[]> {
  if (typeof indexedDB === "undefined") return [];
  const database = await openDatabase();
  const events = await new Promise<RunLogEvent[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction
      .objectStore(STORE_NAME)
      .index("runId")
      .getAll(runId);
    request.onsuccess = () => resolve(request.result as RunLogEvent[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function clearRunEvents(runId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const index = transaction.objectStore(STORE_NAME).index("runId");
    const request = index.openKeyCursor(IDBKeyRange.only(runId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function recordServerEvents(
  runId: string,
  events: Array<
    Omit<RunLogEvent, "id" | "runId" | "timestamp"> & { timestamp?: string }
  >,
) {
  for (const event of events) {
    void recordRunEvent({ ...event, runId, timestamp: event.timestamp });
  }
}
