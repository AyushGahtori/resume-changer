"use client";

import { useEffect } from "react";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { getBrowserAuth } from "@/lib/cloud/browser-auth";

type LoadTestIdentity = { idToken: string };

declare global {
  interface Window {
    __resumeLoadTestSignIn?: (
      identity: LoadTestIdentity,
    ) => Promise<{ uid: string }>;
  }
}

export default function LoadTestAuthClient() {
  useEffect(() => {
    window.__resumeLoadTestSignIn = async ({ idToken }) => {
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(getBrowserAuth(), credential);
      const session = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await result.user.getIdToken() }),
      });
      if (!session.ok)
        throw new Error("The local session could not be opened.");
      return { uid: result.user.uid };
    };
    return () => {
      delete window.__resumeLoadTestSignIn;
    };
  }, []);
  return (
    <main>
      <h1>Local load test sign-in</h1>
    </main>
  );
}
