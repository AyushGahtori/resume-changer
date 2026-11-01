"use client";

import { useState } from "react";
import type { ProjectContext } from "../../../lib/github/context-interview";
import { ContextInterview } from "./context-interview";
import { createEngineInterviewPort } from "./engine-port";
import type { ContextRevisionEvent } from "./types";

/** Hydrate when setup is opened, after the tab-owned import has been restored. */
export function EngineInterview({
  initialContext,
  onChange,
  onRevision,
}: {
  initialContext?: ProjectContext;
  onChange(context: ProjectContext, complete: boolean): void;
  onRevision(event: ContextRevisionEvent): void;
}) {
  const [port] = useState(() =>
    createEngineInterviewPort(onChange, initialContext),
  );
  return <ContextInterview port={port} onContextRevisionChange={onRevision} />;
}
