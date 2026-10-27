import type { FirebaseOptions } from "firebase/app";

export function getFirebaseClientConfig(): FirebaseOptions {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(config).some((value) => !value)) {
    throw Object.assign(
      new Error("Firebase account configuration is incomplete."),
      {
        code: "app/account-config-incomplete",
      },
    );
  }
  return config;
}

export function getFirestoreDatabaseId(): string {
  const id = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  if (!id || !/^(\(default\)|[a-z][a-z0-9-]{2,62})$/.test(id)) {
    throw new Error("The account database is not configured.");
  }
  return id;
}
