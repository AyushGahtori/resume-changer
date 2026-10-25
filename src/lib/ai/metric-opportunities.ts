import type { AchievementPoint } from "../schemas/resume-data";

export type MetricOpportunity = {
  id: string;
  label: string;
  question: string;
  evidenceHint: string;
};

const OPPORTUNITIES: Array<MetricOpportunity & { pattern: RegExp }> = [
  {
    id: "model-quality",
    label: "Model quality",
    question:
      "Was accuracy, F1, precision, recall, or another model result measured before and after this work?",
    evidenceHint:
      "Record the dataset, evaluation method, baseline, final value, and where the result is documented.",
    pattern:
      /\b(model|classifier|cnn|training|prediction|machine learning|ml)\b/i,
  },
  {
    id: "performance",
    label: "Performance",
    question:
      "Did latency, throughput, error rate, uptime, or infrastructure cost change?",
    evidenceHint:
      "Record the measurement window, before/after values, units, and a benchmark or dashboard reference.",
    pattern:
      /\b(api|server|pipeline|backend|latency|performance|deployment|container|cloud)\b/i,
  },
  {
    id: "time-saved",
    label: "Time saved",
    question: "How much manual work or processing time did this change remove?",
    evidenceHint:
      "Record the old and new process time, frequency, affected team, and supporting notes.",
    pattern: /\b(automat|streamlin|migrat|workflow|manual|integrat)/i,
  },
  {
    id: "scale",
    label: "Scale or reach",
    question:
      "How many users, requests, records, documents, or teams did this work serve?",
    evidenceHint:
      "Record the count, timeframe, what was counted, and the report or project source.",
    pattern:
      /\b(user|request|dataset|record|document|team|customer|service|system|platform|project)\b/i,
  },
];

/** Suggest questions only; no numerical claim is generated or saved. */
export function metricOpportunities(
  point: Pick<AchievementPoint, "text" | "context" | "metrics">,
): MetricOpportunity[] {
  const text = [point.text, point.context].filter(Boolean).join(" ");
  const existing = point.metrics.map((metric) =>
    `${metric.label} ${metric.context ?? ""}`.toLowerCase(),
  );
  return OPPORTUNITIES.filter(
    (opportunity) =>
      opportunity.pattern.test(text) &&
      !existing.some((label) =>
        label.includes(opportunity.label.toLowerCase()),
      ),
  )
    .slice(0, 3)
    .map(({ id, label, question, evidenceHint }) => ({
      id,
      label,
      question,
      evidenceHint,
    }));
}
