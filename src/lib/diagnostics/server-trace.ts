export type DiagnosticEvent = {
  timestamp: string;
  stage: string;
  message: string;
  data?: unknown;
};

export function createServerTrace() {
  const events: DiagnosticEvent[] = [];
  return {
    events,
    record(stage: string, message: string, data?: unknown) {
      events.push({
        timestamp: new Date().toISOString(),
        stage,
        message,
        data,
      });
    },
  };
}

export type DiagnosticObserver = (event: DiagnosticEvent) => void;
