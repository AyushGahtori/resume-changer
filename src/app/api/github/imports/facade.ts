import { getAppMode } from "@/lib/cloud/security";
import { requireCloudAccount } from "@/lib/cloud/server-account";
import "server-only";
import { createHash } from "node:crypto";
import {
  getGithubServices,
  type GithubServerServices,
} from "@/lib/github/server/composition";
import {
  MeasurementAnswerSchema,
  err,
  ok,
  type ExecutionContext,
  type JobRecord,
} from "@/lib/github/contracts";
import type {
  DeferredMeasurementTask,
  Draft,
  DomainErrorCode,
  ImportQuestion,
  ImportRecord,
  ImportReviewState,
  MeasurementResult,
  Result,
} from "@/lib/github/contracts";
import type {
  ApproveInput,
  CancelInput,
  CreateImportInput,
  DiscardInput,
  DraftUpdateInput,
  ExtractInput,
  InspectInput,
  MeasurementAnswerInput,
  MeasurementTaskInput,
  SelectionInput,
} from "./http-contracts";

export type ServiceResult<T> = Result<T>;

export type RequestAuthority =
  { kind: "local" } | { kind: "account"; accountId: string };

export type AcceptedJob = {
  jobId: string;
  runId?: string;
  duplicate?: boolean;
  job?: JobRecord;
};

export type ApprovalResult = {
  savedIds: string[];
  alreadyApplied: boolean;
};

/**
 * Route-facing adapter aligned with Appendix A. The import service must enforce
 * destination ownership and import scope for every operation that receives an
 * authority. Task 20 production composition replaces this unavailable adapter
 * when the service and worker are wired into the Next boundary.
 */
export interface GithubImportHttpFacade {
  create(args: {
    authority: RequestAuthority;
    input: CreateImportInput;
  }): Promise<ServiceResult<ImportRecord>>;
  inspect(args: {
    authority: RequestAuthority;
    importId: string;
    input: InspectInput;
  }): Promise<ServiceResult<AcceptedJob>>;
  changeSelection(args: {
    authority: RequestAuthority;
    importId: string;
    input: SelectionInput;
  }): Promise<ServiceResult<ImportRecord>>;
  enqueueAnalysis(args: {
    authority: RequestAuthority;
    importId: string;
    input: ExtractInput;
  }): Promise<ServiceResult<AcceptedJob>>;
  get(args: {
    authority: RequestAuthority;
    importId: string;
  }): Promise<ServiceResult<ImportReviewState>>;
  updateDraft(args: {
    authority: RequestAuthority;
    importId: string;
    draftId: string;
    input: DraftUpdateInput;
  }): Promise<ServiceResult<Draft>>;
  questions(args: {
    authority: RequestAuthority;
    importId: string;
  }): Promise<ServiceResult<ImportQuestion[]>>;
  answer(args: {
    authority: RequestAuthority;
    importId: string;
    questionId: string;
    input: MeasurementAnswerInput;
  }): Promise<
    ServiceResult<{ version: number; result: MeasurementResult | null }>
  >;
  saveMeasurementTask(args: {
    authority: RequestAuthority;
    importId: string;
    input: MeasurementTaskInput;
  }): Promise<ServiceResult<DeferredMeasurementTask>>;
  approve(args: {
    authority: RequestAuthority;
    importId: string;
    input: ApproveInput;
  }): Promise<ServiceResult<ApprovalResult>>;
  cancel(args: {
    authority: RequestAuthority;
    importId: string;
    input: CancelInput;
  }): Promise<ServiceResult<ImportRecord>>;
  discard(args: {
    authority: RequestAuthority;
    importId: string;
    input: DiscardInput;
  }): Promise<ServiceResult<{ discarded: true }>>;
}

/** Each facade is bound to the authenticated execution context of one HTTP request. */
export function createGithubImportHttpFacade(
  services: GithubServerServices,
  context: ExecutionContext,
): GithubImportHttpFacade {
  const invalid = (message: string) =>
    err<never>({ code: "invalid-input", message, retryable: false });
  const record = async (importId: string) => {
    const r = await services.imports.get({ importId }, context);
    return r.ok ? ok(r.value.import) : r;
  };
  const accepted = async (
    r: Promise<Result<JobRecord>>,
  ): Promise<Result<AcceptedJob>> => {
    const value = await r;
    return value.ok
      ? ok({
          jobId: value.value.id,
          runId: value.value.runId,
          job: value.value,
        })
      : value;
  };
  return {
    async create({ input }) {
      if (!input.scope)
        return invalid(
          "Choose an authorized pinned repository before creating an import.",
        );
      return services.imports.create(
        {
          source: input.dataSource,
          destinationProjectId: input.projectId,
          scope: input.scope,
        },
        context,
      );
    },
    async inspect({ importId, input }) {
      const current = await record(importId);
      if (!current.ok) return current;
      if (
        input.packagePath !== undefined ||
        input.contribution !== undefined ||
        input.selectedPrNumbers.length
      ) {
        const changed = await services.imports.changeSelection(
          {
            importId,
            expectedVersion: input.expectedVersion,
            scope: {
              ...current.value.scope,
              packagePath: input.packagePath ?? current.value.scope.packagePath,
              selectedPullRequestNumbers: input.selectedPrNumbers,
              contributionStatement:
                input.contribution?.statement ??
                current.value.scope.contributionStatement,
              selectedPaths:
                input.contribution?.paths ?? current.value.scope.selectedPaths,
            },
            pinnedFileIds: current.value.pinnedFileIds,
          },
          context,
        );
        if (!changed.ok) return changed;
        return accepted(
          services.imports.prepare(
            { importId, expectedVersion: changed.value.version },
            context,
          ),
        );
      }
      return accepted(
        services.imports.prepare(
          { importId, expectedVersion: input.expectedVersion },
          context,
        ),
      );
    },
    async changeSelection({ importId, input }) {
      const review = await services.imports.get({ importId }, context);
      if (!review.ok) return review;
      const current = { value: review.value.import };
      if (
        !input.scope &&
        input.fileIds.some(
          (id) => !review.value.candidates.some((c) => c.id === id),
        )
      )
        return invalid("The selected file is outside this inventory.");
      const scope = input.scope ?? {
        ...current.value.scope,
        contributionStatement:
          input.context?.statement ?? current.value.scope.contributionStatement,
        selectedPaths:
          input.context?.paths ?? current.value.scope.selectedPaths,
        selectedPullRequestNumbers:
          input.context?.pullRequestNumbers ??
          current.value.scope.selectedPullRequestNumbers,
      };
      return services.imports.changeSelection(
        {
          importId,
          expectedVersion: input.expectedVersion,
          scope,
          pinnedFileIds: input.pinnedFileIds,
          removedFileIds:
            input.removedFileIds ??
            (input.scope
              ? current.value.removedFileIds
              : review.value.candidates
                  .filter((c) => !input.fileIds.includes(c.id))
                  .map((c) => c.id)),
          destinationProjectId: input.destinationProjectId,
        },
        context,
      );
    },
    async enqueueAnalysis({ importId, input }) {
      const current = await record(importId);
      if (!current.ok) return current;
      if (
        input.selectionVersion !== undefined &&
        input.selectionVersion !== current.value.selectionVersion
      )
        return err({
          code: "version-conflict",
          message: "The evidence selection changed.",
          retryable: false,
        });
      return accepted(
        services.imports.enqueueAnalysis(
          {
            importId,
            expectedVersion: input.expectedVersion,
            selectionHash: input.selectionHash,
            consentReference:
              input.consentReference ?? "consent-" + input.idempotencyKey,
            idempotencyKey: input.idempotencyKey,
          },
          context,
        ),
      );
    },
    get: ({ importId }) => services.imports.get({ importId }, context),
    async updateDraft({ importId, draftId, input }) {
      const current = await services.imports.get({ importId }, context);
      if (!current.ok) return current;
      const draft = current.value.result?.drafts.find((d) => d.id === draftId);
      if (!draft) return invalid("The selected draft is unavailable.");
      return services.imports.updateDraft(
        {
          importId,
          draftId,
          expectedVersion: input.expectedVersion,
          text: input.text ?? draft.text,
          selectedForSave: input.selectedForSave,
          contributionConfirmed: input.contributionConfirmed,
          confirmedMetricResultIds: input.confirmedMetricResultIds,
        },
        context,
      );
    },
    questions: ({ importId }) =>
      services.measurements.questions({ importId }, context),
    async answer({ importId, questionId, input }) {
      const parsed = MeasurementAnswerSchema.safeParse(input.answer);
      if (!parsed.success) return invalid("The measurement answer is invalid.");
      return services.measurements.answer(
        {
          importId,
          questionId,
          expectedVersion: input.expectedVersion,
          answer: parsed.data,
        },
        context,
      );
    },
    async saveMeasurementTask({ importId, input }) {
      const questionId = input.task.questionId;
      if (typeof questionId !== "string")
        return invalid("Choose a measurement question to defer.");
      const saved = await services.measurements.defer(
        { importId, questionId, expectedVersion: input.expectedVersion },
        context,
      );
      return saved.ok
        ? services.deferredTasks.get(
            { id: saved.value.deferredTaskId },
            context,
          )
        : saved;
    },
    async approve({ importId, input }) {
      const current = await services.imports.get({ importId }, context);
      if (!current.ok) return current;
      const selectedDraftIds =
        input.selectedDraftIds ?? input.drafts.map((d) => d.draftId);
      for (const expected of input.drafts) {
        const draft = current.value.result?.drafts.find(
          (d) => d.id === expected.draftId,
        );
        if (
          !draft ||
          draft.version !== expected.expectedVersion ||
          createHash("sha256").update(draft.text).digest("hex") !==
            expected.contentHash
        )
          return err({
            code: "version-conflict",
            message: "A reviewed draft changed.",
            retryable: false,
          });
      }
      for (const expected of input.metrics) {
        const metric = current.value.measurementResults.find(
          (m) => m.id === expected.resultId,
        );
        if (
          !metric ||
          metric.version !== expected.expectedVersion ||
          metric.previewHash !== expected.confirmationHash
        )
          return err({
            code: "version-conflict",
            message: "A reviewed measurement changed.",
            retryable: false,
          });
      }
      const saved = await services.imports.approve(
        {
          importId,
          expectedVersion:
            input.expectedVersion ?? current.value.import.version,
          selectedDraftIds,
          idempotencyKey: input.idempotencyKey,
        },
        context,
      );
      return saved.ok
        ? ok({
            ...saved.value,
            alreadyApplied: current.value.import.lifecycle === "approved",
          })
        : saved;
    },
    async cancel({ importId, input }) {
      const current = await record(importId);
      if (!current.ok) return current;
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.value.version
      )
        return err({
          code: "version-conflict",
          message: "The active import changed.",
          retryable: false,
        });
      return services.imports.cancel(
        { importId, runId: input.expectedRunId },
        context,
      );
    },
    discard: ({ importId, input }) =>
      services.imports.discard(
        { importId, expectedVersion: input.expectedVersion },
        context,
      ),
  };
}

export async function getGithubImportHttpFacade(
  request: Request,
): Promise<GithubImportHttpFacade> {
  const services = await getGithubServices();
  const context = await services.createContext({
    request,
    accountId:
      getAppMode() === "firebase"
        ? (await requireCloudAccount()).uid
        : undefined,
    signal: request.signal,
  });
  if (!context.ok) throw { domainError: context.error };
  return createGithubImportHttpFacade(services, context.value);
}
