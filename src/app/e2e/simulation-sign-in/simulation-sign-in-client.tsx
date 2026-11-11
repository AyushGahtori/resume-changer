"use client";

import { useEffect } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { getBrowserAuth } from "@/lib/cloud/browser-auth";

declare global {
  interface Window {
    __resumeSimulationSignIn?: (
      customToken: string,
    ) => Promise<{ uid: string }>;
  }
}

export default function SimulationSignInClient() {
  useEffect(() => {
    window.__resumeSimulationSignIn = async (customToken) => {
      const result = await signInWithCustomToken(getBrowserAuth(), customToken);
      const idToken = await result.user.getIdToken();
      const session = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!session.ok)
        throw new Error("The simulation session could not be opened.");
      return { uid: result.user.uid };
    };
    return () => {
      delete window.__resumeSimulationSignIn;
    };
  }, []);
  return (
    <main>
      <h1>Simulation sign-in</h1>
    </main>
  );
}
