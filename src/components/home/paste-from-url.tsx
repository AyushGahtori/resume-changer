"use client";

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { Link2, LoaderCircle } from "lucide-react";
import { requestJobDescriptionExtraction } from "@/lib/jd-url-extraction";
import {
  decidePasteFromUrlSubmit,
  initialPasteFromUrlState,
  pasteFromUrlReducer,
} from "@/lib/paste-from-url-state";

export type PasteFromUrlProps = {
  /**
   * Whether the approved extraction service is available. The server resolves
   * this; when it is false the control renders nothing at all, so the page
   * never shows a button that cannot work.
   */
  available: boolean;
  /**
   * Replaces the current job description with the extracted text. The parent
   * owns the draft, so this callback must only run after a successful
   * extraction.
   */
  onExtracted: (text: string) => void;
  /**
   * The URL the user has already entered in the Job link field, used to
   * pre-fill the entry field.
   */
  jobUrl?: string;
};

/**
 * The optional "Paste from URL" action for the job-description editor.
 *
 * Task 17 of the home page UI plan allows this control to exist only when an
 * approved extraction service is available. The server decides that, and this
 * component renders nothing while it is unavailable, so the browser never
 * issues a request for a user-supplied URL.
 *
 * The URL entry, loading, error, and success states are implemented so that
 * enabling the service is a server-side change rather than new UI work, and
 * so those states are covered by tests. The transitions live in
 * `src/lib/paste-from-url-state.ts` so they can be tested without a DOM.
 */
export default function PasteFromUrl({
  available,
  onExtracted,
  jobUrl = "",
}: PasteFromUrlProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, dispatch] = useReducer(
    pasteFromUrlReducer,
    jobUrl,
    initialPasteFromUrlState,
  );
  const inputId = useId();
  const messageId = useId();
  const panelId = useId();
  const seededJobUrl = useRef(jobUrl);

  // The draft is restored from local storage after this component mounts, so
  // the job link the user already saved arrives as a prop update. Seed the
  // entry field once, when that link first becomes known, and never overwrite
  // a URL the user has typed themselves.
  useEffect(() => {
    if (!jobUrl || seededJobUrl.current) return;
    seededJobUrl.current = jobUrl;
    dispatch({ type: "url-change", url: jobUrl });
  }, [jobUrl]);

  if (!available) return null;

  async function handleSubmit() {
    const decision = decidePasteFromUrlSubmit(state.url);
    if (decision.kind === "invalid") {
      dispatch({ type: "submit-failed", error: decision.error });
      return;
    }

    dispatch({ type: "submit" });

    const result = await requestJobDescriptionExtraction(decision.url);
    if (!result.ok) {
      dispatch({ type: "submit-failed", error: result.error });
      return;
    }

    onExtracted(result.jobDescription);
    dispatch({ type: "submit-succeeded" });
  }

  function handleCancel() {
    setIsOpen(false);
    dispatch({ type: "close" });
  }

  return (
    <div className="paste-from-url">
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        className="paste-from-url-trigger"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <Link2 aria-hidden="true" size={16} />
        <span>Paste from URL</span>
      </button>
      {isOpen && (
        <div className="paste-from-url-panel" id={panelId}>
          {/*
            The JD workspace is already a <form>, and HTML forbids nesting a
            form inside one, so this uses a div with an explicit submit
            handler instead of a nested <form>.
          */}
          <div className="paste-from-url-form">
            <label className="paste-from-url-label" htmlFor={inputId}>
              Job description link
            </label>
            <input
              aria-describedby={state.error ? messageId : undefined}
              aria-invalid={Boolean(state.error)}
              autoComplete="url"
              className="paste-from-url-input"
              id={inputId}
              inputMode="url"
              onChange={(event) =>
                dispatch({ type: "url-change", url: event.target.value })
              }
              placeholder="https://"
              value={state.url}
            />
            <button
              aria-busy={state.status === "loading"}
              className="paste-from-url-submit"
              disabled={state.status === "loading"}
              type="button"
              onClick={handleSubmit}
            >
              {state.status === "loading" ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="home-action-spinner"
                    size={16}
                  />
                  <span>Fetching...</span>
                </>
              ) : (
                <span>Fetch</span>
              )}
            </button>
            <button
              className="paste-from-url-cancel"
              onClick={handleCancel}
              type="button"
            >
              Cancel
            </button>
          </div>
          {state.error && (
            <p
              className="paste-from-url-message is-error"
              id={messageId}
              role="alert"
            >
              {state.error}
            </p>
          )}
          {state.status === "success" && !state.error && (
            <p className="paste-from-url-message" id={messageId} role="status">
              Job description replaced from the link.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
