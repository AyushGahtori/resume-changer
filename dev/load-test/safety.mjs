export function assertLoopbackTarget(baseURL) {
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error("The load-test base URL is invalid.");
  }
  if (url.protocol !== "http:")
    throw new Error("The load test only uses HTTP on loopback.");
  if (url.username || url.password) {
    throw new Error("The load-test URL cannot contain credentials.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The load-test URL cannot contain a path or query.");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("The load test refuses every non-loopback target.");
  }
  return url;
}

export function assertLoadTestEnvironment(env, baseURL) {
  assertLoopbackTarget(baseURL);
  if (env.VERCEL)
    throw new Error("The load test refuses to run when VERCEL is set.");
  if (env.RESUME_APP_MODE !== "firebase") {
    throw new Error("The load test requires RESUME_APP_MODE=firebase.");
  }
  if (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== "demo-resume-changer-loadtest") {
    throw new Error(
      "The load test requires the demo-resume-changer-loadtest project.",
    );
  }
  if (env.NEXT_PUBLIC_FIREBASE_DATABASE_ID !== "(default)") {
    throw new Error("The load test requires the (default) database.");
  }
  for (const key of [
    "FIREBASE_AUTH_EMULATOR_HOST",
    "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
    "FIRESTORE_EMULATOR_HOST",
  ]) {
    if (!/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(env[key] ?? "")) {
      throw new Error(`${key} must be a loopback emulator endpoint.`);
    }
  }
  if (
    env.FIREBASE_AUTH_EMULATOR_HOST !==
    env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST
  ) {
    throw new Error(
      "The browser and server auth emulator endpoints must match.",
    );
  }
  if (env.RESUME_LOAD_TEST !== "1") {
    throw new Error("The load test requires RESUME_LOAD_TEST=1.");
  }
}

export function loadTestEnvironment(baseURL) {
  const url = assertLoopbackTarget(baseURL);
  const env = {
    RESUME_APP_MODE: "firebase",
    NEXT_DIST_DIR: ".next-load-test",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-resume-changer-loadtest",
    NEXT_PUBLIC_FIREBASE_DATABASE_ID: "(default)",
    NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
      "demo-resume-changer-loadtest.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_APP_ID: "demo-loadtest-app",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8088",
    RESUME_LOAD_TEST: "1",
    AI_PROVIDER: "mock",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: url.port || "80",
    HOSTNAME: url.hostname,
  };
  assertLoadTestEnvironment(env, baseURL);
  return env;
}
