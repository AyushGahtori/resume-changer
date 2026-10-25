"use client";

import { getBrowserAuth } from "./browser-auth";

let activeUid: string | null = null;
let refreshing:
  | { uid: string; promise: Promise<boolean>; abort: AbortController }
  | undefined;

export function setActiveAccountUid(uid: string | null) {
  if (activeUid !== uid) refreshing?.abort.abort();
  activeUid = uid;
}

async function refreshAccountSession(
  expectedUid: string,
  signal: AbortSignal,
): Promise<boolean> {
  const auth = getBrowserAuth();
  await auth.authStateReady();
  if (activeUid !== expectedUid || auth.currentUser?.uid !== expectedUid)
    return false;
  const idToken = await auth.currentUser.getIdToken(true);
  if (activeUid !== expectedUid || auth.currentUser?.uid !== expectedUid)
    return false;
  const response = await fetch("/api/auth/session", {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  return response.ok && activeUid === expectedUid;
}

/** Retry an expired app session once, without retrying provider or validation failures. */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const uid = activeUid;
  const url =
    typeof window === "undefined"
      ? null
      : new URL(
          input instanceof Request ? input.url : input.toString(),
          window.location.href,
        );
  const ownApi = Boolean(
    url &&
    url.origin === window.location.origin &&
    url.pathname.startsWith("/api/"),
  );
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (uid && ownApi) headers.set("X-Workspace-Account", uid);
  const options = uid && ownApi ? { ...init, headers } : init;
  const replay = input instanceof Request ? input.clone() : input;
  const response = await fetch(input, options);
  if (
    response.status !== 401 ||
    !uid ||
    !ownApi ||
    url?.pathname === "/api/auth/session" ||
    activeUid !== uid
  )
    return response;
  const error = await response
    .clone()
    .json()
    .catch(() => null);
  if (error?.code !== "AUTH_REQUIRED") return response;
  try {
    if (!refreshing || refreshing.uid !== uid) {
      const task = {
        uid,
        promise: Promise.resolve(false),
        abort: new AbortController(),
      };
      task.promise = refreshAccountSession(uid, task.abort.signal).finally(
        () => {
          if (refreshing === task) refreshing = undefined;
        },
      );
      refreshing = task;
    }
    if (!(await refreshing.promise) || activeUid !== uid) return response;
    if (init?.body instanceof ReadableStream) return response;
    return fetch(replay, options);
  } catch {
    return response;
  }
}
