"use client";

import { useState } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { Asterisk, ArrowRight, LockKeyhole } from "lucide-react";
import { getBrowserAuth } from "@/lib/cloud/browser-auth";

export default function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function enter() {
    setBusy(true);
    setError("");
    try {
      const result = await signInWithPopup(
        getBrowserAuth(),
        new GoogleAuthProvider(),
      );
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: await result.user.getIdToken() }),
      });
      if (!response.ok)
        throw new Error("Your account could not be opened. Please try again.");
      window.location.assign("/");
    } catch (reason) {
      const code =
        reason && typeof reason === "object" && "code" in reason
          ? reason.code
          : "";
      setError(
        code === "auth/popup-blocked"
          ? "Allow the sign-in window in your browser, then try again."
          : code === "auth/popup-closed-by-user"
            ? "Sign-in was closed. You can try again when ready."
            : "Sign-in could not finish. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="account-entry">
      <div
        aria-hidden="true"
        className="account-entry-orb account-entry-orb-warm"
      />
      <div
        aria-hidden="true"
        className="account-entry-orb account-entry-orb-violet"
      />
      <section
        aria-labelledby="account-entry-title"
        className="account-entry-card"
      >
        <span className="account-entry-brand">
          <Asterisk aria-hidden="true" size={24} />
          Resume Changer
        </span>
        <p className="eyebrow">A little space for your next chapter</p>
        <h1 id="account-entry-title">
          Your experience.
          <br />A fresh beginning.
        </h1>
        <p>
          Bring your achievements together and shape a resume for what comes
          next.
        </p>
        <button
          className="account-sign-in-button"
          onClick={enter}
          disabled={busy}
          type="button"
        >
          {busy ? "Opening your workspace…" : "Continue with Google"}
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        {error && (
          <p role="alert" className="account-entry-error">
            {error}
          </p>
        )}
        <p className="account-entry-privacy">
          <LockKeyhole aria-hidden="true" size={15} />
          Your library and saved resumes stay private to your account.
        </p>
      </section>
    </main>
  );
}
