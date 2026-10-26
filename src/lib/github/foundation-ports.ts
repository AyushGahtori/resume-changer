/**
 * Reviewed Gate A implementation ports. Control-plane/UI DTOs remain in contracts.ts
 * and ports.ts; cross-boundary conversions must be explicit and validated.
 * Deriving these types from the implementations prevents a second invented API.
 */
export interface GithubFoundationFactories {
  client: typeof import("./server/client").createGithubClient;
  access: typeof import("./server/access").createGithubAccess;
  repository: typeof import("./server/repository").createRepositoryInspector;
  pullRequests: typeof import("./server/pr-context").createPrContextReader;
  selector: typeof import("./server/selector").createEvidenceSelector;
  budget: typeof import("./server/budget").createBudgetLedger;
  imports: typeof import("./server/store").createImportStore;
  deferredTasks: typeof import("./server/store").createDeferredMeasurementTaskStore;
  jobs: typeof import("./server/jobs/store").createJobStore;
  inspection: typeof import("./server/phase-one").createInspectionRun;
}

export type GithubMeasurementFoundation = Pick<
  typeof import("./measurements"),
  "validateMeasurementAnswer" | "deriveMeasurementResult" | "renderMetricClause"
> &
  Pick<typeof import("./measurement-catalog"), "getApplicableDefinitions">;
