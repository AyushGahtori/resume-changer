import { ChartColumn } from "lucide-react";
import { formatMetricValue } from "@/lib/data/achievement-metrics";
import type { Metric } from "@/lib/schemas/resume-data";

type Props = {
  metrics: Metric[];
};

/**
 * The quantified metrics of one achievement.
 *
 * Every metric keeps its own label, value, unit, evidence and context, so a
 * figure can always be traced back to the evidence that supports it. The
 * evidence stays visible in the card: it is never hidden behind a hover, and
 * the colour of a value never stands in for the evidence itself.
 */
export default function PointMetrics({ metrics }: Props) {
  if (metrics.length === 0) {
    return null;
  }

  return (
    <ul className="point-metrics" aria-label="Achievement metrics">
      {metrics.map((metric) => {
        const { value, prefix, suffix } = formatMetricValue(metric);

        return (
          <li className="point-metric" data-metric-id={metric.id} key={metric.id}>
            <span className="point-metric-icon" aria-hidden="true">
              <ChartColumn size={20} strokeWidth={2} />
            </span>
            <div className="point-metric-body">
              <p className="point-metric-label">{metric.label}</p>
              <p className="point-metric-value">
                {prefix ? (
                  <span className="point-metric-unit">{prefix}</span>
                ) : null}
                <span className="point-metric-number">{value}</span>
                {suffix ? (
                  <span className="point-metric-unit">{suffix}</span>
                ) : null}
              </p>
              <p className="point-metric-evidence">{metric.evidence}</p>
              {metric.context ? (
                <p className="point-metric-context">
                  <span className="point-metric-context-label">Context</span>{" "}
                  {metric.context}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
