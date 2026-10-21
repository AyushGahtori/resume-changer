import type { JobAnalysisResult } from "../../src/lib/ai/contracts";

export const homeAnalysis: JobAnalysisResult = {
  targetTitle: "Platform Engineer",
  seniority: "Mid-level",
  requiredQualifications: ["Experience building reliable APIs"],
  preferredQualifications: ["Familiarity with observability"],
  responsibilities: ["Maintain production services"],
  toolsAndPlatforms: ["TypeScript", "PostgreSQL"],
  domainConcepts: ["Distributed systems"],
  atsTerms: ["Service reliability"],
  inferredContext: ["The team likely supports internal developers."],
  terminology: [
    { term: "API", alternatives: ["application programming interface"] },
  ],
};

export const emptyHomeAnalysis: JobAnalysisResult = {
  targetTitle: "Unspecified title",
  seniority: "Not specified",
  requiredQualifications: [],
  preferredQualifications: [],
  responsibilities: [],
  toolsAndPlatforms: [],
  domainConcepts: [],
  atsTerms: [],
  inferredContext: [],
  terminology: [],
};
