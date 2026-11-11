export async function createEmulatorIdentity({
  authHost,
  origin,
  subject,
  email,
  displayName,
}) {
  const login = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestUri: origin,
        postBody: new URLSearchParams({
          providerId: "google.com",
          id_token: JSON.stringify({
            sub: subject,
            email,
            email_verified: true,
            name: displayName,
          }),
        }).toString(),
        returnSecureToken: true,
      }),
    },
  );
  const tokens = await login.json().catch(() => ({}));
  if (!login.ok || !tokens.localId || !tokens.idToken) {
    throw new Error("The local auth emulator did not return an identity.");
  }
  return {
    uid: tokens.localId,
    idToken: tokens.idToken,
    email,
  };
}

export async function openApiSession({ baseURL, idToken }) {
  const session = await fetch(`${baseURL}/api/auth/session`, {
    method: "POST",
    headers: { Origin: baseURL, "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!session.ok) {
    throw new Error("The local app session could not be opened.");
  }
  const cookies =
    typeof session.headers.getSetCookie === "function"
      ? session.headers.getSetCookie()
      : [session.headers.get("set-cookie")].filter(Boolean);
  const cookie = cookies.map((item) => item.split(";")[0]).join("; ");
  if (!cookie.includes("resume_session=")) {
    throw new Error("The local app session cookie is missing.");
  }
  return { cookie };
}
