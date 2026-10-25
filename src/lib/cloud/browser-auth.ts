"use client";

import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { getFirebaseClientConfig } from "./config";

let emulatorConnected = false;

export function getBrowserAuth() {
  const name = "resume-changer-browser";
  const app =
    getApps().find((candidate) => candidate.name === name) ??
    initializeApp(getFirebaseClientConfig(), name);
  const auth = getAuth(app);
  const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  if (emulator && !emulatorConnected) {
    if (
      !["localhost", "127.0.0.1"].includes(window.location.hostname) ||
      !app.options.projectId?.startsWith("demo-") ||
      !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(emulator)
    )
      throw new Error(
        "The local authentication emulator configuration is invalid.",
      );
    connectAuthEmulator(auth, `http://${emulator}`, { disableWarnings: true });
    emulatorConnected = true;
  }
  return auth;
}
