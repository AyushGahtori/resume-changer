import type { AnalysisSignal } from "@/lib/ui/analysis-preview-model";

export function AnalysisSignalRows({ signals }: { signals: AnalysisSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <ul
      className="analysis-signals"
      aria-label="Job description analysis signals"
    >
      {signals.map(({ key, status, label }) => (
        <li className={`analysis-signal is-${status}`} key={key}>
          <span className="analysis-signal-icon" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {status === "success" ? (
                <path d="m4 8 2.5 2.5L12 5" />
              ) : status === "attention" ? (
                <>
                  <path d="M8 4v5" />
                  <circle
                    cx="8"
                    cy="12"
                    r=".8"
                    fill="currentColor"
                    stroke="none"
                  />
                </>
              ) : (
                <>
                  <path d="M8 7v5" />
                  <circle
                    cx="8"
                    cy="4"
                    r=".8"
                    fill="currentColor"
                    stroke="none"
                  />
                </>
              )}
            </svg>
          </span>
          <span className="analysis-signal-label">{label}</span>
        </li>
      ))}
    </ul>
  );
}
