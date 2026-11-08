"use client";

import { useMemo, useState } from "react";
import { ContextInterview } from "../context-interview";
import { createEngineInterviewPort } from "../engine-port";
import type { ContextRevisionEvent } from "../types";
import {
  createScriptedContextInterviewPort,
  type ScriptedRouteLength,
} from "./scripted-port";
import styles from "./harness.module.css";

export type InterviewHarnessProps = {
  routeLength: ScriptedRouteLength;
  delayMs?: number;
  failCalls?: number;
  dropNextAnswerResponse?: boolean;
  initialPhase?: "active" | "empty" | "expired";
  useEngine?: boolean;
};

export function ContextInterviewHarness({
  routeLength,
  delayMs,
  failCalls,
  dropNextAnswerResponse,
  initialPhase,
  useEngine = false,
}: InterviewHarnessProps) {
  const fixture = useMemo(
    () =>
      createScriptedContextInterviewPort({
        routeLength,
        delayMs,
        failCalls,
        dropNextAnswerResponse,
        initialPhase,
      }),
    [routeLength, delayMs, failCalls, dropNextAnswerResponse, initialPhase],
  );
  const enginePort = useMemo(
    () => (useEngine ? createEngineInterviewPort(() => undefined) : null),
    [useEngine],
  );
  const [events, setEvents] = useState<ContextRevisionEvent[]>([]);

  return (
    <main className={styles.page}>
      <div className={styles.fixtureNote}>
        Scripted local fixture only. No repository, provider, or persistence
        calls.
      </div>
      <ContextInterview
        port={enginePort ?? fixture.port}
        onContextRevisionChange={(event) =>
          setEvents((current) => [...current, event])
        }
      />
      <output
        className={styles.debug}
        data-testid="context-interview-fixture-state"
        data-provider-call-count={fixture.providerCallCount()}
        data-answer-submission-count={fixture.answerSubmissionCount()}
        data-revision-event-count={events.length}
        data-latest-context-revision={events.at(-1)?.revision ?? 0}
      >
        Fixture provider calls: {fixture.providerCallCount()}
      </output>
    </main>
  );
}
