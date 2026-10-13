import type {
  AchievementSelectionInput,
  AchievementSelectionResult,
  JobAnalysisInput,
  JobAnalysisResult,
  LatexRepairInput,
  LatexRepairResult,
  ResumeDraftInput,
  ResumeDraftResult,
} from "./contracts";

export interface AiProvider {
  readonly name: "mock" | "gemini";
  analyzeJobDescription(input: JobAnalysisInput): Promise<JobAnalysisResult>;
  selectAchievements(
    input: AchievementSelectionInput,
  ): Promise<AchievementSelectionResult>;
  draftResume(input: ResumeDraftInput): Promise<ResumeDraftResult>;
  repairLatexContent(input: LatexRepairInput): Promise<LatexRepairResult>;
}

export type AiProviderErrorCode =
  | "MISSING_API_KEY"
  | "INPUT_TOO_LARGE"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "REQUEST_TIMEOUT"
  | "INVALID_RESPONSE"
  | "REQUEST_FAILED";

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code: AiProviderErrorCode,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
