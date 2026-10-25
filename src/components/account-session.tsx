"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { onIdTokenChanged, signOut } from "firebase/auth";
import { getBrowserAuth } from "@/lib/cloud/browser-auth";
import { accountStorage } from "@/lib/cloud/account-storage";
import { setActiveAccountUid } from "@/lib/cloud/api-fetch";

export type WorkspaceAccount = {
  uid: string;
  email: string;
  displayName: string;
};
const AccountContext = createContext<WorkspaceAccount | null>(null);

export function useWorkspaceAccount() {
  return useContext(AccountContext);
}

export function useWorkspaceStorage() {
  const account = useWorkspaceAccount();
  const uid = account?.uid;
  return useCallback(
    () =>
      uid ? accountStorage(window.localStorage, uid) : window.localStorage,
    [uid],
  );
}

export function AccountSession({
  account,
  children,
}: {
  account: WorkspaceAccount | null;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    setActiveAccountUid(account?.uid ?? null);
    return () => setActiveAccountUid(null);
  }, [account?.uid]);
  useEffect(() => {
    if (!account) return;
    const auth = getBrowserAuth();
    let disposed = false;
    let pending: AbortController | undefined;
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (disposed) return;
      pending?.abort();
      const request = new AbortController();
      pending = request;
      try {
        if (!user) {
          accountStorage(window.localStorage, account.uid).clear();
          await fetch("/api/auth/session", {
            method: "DELETE",
            signal: request.signal,
          });
          window.location.replace("/sign-in");
          return;
        }
        const idToken = await user.getIdToken();
        if (
          disposed ||
          request.signal.aborted ||
          auth.currentUser?.uid !== user.uid
        )
          return;
        const response = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
          signal: request.signal,
        });
        if (response.ok && user.uid !== account.uid) {
          accountStorage(window.localStorage, account.uid).clear();
          window.location.reload();
        }
      } catch {
        /* A later authenticated request can renew an expired session. */
      }
    });
    return () => {
      disposed = true;
      pending?.abort();
      unsubscribe();
    };
  }, [account]);
  return (
    <AccountContext.Provider value={account}>
      {children}
    </AccountContext.Provider>
  );
}

export function AccountControl() {
  const account = useWorkspaceAccount();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!account)
    return (
      <span className="local-status">
        <span aria-hidden="true" /> Local mode
      </span>
    );
  async function leave() {
    setBusy(true);
    setError("");
    try {
      setActiveAccountUid(null);
      await signOut(getBrowserAuth());
      const response = await fetch("/api/auth/session", { method: "DELETE" });
      if (!response.ok)
        throw new Error("Sign-out could not finish. Try again.");
      accountStorage(window.localStorage, account!.uid).clear();
      window.location.replace("/sign-in");
    } catch {
      setError("Sign-out could not finish. Try again.");
      setBusy(false);
    }
  }
  return (
    <div className="workspace-account-control">
      <span title={account.email}>{account.displayName || account.email}</span>
      <button type="button" disabled={busy} onClick={leave}>
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
