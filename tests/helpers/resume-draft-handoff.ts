export function createResumeDraftHandoff(args: {
  achievementId: string;
  text: string;
  job?: {
    company: string;
    roleTitle: string;
    jobUrl: string;
    contextId: string;
  };
  groupId?: string;
  groupTitle?: string;
  linkedSkills?: string[];
}) {
  return {
    job: args.job ?? {
      company: "Example Systems",
      roleTitle: "Platform Engineer",
      jobUrl: "",
      contextId: "a".repeat(64),
    },
    requirements: [],
    selectedAchievements: [
      {
        achievementId: args.achievementId,
        text: args.text,
        section: "experience" as const,
        groupId: args.groupId ?? "job-platform",
        groupTitle: args.groupTitle ?? "Platform Engineer",
        linkedSkills: args.linkedSkills ?? [],
        supportedRequirementIds: [],
        selectionConfidence: 0.9,
      },
    ],
    suggestedEvidence: [],
    contentBudgetLines: 24,
  };
}
