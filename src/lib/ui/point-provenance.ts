import type { AchievementSource } from "@/lib/schemas/resume-data";

/**
 * The parts of a point's source that the card shows, in the order they are
 * shown. The source type is always present. The label and the reference are
 * optional, and a missing one is left out entirely, so the row never ends up
 * with an empty segment or a separator that points at nothing.
 */
export type ProvenanceSegmentKind = "type" | "label" | "reference";

export type ProvenanceSegment = {
  kind: ProvenanceSegmentKind;
  text: string;
};

/** The separator that sits between two provenance segments. */
export const PROVENANCE_SEPARATOR = "·";

function optionalSegmentText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The provenance of one achievement point.
 *
 * Only the fields the product already stores are used. Nothing about the
 * local file, the data folder, or any other path is added here, so the row
 * can never expose a location the user did not put in the library.
 */
export function buildProvenanceSegments(
  source: AchievementSource,
): ProvenanceSegment[] {
  const segments: ProvenanceSegment[] = [{ kind: "type", text: source.type }];
  const label = optionalSegmentText(source.label);
  if (label) {
    segments.push({ kind: "label", text: label });
  }
  const reference = optionalSegmentText(source.reference);
  if (reference) {
    segments.push({ kind: "reference", text: reference });
  }
  return segments;
}

/**
 * The provenance row as plain text, with a separator between the segments
 * that are present. A source without a label and without a reference reads
 * as the source type on its own, without a trailing separator.
 */
export function formatProvenance(source: AchievementSource): string {
  return buildProvenanceSegments(source)
    .map((segment) => segment.text)
    .join(` ${PROVENANCE_SEPARATOR} `);
}
