import type { AchievementSelectionInput } from "../ai/contracts";
import { evidenceText } from "../ai/evidence";
import { metricIsPresent, misattributedMetrics } from "../ai/draft-quality";
import {
  includesPhrase,
  normalizeEvidence,
  semanticMatchScore,
} from "../ai/requirement-coverage";
import type { ResumeLibrary } from "../schemas/resume-data";
import type { ManualGenerationMetadata } from "./manual-generation";
import type { PdfLayout } from "../pdf/layout-analysis";

export type QualityFinding = {
  id: string;
  status: "pass" | "review" | "unavailable";
  message: string;
};
export type ResumeQualityReport = {
  machine: QualityFinding[];
  recruiter: QualityFinding[];
  credibility: QualityFinding[];
};

function terms(text: string): string[] {
  return normalizeEvidence(text)
    .split(" ")
    .filter((word) => word.length > 3 && !/^\d+$/.test(word));
}

function retention(source: string, rendered: string): number {
  const expected = [...new Set(terms(source))];
  if (!expected.length) return 1;
  const actual = new Set(terms(rendered));
  return expected.filter((word) => actual.has(word)).length / expected.length;
}

function numbers(text: string): Set<string> {
  return new Set(
    [
      ...text.matchAll(/\b\d+(?:[.,]\d+)*(?:k|m)?\b|\b\d+(?:[.,]\d+)*\s*%/gi),
    ].map(([value]) => value.toLowerCase().replace(/[,\s]/g, "")),
  );
}

function renderedMonth(date: string): string {
  const [year, month] = date.split("-");
  const shortMonths = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${shortMonths[Number(month) - 1]} ${year}`;
}

function finding(
  id: string,
  passed: boolean,
  passMessage: string,
  reviewMessage: string,
): QualityFinding {
  return {
    id,
    status: passed ? "pass" : "review",
    message: passed ? passMessage : reviewMessage,
  };
}

/** Advisory checks on the actual extracted PDF and its source provenance. */
export function assessResumeQuality(args: {
  library: ResumeLibrary;
  input: AchievementSelectionInput;
  metadata: ManualGenerationMetadata;
  pdfText?: string;
  topThirdText?: string;
  layout?: PdfLayout;
}): ResumeQualityReport {
  const { library, input, metadata, pdfText, topThirdText, layout } = args;
  const machine: QualityFinding[] = [];
  const recruiter: QualityFinding[] = [];
  const credibility: QualityFinding[] = [];
  const bulletById = new Map(input.achievements.map((item) => [item.id, item]));
  const selected = metadata.generatedBullets;

  if (!pdfText?.trim()) {
    machine.push({
      id: "pdf-extraction",
      status: "unavailable",
      message:
        "PDF text extraction was unavailable; machine readability is unverified.",
    });
  } else {
    const expectedIdentity = [
      library.profile.fullName,
      library.profile.email,
    ].filter((value): value is string => Boolean(value));
    machine.push(
      finding(
        "identity",
        expectedIdentity.every((value) => includesPhrase(pdfText, value)),
        "Name and available email are readable in the PDF text.",
        "Name or email was not recovered from the PDF text. Check the exported file.",
      ),
    );
    const groups = new Set(
      selected.flatMap((bullet) =>
        bullet.sourceAchievementIds.map((id) => bulletById.get(id)?.groupId),
      ),
    );
    const labels = [
      ...library.jobs
        .filter((job) => groups.has(job.id))
        .flatMap((job) => [job.title, job.company]),
      ...library.projects
        .filter((project) => groups.has(project.id))
        .map((project) => project.name),
    ];
    machine.push(
      finding(
        "roles",
        labels.every((label) => includesPhrase(pdfText, label)),
        "Selected role and project labels are readable in the PDF text.",
        "A selected role, employer, or project label was not recovered from the PDF.",
      ),
    );
    const sections = [
      ...(library.jobs.some((job) => groups.has(job.id)) ? ["Experience"] : []),
      ...(library.projects.some((project) => groups.has(project.id))
        ? ["Projects"]
        : []),
    ];
    machine.push(
      finding(
        "section-headings",
        sections.every((heading) => includesPhrase(pdfText, heading)),
        "Selected experience and project headings are recoverable from the PDF.",
        "A selected section heading was not recovered from the PDF text.",
      ),
    );
    const selectedJobDates = library.jobs
      .filter((job) => groups.has(job.id))
      .flatMap((job) => [
        renderedMonth(job.startDate),
        ...(job.endDate === null
          ? ["Present"]
          : job.endDate
            ? [renderedMonth(job.endDate)]
            : []),
      ]);
    machine.push(
      finding(
        "dates",
        selectedJobDates.every((date) => includesPhrase(pdfText, date)),
        "Selected experience dates are recoverable from the PDF.",
        "An experience date was not recovered from the PDF text.",
      ),
    );
    const skills = input.skills.filter((skill) =>
      metadata.renderedSkillIds.includes(skill.id),
    );
    machine.push(
      finding(
        "skills",
        skills.every((skill) => includesPhrase(pdfText, skill.name)),
        "Rendered skills are readable in the PDF text.",
        "At least one rendered skill was not recovered from the PDF text.",
      ),
    );
    if (metadata.finalCoverage) {
      const supportedRequired = metadata.finalCoverage.filter(
        (row) => row.priority === "required" && row.status === "supported",
      );
      machine.push(
        finding(
          "required-terms",
          supportedRequired.every((row) =>
            row.facets.every((facet) =>
              facet.alternatives.some((alias) =>
                includesPhrase(pdfText, alias),
              ),
            ),
          ),
          "Terms behind supported required qualifications are recoverable from the PDF.",
          "A required qualification is marked supported but one of its terms is missing from the extracted PDF.",
        ),
      );
    }
    machine.push(
      finding(
        "bullets",
        selected.every((bullet) => retention(bullet.text, pdfText) >= 0.8),
        "Selected achievement wording is recoverable from the PDF.",
        "Some achievement wording is missing or unreadable in the extracted PDF text.",
      ),
    );
    const renderedMetrics = selected.flatMap((bullet) =>
      bullet.sourceAchievementIds
        .map((id) => bulletById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .flatMap((source) => source.metrics ?? [])
        .filter((metric) => metricIsPresent(bullet.text, metric))
        .map((metric) => metric.value),
    );
    machine.push(
      finding(
        "metrics",
        renderedMetrics.every((value) => includesPhrase(pdfText, value)),
        "Selected measured results are recoverable from the PDF.",
        "A measured result from a selected bullet was not recovered from the PDF.",
      ),
    );
    const namePosition = normalizeEvidence(pdfText).indexOf(
      normalizeEvidence(library.profile.fullName),
    );
    const firstRole = labels[0]
      ? normalizeEvidence(pdfText).indexOf(normalizeEvidence(labels[0]))
      : -1;
    machine.push(
      finding(
        "reading-order",
        namePosition >= 0 && (firstRole < 0 || namePosition < firstRole),
        "The PDF text begins with identity before selected experience.",
        "PDF text order should be checked; identity did not precede selected experience.",
      ),
    );
  }
  if (layout) {
    machine.push(
      finding(
        "page-layout",
        layout.pageCount === 1 && !layout.clipped,
        "The PDF occupies one unclipped page.",
        "The PDF has a second page or clipped content.",
      ),
    );
  }

  const priorityRequirements = [
    ...input.analysis.requiredQualifications,
    ...input.analysis.responsibilities,
  ];
  const opening = selected.slice(0, 3);
  recruiter.push(
    finding(
      "opening-relevance",
      !priorityRequirements.length ||
        opening.some((bullet) =>
          priorityRequirements.some(
            (requirement) => semanticMatchScore(bullet.text, requirement) > 0,
          ),
        ),
      "An opening achievement addresses a key job requirement.",
      "Put a strongly job-relevant accomplishment among the opening bullets.",
    ),
  );
  recruiter.push(
    topThirdText?.trim()
      ? finding(
          "top-third-relevance",
          !priorityRequirements.length ||
            opening.some(
              (bullet) =>
                retention(bullet.text, topThirdText) >= 0.65 &&
                priorityRequirements.some(
                  (requirement) =>
                    semanticMatchScore(bullet.text, requirement) > 0,
                ),
            ),
          "The visible top third contains job-relevant evidence.",
          "The visible top third lacks evidence for the priority job requirements.",
        )
      : {
          id: "top-third-relevance",
          status: "unavailable",
          message:
            "The visible top third could not be checked from PDF positions.",
        },
  );
  recruiter.push(
    finding(
      "opening-substance",
      opening.every((bullet) => terms(bullet.text).length >= 12),
      "Opening bullets contain enough detail to explain the work.",
      "An opening bullet is very short; check its task, method, and result.",
    ),
  );
  recruiter.push(
    finding(
      "summary",
      Boolean(metadata.resumeSummary?.trim()) &&
        terms(metadata.resumeSummary ?? "").length >= 12,
      "The summary provides a substantive opening statement.",
      "Review the summary for a clear target role and specific accomplishment.",
    ),
  );
  const repetition = opening.some((bullet, index) =>
    opening.slice(index + 1).some((other) => {
      const first = new Set(terms(bullet.text));
      const second = new Set(terms(other.text));
      return (
        first.size > 0 &&
        [...first].filter((term) => second.has(term)).length /
          Math.min(first.size, second.size) >
          0.8
      );
    }),
  );
  recruiter.push(
    finding(
      "distinct-achievements",
      !repetition,
      "Opening bullets present distinct evidence.",
      "Opening bullets repeat much of the same wording; consider a different achievement.",
    ),
  );

  for (const bullet of selected) {
    const sources = bullet.sourceAchievementIds
      .map((id) => bulletById.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const sourceText = sources.map(evidenceText).join(" ");
    const unsupportedNumbers = [...numbers(bullet.text)].filter(
      (number) => !numbers(sourceText).has(number),
    );
    const missingMetrics = sources
      .flatMap((source) => source.metrics ?? [])
      .filter((metric) => !metricIsPresent(bullet.text, metric));
    credibility.push(
      finding(
        `claim-${bullet.achievementId}`,
        sources.length === bullet.sourceAchievementIds.length &&
          !unsupportedNumbers.length &&
          !misattributedMetrics(bullet.text, sources).length &&
          !missingMetrics.length,
        `Bullet ${bullet.achievementId} retains its source facts and recorded metrics.`,
        `Review bullet ${bullet.achievementId}: ${
          [
            unsupportedNumbers.length ? "number absent from its sources" : "",
            missingMetrics.length ? "recorded metric absent or unclear" : "",
            sources.length !== bullet.sourceAchievementIds.length
              ? "source ID missing"
              : "",
          ]
            .filter(Boolean)
            .join("; ") || "metric meaning or attribution needs confirmation"
        }.`,
      ),
    );
    if (bullet.inferredTerms?.length)
      credibility.push({
        id: `inference-${bullet.achievementId}`,
        status: "review",
        message: `Confirm inferred ${bullet.inferredTerms.join(", ")} use in bullet ${bullet.achievementId} before applying.`,
      });
  }
  const summaryNumbers = [...numbers(metadata.resumeSummary ?? "")].filter(
    (number) =>
      !numbers(
        selected
          .flatMap((bullet) => bullet.sourceAchievementIds)
          .map((id) => bulletById.get(id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map(evidenceText)
          .join(" "),
      ).has(number),
  );
  credibility.push(
    finding(
      "summary-numbers",
      !summaryNumbers.length,
      "Numbers in the summary occur in selected source evidence.",
      "The summary contains a number absent from selected source evidence.",
    ),
  );
  return { machine, recruiter, credibility };
}
