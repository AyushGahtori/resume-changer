/**
 * The inclusion controls on the review screen describe real draft values, so
 * every state below is derived from the document and the applied resume — never
 * from artwork or from a sample skill inventory.
 */

/** The sections the review screen can include or exclude. */
export const REVIEW_SECTIONS = [
  "projects",
  "education",
  "credentials",
  "skills",
] as const;

export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

const SECTION_LABELS: Record<ReviewSection, string> = {
  projects: "Include Projects section",
  education: "Include education",
  credentials: "Include credentials",
  skills: "Include skills",
};

/** The visible label of a section toggle, also used as its accessible name. */
export function sectionToggleLabel(section: ReviewSection) {
  return SECTION_LABELS[section];
}

/** How many sections the current draft includes, counted out of the total. */
export function describeSectionInclusion(included: number, total: number) {
  return `${included} of ${total} sections included`;
}

export type SkillReviewState =
  | "in-current-resume"
  | "added-to-draft"
  | "removed-from-draft"
  | "does-not-fit"
  | "not-measured"
  | "available";

/**
 * The state of a single skill checkbox. `selected` is the working draft,
 * `inCurrentResume` is the applied resume the draft is compared against, and
 * `fits` reflects the measured LaTeX layout.
 */
export function resolveSkillReviewState(input: {
  selected: boolean;
  inCurrentResume: boolean;
  fits: boolean;
  unsupported: boolean;
}): SkillReviewState {
  if (input.unsupported) return "not-measured";
  if (input.selected) {
    return input.inCurrentResume ? "in-current-resume" : "added-to-draft";
  }
  if (input.inCurrentResume) return "removed-from-draft";
  if (!input.fits) return "does-not-fit";
  return "available";
}

const SKILL_STATE_BADGES: Record<SkillReviewState, string> = {
  "in-current-resume": "In resume",
  "added-to-draft": "Added",
  "removed-from-draft": "Removed",
  "does-not-fit": "No fit",
  "not-measured": "Not measured",
  available: "",
};

/** A short visible badge for the state, empty when the state needs no badge. */
export function skillReviewStateBadge(state: SkillReviewState) {
  return SKILL_STATE_BADGES[state];
}

const SKILL_STATE_DESCRIPTIONS: Record<SkillReviewState, string> = {
  "in-current-resume": "Already in the applied resume.",
  "added-to-draft": "Added in this draft.",
  "removed-from-draft": "Will be removed from the draft.",
  "does-not-fit": "Does not fit in the two skill lines.",
  "not-measured": "Could not be measured with the resume font.",
  available: "",
};

/**
 * The description a screen reader hears for the checkbox. The visible name
 * stays the skill name so the control is not renamed as it is toggled.
 */
export function skillReviewStateDescription(
  state: SkillReviewState,
  recommended = false,
) {
  const parts = [SKILL_STATE_DESCRIPTIONS[state]];
  if (recommended) parts.push("Recommended for this job.");
  return parts.filter(Boolean).join(" ");
}
