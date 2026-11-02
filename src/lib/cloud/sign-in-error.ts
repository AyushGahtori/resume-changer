/** Display only controlled messages; provider errors can contain request details. */
export function signInErrorMessage(reason: unknown): string {
  const code =
    reason && typeof reason === "object" && "code" in reason ? reason.code : "";
  switch (code) {
    case "app/account-config-incomplete":
      return "Sign-in is not configured for this deployment. Please contact the app owner.";
    case "auth/unauthorized-domain":
      return "Google sign-in is not configured for this website address. Open the approved workspace link or contact the app owner.";
    case "auth/popup-blocked":
      return "Allow the sign-in window in your browser, then try again.";
    case "auth/popup-closed-by-user":
      return "Sign-in was closed. You can try again when ready.";
    default:
      return "Sign-in could not finish. Please try again.";
  }
}
