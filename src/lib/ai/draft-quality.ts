import type { AchievementEvidence, ResumeDraftInput } from "./contracts";
import type { Metric } from "../schemas/resume-data";
import { includesPhrase, normalizeEvidence } from "./requirement-coverage";

export function formatMetric(metric: Metric) {
  const label = metric.label.toLowerCase().replace(/-/g, " ");
  const value = `${metric.value}${metric.unit === "%" ? "%" : ""}`;
  if (/reduction/.test(label))
    return `${value} lower ${label.replace(/\s*reduction\s*/g, "").trim()}`;
  if (/improvement/.test(label))
    return `${value} better ${label.replace(/\s*improvement\s*/g, "").trim()}`;
  if (/increase/.test(label))
    return `${value} higher ${label.replace(/\s*increase\s*/g, "").trim()}`;
  if (/share of/.test(label) && metric.unit === "%")
    return `${value} of ${label.replace(/^share of\s*/, "")}`;
  if (/calls handled/.test(label))
    return `${metric.value} ${metric.unit ?? "calls"}`;
  if (/average response time/.test(label))
    return `${metric.value} ${metric.unit ?? "seconds"} average response time`;
  if (/uptime/.test(label)) return `${value} ${label}`;
  if (/viewers/.test(label))
    return `${metric.value} ${metric.unit ?? "monthly viewers"}`;
  return `${label} of ${metric.value}${metric.unit === "%" ? "%" : metric.unit ? ` ${metric.unit}` : ""}`;
}

export function metricIsPresent(text: string, metric: Metric) {
  const normalized = normalizeEvidence(text);
  const value = normalizeEvidence(metric.value);
  const numeric = metric.value.replace(/,/g, "").toLowerCase();
  const expanded = numeric.match(/^(\d+(?:\.\d+)?)k\+?$/);
  const values = [
    value,
    ...(expanded ? [String(Number(expanded[1]) * 1000)] : []),
  ];
  const valuePresent = values.some((v) => includesPhrase(normalized, v));
  const labels = normalizeEvidence(metric.label)
    .split(" ")
    .filter(
      (word) =>
        word.length > 3 &&
        ![
          "improvement",
          "reduction",
          "increase",
          "average",
          "platform",
        ].includes(word),
    );
  const contextPresent =
    labels.length === 0 || labels.some((label) => normalized.includes(label));
  const unitPresent =
    metric.unit === "%"
      ? new RegExp(
          `${metric.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:%|percent)`,
          "i",
        ).test(text)
      : !metric.unit ||
        metric.unit
          .toLowerCase()
          .split(/\s+/)
          .some(
            (unit) =>
              unit.length > 2 && normalized.includes(normalizeEvidence(unit)),
          );
  return valuePresent && contextPresent && unitPresent;
}

export function misattributedMetrics(
  text: string,
  sources: AchievementEvidence[],
) {
  return sources
    .flatMap((source) => source.metrics ?? [])
    .filter(
      (metric) =>
        includesPhrase(text, metric.value) && !metricIsPresent(text, metric),
    );
}

export function enrichSourceText(source: AchievementEvidence) {
  return preserveMetrics(source.text, [source]).text;
}

export function preserveMetrics(text: string, sources: AchievementEvidence[]) {
  const missing = sources
    .flatMap((source) => source.metrics ?? [])
    .filter((metric) => !metricIsPresent(text, metric));
  const result = missing.length
    ? `${text.replace(/[.;\s]+$/, "")}, with ${missing.map(formatMetric).join(" and ")}.`
    : text;
  return {
    text: result,
    restoredMetricIds: missing.map((metric) => metric.id),
  };
}

export function canSynthesize(sources: AchievementEvidence[]) {
  if (sources.length < 2) return true;
  if (new Set(sources.map((s) => `${s.section}:${s.groupId}`)).size !== 1)
    return false;
  const initiatives = sources.map((s) => s.initiativeId);
  if (initiatives.every(Boolean)) return new Set(initiatives).size === 1;
  if (initiatives.some(Boolean)) return false;
  const stop = new Set(
    "built developed improved implemented engineered worked designed using with from that into system systems platform backend performance tools services project".split(
      " ",
    ),
  );
  const first = normalizeEvidence(sources[0].text)
    .split(" ")
    .filter((word) => word.length > 3 && !stop.has(word));
  return sources
    .slice(1)
    .every(
      (source) =>
        first.filter((word) => includesPhrase(source.text, word)).length >= 2,
    );
}

export function preserveSubstance(
  text: string,
  sources: AchievementEvidence[],
) {
  const original = sources.map((source) => source.text).join(" ");
  const sourceWords = original.split(/\s+/).length;
  const outputWords = text.split(/\s+/).length;
  const lostSpecifics = [
    "CPU throttling",
    "memory leaks",
    "I/O bottlenecks",
  ].filter(
    (term) => includesPhrase(original, term) && !includesPhrase(text, term),
  );
  const actionWords = new Set(
    "developed implemented engineered designed optimized led built migrated configured authored collaborated integrated worked fixed applied introduced standardized provisioned automated created packaged delivered redesigned added modernized improved used trained evaluated analyzed deployed reduced increased boosted enhanced supported maintained managed contributed organized documented secured established streamlined launched enabled normalized validated the our new existing".split(
      " ",
    ),
  );
  const aliases: Record<string, string[]> = {
    JavaScript: ["JS"],
    TypeScript: ["TS"],
    TensorFlow: ["TF"],
    RESTful: ["REST"],
    Node: ["Node.js", "Nodejs"],
    APIs: ["API"],
    LLMs: ["LLM", "large language models"],
  };
  const namedFacts = [
    ...new Set(original.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? []),
  ].filter(
    (name) => /[a-z]/.test(name) && !actionWords.has(name.toLowerCase()),
  );
  const lostNames = namedFacts.filter(
    (name) =>
      ![name, ...(aliases[name] ?? [])].some((alias) =>
        includesPhrase(text, alias),
      ),
  );
  const tooShort =
    sourceWords >= 12 &&
    outputWords < sourceWords * (sources.length > 1 ? 0.55 : 0.75);
  if (!tooShort && !lostSpecifics.length && !lostNames.length)
    return { text, restored: false };
  return {
    text:
      sources.map((source) => source.text.replace(/\.$/, "")).join("; ") + ".",
    restored: true,
  };
}

export function buildEvidenceSummary(
  input: Pick<
    ResumeDraftInput,
    "achievements" | "analysis" | "skills" | "profile"
  >,
) {
  const skills = (input.skills ?? [])
    .filter(
      (s) =>
        s.isListedOnCurrentResume &&
        input.analysis.toolsAndPlatforms.some((term) =>
          includesPhrase([s.name, ...s.aliases].join(" "), term),
        ),
    )
    .slice(0, 4)
    .map((s) => s.name);
  const metrics = input.achievements
    .flatMap((source) =>
      (source.metrics ?? []).map((metric) => ({ metric, source })),
    )
    .slice(0, 3);
  const role =
    input.profile?.headline ??
    input.achievements.find((source) => source.section === "experience")
      ?.groupTitle ??
    "Project contributor";
  const opening = skills.length
    ? `${role} with skills in ${skills.join(", ")}.`
    : "";
  if (metrics.length)
    return `${opening} Achievements include ${metrics.map(({ metric, source }) => `${formatMetric(metric)} (${source.groupSubtitle ?? source.groupTitle})`).join("; ")}.`.trim();
  const strongest = [...input.achievements].sort(
    (a, b) => b.text.length - a.text.length,
  )[0];
  return `${opening} ${strongest?.text ?? ""}`.trim();
}
