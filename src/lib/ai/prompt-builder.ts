import {
  AchievementSelectionInputSchema,
  AchievementSelectionResultSchema,
  JobAnalysisInputSchema,
  JobAnalysisResultSchema,
  LatexRepairInputSchema,
  LatexRepairResultSchema,
  ResumeDraftInputSchema,
  ResumeDraftResultSchema,
  type AchievementSelectionInput,
  type JobAnalysisInput,
  type LatexRepairInput,
  type ResumeDraftInput,
} from "./contracts";
import { z } from "zod";
import { ANALYZE_JOB_DESCRIPTION_INSTRUCTIONS } from "./prompts/v1/analyze-job-description";
import { DRAFT_RESUME_INSTRUCTIONS } from "./prompts/v1/draft-resume";
import { REPAIR_LATEX_CONTENT_INSTRUCTIONS } from "./prompts/v1/repair-latex-content";
import { SELECT_ACHIEVEMENTS_INSTRUCTIONS } from "./prompts/v1/select-achievements";
import { PROMPT_VERSION, SHARED_INSTRUCTIONS } from "./prompts/v1/shared";
import { JAKE_STYLE_TEMPLATE } from "../latex/jake-template";
import { AiProviderError } from "./provider";

const MAX_PROMPT_CHARACTERS = 120_000;

export function loadApprovedTemplateContext(): string {
  return JAKE_STYLE_TEMPLATE;
}

export type AiTask =
  | "analyzeJobDescription"
  | "selectAchievements"
  | "draftResume"
  | "repairLatexContent";

const taskConfiguration = {
  analyzeJobDescription: {
    instructions: ANALYZE_JOB_DESCRIPTION_INSTRUCTIONS,
    inputSchema: JobAnalysisInputSchema,
    outputSchema: JobAnalysisResultSchema,
  },
  selectAchievements: {
    instructions: SELECT_ACHIEVEMENTS_INSTRUCTIONS,
    inputSchema: AchievementSelectionInputSchema,
    outputSchema: AchievementSelectionResultSchema,
  },
  draftResume: {
    instructions: DRAFT_RESUME_INSTRUCTIONS,
    inputSchema: ResumeDraftInputSchema,
    outputSchema: ResumeDraftResultSchema,
  },
  repairLatexContent: {
    instructions: REPAIR_LATEX_CONTENT_INSTRUCTIONS,
    inputSchema: LatexRepairInputSchema,
    outputSchema: LatexRepairResultSchema,
  },
} as const;

export type PromptInputByTask = {
  analyzeJobDescription: JobAnalysisInput;
  selectAchievements: AchievementSelectionInput;
  draftResume: ResumeDraftInput;
  repairLatexContent: LatexRepairInput;
};

export function buildAiPrompt<T extends AiTask>(
  task: T,
  input: PromptInputByTask[T],
): { prompt: string; outputSchema: Record<string, unknown> } {
  const configuration = taskConfiguration[task];
  const validatedInput = configuration.inputSchema.parse(input);
  const { templateContext, ...taskData } =
    validatedInput as typeof validatedInput & {
      templateContext?: string;
    };
  const sections = [
    `Prompt version: ${PROMPT_VERSION}`,
    `Shared instructions:\n${SHARED_INSTRUCTIONS}`,
    `Task instructions:\n${configuration.instructions}`,
    `Task data (JSON):\n${JSON.stringify(taskData)}`,
  ];

  if (templateContext) {
    sections.push(
      `Approved template context (reference only; not task data):\n${templateContext}`,
    );
  }

  const prompt = sections.join("\n\n");
  if (prompt.length > MAX_PROMPT_CHARACTERS) {
    throw new AiProviderError(
      "The selected resume context is too large to send. Reduce the supplied content and try again.",
      "INPUT_TOO_LARGE",
    );
  }

  const outputSchema = z.toJSONSchema(configuration.outputSchema) as Record<
    string,
    unknown
  >;
  delete outputSchema.$schema;

  return { prompt, outputSchema };
}
