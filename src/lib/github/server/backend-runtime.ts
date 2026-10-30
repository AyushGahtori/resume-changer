import { randomUUID } from "node:crypto";
import { createImportStore, createDeferredMeasurementTaskStore } from "./store";
import { createJobStore } from "./jobs/store";
import { createJobPort } from "./job-port";
import {
  createInspectionPorts,
  type InspectionDependencies,
} from "./inspection-ports";
import { createSelectionPolicy } from "./selection-policy";
import {
  createMeasurementPort,
  measurementDefinitions,
} from "./measurement-port";
import {
  createMeasurementService,
  readReviewedMeasurements,
} from "./measurement-service";
import { createRepositoryExtractorForWorker } from "./extraction";
import { createImportService } from "./service";
import { createImportJobRunner } from "./jobs/runner";
import { createReportParser } from "./reports-core";
import { createRunBudget } from "./budget-port";
import { createUnavailableGithubPorts } from "./unavailable";
import { currentImportSession } from "./session-memory";
import {
  err,
  ok,
  type ExecutionContext,
  type ImportRecord,
  type JobRecord,
  type Result,
} from "../contracts";
import type {
  GithubFactoryPorts,
  GithubAccessPort,
  ImportStorePort,
  ApprovalPort,
} from "../ports";
import type { AiProvider } from "../../ai/provider";
import type { GithubApprovalPortDependencies } from "../../data/writers";
import type {
  GithubRequestIdentity,
  GithubRuntimeBindings,
} from "./composition";
import type { BudgetSnapshot } from "./budget";

export type GithubBackendDependencies = {
  personalRoot: string;
  now?: () => Date;
  id?: () => string;
  access: GithubAccessPort;
  transport: InspectionDependencies["transport"];
  authorize: InspectionDependencies["authorize"];
  provider: Pick<AiProvider, "extractRepositoryAchievements">;
  requestContext: (
    input: GithubRequestIdentity,
  ) => Promise<Result<ExecutionContext>>;
  jobContext: (job: JobRecord) => Promise<Result<ExecutionContext>>;
  workerAvailable: () => boolean;
  dispatchJob?: (job: JobRecord, context: ExecutionContext) => Promise<void>;
  approvalFactory: (
    dependencies: GithubApprovalPortDependencies,
  ) => ApprovalPort;
  ownsProject: (
    projectId: string,
    context: ExecutionContext,
  ) => Promise<boolean>;
};

/** Complete local backend assembly. OAuth, vault, pinned network IO and account resolution are injected server capabilities. */
export function createGithubBackendRuntime(deps: GithubBackendDependencies): {
  ports: GithubFactoryPorts;
  bindings: GithubRuntimeBindings;
} {
  const now = deps.now ?? (() => new Date()),
    id = deps.id ?? randomUUID;
  const durable = createJobStore({
    rootDir: deps.personalRoot,
    clock: { now },
    createId: id,
  });
  const imports = createImportStore({
    now,
    id,
    isJobActive: durable.isImportRunActive,
  });
  const jobs = createJobPort(durable, imports);
  const deferredTasks = createDeferredMeasurementTaskStore({ now, id });
  const measurements = createMeasurementPort();
  const reviewStore: ImportStorePort = {
    ...imports,
    async get(input, context) {
      const loaded = await imports.get(input, context);
      if (!loaded.ok) return loaded;
      const record = loaded.value;
      if (record.activeRunId && record.resultRunId === record.activeRunId) {
        const job = await jobs.getByRunId(
          { runId: record.activeRunId },
          context,
        );
        if (!job.ok) return job;
        if (job.value?.state === "completed" && job.value.kind === "analyze")
          return ok({
            ...record,
            lifecycle: "ready-to-review",
            activeRunId: null,
          });
      }
      return loaded;
    },
  };
  const measurementService = createMeasurementService({
    store: reviewStore,
    deferredTasks,
    measurements,
    now,
  });
  const approval = deps.approvalFactory({
    store: reviewStore,
    measurements,
    now,
    id,
    async resolveReview(record, context) {
      const prepared = record.preparedSelectionRef
        ? await imports.cacheGetByKey(
            { key: record.preparedSelectionRef },
            context,
          )
        : ok(null);
      const result = record.resultRef
        ? await imports.cacheGetByKey({ key: record.resultRef }, context)
        : ok(null);
      if (!prepared.ok) return prepared;
      if (!result.ok) return result;
      if (
        prepared.value?.value.kind !== "selected-bundle" ||
        result.value?.value.kind !== "extraction-result" ||
        !record.consent ||
        prepared.value.value.prepared.snapshot?.upstreamBytes === undefined ||
        prepared.value.value.prepared.snapshot?.maxFetchedFileBytes ===
          undefined
      )
        return err({
          code: "needs-context",
          message: "The exact reviewed snapshot is no longer available.",
          retryable: false,
        });
      const p = {
        ...prepared.value.value.prepared,
        consentedAt: record.consent.consentedAt,
      };
      const records = await readReviewedMeasurements(record, context);
      const reviewed = records
        .filter((m) =>
          record.draftEdits.some(
            (e) =>
              e.draftId === m.draftId &&
              e.confirmedMetricResultIds.includes(m.result.id),
          ),
        )
        .map((m) => ({
          draftId: m.draftId,
          answer: m.answer,
          result: { ...m.result, confirmed: true },
          confirmedAt: record.draftEdits.find((e) => e.draftId === m.draftId)!
            .updatedAt,
          origin: "local-review" as const,
        }));
      const groups = new Map<string, { chars: number; lines: number }>();
      for (const e of p.evidence) {
        const g = groups.get(e.path) ?? { chars: 0, lines: 0 };
        g.chars += e.excerpt.length;
        g.lines +=
          e.pointer.kind === "lines"
            ? e.pointer.endLine - e.pointer.startLine + 1
            : e.excerpt.split("\n").length;
        groups.set(e.path, g);
      }
      return ok({
        preparedRef: record.preparedSelectionRef!,
        resultRef: record.resultRef!,
        prepared: p,
        result: result.value.value.result,
        measurements: reviewed,
        snapshot: {
          treeSha: p.snapshot!.treeSha,
          inspectedAt: p.snapshot!.observedAt,
          budgetsUsed: {
            filesFetched: p.budget.fetchedFiles,
            maxFetchedFileBytes: p.snapshot!.maxFetchedFileBytes!,
            decodedBytes: p.budget.fetchedBytes,
            upstreamBytes: p.snapshot!.upstreamBytes!,
            httpAttempts: p.budget.httpAttempts,
            selectedFiles: p.selectedFileIds.length,
            selectedCharacters: p.budget.selectedCharacters,
            maxSelectedFileCharacters: Math.max(
              0,
              ...[...groups.values()].map((g) => g.chars),
            ),
            maxRequestLines: p.budget.selectedUniqueLines,
            maxRequestFileLines: Math.max(
              0,
              ...[...groups.values()].map((g) => g.lines),
            ),
            uniqueLines: p.budget.selectedUniqueLines,
            transmittedLines: p.budget.cumulativeTransmittedLines,
            maxRequestInputTokens: p.budget.estimatedInputTokens ?? 0,
            reportedInputTokens: p.budget.reportedInputTokens,
            estimatedInputTokens: p.budget.estimatedInputTokens,
          },
        },
      });
    },
  });
  const policy = createSelectionPolicy({});
  const inspection = createInspectionPorts({
    async onFileRead(file, context, repositoryId) {
      const session = currentImportSession();
      if (!session) return;
      const saved = await imports.cachePut(
        {
          identity: {
            kind: "safe-content",
            repositoryId,
            blobSha: file.blobSha,
            parserVersion: "github-source-text-v1",
            safetyPolicyVersion: "github-file-safety-v1",
          },
          value: { kind: "safe-content", files: [file] },
        },
        context,
      );
      if (!saved.ok) throw new Error("Completed file could not be retained.");
      await session.checkpoint?.();
    },
    transport: deps.transport,
    authorize: deps.authorize,
    policy,
  });
  const extractor = createRepositoryExtractorForWorker(deps.provider, now);
  const service = createImportService({
    store: imports,
    jobs,
    repository: inspection.repository,
    pullRequests: inspection.pullRequests,
    selector: inspection.selector,
    extractor,
    catalog: measurementDefinitions,
    measurements: measurementService,
    approve: approval,
    now,
  });
  const reports = createReportParser({ definitions: measurementDefinitions });
  const runner = createImportJobRunner({
    jobs,
    executePrepare: (job, context) => service.executePrepare({ job, context }),
    executeAnalyze: (job, context) => service.executeAnalyze({ job, context }),
    async contextFor(job) {
      const base = await deps.jobContext(job);
      if (!base.ok) return base;
      if (base.value.personalRoot !== deps.personalRoot)
        return err({
          code: "forbidden",
          message: "The worker context belongs to another workspace.",
          retryable: false,
        });
      const raw = await durable.get({ jobId: job.id });
      if (!raw.ok) return raw;
      const context = {
        ...base.value,
        runId: job.runId,
        deadline: job.deadline,
      };
      const budget = createRunBudget({
        now,
        deadline: job.deadline,
        // An interrupted request is never resumed. Its replacement receives a fresh
        // bounded ledger and reuses completed screened files, not HTTP reservations.
        snapshot: currentImportSession()
          ? undefined
          : (raw.value.runnerData.budget as BudgetSnapshot | undefined),
        async persist() {
          if (currentImportSession()) return;
          const current = await durable.get({ jobId: job.id });
          if (!current.ok) throw new Error("Job checkpoint unavailable.");
          const r = await jobs.checkpoint(
            {
              jobId: job.id,
              workerId: job.lease!.owner,
              fence: job.executionFence,
              stage: current.value.checkpoint.stage,
              checkpoint: {
                providerState: current.value.checkpoint.providerState,
                providerResultRef: current.value.checkpoint.providerResultRef,
              },
            },
            context,
          );
          if (!r.ok)
            throw new Error("The worker no longer owns the budget checkpoint.");
        },
      });
      context.budget = budget;
      return ok(context);
    },
  });
  const safeService = {
    ...service,
    async create(
      input: Parameters<typeof service.create>[0],
      context: ExecutionContext,
    ) {
      if (!(await deps.ownsProject(input.destinationProjectId, context)))
        return err<ImportRecord>({
          code: "forbidden",
          message: "Choose a project in your own library.",
          retryable: false,
        });
      return service.create(input, context);
    },
    async prepare(
      input: Parameters<typeof service.prepare>[0],
      context: ExecutionContext,
    ) {
      if (!deps.workerAvailable())
        return err<JobRecord>({
          code: "unavailable",
          message: "The GitHub import worker is unavailable.",
          retryable: true,
        });
      const result = await service.prepare(input, context);
      if (result.ok && currentImportSession()) {
        await runner.runOnce({ jobId: result.value.id });
        return jobs.getJob({ jobId: result.value.id }, context);
      }
      if (result.ok) await deps.dispatchJob?.(result.value, context);
      return result;
    },
    async enqueueAnalysis(
      input: Parameters<typeof service.enqueueAnalysis>[0],
      context: ExecutionContext,
    ) {
      if (!deps.workerAvailable())
        return err<JobRecord>({
          code: "unavailable",
          message: "The GitHub import worker is unavailable.",
          retryable: true,
        });
      const result = await service.enqueueAnalysis(input, context);
      if (result.ok && currentImportSession()) {
        await runner.runOnce({ jobId: result.value.id });
        return jobs.getJob({ jobId: result.value.id }, context);
      }
      if (result.ok) await deps.dispatchJob?.(result.value, context);
      return result;
    },
    async changeSelection(
      input: Parameters<typeof service.changeSelection>[0],
      context: ExecutionContext,
    ) {
      if (
        input.destinationProjectId &&
        !(await deps.ownsProject(input.destinationProjectId, context))
      )
        return err<ImportRecord>({
          code: "forbidden",
          message: "Choose a project in your own library.",
          retryable: false,
        });
      return service.changeSelection(input, context);
    },
  };
  const ports: GithubFactoryPorts = {
    ...createUnavailableGithubPorts(),
    ...inspection,
    access: deps.access,
    imports,
    jobs,
    measurements,
    measurementService,
    selectionPolicy: policy,
    reports,
    extractor,
    runner,
    service: safeService,
    approval,
    deferredTasks,
  };
  return {
    ports,
    bindings: {
      async createContext(input) {
        const r = await deps.requestContext(input);
        if (!r.ok) return r;
        if (r.value.personalRoot !== deps.personalRoot)
          return err({
            code: "forbidden",
            message: "The session belongs to another workspace.",
            retryable: false,
          });
        return ok({
          ...r.value,
          budget: createRunBudget({ now, deadline: r.value.deadline }),
        });
      },
    },
  };
}
