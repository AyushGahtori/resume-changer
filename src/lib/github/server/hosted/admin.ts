import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

export function hostedAdmin() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  const raw = process.env.GITHUB_FIREBASE_SERVICE_ACCOUNT;
  if (!projectId || !databaseId || !raw)
    throw new Error("Hosted GitHub database credentials are unavailable.");
  const credentials = JSON.parse(raw);
  if (credentials.project_id !== projectId)
    throw new Error("The hosted GitHub database project does not match.");
  const namespace = process.env.GITHUB_HOSTED_NAMESPACE;
  if (!namespace || !/^[a-z][a-z0-9-]{0,47}$/.test(namespace))
    throw new Error("A dedicated GitHub state namespace is required.");
  const name = `github-hosted-${namespace}`;
  const app =
    getApps().find((app) => app.name === name) ??
    initializeApp({ credential: cert(credentials), projectId }, name);
  return { db: getFirestore(app, databaseId), auth: getAuth(app), namespace };
}
