import { validateExtractionUrl } from "@/lib/jd-url-extraction";

/**
 * The state machine behind the optional "Paste from URL" control.
 *
 * The control is a disclosure that owns four states — idle, loading, error,
 * and success — plus the URL the user typed. Keeping those transitions in a
 * pure module means every one of them can be tested without a DOM, while the
 * component stays a thin renderer.
 *
 * The state machine never decides to keep a draft: it reports success, and
 * the caller replaces the job description only then. A failed, cancelled, or
 * still-loading extraction leaves the current draft untouched.
 */

export type PasteFromUrlStatus = "idle" | "loading" | "error" | "success";

export type PasteFromUrlState = {
  status: PasteFromUrlStatus;
  url: string;
  error: string;
};

export type PasteFromUrlAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "url-change"; url: string }
  | { type: "submit" }
  | { type: "submit-failed"; error: string }
  | { type: "submit-succeeded" };

export function initialPasteFromUrlState(url = ""): PasteFromUrlState {
  return { status: "idle", url, error: "" };
}

/**
 * Reduces one action into the next state.
 *
 * `submit` clears the previous error and moves to loading, so a retry never
 * shows a stale message. `submit-failed` records the message for the alert.
 * `submit-succeeded` clears the error and reports success.
 */
export function pasteFromUrlReducer(
  state: PasteFromUrlState,
  action: PasteFromUrlAction,
): PasteFromUrlState {
  switch (action.type) {
    case "open":
      return { ...state, error: "" };
    case "close":
      return { ...state, status: "idle", error: "" };
    case "url-change":
      return { ...state, url: action.url, error: "" };
    case "submit":
      return { ...state, status: "loading", error: "" };
    case "submit-failed":
      return { ...state, status: "error", error: action.error };
    case "submit-succeeded":
      return { ...state, status: "success", error: "" };
    default:
      return state;
  }
}

/**
 * Decides what a submit should do.
 *
 * An invalid URL never reaches the network: the control reports the problem
 * and stays where it is. A valid URL produces the request to send.
 */
export type PasteFromUrlSubmitDecision =
  { kind: "invalid"; error: string } | { kind: "request"; url: string };

export function decidePasteFromUrlSubmit(
  url: string,
): PasteFromUrlSubmitDecision {
  const validation = validateExtractionUrl(url);
  if (!validation.valid) {
    return { kind: "invalid", error: validation.error };
  }
  return { kind: "request", url: validation.url };
}
