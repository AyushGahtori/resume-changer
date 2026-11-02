import {
  PROJECT_CONTEXT_VERSION,
  QuestionCatalogSchema,
  type CandidateNext,
  type FactContribution,
  type FactField,
  type InformationTarget,
  type QuestionNode,
  type QuestionOption,
} from "./types";

type ChoiceDraft = {
  id: string;
  label: string;
  facts?: FactContribution[];
};

type NodeDraft = {
  id: string;
  prompt: string;
  reason: string;
  informationTargets: InformationTarget[];
  selectionMode: "single" | "multiple";
  options: [ChoiceDraft, ChoiceDraft, ChoiceDraft, ChoiceDraft];
  customTarget?: FactField;
  phase: "setup" | "branch" | "wrap-up" | "follow-up";
  priority: number;
  branchGroup?: string;
  branchAreaOptionId?: string;
  terminal?: boolean;
};

const fact = (field: FactField, value: string): FactContribution => ({
  field,
  value,
});

const choice = (
  id: string,
  label: string,
  facts: FactContribution[] = [],
): ChoiceDraft => ({ id, label, facts });

const makeNode = (
  draft: NodeDraft,
  edges: CandidateNext[] = [],
): QuestionNode => {
  const options: QuestionOption[] = [
    ...draft.options.map((option) => ({
      id: option.id,
      label: option.label,
      kind: "choice" as const,
      facts: option.facts ?? [],
    })),
    {
      id: "custom",
      label: "Something else — add your own short answer",
      kind: "custom",
      facts: [],
    },
  ];

  return {
    ...draft,
    terminal: draft.terminal ?? edges.length === 0,
    edges,
    options,
  };
};

const edge = (to: string, when: CandidateNext["when"] = []): CandidateNext => ({
  to,
  when,
});

const selectedAny = (
  nodeId: string,
  optionIds: string[],
): CandidateNext["when"][number] => ({
  op: "selected-any",
  nodeId,
  optionIds,
});

const sharedNodes: QuestionNode[] = [
  makeNode(
    {
      id: "project.purpose",
      prompt: "What is this project mainly for?",
      reason:
        "A short project description keeps the product's purpose separate from your personal role.",
      informationTargets: ["primary-kind", "project-purpose"],
      selectionMode: "single",
      customTarget: "projectPurpose",
      phase: "setup",
      priority: 10,
      options: [
        choice("product", "A product or application for people to use", [
          fact("primaryKind", "product"),
          fact("projectPurpose", "A product or application for people to use"),
        ]),
        choice("developer-tool", "A developer tool, library, or platform", [
          fact("primaryKind", "developer-tool"),
          fact("projectPurpose", "A developer tool, library, or platform"),
        ]),
        choice("backend-service", "A backend service, API, or automation", [
          fact("primaryKind", "backend-service"),
          fact("projectPurpose", "A backend service, API, or automation"),
        ]),
        choice("data-ai-system", "A data, AI, or machine-learning system", [
          fact("primaryKind", "data-ai-system"),
          fact("projectPurpose", "A data, AI, or machine-learning system"),
        ]),
      ],
    },
    [edge("project.areas")],
  ),
  makeNode(
    {
      id: "project.areas",
      prompt: "Which areas or capabilities are part of it?",
      reason:
        "Project areas may overlap, so this question accepts more than one answer.",
      informationTargets: ["secondary-tags", "confirmed-capabilities"],
      selectionMode: "multiple",
      customTarget: "confirmedCapabilities",
      phase: "setup",
      priority: 20,
      options: [
        choice("web-mobile", "Web or mobile experiences", [
          fact("secondaryTags", "web-mobile"),
          fact("confirmedCapabilities", "Web or mobile experiences"),
        ]),
        choice("ai-ml-data", "AI, machine learning, or data work", [
          fact("secondaryTags", "ai-ml-data"),
          fact("confirmedCapabilities", "AI, machine learning, or data work"),
        ]),
        choice("backend-automation", "Backend services or automation", [
          fact("secondaryTags", "backend-automation"),
          fact("confirmedCapabilities", "Backend services or automation"),
        ]),
        choice("developer-tools", "Developer tools or platform work", [
          fact("secondaryTags", "developer-tools"),
          fact("confirmedCapabilities", "Developer tools or platform work"),
        ]),
      ],
    },
    [edge("project.ownership")],
  ),
  makeNode(
    {
      id: "project.ownership",
      prompt: "How would you describe your ownership of the project?",
      reason: "Project presence alone does not establish personal authorship.",
      informationTargets: ["ownership", "contribution-details"],
      selectionMode: "single",
      customTarget: "contributionDetails",
      phase: "setup",
      priority: 30,
      options: [
        choice("whole-project", "I built the whole project", [
          fact("ownership", "whole-project"),
        ]),
        choice("selected-areas", "I owned selected areas", [
          fact("ownership", "selected-areas"),
        ]),
        choice("shared", "The work was shared with others", [
          fact("ownership", "shared"),
        ]),
        choice("unsure", "I'm unsure how to describe my ownership", [
          fact("ownership", "unsure"),
        ]),
      ],
    },
    [edge("project.collaboration")],
  ),
  makeNode(
    {
      id: "project.collaboration",
      prompt: "How did you work with other people?",
      reason:
        "Solo and team context helps keep later contribution statements precise.",
      informationTargets: ["collaboration"],
      selectionMode: "single",
      customTarget: "contributionDetails",
      phase: "setup",
      priority: 40,
      options: [
        choice("solo", "I worked solo", [fact("collaboration", "solo")]),
        choice("team", "I worked with a team", [fact("collaboration", "team")]),
        choice("mixed", "Some work was solo and some was collaborative", [
          fact("collaboration", "mixed"),
        ]),
        choice("prefer-not-to-say", "I prefer not to say", [
          fact("collaboration", "prefer-not-to-say"),
        ]),
      ],
    },
    [
      edge("project.contribution-scope", [
        selectedAny("project.ownership", [
          "selected-areas",
          "shared",
          "unsure",
        ]),
      ]),
      edge("project.intended-users"),
    ],
  ),
  makeNode(
    {
      id: "project.contribution-scope",
      prompt: "Which parts did you personally contribute to?",
      reason:
        "This gives selected or shared ownership a concrete scope without requiring an essay.",
      informationTargets: ["contributed-areas", "contribution-details"],
      selectionMode: "multiple",
      customTarget: "contributionDetails",
      phase: "setup",
      priority: 58,
      options: [
        choice("designed-implemented", "I designed and implemented parts", [
          fact("contributedAreas", "design-and-implementation"),
          fact("contributionDetails", "Designed and implemented parts"),
        ]),
        choice(
          "implemented-spec",
          "I implemented from an existing design or spec",
          [
            fact("contributedAreas", "implementation"),
            fact(
              "contributionDetails",
              "Implemented from an existing design or spec",
            ),
          ],
        ),
        choice("led-reviewed", "I led, reviewed, or mentored work", [
          fact("contributedAreas", "leadership-review-mentoring"),
          fact("contributionDetails", "Led, reviewed, or mentored work"),
        ]),
        choice(
          "maintained-operated",
          "I maintained or operated existing work",
          [
            fact("contributedAreas", "maintenance-and-operations"),
            fact("contributionDetails", "Maintained or operated existing work"),
          ],
        ),
      ],
    },
    [edge("project.intended-users")],
  ),
  makeNode(
    {
      id: "project.intended-users",
      prompt: "Who is the project mainly for?",
      reason:
        "The intended audience clarifies what its core capabilities enable.",
      informationTargets: ["intended-users"],
      selectionMode: "multiple",
      customTarget: "intendedUsers",
      phase: "setup",
      priority: 55,
      options: [
        choice("public-users", "Customers or the general public", [
          fact("intendedUsers", "Customers or the general public"),
        ]),
        choice("internal-users", "People inside a team or organization", [
          fact("intendedUsers", "People inside a team or organization"),
        ]),
        choice("technical-users", "Developers or technical operators", [
          fact("intendedUsers", "Developers or technical operators"),
        ]),
        choice(
          "research-users",
          "Researchers, students, or another focused group",
          [
            fact(
              "intendedUsers",
              "Researchers, students, or another focused group",
            ),
          ],
        ),
      ],
    },
    [
      edge("branch.web-mobile.1", [
        selectedAny("project.areas", ["web-mobile"]),
      ]),
      edge("branch.ai-ml-data.1", [
        selectedAny("project.areas", ["ai-ml-data"]),
      ]),
      edge("branch.backend-automation.1", [
        selectedAny("project.areas", ["backend-automation"]),
      ]),
      edge("branch.developer-tools.1", [
        selectedAny("project.areas", ["developer-tools"]),
      ]),
      edge("branch.other-custom.1", [selectedAny("project.areas", ["custom"])]),
      edge("project.technical-work"),
    ],
  ),
  makeNode(
    {
      id: "project.technical-work",
      prompt: "What kind of technical work was most central?",
      reason:
        "A small number of implementation details helps connect the project to your contribution.",
      informationTargets: ["contribution-details"],
      selectionMode: "multiple",
      customTarget: "contributionDetails",
      phase: "wrap-up",
      priority: 65,
      options: [
        choice("architecture", "Architecture and component boundaries", [
          fact("contributionDetails", "Architecture and component boundaries"),
        ]),
        choice("core-feature", "A core feature or user workflow", [
          fact("contributionDetails", "A core feature or user workflow"),
        ]),
        choice("data-flow", "Data flow, persistence, or external integration", [
          fact(
            "contributionDetails",
            "Data flow, persistence, or external integration",
          ),
        ]),
        choice("testing-reliability", "Testing, reliability, or security", [
          fact("contributionDetails", "Testing, reliability, or security"),
        ]),
      ],
    },
    [
      edge("project.outcomes"),
      edge("project.quality-checks", [
        selectedAny("project.technical-work", ["testing-reliability"]),
      ]),
      edge("project.data-handling", [
        selectedAny("project.areas", ["ai-ml-data", "backend-automation"]),
      ]),
      edge("project.important-decisions", [
        selectedAny("project.technical-work", ["architecture", "data-flow"]),
      ]),
    ],
  ),
  makeNode(
    {
      id: "project.outcomes",
      prompt: "What can you say about the result, including limits?",
      reason:
        "This asks for evidence or a useful limitation without pressuring you to invent metrics.",
      informationTargets: ["outcome-evidence", "limitations"],
      selectionMode: "multiple",
      customTarget: "outcomeEvidence",
      phase: "wrap-up",
      priority: 60,
      options: [
        choice("measured", "There is a measured result with a source", [
          fact("outcomeEvidence", "A measured result is available"),
        ]),
        choice("shipped", "A useful workflow or capability was shipped", [
          fact(
            "outcomeEvidence",
            "A useful workflow or capability was shipped",
          ),
        ]),
        choice("qualitative", "There is qualitative feedback or observation", [
          fact(
            "outcomeEvidence",
            "Qualitative feedback or observation is available",
          ),
        ]),
        choice("no-reliable-result", "No reliable result is available yet", [
          fact("outcomeEvidence", "No reliable result is available yet"),
          fact("limitations", "No reliable result is available yet"),
        ]),
      ],
    },
    [
      edge("project.evidence-source", [
        selectedAny("project.outcomes", ["measured", "shipped", "qualitative"]),
      ]),
      edge("project.known-limitations", [
        selectedAny("project.outcomes", ["no-reliable-result"]),
      ]),
      edge("project.constraints", [
        selectedAny("project.ownership", [
          "selected-areas",
          "shared",
          "unsure",
        ]),
      ]),
      edge("project.future-work", [
        selectedAny("project.outcomes", ["no-reliable-result"]),
      ]),
    ],
  ),
  makeNode(
    {
      id: "project.evidence-source",
      prompt: "What could substantiate that result?",
      reason:
        "A source type helps reviewers distinguish an observed result from a planned one.",
      informationTargets: ["outcome-evidence"],
      selectionMode: "multiple",
      customTarget: "outcomeEvidence",
      phase: "follow-up",
      priority: 45,
      options: [
        choice("tests-benchmarks", "Tests, benchmark, or evaluation output", [
          fact("outcomeEvidence", "Tests, benchmark, or evaluation output"),
        ]),
        choice("usage-telemetry", "Usage or operational telemetry", [
          fact("outcomeEvidence", "Usage or operational telemetry"),
        ]),
        choice("user-feedback", "User or stakeholder feedback", [
          fact("outcomeEvidence", "User or stakeholder feedback"),
        ]),
        choice(
          "release-artifact",
          "A release, report, or documented artifact",
          [
            fact(
              "outcomeEvidence",
              "A release, report, or documented artifact",
            ),
          ],
        ),
      ],
    },
    [edge("project.known-limitations")],
  ),
  makeNode(
    {
      id: "project.known-limitations",
      prompt: "What should a reader keep in mind about the evidence?",
      reason:
        "Known uncertainty and tradeoffs stay visible instead of being turned into a stronger claim.",
      informationTargets: ["limitations"],
      selectionMode: "multiple",
      customTarget: "limitations",
      phase: "follow-up",
      priority: 42,
      options: [
        choice("small-sample", "The sample or observation window was small", [
          fact("limitations", "The sample or observation window was small"),
        ]),
        choice(
          "external-dependency",
          "An external service or dependency affected it",
          [
            fact(
              "limitations",
              "An external service or dependency affected it",
            ),
          ],
        ),
        choice("not-production", "It was not measured in production", [
          fact("limitations", "It was not measured in production"),
        ]),
        choice("unknown-limit", "The limitation is not yet clear", [
          fact("limitations", "The limitation is not yet clear"),
        ]),
      ],
    },
    [edge("project.future-work")],
  ),
  makeNode(
    {
      id: "project.constraints",
      prompt: "What constrained your part of the work?",
      reason:
        "Constraints help explain shared ownership and avoid implying control over work outside your scope.",
      informationTargets: ["limitations", "contribution-details"],
      selectionMode: "multiple",
      customTarget: "limitations",
      phase: "follow-up",
      priority: 34,
      options: [
        choice("coordination", "Coordination across people or teams", [
          fact("limitations", "Coordination across people or teams"),
        ]),
        choice("legacy-contracts", "Existing contracts or legacy behavior", [
          fact("limitations", "Existing contracts or legacy behavior"),
        ]),
        choice("time-resources", "Time, staffing, or resource limits", [
          fact("limitations", "Time, staffing, or resource limits"),
        ]),
        choice("external-control", "A dependency owned by another group", [
          fact("limitations", "A dependency owned by another group"),
        ]),
      ],
    },
    [edge("project.future-work")],
  ),
  makeNode(
    {
      id: "project.quality-checks",
      prompt: "How was quality checked for the work you described?",
      reason:
        "Validation context is useful when testing or reliability is part of the contribution.",
      informationTargets: ["contribution-details", "outcome-evidence"],
      selectionMode: "multiple",
      customTarget: "contributionDetails",
      phase: "follow-up",
      priority: 32,
      options: [
        choice("unit-integration", "Unit or integration tests", [
          fact(
            "contributionDetails",
            "Quality checked with unit or integration tests",
          ),
        ]),
        choice("manual-review", "Manual review or exploratory checks", [
          fact(
            "contributionDetails",
            "Quality checked with manual review or exploration",
          ),
        ]),
        choice("runtime-signals", "Runtime monitoring or operational signals", [
          fact(
            "contributionDetails",
            "Quality checked with runtime or operational signals",
          ),
        ]),
        choice("not-formalized", "Checks were informal or not recorded", [
          fact("limitations", "Quality checks were informal or not recorded"),
        ]),
      ],
    },
    [edge("project.future-work")],
  ),
  makeNode(
    {
      id: "project.data-handling",
      prompt: "What mattered about data or external inputs?",
      reason:
        "Data and integration boundaries often explain the real implementation work.",
      informationTargets: ["contribution-details", "limitations"],
      selectionMode: "multiple",
      customTarget: "contributionDetails",
      phase: "follow-up",
      priority: 31,
      options: [
        choice("validation", "Validation and schema boundaries", [
          fact("contributionDetails", "Validation and schema boundaries"),
        ]),
        choice("privacy", "Privacy, access, or retention", [
          fact("contributionDetails", "Privacy, access, or retention"),
        ]),
        choice("quality", "Data quality or missing inputs", [
          fact("contributionDetails", "Data quality or missing inputs"),
        ]),
        choice("external-shape", "External system behavior or format changes", [
          fact("limitations", "External system behavior or format changes"),
        ]),
      ],
    },
    [edge("project.future-work")],
  ),
  makeNode(
    {
      id: "project.important-decisions",
      prompt: "Which design decision had the biggest effect?",
      reason:
        "A concrete decision can explain your technical contribution better than a list of tools.",
      informationTargets: ["contribution-details", "limitations"],
      selectionMode: "multiple",
      customTarget: "contributionDetails",
      phase: "follow-up",
      priority: 30,
      options: [
        choice("compatibility", "Compatibility with existing behavior", [
          fact("contributionDetails", "Compatibility with existing behavior"),
        ]),
        choice("simplicity", "Keeping the design simple to maintain", [
          fact("contributionDetails", "Keeping the design simple to maintain"),
        ]),
        choice("performance", "Performance or resource use", [
          fact("contributionDetails", "Performance or resource use"),
        ]),
        choice("safety", "Security, privacy, or failure handling", [
          fact("contributionDetails", "Security, privacy, or failure handling"),
        ]),
      ],
    },
    [edge("project.future-work")],
  ),
  makeNode({
    id: "project.future-work",
    prompt: "What remains uncertain or would you improve next?",
    reason:
      "A forward-looking note keeps incomplete work and unknown outcomes explicit.",
    informationTargets: ["limitations", "contribution-details"],
    selectionMode: "multiple",
    customTarget: "limitations",
    phase: "follow-up",
    priority: 20,
    terminal: true,
    options: [
      choice("more-measurement", "Collect stronger outcome evidence", [
        fact("limitations", "Stronger outcome evidence is still needed"),
      ]),
      choice("edge-cases", "Cover more edge cases or failure modes", [
        fact("limitations", "More edge cases or failure modes remain"),
      ]),
      choice("broader-adoption", "Validate with more users or environments", [
        fact("limitations", "More user or environment validation is needed"),
      ]),
      choice("nothing-planned", "Nothing specific is planned or known", [
        fact("limitations", "No further work is currently known"),
      ]),
    ],
  }),
];

type BranchGroup = {
  id: string;
  areaOptionId: string;
  rootOptions: [ChoiceDraft, ChoiceDraft, ChoiceDraft, ChoiceDraft];
  questions: Array<{
    slug: string;
    prompt: string;
    reason: string;
    targets: InformationTarget[];
    optionSet:
      | "workflow"
      | "implementation"
      | "architecture"
      | "quality"
      | "operations"
      | "tradeoffs";
  }>;
};

const reusableBranchChoices = {
  workflow: [
    choice("main-flow", "The main user or operator workflow"),
    choice("secondary-flow", "A secondary or administrative workflow"),
    choice("technical-flow", "A developer or system workflow"),
    choice("workflow-unclear", "The workflow is still being defined"),
  ],
  implementation: [
    choice("new-feature", "A new feature or capability"),
    choice("existing-behavior", "An extension of existing behavior"),
    choice("integration-work", "Integration with another component"),
    choice("maintenance-work", "Maintenance, correction, or cleanup"),
  ],
  architecture: [
    choice("boundaries", "Component or responsibility boundaries"),
    choice("data-contracts", "Data flow, contracts, or persistence"),
    choice("state-management", "State ownership and lifecycle"),
    choice("design-tradeoff", "A different design decision"),
  ],
  quality: [
    choice("automated-tests", "Automated tests or benchmarks"),
    choice("manual-checks", "Manual or exploratory checks"),
    choice("runtime-signals", "Runtime or operational signals"),
    choice("no-formal-checks", "No formal check was recorded"),
  ],
  operations: [
    choice("release", "Packaging, release, or deployment"),
    choice("recovery", "Retries, cancellation, or recovery"),
    choice("diagnostics", "Monitoring or troubleshooting"),
    choice("not-applicable", "Not applicable or not known"),
  ],
  tradeoffs: [
    choice("compatibility", "Compatibility with existing behavior"),
    choice("privacy-security", "Privacy, access, or security"),
    choice("performance", "Performance or resource limits"),
    choice("external-constraint", "An external dependency or constraint"),
  ],
} as const;

const branchGroups: BranchGroup[] = [
  {
    id: "web-mobile",
    areaOptionId: "web-mobile",
    rootOptions: [
      choice("web", "A web application or site", [
        fact("secondaryTags", "web"),
        fact("confirmedCapabilities", "A web application or site"),
      ]),
      choice("mobile", "A mobile application", [
        fact("secondaryTags", "mobile"),
        fact("confirmedCapabilities", "A mobile application"),
      ]),
      choice("both", "Web and mobile clients", [
        fact("secondaryTags", "web"),
        fact("secondaryTags", "mobile"),
        fact("confirmedCapabilities", "Web and mobile clients"),
      ]),
      choice("shared-interface", "Shared UI components or design system", [
        fact("secondaryTags", "shared-interface"),
        fact("confirmedCapabilities", "Shared UI components or design system"),
      ]),
    ],
    questions: [
      {
        slug: "workflow",
        prompt: "Which user journey did the interface support?",
        reason:
          "A concrete journey helps explain what the screen or client enabled.",
        targets: ["contribution-details", "confirmed-capabilities"],
        optionSet: "workflow",
      },
      {
        slug: "layout",
        prompt: "What was important about layout or navigation?",
        reason:
          "Responsive layout and navigation can be central product behavior.",
        targets: ["contribution-details"],
        optionSet: "architecture",
      },
      {
        slug: "state",
        prompt: "Where did client-side state or form behavior matter?",
        reason:
          "State transitions and input handling often distinguish the implementation.",
        targets: ["contribution-details"],
        optionSet: "implementation",
      },
      {
        slug: "data",
        prompt: "How did the interface connect to data or services?",
        reason: "This surfaces client/server boundaries and integration work.",
        targets: ["contribution-details"],
        optionSet: "architecture",
      },
      {
        slug: "accessibility",
        prompt: "Which accessibility or device needs did you account for?",
        reason:
          "Accessibility and device behavior are observable product decisions.",
        targets: ["contribution-details", "limitations"],
        optionSet: "quality",
      },
      {
        slug: "performance",
        prompt: "What affected responsiveness or perceived performance?",
        reason:
          "Performance details are useful when supported by an observed change.",
        targets: ["contribution-details", "outcome-evidence"],
        optionSet: "tradeoffs",
      },
      {
        slug: "device-integration",
        prompt: "Did browser or device integration shape the work?",
        reason:
          "Platform APIs and browser/device constraints can explain implementation scope.",
        targets: ["contribution-details", "limitations"],
        optionSet: "implementation",
      },
      {
        slug: "verification",
        prompt: "How did you check the experience across states or devices?",
        reason:
          "Verification context keeps quality claims tied to actual checks.",
        targets: ["contribution-details", "outcome-evidence"],
        optionSet: "quality",
      },
    ],
  },
  {
    id: "ai-ml-data",
    areaOptionId: "ai-ml-data",
    rootOptions: [
      choice("ai-feature", "An AI-assisted feature or language model", [
        fact("secondaryTags", "ai"),
        fact(
          "confirmedCapabilities",
          "An AI-assisted feature or language model",
        ),
      ]),
      choice("machine-learning", "A trained or predictive model", [
        fact("secondaryTags", "machine-learning"),
        fact("confirmedCapabilities", "A trained or predictive model"),
      ]),
      choice("data-pipeline", "A data pipeline or analytics workflow", [
        fact("secondaryTags", "data"),
        fact("confirmedCapabilities", "A data pipeline or analytics workflow"),
      ]),
      choice("evaluation", "Model evaluation, monitoring, or safeguards", [
        fact("secondaryTags", "model-evaluation"),
        fact(
          "confirmedCapabilities",
          "Model evaluation, monitoring, or safeguards",
        ),
      ]),
    ],
    questions: [
      {
        slug: "task",
        prompt: "What task did the model or data workflow support?",
        reason:
          "The task is more informative than naming a model or library alone.",
        targets: ["contribution-details", "confirmed-capabilities"],
        optionSet: "workflow",
      },
      {
        slug: "data",
        prompt: "What happened to the data before or during processing?",
        reason:
          "Data preparation and validation shape whether a result is reproducible.",
        targets: ["contribution-details", "limitations"],
        optionSet: "architecture",
      },
      {
        slug: "evaluation",
        prompt: "How was output quality or model behavior evaluated?",
        reason:
          "Evaluation details prevent unsupported claims about model quality.",
        targets: ["outcome-evidence", "contribution-details"],
        optionSet: "quality",
      },
      {
        slug: "safety",
        prompt: "What privacy, safety, or failure limits were relevant?",
        reason:
          "Safety boundaries and known failures should stay visible in later claims.",
        targets: ["limitations", "contribution-details"],
        optionSet: "tradeoffs",
      },
      {
        slug: "integration",
        prompt: "How did this work connect to the surrounding product?",
        reason:
          "Integration shows how the capability was used without implying model ownership.",
        targets: ["contribution-details"],
        optionSet: "implementation",
      },
      {
        slug: "deployment",
        prompt: "How was the workflow run or made available?",
        reason:
          "Serving, batch execution, and deployment are distinct implementation work.",
        targets: ["contribution-details", "limitations"],
        optionSet: "operations",
      },
      {
        slug: "monitoring",
        prompt: "What signals or checks helped detect behavior after release?",
        reason:
          "Operational evidence can support reliability statements if it was recorded.",
        targets: ["outcome-evidence", "contribution-details"],
        optionSet: "quality",
      },
      {
        slug: "limits",
        prompt: "What uncertainty or limitation should remain explicit?",
        reason:
          "Model and data uncertainty must not be converted into a personal achievement.",
        targets: ["limitations"],
        optionSet: "tradeoffs",
      },
    ],
  },
  {
    id: "backend-automation",
    areaOptionId: "backend-automation",
    rootOptions: [
      choice("api-service", "An API or backend service", [
        fact("secondaryTags", "backend"),
        fact("confirmedCapabilities", "An API or backend service"),
      ]),
      choice("automation", "A scheduled or event-driven automation", [
        fact("secondaryTags", "automation"),
        fact("confirmedCapabilities", "A scheduled or event-driven automation"),
      ]),
      choice("integration", "An integration between external systems", [
        fact("secondaryTags", "integration"),
        fact(
          "confirmedCapabilities",
          "An integration between external systems",
        ),
      ]),
      choice("multiple-systems", "More than one of these areas", [
        fact("secondaryTags", "backend-automation-integration"),
        fact(
          "confirmedCapabilities",
          "Backend, automation, or integration work",
        ),
      ]),
    ],
    questions: [
      {
        slug: "contract",
        prompt: "What request, event, or API contract mattered most?",
        reason: "Contracts show what other components could rely on.",
        targets: ["contribution-details", "confirmed-capabilities"],
        optionSet: "workflow",
      },
      {
        slug: "access",
        prompt: "How were identity, permissions, or trust boundaries handled?",
        reason:
          "Authorization boundaries are central to backend responsibility.",
        targets: ["contribution-details", "limitations"],
        optionSet: "tradeoffs",
      },
      {
        slug: "persistence",
        prompt: "What data or state had to persist across requests?",
        reason: "Persistence and state ownership clarify the service's role.",
        targets: ["contribution-details"],
        optionSet: "architecture",
      },
      {
        slug: "background-work",
        prompt: "How did background work, retries, or scheduling behave?",
        reason:
          "Durable and retryable work has different failure modes from one request.",
        targets: ["contribution-details", "limitations"],
        optionSet: "operations",
      },
      {
        slug: "idempotency",
        prompt: "What prevented duplicate or conflicting work?",
        reason:
          "Idempotency details help describe reliability without overclaiming.",
        targets: ["contribution-details"],
        optionSet: "architecture",
      },
      {
        slug: "dependencies",
        prompt: "Which external system or dependency shaped the design?",
        reason: "External boundaries make ownership and limitations clearer.",
        targets: ["contribution-details", "limitations"],
        optionSet: "implementation",
      },
      {
        slug: "reliability",
        prompt: "How were failures detected or recovered?",
        reason:
          "Recovery mechanisms and operational signals support reliability claims.",
        targets: ["contribution-details", "outcome-evidence"],
        optionSet: "operations",
      },
      {
        slug: "verification",
        prompt: "How were service behavior and edge cases checked?",
        reason: "Tests and operational checks show what was actually verified.",
        targets: ["contribution-details", "outcome-evidence"],
        optionSet: "quality",
      },
    ],
  },
  {
    id: "developer-tools",
    areaOptionId: "developer-tools",
    rootOptions: [
      choice("cli-library", "A CLI, library, or framework", [
        fact("secondaryTags", "developer-tool"),
        fact("confirmedCapabilities", "A CLI, library, or framework"),
      ]),
      choice("editor-extension", "An editor or IDE extension", [
        fact("secondaryTags", "editor-extension"),
        fact("confirmedCapabilities", "An editor or IDE extension"),
      ]),
      choice("build-platform", "A build, deployment, or platform tool", [
        fact("secondaryTags", "platform-tool"),
        fact("confirmedCapabilities", "A build, deployment, or platform tool"),
      ]),
      choice(
        "developer-workflow",
        "A tool that improves a developer workflow",
        [
          fact("secondaryTags", "developer-workflow"),
          fact(
            "confirmedCapabilities",
            "A tool that improves a developer workflow",
          ),
        ],
      ),
    ],
    questions: [
      {
        slug: "workflow",
        prompt: "Which developer workflow did the tool support?",
        reason:
          "A real workflow describes the value more clearly than a tool category.",
        targets: ["contribution-details", "confirmed-capabilities"],
        optionSet: "workflow",
      },
      {
        slug: "interface",
        prompt:
          "What command, API, or extension surface did users interact with?",
        reason:
          "The user-facing interface defines compatibility and adoption requirements.",
        targets: ["contribution-details"],
        optionSet: "implementation",
      },
      {
        slug: "distribution",
        prompt: "How was the tool packaged or distributed?",
        reason:
          "Packaging and installation are part of a usable developer tool.",
        targets: ["contribution-details"],
        optionSet: "operations",
      },
      {
        slug: "compatibility",
        prompt: "Which runtimes, editors, or project formats had to work?",
        reason:
          "Compatibility constraints can explain the scope of implementation work.",
        targets: ["contribution-details", "limitations"],
        optionSet: "tradeoffs",
      },
      {
        slug: "performance",
        prompt: "What affected speed or resource use for developers?",
        reason:
          "Tool performance matters when measured in the user's actual workflow.",
        targets: ["contribution-details", "outcome-evidence"],
        optionSet: "architecture",
      },
      {
        slug: "documentation",
        prompt: "How did users learn to install or use it?",
        reason:
          "Documentation and onboarding are part of a developer-facing capability.",
        targets: ["contribution-details", "confirmed-capabilities"],
        optionSet: "workflow",
      },
      {
        slug: "privacy",
        prompt:
          "What source code, credentials, or telemetry boundaries mattered?",
        reason:
          "Developer tools often run near sensitive local or repository data.",
        targets: ["limitations", "contribution-details"],
        optionSet: "tradeoffs",
      },
      {
        slug: "verification",
        prompt: "How was compatibility or usability checked?",
        reason:
          "The checks clarify which environments the tool was actually verified in.",
        targets: ["contribution-details", "outcome-evidence"],
        optionSet: "quality",
      },
    ],
  },
  {
    id: "other-custom",
    areaOptionId: "custom",
    rootOptions: [
      choice("research", "A research or learning project", [
        fact("secondaryTags", "research"),
        fact("confirmedCapabilities", "A research or learning project"),
      ]),
      choice("creative", "A creative, content, or media project", [
        fact("secondaryTags", "creative-media"),
        fact("confirmedCapabilities", "A creative, content, or media project"),
      ]),
      choice("community", "A community or public-service project", [
        fact("secondaryTags", "community-service"),
        fact("confirmedCapabilities", "A community or public-service project"),
      ]),
      choice("other-domain", "Another domain not listed here", [
        fact("secondaryTags", "other-domain"),
        fact("confirmedCapabilities", "A project in another domain"),
      ]),
    ],
    questions: [
      {
        slug: "purpose",
        prompt: "What did people use or learn from the project?",
        reason:
          "This lets an unfamiliar project type be described in its own terms.",
        targets: ["project-purpose", "confirmed-capabilities"],
        optionSet: "workflow",
      },
      {
        slug: "audience",
        prompt: "Who was it designed to help or reach?",
        reason:
          "Audience context makes a less familiar project's purpose concrete.",
        targets: ["intended-users"],
        optionSet: "workflow",
      },
      {
        slug: "inputs",
        prompt: "What inputs, materials, or information did it use?",
        reason:
          "Inputs help identify the core work without assuming a software product.",
        targets: ["contribution-details"],
        optionSet: "architecture",
      },
      {
        slug: "core-work",
        prompt: "What part required the most meaningful work?",
        reason:
          "A focused description identifies a contribution without relying on a title.",
        targets: ["contribution-details"],
        optionSet: "implementation",
      },
      {
        slug: "decision",
        prompt: "Which decision or approach shaped the result?",
        reason: "A decision can explain why the work took the form it did.",
        targets: ["contribution-details"],
        optionSet: "architecture",
      },
      {
        slug: "constraints",
        prompt: "What resources, access, or external limits affected it?",
        reason:
          "Constraints keep the resulting claim grounded in its real conditions.",
        targets: ["limitations"],
        optionSet: "tradeoffs",
      },
      {
        slug: "validation",
        prompt: "How did you decide whether it worked?",
        reason:
          "Validation may be a user response, review, test, or documented outcome.",
        targets: ["outcome-evidence", "contribution-details"],
        optionSet: "quality",
      },
      {
        slug: "limits",
        prompt: "What should not be inferred from the available evidence?",
        reason:
          "A clear boundary prevents an unfamiliar project from being over-described.",
        targets: ["limitations"],
        optionSet: "tradeoffs",
      },
    ],
  },
];

const questionOptionSets: Record<
  BranchGroup["questions"][number]["optionSet"],
  readonly ChoiceDraft[]
> = reusableBranchChoices;

const branchNodes = branchGroups.flatMap((group) => {
  const rootId = "branch." + group.id + ".1";
  const questions = [
    {
      slug: "focus",
      prompt:
        group.id === "other-custom"
          ? "Which broad description best fits this project?"
          : "Which part of this project area is most central?",
      reason:
        group.id === "other-custom"
          ? "The first follow-up keeps an unfamiliar project centered on the user's description."
          : "This narrows a broad project area without assuming all of its possible subtypes.",
      targets: [
        "secondary-tags",
        "confirmed-capabilities",
      ] as InformationTarget[],
      optionSet: "workflow" as const,
      options: group.rootOptions,
      selectionMode:
        group.id === "ai-ml-data" ? ("multiple" as const) : ("single" as const),
    },
    ...group.questions.map((question) => ({
      ...question,
      options: questionOptionSets[question.optionSet].map((option) =>
        choice(option.id, option.label, [
          fact("contributionDetails", option.label),
        ]),
      ) as [ChoiceDraft, ChoiceDraft, ChoiceDraft, ChoiceDraft],
      selectionMode: "multiple" as const,
    })),
  ];

  return questions.map((question, index) => {
    const id = "branch." + group.id + "." + (index + 1);
    const nextId =
      index < questions.length - 1
        ? "branch." + group.id + "." + (index + 2)
        : "project.technical-work";
    const initial = index === 0;
    return makeNode(
      {
        id,
        prompt: question.prompt,
        reason: question.reason,
        informationTargets: question.targets,
        selectionMode: question.selectionMode,
        customTarget: initial ? "contributionDetails" : "contributionDetails",
        phase: "branch",
        branchGroup: group.id,
        branchAreaOptionId: group.areaOptionId,
        priority: 88 - index,
        options: question.options,
      },
      [edge(nextId)],
    );
  });
});

export const DEFAULT_QUESTION_CATALOG = QuestionCatalogSchema.parse({
  version: PROJECT_CONTEXT_VERSION,
  rootId: "project.purpose",
  maxQuestions: 10,
  maxBranchQuestions: 3,
  wrapUpNodeIds: ["project.technical-work", "project.outcomes"],
  nodes: [...sharedNodes, ...branchNodes],
});

export const DEFAULT_QUESTION_COUNT = DEFAULT_QUESTION_CATALOG.nodes.length;

export const DEFAULT_QUESTION_IDS = DEFAULT_QUESTION_CATALOG.nodes.map(
  (node) => node.id,
);
